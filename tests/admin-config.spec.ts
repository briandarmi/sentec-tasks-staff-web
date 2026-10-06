import { describe, expect, it } from 'vitest'
import { ApiError, IDS, WARN_NO_NEW_COLUMN, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// The configuration + platform surface of sentec-tasks-api, pinned against
// the mock: kanban PATCH semantics, the config upserts and their exact
// validation strings, the master-department enable model, staff lifecycle,
// and the operator-only platform routes.
//
// Suites share one mock instance and run in order; each notes what it leaves
// behind.

interface Session { cookie: string, csrf: string, staff: { id: string } }

function login(email: string, password: string): Session {
  const res = call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
  const data = res.body!.data as { csrfToken: string, staff: { id: string }, _sessionCookie: string }
  return { cookie: `st_session=${data._sessionCookie}`, csrf: data.csrfToken, staff: data.staff }
}

function h(session: Session, hotelId?: string) {
  return { 'cookie': session.cookie, 'x-csrf-token': session.csrf, ...(hotelId ? { 'x-hotel-id': hotelId } : {}) }
}

function errOf(fn: () => unknown): { code: string, message: string } {
  try {
    fn()
    return { code: 'NO_ERROR', message: '' }
  }
  catch (e) {
    const err = e as ApiError
    return { code: err.code, message: err.message }
  }
}

const H = IDS.hotel.simatupang
const data = <T = any>(res: { body: { data: unknown } | null }): T => res!.body!.data as T
const admin = () => login('admin@aston.example', 'admin123')
const operator = () => login('operator@sentineltech.example', 'operator123')

describe('kanban board editing (PATCH /v1/kanban-board)', () => {
  // Leaves behind: an extra "Blocked" column at Simatupang.

  it('validates entries all-or-nothing with the exact messages', () => {
    const a = admin()
    expect(errOf(() => call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ name: 'X' }] } })).message)
      .toBe('columnSort is required')
    expect(errOf(() => call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ name: 'X', columnSort: 0 }] } })).message)
      .toBe('columnSort must be a positive integer')
    expect(errOf(() => call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ name: 'X', columnSort: 1, status: 'DONE' }] } })).message)
      .toBe('status must be one of NEW, IN_PROGRESS, SUBMITTED, FINISHED, VERIFIED, PENDING, CANCELLED')
    expect(errOf(() => call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ isRemoved: true, name: 'X', columnSort: 1 }] } })).message)
      .toBe('cannot set isRemoved on a new column')
  })

  it('keeps a column\'s status immutable and skips removals with active tasks', () => {
    const a = admin()
    const board = data<{ columns: Array<{ id: string, status: string | null, name: string }> }>(call('/v1/kanban-board', { headers: h(a, H) }))
    const inProgress = board.columns.find(c => c.status === 'IN_PROGRESS')!
    expect(errOf(() => call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ id: inProgress.id, status: 'PENDING' }] } })).message)
      .toBe('column status cannot be changed after creation')
    // In Progress holds active work: the removal is SKIPPED with a warning.
    const removal = call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ id: inProgress.id, isRemoved: true }] } })
    const warnings = (removal.body!.meta as { warnings: string[] }).warnings
    expect(warnings.some(w => w.includes('still has an active task'))).toBe(true)
    const after = data<{ columns: Array<{ id: string }> }>(call('/v1/kanban-board', { headers: h(a, H) }))
    expect(after.columns.some(c => c.id === inProgress.id)).toBe(true)
  })

  it('creates columns, treats description as three-state, warns about a missing NEW column', () => {
    const a = admin()
    const created = call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ name: 'Blocked', columnSort: 9, status: 'PENDING', description: 'Waiting on parts' }] } })
    expect((created.body!.meta as { warnings: string[] }).warnings).toEqual([])
    const board = data<{ columns: Array<{ id: string, name: string, description: string | null, status: string | null }> }>(created)
    const blocked = board.columns.find(c => c.name === 'Blocked')!
    expect(blocked.description).toBe('Waiting on parts')
    // Key present with null clears; key absent leaves unchanged.
    call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ id: blocked.id, description: null }] } })
    let reread = data<{ columns: Array<{ id: string, description: string | null }> }>(call('/v1/kanban-board', { headers: h(a, H) }))
    expect(reread.columns.find(c => c.id === blocked.id)!.description).toBeNull()
    call('/v1/kanban-board', { method: 'PATCH', headers: h(a, H), body: { columns: [{ id: blocked.id, name: 'Blocked!' }] } })
    reread = data(call('/v1/kanban-board', { headers: h(a, H) }))
    expect(reread.columns.find(c => c.id === blocked.id)!.description).toBeNull()
    // Removing the NEW column on an EMPTY tenant triggers the orphan warning
    // (anywhere with a task in New, the removal itself would be skipped instead).
    const service = { 'authorization': 'Bearer service:test', 'x-hotel-id': '88888888-0000-4000-8000-000000000001' }
    call('/v1/tenants', { method: 'POST', headers: { authorization: 'Bearer service:test' }, body: { hotelRef: '88888888-0000-4000-8000-000000000001', name: 'Alana Surabaya' } })
    const emptyBoard = data<{ columns: Array<{ id: string, status: string | null }> }>(call('/v1/kanban-board', { headers: service }))
    const newColumn = emptyBoard.columns.find(c => c.status === 'NEW')!
    const warned = call('/v1/kanban-board', { method: 'PATCH', headers: service, body: { columns: [{ id: newColumn.id, isRemoved: true }] } })
    expect((warned.body!.meta as { warnings: string[] }).warnings).toContain(WARN_NO_NEW_COLUMN)
  })
})

describe('catalog items', () => {
  it('validates name in runes, priority, and the proof-photo range', () => {
    const a = admin()
    expect(errOf(() => call('/v1/catalog-items', { method: 'POST', headers: h(a, H), body: { name: '' } })).message)
      .toBe('name is required (1-100 runes)')
    expect(errOf(() => call('/v1/catalog-items', { method: 'POST', headers: h(a, H), body: { name: 'X', defaultPriority: 'ASAP' } })).message)
      .toBe('defaultPriority must be one of LOW, NORMAL, HIGH, URGENT')
    expect(errOf(() => call('/v1/catalog-items', { method: 'POST', headers: h(a, H), body: { name: 'X', minProofPhotos: 11 } })).message)
      .toBe('minProofPhotos must be between 0 and 10')
    expect(errOf(() => call('/v1/catalog-items', { method: 'POST', headers: h(a, H), body: { name: 'Extra towels' } })).code)
      .toBe('CONFLICT')
  })

  it('upserts are a FULL REPLACE: omitted fields reset, not persist', () => {
    const a = admin()
    const created = data(call('/v1/catalog-items', { method: 'POST', headers: h(a, H), body: { name: 'Pillow menu', description: 'Feather or foam', minProofPhotos: 2, requiresCompletionNote: true, categoryId: IDS.category.hk } }))
    const replaced = data(call('/v1/catalog-items', { method: 'POST', headers: h(a, H), body: { id: created.id, name: 'Pillow menu' } }))
    expect(replaced.description).toBeNull()
    expect(replaced.minProofPhotos).toBe(0)
    expect(replaced.requiresCompletionNote).toBe(false)
    expect(replaced.categoryId).toBeNull()
    expect(replaced.defaultPriority).toBe('NORMAL')
  })

  it('lists actives by default and includes inactives on request', () => {
    const a = admin()
    const pillow = data<any[]>(call('/v1/catalog-items', { headers: h(a, H) })).find(i => i.name === 'Pillow menu')!
    call('/v1/catalog-items', { method: 'POST', headers: h(a, H), body: { id: pillow.id, name: 'Pillow menu', isActive: false } })
    expect(data<any[]>(call('/v1/catalog-items', { headers: h(a, H) })).some(i => i.id === pillow.id)).toBe(false)
    expect(data<any[]>(call('/v1/catalog-items', { headers: h(a, H), query: { includeInactive: 'true' } })).some(i => i.id === pillow.id)).toBe(true)
  })
})

describe('departments: master catalogue + per-hotel enablement', () => {
  it('master reads are admin-only; master creates are service-only', () => {
    const staff = login('staff@aston.example', 'staff123')
    expect(errOf(() => call('/v1/departments', { headers: h(staff, H) })).message).toBe('admin access required')
    const rows = data<any[]>(call('/v1/departments', { headers: h(admin(), H) }))
    expect(rows.some(d => d.name === 'Housekeeping')).toBe(true)
    const created = call('/v1/departments', { method: 'POST', headers: { authorization: 'Bearer service:test' }, body: { name: 'Security' } })
    expect(created.status).toBe(201)
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: { authorization: 'Bearer service:test' }, body: { name: 'Security' } })).message)
      .toBe('department name already exists')
  })

  it('enabling is idempotent (201 then 200) and checked against DB-truth hotels', () => {
    const a = admin()
    const security = data<any[]>(call('/v1/departments', { headers: h(a, H) })).find(d => d.name === 'Security')!
    const first = call('/v1/hotel-departments', { method: 'POST', headers: h(a, H), body: { departmentId: security.id } })
    expect(first.status).toBe(201)
    const again = call('/v1/hotel-departments', { method: 'POST', headers: h(a, H), body: { departmentId: security.id } })
    expect(again.status).toBe(200)
    expect(data(again).id).toBe(data(first).id)
    // Rina's reach covers Simatupang via the group grant, but she has no
    // membership there — with per-hotel roles she is plain staff at that
    // hotel, and the admin check (run after the hotel is resolved) refuses.
    const rina = login('regional@aston.example', 'regional123')
    expect(errOf(() => call('/v1/hotel-departments', { method: 'POST', headers: h(rina, H), body: { departmentId: security.id } })).message)
      .toBe('admin access required')
  })
})

describe('teams and members', () => {
  it('upserts with duplicate-name 409 and cross-hotel department 422', () => {
    const a = admin()
    expect(errOf(() => call('/v1/teams', { method: 'POST', headers: h(a, H), body: { name: 'HK Morning Shift' } })).message)
      .toBe('team name already exists')
    expect(errOf(() => call('/v1/teams', { method: 'POST', headers: h(a, H), body: { name: 'Fave crew', hotelDepartmentId: IDS.dept.faveHousekeeping } })).message)
      .toBe('invalid department reference')
  })

  it('manages members idempotently, hotel-scoped, with 200 {ok:true}', () => {
    const a = admin()
    expect(errOf(() => call(`/v1/teams/${IDS.team.hkMorning}/members/${IDS.staff.nur}`, { method: 'PUT', headers: h(a, H) })).message)
      .toBe('invalid staff reference') // Nur belongs to Fave, not Simatupang
    const added = call(`/v1/teams/${IDS.team.hkMorning}/members/${IDS.staff.sari}`, { method: 'PUT', headers: h(a, H) })
    expect(added.status).toBe(200)
    expect(added.body!.data).toEqual({ ok: true })
    const members = data<string[]>(call(`/v1/teams/${IDS.team.hkMorning}/members`, { headers: h(a, H) }))
    expect(members).toContain(IDS.staff.sari)
    // Removal is a 200 no-op when absent — never an error.
    expect(call(`/v1/teams/${IDS.team.hkMorning}/members/${IDS.staff.sari}`, { method: 'DELETE', headers: h(a, H) }).status).toBe(200)
    expect(call(`/v1/teams/${IDS.team.hkMorning}/members/${IDS.staff.sari}`, { method: 'DELETE', headers: h(a, H) }).status).toBe(200)
  })
})

describe('SLAs and operating schedules', () => {
  it('requires positive whole minutes and swaps the single default', () => {
    const a = admin()
    expect(errOf(() => call('/v1/slas', { method: 'POST', headers: h(a, H), body: { name: 'Bad', responseTime: 0, resolutionTime: 5 } })).message)
      .toBe('responseTime and resolutionTime must be positive minutes')
    const created = data(call('/v1/slas', { method: 'POST', headers: h(a, H), body: { name: 'Overnight', responseTime: 60, resolutionTime: 240, isDefault: true } }))
    expect(created.isDefault).toBe(true)
    const rows = data<any[]>(call('/v1/slas', { headers: h(a, H) }))
    expect(rows.filter(s => s.isDefault)).toHaveLength(1)
    // Hand the default back to Standard so routing fallbacks stay stable.
    call('/v1/slas', { method: 'POST', headers: h(a, H), body: { id: IDS.sla.smtpStandard, name: 'Standard', responseTime: 15, resolutionTime: 45, isDefault: true } })
  })

  it('enforces schedule shape rules and the two uniqueness slots', () => {
    const a = admin()
    expect(errOf(() => call('/v1/operating-schedules', { method: 'POST', headers: h(a, H), body: { name: 'X', windows: [{ weekday: 7, opensMinutes: 0, closesMinutes: 100 }] } })).message)
      .toBe('window weekday must be 0-6 (Sunday-Saturday)')
    expect(errOf(() => call('/v1/operating-schedules', { method: 'POST', headers: h(a, H), body: { name: 'X', windows: [{ weekday: 1, opensMinutes: 0, closesMinutes: 100 }, { weekday: 1, opensMinutes: 200, closesMinutes: 300 }] } })).message)
      .toBe('at most one window per weekday')
    expect(errOf(() => call('/v1/operating-schedules', { method: 'POST', headers: h(a, H), body: { name: 'X', windows: [{ weekday: 1, opensMinutes: 300, closesMinutes: 200 }] } })).message)
      .toBe('window closesMinutes must be greater than opensMinutes')
    expect(errOf(() => call('/v1/operating-schedules', { method: 'POST', headers: h(a, H), body: { name: 'X', isDefault: true, windows: [] } })).message)
      .toBe('another schedule already claims this default/department slot')
    expect(errOf(() => call('/v1/operating-schedules', { method: 'POST', headers: h(a, H), body: { name: 'X', hotelDepartmentId: IDS.dept.smtpMaintenance, windows: [] } })).message)
      .toBe('another schedule already claims this default/department slot')
  })

  it('every save replaces the FULL windows/exceptions set', () => {
    const a = admin()
    const created = data(call('/v1/operating-schedules', { method: 'POST', headers: h(a, H), body: { name: 'FO Desk', hotelDepartmentId: IDS.dept.smtpFrontOffice, windows: [{ weekday: 1, opensMinutes: 360, closesMinutes: 1320 }], exceptions: [{ date: '2026-12-25', isClosed: true }] } }))
    const replaced = data(call('/v1/operating-schedules', { method: 'POST', headers: h(a, H), body: { id: created.id, name: 'FO Desk', hotelDepartmentId: IDS.dept.smtpFrontOffice, windows: [{ weekday: 2, opensMinutes: 360, closesMinutes: 1320 }], exceptions: [] } }))
    expect(replaced.windows).toHaveLength(1)
    expect(replaced.windows[0].weekday).toBe(2)
    expect(replaced.exceptions).toEqual([])
  })
})

describe('terminology', () => {
  it('merges the vertical profile with per-hotel overrides, one key per PATCH', () => {
    const a = admin()
    const merged = data<Record<string, string>>(call('/v1/terminology', { headers: h(a, H) }))
    expect(merged.requester).toBe('Guest') // the seeded override
    expect(merged.visit).toBe('Visit') // the profile default
    expect(errOf(() => call('/v1/terminology', { method: 'PATCH', headers: h(a, H), body: { key: 'visit', value: ' ' } })).message)
      .toBe('value is required')
    const after = data<Record<string, string>>(call('/v1/terminology', { method: 'PATCH', headers: h(a, H), body: { key: 'visit', value: 'Stay' } }))
    expect(after.visit).toBe('Stay')
    expect(after.requester).toBe('Guest')
  })
})

describe('staff lifecycle', () => {
  // Leaves behind: one new staff member (Ayu) at Simatupang, promoted to admin.

  it('creates staff/leader only, validating password and hotel grants', () => {
    const a = admin()
    expect(errOf(() => call('/v1/staff', { method: 'POST', headers: h(a, H), body: { email: 'x@aston.example', name: 'X', password: 'longenough1', role: 'admin', hotels: [H] } })).message)
      .toBe('role must be staff or leader')
    expect(errOf(() => call('/v1/staff', { method: 'POST', headers: h(a, H), body: { email: 'x@aston.example', name: 'X', password: 'short', role: 'staff', hotels: [H] } })).message)
      .toBe('password must be at least 10 characters')
    expect(errOf(() => call('/v1/staff', { method: 'POST', headers: h(a, H), body: { email: 'x@aston.example', name: 'X', password: 'longenough1', role: 'staff', hotels: [IDS.hotel.fave] } })).message)
      .toBe('cannot grant access to hotels you do not manage')
    // An email that is already a member here is a 409; one from another hotel
    // is ATTACHED (200) — name and password ignored, memberships extended.
    expect(errOf(() => call('/v1/staff', { method: 'POST', headers: h(a, H), body: { email: 'admin@aston.example', name: 'X', password: 'longenough1', role: 'staff', hotels: [H] } })).message)
      .toBe('that staff member already has access to this hotel')
    const attached = call('/v1/staff', { method: 'POST', headers: h(a, H), body: { email: 'nur@fave.example', name: 'Ignored', password: 'ignoredpassword', role: 'leader', hotels: [H], hotelDepartmentId: IDS.dept.smtpFrontOffice } })
    expect(attached.status).toBe(200)
    expect(data(attached).name).toBe('Nur Aini')
    // The response shows memberships at the granted hotels only — what Nur is at Fave is not this admin's to see.
    expect(data(attached).memberships).toEqual([{ hotelRef: H, role: 'leader', hotelDepartmentId: IDS.dept.smtpFrontOffice, createTask: false, syncIssue: null }])
    expect(data(attached).properties.map((p: any) => p.hotelRef).sort()).toEqual([H, IDS.hotel.fave].sort())
    const created = call('/v1/staff', { method: 'POST', headers: h(a, H), body: { email: 'ayu@aston.example', name: 'Ayu Lestari', password: 'ayu1234567', role: 'staff', hotels: [H], hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: true } })
    expect(created.status).toBe(201)
    expect(data(created).memberships).toEqual([{ hotelRef: H, role: 'staff', hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: true, syncIssue: null }])
    expect(data(created).properties.map((p: any) => p.hotelRef)).toEqual([H])
  })

  it('promotes to admin via PATCH — never at creation — with a 422 on a bad role', () => {
    const a = admin()
    const ayu = data<any[]>(call('/v1/staff', { headers: h(a, H) })).find(s => s.email === 'ayu@aston.example')!
    expect(errOf(() => call(`/v1/staff/${ayu.id}`, { method: 'PATCH', headers: h(a, H), body: { role: 'boss' } })).code)
      .toBe('UNPROCESSABLE')
    const promoted = data(call(`/v1/staff/${ayu.id}`, { method: 'PATCH', headers: h(a, H), body: { role: 'admin' } }))
    expect(promoted.memberships.find((m: any) => m.hotelRef === H).role).toBe('admin')
    // Role fields change ONE hotel's membership and need a hotel: without the
    // header it is a 400; at a hotel where the target has no membership, 422.
    expect(errOf(() => call(`/v1/staff/${ayu.id}`, { method: 'PATCH', headers: h(a), body: { createTask: false } })).message).toBe('hotel context required to change role, hotelDepartmentId or createTask')
    const rinaAtKuningan = login('regional@aston.example', 'regional123')
    // Rina is admin at Kuningan only: the same patch at Simatupang is refused there.
    expect(errOf(() => call(`/v1/staff/${IDS.staff.budi}`, { method: 'PATCH', headers: h(rinaAtKuningan, H), body: { role: 'leader' } })).message).toBe('admin access required at this hotel')
    const budiKngn = data(call(`/v1/staff/${IDS.staff.budi}`, { method: 'PATCH', headers: h(rinaAtKuningan, IDS.hotel.kuningan), body: { role: 'leader' } }))
    // The response carries the membership at the named hotel, and no other.
    expect(budiKngn.memberships).toEqual([{ hotelRef: IDS.hotel.kuningan, role: 'leader', hotelDepartmentId: IDS.dept.kngnHousekeeping, createTask: true, syncIssue: null }])
    expect(data<any[]>(call('/v1/staff', { headers: h(a, H) })).find(s => s.id === IDS.staff.budi).memberships[0].role).toBe('staff')
    // Ayu shares Simatupang with Rina's reach, but has no membership at Kuningan: 422.
    expect(errOf(() => call(`/v1/staff/${ayu.id}`, { method: 'PATCH', headers: h(rinaAtKuningan, IDS.hotel.kuningan), body: { role: 'leader' } })).message).toBe('staff member has no membership at this hotel')
    // name is account-wide: any admin who shares a hotel, no header needed —
    // and with no hotel named the response lists no memberships at all.
    const renamed = data(call(`/v1/staff/${IDS.staff.budi}`, { method: 'PATCH', headers: h(rinaAtKuningan), body: { name: 'Budi S.' } }))
    expect(renamed.name).toBe('Budi S.')
    expect(renamed.memberships).toEqual([])
    call(`/v1/staff/${IDS.staff.budi}`, { method: 'PATCH', headers: h(rinaAtKuningan, IDS.hotel.kuningan), body: { role: 'staff' } })
    call(`/v1/staff/${IDS.staff.budi}`, { method: 'PATCH', headers: h(rinaAtKuningan), body: { name: 'Budi Santoso' } })
    // A non-sharing admin's target collapses to the same 404 as a missing one
    // (the operator shares no hotel with anyone; Nur now shares Simatupang
    // since the attach above).
    const rina = login('regional@aston.example', 'regional123')
    expect(errOf(() => call(`/v1/staff/${IDS.staff.operator}`, { method: 'PATCH', headers: h(rina), body: { name: 'X' } })).message)
      .toBe('staff')
  })
})

describe('platform routes (operator only)', () => {
  // Leaves behind: one provisioned tenant with its first admin, one new group,
  // one deactivated partner (re-activated at the end).

  it('gates every /v1/platform route on the operator flag', () => {
    const a = admin()
    expect(errOf(() => call('/v1/platform/tenants', { headers: h(a) })).message).toBe('operator access required')
    expect(errOf(() => call('/v1/platform/partners', { headers: h(a) })).message).toBe('operator access required')
  })

  it('provisions idempotently and seeds the template board and default SLA', () => {
    const op = operator()
    const hotelRef = '77777777-0000-4000-8000-000000000001'
    const first = call('/v1/platform/tenants', { method: 'POST', headers: h(op), body: { hotelRef, name: 'Huxley Seminyak' } })
    expect(first.status).toBe(201)
    expect(call('/v1/platform/tenants', { method: 'POST', headers: h(op), body: { hotelRef, name: 'Huxley Seminyak' } }).status).toBe(200)
    // The seeded board + default SLA are visible to a service actor.
    const service = { authorization: 'Bearer service:test' }
    const board = data(call('/v1/kanban-board', { headers: service, query: { hotelRef } }))
    expect(board.columns.length).toBe(6)
    const slas = data<any[]>(call('/v1/slas', { headers: service, query: { hotelRef } }))
    expect(slas.some(s => s.isDefault)).toBe(true)
  })

  it('creates the first admin exactly once, with a one-time temporary password', () => {
    const op = operator()
    const hotelRef = '77777777-0000-4000-8000-000000000001'
    const created = call(`/v1/platform/tenants/${hotelRef}/first-admin`, { method: 'POST', headers: h(op), body: { email: 'gm@huxley.example', name: 'Huxley GM' } })
    expect(created.status).toBe(201)
    const payload = data<{ temporaryPassword: string, memberships: Array<{ hotelRef: string, role: string }> }>(created)
    expect(payload.memberships).toEqual([{ hotelRef, role: 'admin', hotelDepartmentId: null, createTask: true, syncIssue: null }])
    expect(payload.temporaryPassword.length).toBeGreaterThanOrEqual(20)
    expect(errOf(() => call(`/v1/platform/tenants/${hotelRef}/first-admin`, { method: 'POST', headers: h(op), body: { email: 'gm2@huxley.example', name: 'Another' } })).message)
      .toBe('tenant already has an admin')
    // The password works: the new admin can sign in and read their hotel.
    const gm = login('gm@huxley.example', payload.temporaryPassword)
    expect(call('/v1/tasks', { headers: h(gm, hotelRef) }).status).toBe(200)
  })

  it('manages groups with membership-verified removal', () => {
    const op = operator()
    const group = data(call('/v1/platform/tenant-groups', { method: 'POST', headers: h(op), body: { name: 'Huxley' } }))
    const hotelRef = '77777777-0000-4000-8000-000000000001'
    call(`/v1/platform/tenant-groups/${group.id}/tenants/${hotelRef}`, { method: 'PUT', headers: h(op) })
    const listed = data<any[]>(call('/v1/platform/tenant-groups', { headers: h(op) }))
    expect(listed.find(g => g.id === group.id)!.tenants).toEqual([{ hotelRef, name: 'Huxley Seminyak' }])
    // Naming the wrong group leaves membership untouched.
    expect(errOf(() => call(`/v1/platform/tenant-groups/${IDS.group.aston}/tenants/${hotelRef}`, { method: 'DELETE', headers: h(op) })).message)
      .toBe('group membership')
    call(`/v1/platform/tenant-groups/${group.id}/tenants/${hotelRef}`, { method: 'DELETE', headers: h(op) })
    const renamed = data(call(`/v1/platform/tenant-groups/${group.id}`, { method: 'PATCH', headers: h(op), body: { name: 'Huxley Collection' } }))
    expect(renamed.name).toBe('Huxley Collection')
  })

  it('registers partners with a one-time secret; deactivation revokes instantly', () => {
    const op = operator()
    const created = call('/v1/platform/partners', { method: 'POST', headers: h(op), body: { name: 'Sentec SBE' } })
    expect(created.status).toBe(201)
    expect(data<{ secret: string }>(created).secret.length).toBe(43)
    // The list never carries a secret.
    const listed = data<any[]>(call('/v1/platform/partners', { headers: h(op) }))
    expect(listed.every(p => !('secret' in p))).toBe(true)
    // Deactivating an active partner cuts its token off immediately.
    call(`/v1/platform/partners/${IDS.partner.butler}`, { method: 'PATCH', headers: h(op), body: { isActive: false } })
    expect(errOf(() => call('/v1/tasks', { headers: { 'authorization': `Bearer partner:${IDS.partner.butler}`, 'x-hotel-id': H } })).code)
      .toBe('UNAUTHORIZED')
    call(`/v1/platform/partners/${IDS.partner.butler}`, { method: 'PATCH', headers: h(op), body: { isActive: true } })
    expect(call('/v1/tasks', { headers: { 'authorization': `Bearer partner:${IDS.partner.butler}`, 'x-hotel-id': H } }).status).toBe(200)
  })
})
