import { computed } from 'vue'
import type { SessionUser, TenantRole } from '~/utils/clientFakeApi'

/**
 * Signed-in state for the Sentec Tasks web app.
 *
 * Auth model: the real API issues an httpOnly cookie session with CSRF
 * protection and a CORS allow-list — deliberately NOT a bearer token in
 * localStorage, which any script on the page can read. This composable keeps
 * the same discipline against the mock: no user id, role or permission is ever
 * persisted, and nothing the UI stores can be replayed as a credential beyond
 * the shift window.
 *
 * The one thing held across a page refresh is the opaque resume token, in
 * `sessionStorage` rather than `localStorage` so it dies with the browser tab.
 * That matters on shared shift devices, which is the same reason logout below
 * clears every cached row rather than only the identity.
 */

const RESUME_KEY = 'sentec-tasks-resume'

export interface ReachableTenant {
  id: string
  name: string
  role: TenantRole | null
  /** True when reach comes from a group grant rather than direct membership. */
  viaGroupGrant: boolean
}

export function useSession() {
  const sessionId = useState<string | null>('sessionId', () => null)
  const csrfToken = useState<string | null>('csrfToken', () => null)
  const user = useState<SessionUser | null>('sessionUser', () => null)
  const tenantId = useState<string | null>('activeTenantId', () => null)
  /** True while the initial resume attempt is in flight, to avoid a login flash. */
  const isRestoring = useState<boolean>('sessionRestoring', () => true)

  const isAuthenticated = computed(() => Boolean(sessionId.value && user.value))
  const isOperator = computed(() => Boolean(user.value?.isOperator))
  const tenants = computed<ReachableTenant[]>(() => user.value?.tenants ?? [])
  const activeTenant = computed(() => tenants.value.find(t => t.id === tenantId.value) ?? null)
  const displayName = computed(() => user.value?.displayName ?? '')
  const email = computed(() => user.value?.email ?? '')
  const userId = computed(() => user.value?.userId ?? null)

  /** Role at the active property. Operators act as admin everywhere. */
  const role = computed<TenantRole | 'operator' | null>(() => {
    if (!user.value) return null
    if (user.value.isOperator) return 'operator'
    return activeTenant.value?.role ?? null
  })

  function readResumeToken() {
    if (!import.meta.client) return null
    try {
      return sessionStorage.getItem(RESUME_KEY)
    }
    catch {
      // Private mode or blocked storage: sign-in still works, it just will not
      // survive a refresh.
      return null
    }
  }

  function writeResumeToken(token: string | null) {
    if (!import.meta.client) return
    try {
      if (token) sessionStorage.setItem(RESUME_KEY, token)
      else sessionStorage.removeItem(RESUME_KEY)
    }
    catch { /* storage unavailable — nothing to do */ }
  }

  function adopt(payload: { sessionId: string, csrfToken: string, resumeToken: string, user: SessionUser }) {
    sessionId.value = payload.sessionId
    csrfToken.value = payload.csrfToken
    user.value = payload.user
    writeResumeToken(payload.resumeToken)

    // Pick a property so the first screen has data. A single-property user never
    // sees a chooser at all.
    const stillValid = payload.user.tenants.some(t => t.id === tenantId.value)
    if (!stillValid) tenantId.value = payload.user.tenants[0]?.id ?? null
  }

  async function request<T>(path: string, opts: { method?: string, body?: unknown, query?: Record<string, unknown>, tenantId?: string } = {}): Promise<T> {
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    return handleFakeApiRequest(path, {
      method: opts.method,
      body: opts.body,
      query: opts.query,
      headers: {
        ...(sessionId.value ? { 'x-session-id': sessionId.value } : {}),
        ...(csrfToken.value ? { 'x-csrf-token': csrfToken.value } : {}),
        ...(opts.tenantId ?? tenantId.value ? { 'x-tenant-id': String(opts.tenantId ?? tenantId.value) } : {}),
      },
    }) as T
  }

  async function login(credentials: { username: string, password: string }) {
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    try {
      const res = handleFakeApiRequest('/v1/auth/login', {
        method: 'POST',
        body: { username: credentials.username.trim(), password: credentials.password },
      }) as { data: { sessionId: string, csrfToken: string, resumeToken: string, user: SessionUser } }
      adopt(res.data)
      return { ok: true as const }
    }
    catch (e) {
      return { ok: false as const, message: (e as Error).message }
    }
  }

  /** Re-establish a session on boot. Silent: a dead token just means signed out. */
  async function restore() {
    const token = readResumeToken()
    if (!token) {
      isRestoring.value = false
      return false
    }
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    try {
      const res = handleFakeApiRequest('/v1/auth/resume', { method: 'POST', body: { token } }) as
        { data: { sessionId: string, csrfToken: string, resumeToken: string, user: SessionUser } }
      adopt(res.data)
      return true
    }
    catch {
      writeResumeToken(null)
      return false
    }
    finally {
      isRestoring.value = false
    }
  }

  /**
   * Sign out and forget everything.
   *
   * Finding 3: previously the next person on a shared device saw the last
   * user's tasks until their own data loaded. So this clears the identity, the
   * resume token AND every cached payload — including the selected property,
   * which is why signing back in asks for the property again. That is correct
   * for a shared device even though it costs the single-property user a tap.
   */
  async function logout() {
    try {
      await request('/v1/auth/logout', { method: 'POST' })
    }
    catch { /* already gone server-side; local teardown still has to happen */ }

    sessionId.value = null
    csrfToken.value = null
    user.value = null
    tenantId.value = null
    writeResumeToken(null)
    clearNuxtState()
  }

  function setTenantId(next: string) {
    if (tenants.value.some(t => t.id === next)) tenantId.value = next
  }

  return {
    sessionId,
    user,
    userId,
    displayName,
    email,
    tenantId,
    tenants,
    activeTenant,
    role,
    isOperator,
    isAuthenticated,
    isRestoring,
    login,
    logout,
    restore,
    request,
    setTenantId,
  }
}

/**
 * Drop every cached API payload held in Nuxt state.
 *
 * `useState` keys are shared app-wide, so leaving them populated after a logout
 * is exactly the leak finding 3 describes. Keys are listed explicitly rather
 * than wildcarded so adding a new cache is a deliberate act.
 */
function clearNuxtState() {
  const keys = [
    'cachedTasks',
    'cachedBoard',
    'cachedDepartments',
    'cachedSlas',
    'cachedCatalogItems',
    'cachedCatalogCategories',
    'cachedStaff',
    'cachedRoutingRules',
    'cachedSummary',
  ]
  for (const key of keys) {
    const state = useState<unknown>(key, () => null)
    state.value = null
  }
}
