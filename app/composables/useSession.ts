import { computed } from 'vue'
import type { Envelope, Staff } from '~/utils/clientFakeApi'

/**
 * Signed-in state against the real Sentec Tasks API contract.
 *
 * Auth model: POST /v1/auth/staff/login?delivery=cookie sets the httpOnly
 * `st_session` cookie and returns {csrfToken, staff}; every mutation must echo
 * the CSRF token as X-CSRF-Token; GET /v1/auth/session recovers the token
 * after a refresh. A browser-side mock cannot mint an httpOnly cookie, so the
 * session id is held here and replayed as a `Cookie: st_session=…` header —
 * the shape is the contract's, the protection is necessarily the server's.
 *
 * The session id is the ONE thing persisted across a refresh, in
 * `sessionStorage` so it dies with the tab — the same 12-hour shift-device
 * discipline the real cookie has (Max-Age=43200).
 */

const SESSION_KEY = 'sentec-tasks-session'

export interface ReachableHotel {
  id: string
  name: string
}

export function useSession() {
  const sessionId = useState<string | null>('sessionId', () => null)
  const csrfToken = useState<string | null>('csrfToken', () => null)
  const staff = useState<Staff | null>('sessionStaff', () => null)
  const hotelId = useState<string | null>('activeHotelId', () => null)
  /** True while the initial recovery attempt is in flight, to avoid a login flash. */
  const isRestoring = useState<boolean>('sessionRestoring', () => true)

  const isAuthenticated = computed(() => Boolean(sessionId.value && staff.value))
  const isOperator = computed(() => Boolean(staff.value?.isOperator))
  const displayName = computed(() => staff.value?.name ?? '')
  const email = computed(() => staff.value?.email ?? '')
  const userId = computed(() => staff.value?.id ?? null)
  /** Account-wide role — the real API has one role per account, not per hotel. */
  const role = computed(() => staff.value?.role ?? null)
  const createTask = computed(() => Boolean(staff.value?.createTask))

  const hotels = computed<ReachableHotel[]>(() => (staff.value?.hotels ?? []).map(id => ({ id, name: hotelNames.value[id] ?? id })))
  const activeHotel = computed(() => hotels.value.find(h => h.id === hotelId.value) ?? null)

  /** Hotel display names, resolved lazily from the mock's demo helper. */
  const hotelNames = useState<Record<string, string>>('hotelNames', () => ({}))

  async function resolveHotelNames(ids: string[]) {
    const { demoHotelName } = await import('~/utils/clientFakeApi')
    const next = { ...hotelNames.value }
    for (const id of ids) next[id] = demoHotelName(id)
    hotelNames.value = next
  }

  function readStoredSession() {
    if (!import.meta.client) return null
    try {
      return sessionStorage.getItem(SESSION_KEY)
    }
    catch {
      return null
    }
  }

  function writeStoredSession(id: string | null) {
    if (!import.meta.client) return
    try {
      if (id) sessionStorage.setItem(SESSION_KEY, id)
      else sessionStorage.removeItem(SESSION_KEY)
    }
    catch { /* storage unavailable — sign-in just will not survive a refresh */ }
  }

  function adopt(payload: { sessionId: string, csrfToken: string, staff: Staff }) {
    sessionId.value = payload.sessionId
    csrfToken.value = payload.csrfToken
    staff.value = payload.staff
    writeStoredSession(payload.sessionId)
    void resolveHotelNames(payload.staff.hotels)
    const stillValid = payload.staff.hotels.includes(hotelId.value ?? '')
    if (!stillValid) hotelId.value = payload.staff.hotels[0] ?? null
  }

  /**
   * One request against the API. Injects the session cookie, the CSRF echo and
   * the X-Hotel-Id scope; returns the response envelope's body. Swapping the
   * mock for the real API means replacing the import below with $fetch — the
   * headers and paths are already the real contract.
   */
  async function request<T = unknown>(path: string, opts: { method?: string, body?: unknown, query?: Record<string, unknown>, hotelId?: string | null } = {}): Promise<Envelope<T>> {
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    const scope = opts.hotelId === undefined ? hotelId.value : opts.hotelId
    const res = handleFakeApiRequest(path, {
      method: opts.method,
      body: opts.body as Record<string, unknown> | undefined,
      query: opts.query as Record<string, string> | undefined,
      headers: {
        ...(sessionId.value ? { cookie: `st_session=${sessionId.value}` } : {}),
        ...(csrfToken.value ? { 'x-csrf-token': csrfToken.value } : {}),
        ...(scope ? { 'x-hotel-id': scope } : {}),
      },
    })
    return (res.body ?? { version: 'v1', data: null }) as Envelope<T>
  }

  async function login(credentials: { email: string, password: string }) {
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    try {
      const res = handleFakeApiRequest('/v1/auth/staff/login', {
        method: 'POST',
        query: { delivery: 'cookie' },
        body: { email: credentials.email.trim(), password: credentials.password },
      })
      const data = res.body?.data as { csrfToken: string, staff: Staff, _sessionCookie: string }
      adopt({ sessionId: data._sessionCookie, csrfToken: data.csrfToken, staff: data.staff })
      return { ok: true as const }
    }
    catch (e) {
      return { ok: false as const, message: (e as Error).message }
    }
  }

  /** CSRF recovery on boot: the cookie survives a refresh, the token does not. */
  async function restore() {
    const stored = readStoredSession()
    if (!stored) {
      isRestoring.value = false
      return false
    }
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    try {
      const res = handleFakeApiRequest('/v1/auth/session', { headers: { cookie: `st_session=${stored}` } })
      const data = res.body?.data as { csrfToken: string, staff: Staff }
      adopt({ sessionId: stored, csrfToken: data.csrfToken, staff: data.staff })
      return true
    }
    catch {
      writeStoredSession(null)
      return false
    }
    finally {
      isRestoring.value = false
    }
  }

  /**
   * Sign out and forget everything — identity, session, every cached payload,
   * and the selected property. Correct for a shared shift device.
   */
  async function logout() {
    try {
      await request('/v1/auth/logout', { method: 'POST' })
    }
    catch { /* already gone server-side; local teardown still has to happen */ }

    sessionId.value = null
    csrfToken.value = null
    staff.value = null
    hotelId.value = null
    writeStoredSession(null)
    clearNuxtState()
  }

  function setHotelId(next: string) {
    if (staff.value?.hotels.includes(next)) hotelId.value = next
  }

  return {
    sessionId,
    staff,
    userId,
    displayName,
    email,
    role,
    createTask,
    hotelId,
    hotels,
    activeHotel,
    isOperator,
    isAuthenticated,
    isRestoring,
    login,
    logout,
    restore,
    request,
    setHotelId,
  }
}

/**
 * Drop every cached API payload held in Nuxt state. Keys are listed explicitly
 * rather than wildcarded so adding a new cache is a deliberate act.
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
    'hotelNames',
  ]
  for (const key of keys) {
    const state = useState<unknown>(key, () => null)
    state.value = null
  }
}
