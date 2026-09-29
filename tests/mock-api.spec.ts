import { describe, expect, it } from 'vitest'
import { ApiError, IDS, demoAllowedOrigins, demoFollowApiLink, demoGoogleCallbackUrl, demoGoogleConsent, demoOutbox, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// Core wire-contract pins for the mock of sentec-tasks-api (master @ c3f52ad,
// sign-in branch @ 48756a3):
// envelope shape, auth model (cookie + CSRF, bearer stand-ins), hotel scoping,
// and the transport quirks (plain-text 404, null-vs-[] serialization) that a
// faithful client has to survive.
//
// Suites share one mock instance and run in order; each notes what it leaves
// behind.

interface Session { cookie: string, csrf: string, staff: { id: string, properties: Array<{ hotelRef: string, name: string }>, memberships: Array<{ hotelRef: string, role: string, hotelDepartmentId: string | null, createTask: boolean }> } }

function login(email: string, password: string): Session {
  const res = call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
  const data = res.body!.data as { csrfToken: string, staff: Session['staff'], _sessionCookie: string }
  return { cookie: `st_session=${data._sessionCookie}`, csrf: data.csrfToken, staff: data.staff }
}

function h(session: Session, hotelId?: string) {
  return { 'cookie': session.cookie, 'x-csrf-token': session.csrf, ...(hotelId ? { 'x-hotel-id': hotelId } : {}) }
}

const service = (hotelId?: string) => ({ authorization: 'Bearer service:test', ...(hotelId ? { 'x-hotel-id': hotelId } : {}) })

function errOf(fn: () => unknown): { code: string, message: string, status: number } {
  try {
    fn()
    return { code: 'NO_ERROR', message: '', status: 0 }
  }
  catch (e) {
    const err = e as ApiError
    return { code: err.code, message: err.message, status: err.status }
  }
}

const H = IDS.hotel.simatupang

describe('transport and envelope', () => {
  it('wraps every response in the v1 envelope', () => {
    const res = call('/healthz')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ version: 'v1', data: { status: 'ok' } })
  })

  it('answers unknown routes with the mux plain-text 404, not the envelope', () => {
    try {
      call('/v1/nope', { headers: service() })
      expect.fail('should have thrown')
    }
    catch (e) {
      const err = e as ApiError
      expect(err.message).toBe('404 page not found')
      expect(err.plain).toBe(true)
    }
  })

  it('serializes an empty task list as data null, and list meta uses total', () => {
    const admin = login('admin@aston.example', 'admin123')
    const res = call('/v1/tasks', { headers: h(admin, H), query: { roomNumber: 'no-such-room' } })
    expect(res.body!.data).toBeNull()
    expect(res.body!.meta).toEqual({ total: 0 })
  })

  it('serializes empty config lists as [], not null', () => {
    // A hotel the service actor names freely; it has no config at all.
    const res = call('/v1/routing-rules', { headers: service(), query: { hotelRef: '99999999-0000-4000-8000-000000000001' } })
    expect(res.body!.data).toEqual([])
  })
})

describe('auth model', () => {
  it('logs in by email, returning the CSRF token, the reach and the per-property memberships', () => {
    const regional = login('regional@aston.example', 'regional123')
    // The reach (properties) is the membership at Kuningan plus every hotel
    // of the granted Aston group, sorted by name; the membership list holds
    // only the hotels with a staff_hotel row — Kuningan, as admin.
    const reach = regional.staff.properties.map(p => p.hotelRef)
    expect(reach).toContain(IDS.hotel.kuningan)
    expect(reach).toContain(IDS.hotel.simatupang)
    expect(regional.staff.properties.map(p => p.name)).toEqual([...regional.staff.properties.map(p => p.name)].sort())
    expect(regional.staff.memberships).toEqual([{ hotelRef: IDS.hotel.kuningan, role: 'admin', hotelDepartmentId: null, createTask: true }])
    // The old account-wide fields are gone from the wire.
    expect('role' in regional.staff).toBe(false)
    expect('hotels' in regional.staff).toBe(false)
    expect(regional.csrf.length).toBeGreaterThan(20)
  })

  it('resolves role, department and createTask from the membership at the X-Hotel-Id hotel', () => {
    const budi = login('staff@aston.example', 'staff123')
    // Two memberships, one role each; the header picks which one governs.
    expect(budi.staff.memberships.map(m => m.hotelRef).sort()).toEqual([IDS.hotel.simatupang, IDS.hotel.kuningan].sort())
    // Rina is admin at Kuningan only: the admin-only staff list works there…
    const rina = login('regional@aston.example', 'regional123')
    expect(call('/v1/staff', { headers: h(rina, IDS.hotel.kuningan) }).status).toBe(200)
    // …and is refused at Simatupang, which she reaches through the grant alone.
    expect(errOf(() => call('/v1/staff', { headers: h(rina, IDS.hotel.simatupang) })).message).toBe('admin access required')
    // A hotel-scoped admin route with NO hotel is a 400 now, where it was 403.
    expect(errOf(() => call('/v1/slas', { method: 'POST', headers: h(budi), body: { name: 'X', responseTime: 5, resolutionTime: 10 } })).message).toBe('hotel context required')
  })

  it('refuses bad credentials and rate-limits after five failures', () => {
    expect(errOf(() => login('admin@aston.example', 'wrong')).message).toBe('invalid email or password')
    for (let i = 0; i < 5; i++) {
      errOf(() => login('nobody@aston.example', 'wrong'))
    }
    const limited = errOf(() => login('nobody@aston.example', 'wrong'))
    expect(limited.code).toBe('RATE_LIMITED')
    expect(limited.message).toBe('too many login attempts')
  })

  it('a present-but-malformed Authorization header never falls back to the cookie', () => {
    const admin = login('admin@aston.example', 'admin123')
    const err = errOf(() => call('/v1/tasks', { headers: { 'cookie': admin.cookie, 'authorization': 'Basic nope', 'x-hotel-id': H } }))
    expect(err.message).toBe('missing bearer token')
  })

  it('requires the CSRF echo on cookie mutations, and only on mutations', () => {
    const admin = login('admin@aston.example', 'admin123')
    const err = errOf(() => call('/v1/slas', { method: 'POST', headers: { 'cookie': admin.cookie, 'x-hotel-id': H }, body: { name: 'X', responseTime: 5, resolutionTime: 10 } }))
    expect(err.message).toBe('invalid CSRF token')
    // A GET with no token is fine; bearer/service actors are exempt entirely.
    expect(call('/v1/slas', { headers: { 'cookie': admin.cookie, 'x-hotel-id': H } }).status).toBe(200)
    expect(call('/v1/tasks', { headers: service(H) }).status).toBe(200)
  })

  it('default-delivery login returns a bearer token that works without CSRF', () => {
    const res = call('/v1/auth/staff/login', { method: 'POST', body: { email: 'admin@aston.example', password: 'admin123' } })
    const data = res.body!.data as { token: string }
    expect(data.token.length).toBeGreaterThan(20)
    const list = call('/v1/slas', { headers: { 'authorization': `Bearer ${data.token}`, 'x-hotel-id': H } })
    expect(list.status).toBe(200)
  })

  it('session recovery is cookie-only; logout applies to cookie sessions', () => {
    const admin = login('admin@aston.example', 'admin123')
    const recovered = call('/v1/auth/session', { headers: { cookie: admin.cookie } })
    expect((recovered.body!.data as { csrfToken: string }).csrfToken).toBe(admin.csrf)
    expect(errOf(() => call('/v1/auth/session', { headers: service() })).message)
      .toBe('this endpoint requires an active cookie session')
    expect(errOf(() => call('/v1/auth/logout', { method: 'POST', headers: service() })).message)
      .toBe('logout applies to cookie sessions')
    call('/v1/auth/logout', { method: 'POST', headers: h(admin) })
    expect(errOf(() => call('/v1/tasks', { headers: h(admin, H) })).code).toBe('UNAUTHORIZED')
  })

  it('serviceAuth-only mounts refuse everything but a service token', () => {
    const admin = login('admin@aston.example', 'admin123')
    expect(errOf(() => call('/v1/tenants', { method: 'POST', headers: h(admin), body: {} })).message)
      .toBe('missing bearer token')
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: { authorization: 'Bearer partner:whatever' }, body: { name: 'X' } })).message)
      .toBe('invalid service token')
  })

  it('a deactivated partner token stops verifying immediately', () => {
    // Partner 3 (Sentec EMS) is seeded inactive.
    expect(errOf(() => call('/v1/tasks', { headers: { 'authorization': `Bearer partner:${IDS.partner.ems}`, 'x-hotel-id': H } })).message)
      .toBe('invalid token')
    // Partner 1 (Butler) is active and reads fine.
    expect(call('/v1/tasks', { headers: { 'authorization': `Bearer partner:${IDS.partner.butler}`, 'x-hotel-id': H } }).status).toBe(200)
  })
})

describe('hotel scoping', () => {
  it('humans resolve X-Hotel-Id only, and must be members', () => {
    const admin = login('admin@aston.example', 'admin123')
    expect(errOf(() => call('/v1/tasks', { headers: h(admin) })).message).toBe('hotel context required')
    expect(errOf(() => call('/v1/tasks', { headers: h(admin, IDS.hotel.fave) })).message).toBe('no access to this hotel')
    // A human's query param is ignored — the header is the only source.
    expect(errOf(() => call('/v1/tasks', { headers: h(admin), query: { hotelRef: H } })).message).toBe('hotel context required')
  })

  it('an operator has an empty reach and no memberships: hotel-scoped routes refuse them', () => {
    const operator = login('operator@sentineltech.example', 'operator123')
    expect(operator.staff.properties).toEqual([])
    expect(operator.staff.memberships).toEqual([])
    expect(errOf(() => call('/v1/tasks', { headers: h(operator, H) })).message).toBe('no access to this hotel')
  })

  it('service actors resolve ?hotelRef= first, then the header, any hotel', () => {
    const viaQuery = call('/v1/tasks', { headers: service(), query: { hotelRef: IDS.hotel.fave } })
    expect(viaQuery.status).toBe(200)
    const viaHeader = call('/v1/tasks', { headers: service(H) })
    expect(viaHeader.status).toBe(200)
  })

  it('/v1/staff/me works for any human and refuses machines', () => {
    const staff = login('staff@aston.example', 'staff123')
    const me = call('/v1/staff/me', { headers: h(staff) })
    expect((me.body!.data as { id: string }).id).toBe(IDS.staff.budi)
    expect(errOf(() => call('/v1/staff/me', { headers: service() })).message).toBe('missing staff identity')
  })
})

describe('staff directory reads', () => {
  it('GET /v1/staff is admin-only; /v1/staff/assignable admits leaders with a slim shape', () => {
    const staff = login('staff@aston.example', 'staff123')
    const leader = login('leader@aston.example', 'leader123')
    expect(errOf(() => call('/v1/staff', { headers: h(staff, H) })).message).toBe('admin access required')
    expect(errOf(() => call('/v1/staff/assignable', { headers: h(staff, H) })).message).toBe('leader or admin access required')
    const rows = call('/v1/staff/assignable', { headers: h(leader, H) }).body!.data as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    // The slim projection: no email, no hotels, no createTask.
    expect(Object.keys(rows[0]!).sort()).toEqual(['hotelDepartmentId', 'id', 'name', 'role'])
  })

  it('departmentId narrows /v1/staff/assignable and never widens it', () => {
    const leader = login('leader@aston.example', 'leader123')
    const hk = call('/v1/staff/assignable', { headers: h(leader, H), query: { departmentId: IDS.dept.smtpHousekeeping } }).body!.data as Array<{ id: string }>
    expect(hk.some(row => row.id === IDS.staff.budi)).toBe(true)
    expect(hk.some(row => row.id === IDS.staff.joko)).toBe(false)
  })
})

describe('passwordless sign-in (feat/google-and-magic-link-auth @ 48756a3)', () => {
  // Leaves behind: a few cookie sessions and consumed magic-link tokens.

  const origin = demoAllowedOrigins()[0]!
  const returnTo = `${origin}/login?redirect=%2Ftasks%2Fabc`
  const sessionFor = (cookie: string) => call('/v1/auth/session', { headers: { cookie: `st_session=${cookie}` } }).body!.data as { csrfToken: string, staff: { email: string } }

  function startGoogle(to = returnTo) {
    const url = (call('/v1/auth/google/url', { query: { returnTo: to } }).body!.data as { url: string }).url
    return demoGoogleConsent(url)!
  }

  it('google/url hands back the authorization URL and refuses a returnTo off the allow-list', () => {
    const res = call('/v1/auth/google/url', { query: { returnTo } })
    expect(res.status).toBe(200)
    const url = new URL((res.body!.data as { url: string }).url)
    expect(url.searchParams.get('state')!.length).toBeGreaterThan(20)
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/v1\/auth\/google\/callback$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // Parsed origin, never a prefix match: a look-alike host is refused too.
    expect(errOf(() => call('/v1/auth/google/url', { query: { returnTo: 'https://evil.example/login' } })).message).toBe('returnTo is not an allowed origin')
    expect(errOf(() => call('/v1/auth/google/url', { query: { returnTo: `${origin}.evil.example/login` } })).message).toBe('returnTo is not an allowed origin')
    // No returnTo at all falls back to the allow-list's first entry.
    expect(call('/v1/auth/google/url').status).toBe(200)
  })

  it('the callback mints the same st_session cookie password login does and 302s to the sealed returnTo', () => {
    const consent = startGoogle()
    const { location, sessionCookie } = demoFollowApiLink(demoGoogleCallbackUrl(consent, { email: 'staff@aston.example' }))
    expect(location).toBe(returnTo)
    expect(sessionCookie).toBeTruthy()
    // Nothing secret rode in the redirect: the app recovers identity + CSRF from /v1/auth/session.
    const recovered = sessionFor(sessionCookie!)
    expect(recovered.staff.email).toBe('staff@aston.example')
    expect(recovered.csrfToken.length).toBeGreaterThan(20)
    // And it is an ordinary cookie actor from here on — CSRF applies to mutations.
    expect(call('/v1/tasks', { headers: { 'cookie': `st_session=${sessionCookie}`, 'x-hotel-id': H } }).status).toBe(200)
    expect(errOf(() => call('/v1/tasks/claim', { method: 'POST', headers: { 'cookie': `st_session=${sessionCookie}`, 'x-hotel-id': H }, body: { taskId: IDS.task.turndownPool } })).message).toBe('invalid CSRF token')
  })

  it('refuses with one coarse code per cause, always by redirect, and burns the flow either way', () => {
    // Cancelled at Google: reported on the fallback origin, not the sealed returnTo.
    const first = startGoogle()
    const cancelled = demoFollowApiLink(demoGoogleCallbackUrl(first, 'cancel'))
    expect(cancelled.location).toBe(`${origin}/?authError=google_denied`)
    expect(cancelled.sessionCookie).toBeNull()
    // The flow cookie was cleared by that terminal outcome: a replayed callback has no flow.
    const replayed = demoFollowApiLink(demoGoogleCallbackUrl(first, { email: 'staff@aston.example' }))
    expect(replayed.location).toBe(`${origin}/?authError=expired_flow`)
    // A state that does not match the flow: login-CSRF defence.
    const consent = startGoogle()
    const forged = demoFollowApiLink(demoGoogleCallbackUrl({ ...consent, state: 'forged' }, { email: 'staff@aston.example' }))
    expect(forged.location).toBe(`${returnTo}&authError=invalid_state`)
    // No auto-provisioning; an unverified address is refused outright.
    expect(demoFollowApiLink(demoGoogleCallbackUrl(startGoogle(), { email: 'someone.else@gmail.example' })).location).toBe(`${returnTo}&authError=no_account`)
    expect(demoFollowApiLink(demoGoogleCallbackUrl(startGoogle(), { email: 'unverified@gmail.example' })).location).toBe(`${returnTo}&authError=email_unverified`)
    // A code Google would not have issued fails the exchange.
    const bad = new URL(demoGoogleCallbackUrl(startGoogle(), { email: 'staff@aston.example' }))
    bad.searchParams.set('code', 'garbage')
    expect(demoFollowApiLink(bad.toString()).location).toBe(`${returnTo}&authError=exchange_failed`)
  })

  it('magic-link/request answers a byte-identical 202 for unknown and live addresses, mailing only the live one', () => {
    const unknown = call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'nobody@aston.example', returnTo } })
    const live = call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'Leader@Aston.example ', returnTo } })
    expect(unknown.status).toBe(202)
    expect(live.status).toBe(202)
    expect(unknown.body).toEqual(live.body)
    expect(live.body).toEqual({ version: 'v1', data: { status: 'sent' } })
    expect(demoOutbox('nobody@aston.example')).toHaveLength(0)
    const [mail] = demoOutbox('leader@aston.example')
    expect(mail!.subject).toBe('Your Sentec Tasks sign-in link')
    const link = new URL(mail!.link)
    expect(link.pathname).toBe('/v1/auth/magic-link/verify')
    expect(link.searchParams.get('token')!.length).toBeGreaterThan(20)
    expect(link.searchParams.get('returnTo')).toBe(returnTo)
    // The only non-202s say nothing about the address.
    expect(errOf(() => call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'not-an-email', returnTo } })).message).toBe('a valid email is required')
    expect(errOf(() => call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'leader@aston.example', returnTo: 'https://evil.example/' } })).message).toBe('returnTo is not an allowed origin')
  })

  it('verify is single-use and redirects on failure with link_invalid, never JSON', () => {
    const [mail] = demoOutbox('leader@aston.example')
    const first = demoFollowApiLink(mail!.link)
    expect(first.location).toBe(returnTo)
    expect(sessionFor(first.sessionCookie!).staff.email).toBe('leader@aston.example')
    // A scanner's second fetch burns closed, not open.
    const second = demoFollowApiLink(mail!.link)
    expect(second.location).toBe(`${returnTo}&authError=link_invalid`)
    expect(second.sessionCookie).toBeNull()
    // Malformed token: same single code.
    expect(demoFollowApiLink(`https://api.sentec-tasks.example/v1/auth/magic-link/verify?token=nope&returnTo=${encodeURIComponent(returnTo)}`).location)
      .toBe(`${returnTo}&authError=link_invalid`)
    // A returnTo that travelled through the mailbox is re-validated; a bad one goes to the fallback and is never echoed.
    const foreign = demoFollowApiLink('https://api.sentec-tasks.example/v1/auth/magic-link/verify?token=nope&returnTo=https%3A%2F%2Fevil.example%2F')
    expect(foreign.location).toBe(`${origin}/?authError=invalid_return_to`)
  })

  it('a newer link supersedes the previous unconsumed one', () => {
    call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'staff@aston.example', returnTo } })
    call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'staff@aston.example', returnTo } })
    const [newest, older] = demoOutbox('staff@aston.example')
    expect(demoFollowApiLink(older!.link).location).toBe(`${returnTo}&authError=link_invalid`)
    expect(demoFollowApiLink(newest!.link).sessionCookie).toBeTruthy()
  })

  it('rate-limits requests per address on SUCCESS: three per window, then 429', () => {
    for (let i = 0; i < 3; i++) {
      expect(call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'operator@sentineltech.example', returnTo } }).status).toBe(202)
    }
    const limited = errOf(() => call('/v1/auth/magic-link/request', { method: 'POST', body: { email: 'operator@sentineltech.example', returnTo } }))
    expect(limited.status).toBe(429)
    expect(limited.message).toBe('too many sign-in link requests')
  })
})
