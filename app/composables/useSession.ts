import { computed } from 'vue'
import { ApiError } from '~/utils/clientFakeApi'
import type { Envelope, FakeResponse, HotelMembership, Property, Staff } from '~/utils/clientFakeApi'
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
 * which hands the app nothing but the cookie.
 *
 * Roles are PER PROPERTY (feat/projects): the Staff payload carries
 * `properties` (the reach) and `memberships` (role, department and the
 * create-task permission at each hotel). `role`, `departmentId` and
 * `createTask` below are read from the membership at the SELECTED hotel and
 * change with the switcher; a hotel reached only through a group grant has
 * no membership, so the person is plain staff there.
 *
 * Two transports, one contract. With `NUXT_PUBLIC_API_BASE` set the calls go
 * to the API with `credentials: 'include'` and the browser holds the real
 * cookie; unset, they go to the in-browser mock, which cannot mint an
 * httpOnly cookie, so the session id is held here and replayed as a
 * `Cookie: st_session=…` header. Either way the id (or, live, a "signed in
 * here" marker) is the ONE thing persisted across a refresh — since
 * 2026-09-17 in a cookie of its own (`SameSite=Strict`, `Secure` on https,
 * scoped to this app's base path) with the same 12-hour `Max-Age=43200` the
 * real `st_session` cookie has. Identity and the CSRF token are recovered
 * from GET /v1/auth/session on boot.
 */

const SESSION_KEY = 'sentec-tasks-session'
/** Mirrors the real cookie's Max-Age. The mock's session row expires on the same clock. */
const SESSION_COOKIE_MAX_AGE_S = 12 * 60 * 60
/** Live mode: the browser holds the real cookie; this marker only says "a session was started here". */
const LIVE_SESSION_MARKER = 'live'

export interface ReachableHotel {
  id: string
  name: string
}

export interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, unknown>
  hotelId?: string | null
}

export function useSession() {
  const sessionId = useState<string | null>('sessionId', () => null)
  const csrfToken = useState<string | null>('csrfToken', () => null)
  const staff = useState<Staff | null>('sessionStaff', () => null)
  const hotelId = useState<string | null>('activeHotelId', () => null)
  /** True while the initial recovery attempt is in flight, to avoid a login flash. */
  const isRestoring = useState<boolean>('sessionRestoring', () => true)
  /**
   * Set once when boot found a stored session the server no longer knows
   * (the 12-hour window passed while the tab was closed, or a sign-out from
   * elsewhere). The auth middleware reads it — once — to say why on `/login`.
   */
  const expiredOnRestore = useState<boolean>('sessionExpiredOnRestore', () => false)

  const runtimeConfig = useRuntimeConfig()
  const apiBase = String((runtimeConfig.public as { apiBase?: string }).apiBase ?? '').replace(/\/+$/, '')
  /** True when requests go to a real API; false on the in-browser mock. */
  const isLive = Boolean(apiBase)

  const isAuthenticated = computed(() => Boolean(sessionId.value && staff.value))
  const isOperator = computed(() => Boolean(staff.value?.isOperator))
  const displayName = computed(() => staff.value?.name ?? '')
  const email = computed(() => staff.value?.email ?? '')
  const userId = computed(() => staff.value?.id ?? null)

  const properties = computed<Property[]>(() => staff.value?.properties ?? [])
  const memberships = computed<HotelMembership[]>(() => staff.value?.memberships ?? [])
  /** The standing at the selected hotel; null at a grant-only hotel or with none selected. */
  const membership = computed(() => memberships.value.find(m => m.hotelRef === hotelId.value) ?? null)
  /** Role AT THE SELECTED HOTEL — plain staff where there is no membership. */
  const role = computed(() => (staff.value ? membership.value?.role ?? 'staff' : null))
  const departmentId = computed(() => membership.value?.hotelDepartmentId ?? null)
  const createTask = computed(() => Boolean(membership.value?.createTask))

  const hotels = computed<ReachableHotel[]>(() => properties.value.map(p => ({ id: p.hotelRef, name: p.name })))
  const activeHotel = computed(() => hotels.value.find(h => h.id === hotelId.value) ?? null)

  const cookiePath = cookiePathFor(runtimeConfig.app.baseURL)

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
    // Keep the selected hotel if it is still in the reach; else the first
    // property (the API sorts them by name).
    const reach = payload.staff.properties.map(p => p.hotelRef)
    if (!reach.includes(hotelId.value ?? '')) hotelId.value = reach[0] ?? null
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  interface TransportOptions {
    method?: string
    body?: unknown
    query?: Record<string, unknown>
    headers?: Record<string, string>
  }

  /** The API's error envelope, as one ApiError the screens already know how to read. */
  function toApiError(err: unknown): ApiError {
    if (err instanceof ApiError) return err
    const response = (err as { response?: { status?: number, _data?: unknown } })?.response
    const status = response?.status ?? 0
    const first = (response?._data as { errors?: Array<{ code?: string, message?: string }> } | undefined)?.errors?.[0]
    const code = first?.code ?? (status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'ERROR')
    const message = first?.message ?? (typeof response?._data === 'string' ? response._data : (err as Error)?.message ?? 'Request failed')
    const wrapped = new ApiError(code, message)
    if (status) wrapped.status = status
    return wrapped
  }

  /**
   * One request, either transport. Live: `$fetch` with credentials, so the
   * browser sends the real `st_session` cookie; the response envelope comes
   * back with its status. Mock: the in-browser API with the cookie replayed
   * as a header. Both throw ApiError on a non-2xx.
   */
  async function transport<T>(path: string, opts: TransportOptions = {}): Promise<FakeResponse<T>> {
    if (!isLive) {
      const { handleFakeApiRequest } = await import('~/utils/clientFakeApi')
      return handleFakeApiRequest(path, {
        method: opts.method,
        body: opts.body as Record<string, unknown> | undefined,
        query: opts.query as Record<string, string> | undefined,
        headers: {
          ...(sessionId.value && sessionId.value !== LIVE_SESSION_MARKER ? { cookie: `st_session=${sessionId.value}` } : {}),
          ...opts.headers,
        },
      }) as FakeResponse<T>
    }
    try {
      const res = await $fetch.raw<Envelope<T>>(`${apiBase}${path}`, {
        method: (opts.method ?? 'GET') as 'GET',
        body: opts.body as Record<string, unknown> | FormData | undefined,
        query: opts.query,
        credentials: 'include',
        headers: opts.headers,
      })
      return { status: res.status, body: (res._data ?? null) as Envelope<T> | null }
    }
    catch (err) {
      throw toApiError(err)
    }
  }

  /** The headers every signed-in call carries: the CSRF echo and the hotel scope. */
  function scopedHeaders(hotelOverride?: string | null): Record<string, string> {
    const scope = hotelOverride === undefined ? hotelId.value : hotelOverride
    return {
      ...(csrfToken.value ? { 'x-csrf-token': csrfToken.value } : {}),
      ...(scope ? { 'x-hotel-id': scope } : {}),
    }
  }

  /**
   * One signed-in request: status + envelope. A 401 while signed in means the
   * cookie session is gone server-side (the 12-hour window passed, a sign-out
   * elsewhere, a server restart): forget it here and go to /login; the error
   * still propagates so the calling screen stops its own flow. Not for the
   * logout call itself — that is the user leaving, and a 401 there just means
   * "already gone".
   */
  async function requestRaw<T = unknown>(path: string, opts: RequestOptions = {}): Promise<FakeResponse<T>> {
    try {
      return await transport<T>(path, { method: opts.method, body: opts.body, query: opts.query, headers: scopedHeaders(opts.hotelId) })
    }
    catch (err) {
      if (isSessionInvalidError(err) && isAuthenticated.value && path !== '/v1/auth/logout') {
        await signOutAfterSessionExpiry(forgetSession)
      }
      throw err
    }
  }

  /** One signed-in request; returns the response envelope's body. */
  async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<Envelope<T>> {
    const res = await requestRaw<T>(path, opts)
    return (res.body ?? { version: 'v1', data: null }) as Envelope<T>
  }

  /**
   * A multipart upload (POST /v1/staff/import): live, a real FormData with
   * the file under `file`; on the mock, the file's text under
   * body.file {name, content}, since a function call has no multipart.
   */
  async function upload<T = unknown>(path: string, file: File, opts: { hotelId?: string | null } = {}): Promise<Envelope<T>> {
    let body: unknown
    if (isLive) {
      const form = new FormData()
      form.append('file', file, file.name)
      body = form
    }
    else {
      body = { file: { name: file.name, content: await file.text() } }
    }
    const res = await requestRaw<T>(path, { method: 'POST', body, hotelId: opts.hotelId })
    return (res.body ?? { version: 'v1', data: null }) as Envelope<T>
  }

  /**
   * A raw file download (GET /v1/staff/import/template): live, the bytes with
   * the filename from Content-Disposition; on the mock, the text the mock
   * handed back. Errors are still the JSON envelope, via ApiError.
   */
  async function download(path: string, query: Record<string, unknown> = {}, opts: { hotelId?: string | null } = {}): Promise<{ blob: Blob, filename: string }> {
    if (!isLive) {
      const res = await requestRaw(path, { query, hotelId: opts.hotelId })
      const raw = res.raw
      if (!raw) throw new ApiError('ERROR', 'no file in the response')
      return { blob: new Blob([raw.content], { type: raw.contentType }), filename: raw.filename }
    }
    const url = new URL(`${apiBase}${path}`, window.location.origin)
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    const res = await fetch(url.toString(), { credentials: 'include', headers: scopedHeaders(opts.hotelId) })
    if (!res.ok) {
      let data: unknown = null
      try {
        data = await res.json()
      }
      catch { /* not JSON */ }
      const err = toApiError({ response: { status: res.status, _data: data } })
      if (isSessionInvalidError(err) && isAuthenticated.value) await signOutAfterSessionExpiry(forgetSession)
      throw err
    }
    const disposition = res.headers.get('content-disposition') ?? ''
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
    return { blob: await res.blob(), filename: match?.[1] ? decodeURIComponent(match[1]) : 'download' }
  }

  // ── Sign-in paths ──────────────────────────────────────────────────────────

  /** A failed sign-in call as the screen needs it: the API's code and message. */
  const failure = (e: unknown) => {
    const err = toApiError(e)
    return { ok: false as const, code: err.code ?? 'ERROR', message: err.message }
  }

  /** Password login — kept as the transition fallback beside the two passwordless paths. */
  async function login(credentials: { email: string, password: string }) {
    try {
      const res = await transport<{ csrfToken: string, staff: Staff, _sessionCookie?: string }>('/v1/auth/staff/login', {
        method: 'POST',
        query: { delivery: 'cookie' },
        body: { email: credentials.email.trim(), password: credentials.password },
      })
      const data = res.body!.data
      // Live, the browser now holds st_session; the mock hands the id back in
      // its Set-Cookie seam (`_sessionCookie`, a field the real response lacks).
      adopt({ sessionId: isLive ? LIVE_SESSION_MARKER : data._sessionCookie!, csrfToken: data.csrfToken, staff: data.staff })
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
   * can say, instead of a dead end on the API's own error page. A 503 means
   * the deployment has no Google client configured — "not available", not
   * an error.
   */
  async function googleSignInUrl(returnTo: string) {
    try {
      const res = await transport<{ url: string }>('/v1/auth/google/url', { query: { returnTo } })
      return { ok: true as const, url: res.body!.data.url }
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
    try {
      await transport('/v1/auth/magic-link/request', { method: 'POST', body: { email: email.trim(), returnTo } })
      return { ok: true as const }
    }
    catch (e) {
      return failure(e)
    }
  }

  /**
   * GET /v1/auth/session: adopt identity and CSRF token, or forget the stored
   * session if the server no longer knows it. `id` is the mock's session id;
   * live it is the marker and the browser's cookie does the talking.
   */
  async function recover(id: string) {
    try {
      const res = await transport<{ csrfToken: string, staff: Staff }>('/v1/auth/session', {
        headers: isLive ? {} : { cookie: `st_session=${id}` },
      })
      const data = res.body!.data
      adopt({ sessionId: isLive ? LIVE_SESSION_MARKER : id, csrfToken: data.csrfToken, staff: data.staff })
      return true
    }
    catch {
      writeStoredSession(null)
      return false
    }
  }

  /**
   * CSRF recovery on boot: the cookie survives a refresh, the token does not.
   * Live, the app also lands here straight after a redirect-based sign-in with
   * nothing but the cookie — so it always asks, and a 401 simply means "not
   * signed in" unless a session had been started on this device.
   */
  async function restore() {
    const stored = readStoredSession()
    if (!stored && !isLive) {
      isRestoring.value = false
      return false
    }
    try {
      const ok = await recover(stored ?? LIVE_SESSION_MARKER)
      if (!ok && stored) expiredOnRestore.value = true
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
   * GET /v1/auth/session exactly as it does on a cold boot. The mock cannot
   * set that cookie from a 302, so the id it carried is handed in here and
   * stored where the cookie seam already lives; the recovery is the same.
   */
  async function adoptCookieSession(id: string) {
    writeStoredSession(isLive ? LIVE_SESSION_MARKER : id)
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

  /** Switch property — anything in the reach, membership or grant alike. */
  function setHotelId(next: string) {
    if (properties.value.some(p => p.hotelRef === next)) hotelId.value = next
  }

  return {
    isLive,
    sessionId,
    staff,
    userId,
    displayName,
    email,
    role,
    departmentId,
    createTask,
    membership,
    memberships,
    properties,
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
    requestRaw,
    upload,
    download,
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
    'cachedTenant',
    'cachedProjects',
    'hotelNames',
  ]
  for (const key of keys) {
    const state = useState<unknown>(key, () => null)
    state.value = null
  }
}
