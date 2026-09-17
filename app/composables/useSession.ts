import { computed } from 'vue'
import type { ApiError, Envelope, Staff } from '~/utils/clientFakeApi'
import { isSessionInvalidError } from '~/utils/sign-in'
import { cookiePathFor, isSecureOrigin, readCookie, writeCookie } from '~/utils/session-cookie'

/**
 * Signed-in state against the real Sentec Tasks API contract.
 *
 * Auth model: three sign-in paths — password (POST /v1/auth/staff/login
 * ?delivery=cookie), Google Sign-In (GET /v1/auth/google/url → callback) and
 * the emailed magic link (POST /v1/auth/magic-link/request → verify) — all
 * mint the same httpOnly `st_session` cookie; there is no separate actor kind.
 * Every mutation must echo the CSRF token as X-CSRF-Token; GET /v1/auth/session
 * recovers the token after a refresh, and after either redirect-based sign-in,
 * which hands the app nothing but the cookie. A browser-side mock cannot mint
 * an httpOnly cookie, so the session id is held here and replayed as a
 * `Cookie: st_session=…` header — the shape is the contract's, the protection
 * is necessarily the server's.
 *
 * The session id is the ONE thing persisted across a refresh — since
 * 2026-09-17 in a cookie of its own (`SameSite=Strict`, `Secure` on https,
 * scoped to this app's base path) with the same 12-hour `Max-Age=43200` the
 * real `st_session` cookie has, so the shift-device discipline is the
 * browser's to enforce rather than the tab's. Nothing else is stored: identity
 * and the CSRF token are recovered from GET /v1/auth/session on boot. It was
 * in sessionStorage before; a leftover there is adopted once and removed.
 */

const SESSION_KEY = 'sentec-tasks-session'
/** Mirrors the real cookie's Max-Age. The mock's session row expires on the same clock. */
const SESSION_COOKIE_MAX_AGE_S = 12 * 60 * 60

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
  /**
   * Set once when boot found a stored session id the server no longer knows
   * (the 12-hour window passed while the tab was closed, or a sign-out from
   * elsewhere). The auth middleware reads it — once — to say why on `/login`.
   */
  const expiredOnRestore = useState<boolean>('sessionExpiredOnRestore', () => false)

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

  const cookiePath = cookiePathFor(useRuntimeConfig().app.baseURL)

  function readStoredSession() {
    if (!import.meta.client) return null
    const fromCookie = readCookie(SESSION_KEY)
    if (fromCookie) return fromCookie
    // Pre-2026-09-17 builds kept the id in sessionStorage. Move it once.
    try {
      const legacy = sessionStorage.getItem(SESSION_KEY)
      if (legacy) {
        sessionStorage.removeItem(SESSION_KEY)
        writeStoredSession(legacy)
        return legacy
      }
    }
    catch { /* storage unavailable — nothing to migrate */ }
    return null
  }

  function writeStoredSession(id: string | null) {
    if (!import.meta.client) return
    try {
      writeCookie(SESSION_KEY, id, { path: cookiePath, maxAgeSeconds: SESSION_COOKIE_MAX_AGE_S, secure: isSecureOrigin() })
    }
    catch { /* cookies blocked — sign-in just will not survive a refresh */ }
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
    let res: ReturnType<typeof handleFakeApiRequest>
    try {
      res = handleFakeApiRequest(path, {
        method: opts.method,
        body: opts.body as Record<string, unknown> | undefined,
        query: opts.query as Record<string, string> | undefined,
        headers: {
          ...(sessionId.value ? { cookie: `st_session=${sessionId.value}` } : {}),
          ...(csrfToken.value ? { 'x-csrf-token': csrfToken.value } : {}),
          ...(scope ? { 'x-hotel-id': scope } : {}),
        },
      })
    }
    catch (err) {
      // A 401 while signed in means the cookie session is gone server-side:
      // the 12-hour window passed, a sign-out elsewhere, a server restart.
      // Forget it here and go to /login; the error still propagates so the
      // calling screen stops its own flow. Not for the logout call itself —
      // that is the user leaving, and a 401 there just means "already gone".
      if (isSessionInvalidError(err) && isAuthenticated.value && path !== '/v1/auth/logout') {
        await signOutAfterSessionExpiry(forgetSession)
      }
      throw err
    }
    return (res.body ?? { version: 'v1', data: null }) as Envelope<T>
  }

  /** A failed sign-in call as the screen needs it: the API's code and message. */
  const failure = (e: unknown) => ({ ok: false as const, code: (e as ApiError).code ?? 'ERROR', message: (e as Error).message })

  /** Password login — kept as the transition fallback beside the two passwordless paths. */
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
      return failure(e)
    }
  }

  /**
   * GET /v1/auth/google/url: the Google authorization URL to navigate the
   * browser to (a full-page navigation, not a fetch). It answers JSON rather
   * than 302ing precisely so a 400, 429 or 503 here is something this screen
   * can say, instead of a dead end on the API's own error page.
   */
  async function googleSignInUrl(returnTo: string) {
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    try {
      const res = handleFakeApiRequest('/v1/auth/google/url', { query: { returnTo } })
      return { ok: true as const, url: (res.body?.data as { url: string }).url }
    }
    catch (e) {
      return failure(e)
    }
  }

  /**
   * POST /v1/auth/magic-link/request. A 202 means "acted on your request",
   * never "that account exists" — the body is byte-identical either way, and
   * the screen must not word it any other way. Only 400 (malformed email or
   * disallowed returnTo), 429 and 503 differ, none of which is about the
   * address.
   */
  async function requestMagicLink(email: string, returnTo: string) {
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    try {
      handleFakeApiRequest('/v1/auth/magic-link/request', { method: 'POST', body: { email: email.trim(), returnTo } })
      return { ok: true as const }
    }
    catch (e) {
      return failure(e)
    }
  }

  /**
   * GET /v1/auth/session with a session id: adopt identity and CSRF token, or
   * forget the id if the server no longer knows it.
   */
  async function recover(id: string) {
    const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
    try {
      const res = handleFakeApiRequest('/v1/auth/session', { headers: { cookie: `st_session=${id}` } })
      const data = res.body?.data as { csrfToken: string, staff: Staff }
      adopt({ sessionId: id, csrfToken: data.csrfToken, staff: data.staff })
      return true
    }
    catch {
      writeStoredSession(null)
      return false
    }
  }

  /** CSRF recovery on boot: the cookie survives a refresh, the token does not. */
  async function restore() {
    const stored = readStoredSession()
    if (!stored) {
      isRestoring.value = false
      return false
    }
    try {
      const ok = await recover(stored)
      if (!ok) expiredOnRestore.value = true
      return ok
    }
    finally {
      isRestoring.value = false
    }
  }

  /**
   * After a redirect-based sign-in (Google callback, magic-link verify) the
   * session arrives as the cookie and nothing else — no token, no CSRF token
   * in the URL. The app then recovers identity and CSRF from
   * GET /v1/auth/session exactly as it does on a cold boot. A browser mock
   * cannot set that cookie from a 302, so the id it carried is handed in here
   * and stored where the cookie seam already lives; the recovery is the same.
   */
  async function adoptCookieSession(id: string) {
    writeStoredSession(id)
    return recover(id)
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

    forgetSession()
  }

  /**
   * Forget everything on this device — identity, session id, every cached
   * payload, the selected property — without talking to the API. The local
   * half of `logout`, and the whole of a sign-out the server forced.
   */
  function forgetSession() {
    sessionId.value = null
    csrfToken.value = null
    staff.value = null
    hotelId.value = null
    writeStoredSession(null)
    clearNuxtState()
  }

  /**
   * Tear the session down because the API no longer accepts it. Unlike
   * `logout` this does NOT call `POST /v1/auth/logout`: the cookie is already
   * dead, so the call could only 401 again. Callers send the user to `/login`.
   */
  function expireSession() {
    forgetSession()
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
    expiredOnRestore,
    login,
    googleSignInUrl,
    requestMagicLink,
    adoptCookieSession,
    logout,
    expireSession,
    restore,
    request,
    setHotelId,
  }
}

/**
 * The one in-flight forced sign-out. A screen fires several requests at once
 * (board, counts, staff list) and every one of them 401s when the session
 * dies; only the first tears down and navigates, the rest wait on the same
 * promise so `/login` is not pushed onto the history stack several times.
 */
let sessionExpiryInFlight: Promise<void> | null = null

/**
 * Forget the session and go to `/login?reason=expired`, remembering the page
 * the user was on so a fresh sign-in puts them back (`safeRedirectPath` on the
 * login screen keeps it in-app).
 */
function signOutAfterSessionExpiry(forget: () => void): Promise<void> {
  if (sessionExpiryInFlight) return sessionExpiryInFlight
  sessionExpiryInFlight = (async () => {
    try {
      forget()
      const route = useRoute()
      if (route.path !== '/login') {
        await navigateTo({
          path: '/login',
          query: route.fullPath === '/' ? { reason: 'expired' } : { reason: 'expired', redirect: route.fullPath },
        })
      }
    }
    finally {
      sessionExpiryInFlight = null
    }
  })()
  return sessionExpiryInFlight
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
