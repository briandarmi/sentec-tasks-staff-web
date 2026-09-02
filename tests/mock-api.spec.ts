import { describe, expect, it } from 'vitest'
import { ApiError, IDS, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// Core wire-contract pins for the mock of sentec-tasks-api (@ 0c8e1bd):
// envelope shape, auth model (cookie + CSRF, bearer stand-ins), hotel scoping,
// and the transport quirks (plain-text 404, null-vs-[] serialization) that a
// faithful client has to survive.
//
// Suites share one mock instance and run in order; each notes what it leaves
// behind.

interface Session { cookie: string, csrf: string, staff: { id: string, role: string, hotels: string[] } }

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
  it('logs in by email, returning the CSRF token and the hotels CLAIM', () => {
    const regional = login('regional@aston.example', 'regional123')
    // Direct staff_hotel row at Kuningan plus the Aston group grant.
    expect(regional.staff.hotels).toContain(IDS.hotel.kuningan)
    expect(regional.staff.hotels).toContain(IDS.hotel.simatupang)
    expect(regional.csrf.length).toBeGreaterThan(20)
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

  it('an operator has an empty hotels claim: hotel-scoped routes refuse them', () => {
    const operator = login('operator@sentineltech.example', 'operator123')
    expect(operator.staff.hotels).toEqual([])
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
