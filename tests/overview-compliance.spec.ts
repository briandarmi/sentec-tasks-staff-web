import { describe, expect, it } from 'vitest'
import { ApiError, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// Pins the platform-overview briefing (docs/sentec-tasks-overview-standalone.html)
// to the mock: the status-lifecycle guards, the SLA clock definitions
// (both budgets from activation, deadlines ticking only in the department's
// open hours), specificity-tiered routing, the source-app registry, and the
// admin board's direct task editing.
//
// Suites share one mock instance and run in order; each notes what it leaves
// behind.

type Session = { sessionId: string, csrfToken: string, user: any }

function login(username: string, password: string): Session {
  return call('/v1/auth/login', { method: 'POST', body: { username, password } }).data as Session
}

function h(session: Session, tenantId?: string) {
  return { 'x-session-id': session.sessionId, ...(tenantId ? { 'x-tenant-id': tenantId } : {}) }
}

function errCode(fn: () => unknown): string {
  try {
    fn()
    return 'NO_ERROR'
  }
  catch (e) {
    return e instanceof ApiError ? e.code : `UNEXPECTED:${String(e)}`
  }
}

describe('status lifecycle guards', () => {
  // Leaves behind: one finished proof-gated task, one cancelled task.

  it('freezes a SUBMITTED task — only the review decision moves it', () => {
    const admin = login('admin', 'admin123')
    // Task 15 is seeded SUBMITTED. Even an admin cannot move it by column.
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '15', columnId: '2' }, headers: h(admin, '1') })))
      .toBe('AWAITING_REVIEW')
  })

  it('refuses a bare column move INTO Awaiting Review — that would skip the proof gates', () => {
    const admin = login('admin', 'admin123')
    // Task 3 is IN_PROGRESS; column 20 maps to SUBMITTED.
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '3', columnId: '20' }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('cancels only open work: NEW, IN_PROGRESS or PENDING', () => {
    const admin = login('admin', 'admin123')
    // Task 7 is FINISHED and task 8 VERIFIED — history, not cancellable.
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '7', columnId: '6' }, headers: h(admin, '1') })))
      .toBe('TASK_CLOSED')
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '8', columnId: '6' }, headers: h(admin, '1') })))
      .toBe('TASK_CLOSED')
    // A fresh NEW task cancels fine.
    const created = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Raised in error', location: '0501' }, headers: h(admin, '1') }).data
    expect(call('/v1/tasks/status', { method: 'PATCH', body: { taskId: created.id, columnId: '6' }, headers: h(admin, '1') }).data.status)
      .toBe('CANCELLED')
  })

  it('blocks staff from finishing proof-gated work directly — a leader decides, via review', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    // Item 2 requires a proof photo and a completion note.
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '2', title: 'Deep clean 0703', location: '0703', assignee: { kind: 'STAFF', userId: '10' } }, headers: h(staff, '1') }).data
    call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '2' }, headers: h(staff, '1') })
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '4' }, headers: h(staff, '1') })))
      .toBe('NEEDS_REVIEW')
    // A manager moving it to FINISHED IS the decision — allowed.
    expect(call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '4' }, headers: h(leader, '1') }).data.status)
      .toBe('FINISHED')
  })

  it('stamps response time on the first entry into IN_PROGRESS, not on any move off NEW', () => {
    const admin = login('admin', 'admin123')
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Parked first', location: '0704' }, headers: h(admin, '1') }).data
    // NEW → PENDING is a park, not a response.
    const parked = call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '3' }, headers: h(admin, '1') }).data
    expect(parked.responseDuration).toBeNull()
    const started = call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '2' }, headers: h(admin, '1') }).data
    expect(started.responseDuration).not.toBeNull()
    expect(started.responseSlaStatus).toBe('ON_TIME')
  })
})

describe('SLA clocks tick in the department\'s open hours', () => {
  // Engineering (department 2, tenant 1) opens Mon–Fri 08:00–17:00 and
  // Sat 08:00–13:00 WIB, is closed Sundays, and has a dated closed
  // exception on 2026-08-17. Item 4 routes there on the Urgent SLA (5/20).
  // Leaves behind: a handful of NEW tasks.

  it('rolls a deadline across a closed Sunday to the next opening', () => {
    const admin = login('admin', 'admin123')
    // Sunday 07:00 WIB — Engineering is closed; the clock starts Monday 08:00.
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '4', title: 'AC service', location: '1501', activationDate: '2026-09-06T00:00:00.000Z' }, headers: h(admin, '1') }).data
    expect(task.responseDueAt).toBe('2026-09-07T01:05:00.000Z') // Mon 08:05 WIB
    expect(task.resolutionDueAt).toBe('2026-09-07T01:20:00.000Z') // Mon 08:20 WIB
  })

  it('honours a dated closed exception', () => {
    const admin = login('admin', 'admin123')
    // 2026-08-17 (a Monday) is an exception day: fully closed.
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '4', title: 'AC service', location: '1501', activationDate: '2026-08-17T02:00:00.000Z' }, headers: h(admin, '1') }).data
    expect(task.responseDueAt).toBe('2026-08-18T01:05:00.000Z') // Tue 08:05 WIB
  })

  it('counts both budgets from activation for a 24/7 department', () => {
    const admin = login('admin', 'admin123')
    // Housekeeping has no schedule of its own → the tenant-wide 24/7 default.
    // Standard SLA is 15/45: resolution is 45 from activation, never 15+45.
    const start = '2026-08-26T02:00:00.000Z'
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Towels', location: '1408', activationDate: start }, headers: h(admin, '1') }).data
    expect(Date.parse(task.responseDueAt) - Date.parse(start)).toBe(15 * 60_000)
    expect(Date.parse(task.resolutionDueAt) - Date.parse(start)).toBe(45 * 60_000)
  })

  it('refuses an SLA whose resolution is shorter than its response', () => {
    const admin = login('admin', 'admin123')
    // Both budgets count from activation, so this would demand the work
    // finish before anyone need start it.
    expect(errCode(() => call('/v1/slas/upsert', { method: 'POST', body: { name: 'Impossible', responseTime: 30, resolutionTime: 10 }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('previews the exact deadlines create would stamp', () => {
    const admin = login('admin', 'admin123')
    const body = { itemId: '4', title: 'AC service', location: '1501', activationDate: '2026-09-06T00:00:00.000Z' }
    const preview = call('/v1/tasks/preview', { method: 'POST', body, headers: h(admin, '1') }).data.task
    const created = call('/v1/tasks', { method: 'POST', body, headers: h(admin, '1') }).data
    expect(preview.responseDueAt).toBe(created.responseDueAt)
    expect(preview.resolutionDueAt).toBe(created.resolutionDueAt)
  })
})

describe('routing is specificity-tiered', () => {
  // exact item > category > location type > priority > catch-all.
  // Leaves behind: a few NEW tasks at tenants 1 and 2.

  it('lets an item rule beat the location-type rule', () => {
    const admin = login('admin', 'admin123')
    // Item 4 has its own rule (→ Maintenance); the Lobby is a Public Area,
    // whose location-type rule points at Front Office. The item wins.
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '4', title: 'Lobby AC', locationId: '5' }, headers: h(admin, '1') }).data
    expect(task.departmentId).toBe('2')
  })

  it('lets a category rule beat the location-type rule', () => {
    const admin = login('admin', 'admin123')
    // Item 1 has no item rule; its category routes to Housekeeping even
    // though the Lobby's location type would route to Front Office.
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Lobby towels', locationId: '5' }, headers: h(admin, '1') }).data
    expect(task.departmentId).toBe('1')
  })

  it('routes itemless work by location type', () => {
    const admin = login('admin', 'admin123')
    const task = call('/v1/tasks', { method: 'POST', body: { title: 'Spill in the lobby', locationId: '5' }, headers: h(admin, '1') }).data
    expect(task.departmentId).toBe('3')
    expect(task.slaId).toBe('1')
  })

  it('falls through to the priority tier, then the catch-all', () => {
    const operator = login('operator', 'operator123')
    // Tenant 2 seeds an URGENT rule (→ Maintenance) and a catch-all (→ Housekeeping).
    const urgent = call('/v1/tasks', { method: 'POST', body: { title: 'Water on the stairs', priority: 'URGENT' }, headers: h(operator, '2') }).data
    expect(urgent.departmentId).toBe('6')
    const routine = call('/v1/tasks', { method: 'POST', body: { title: 'Tidy the store room' }, headers: h(operator, '2') }).data
    expect(routine.departmentId).toBe('5')
    expect(routine.slaId).toBe('4')
  })

  it('lists rules most-specific-tier first', () => {
    const admin = login('admin', 'admin123')
    const rules = call('/v1/routing-rules', { headers: h(admin, '1') }).data
    expect(rules[0].matchItemId).not.toBeNull()
    // The location-type rule sorts after every category rule.
    const tiers = rules.map((r: any) => (r.matchItemId ? 0 : r.matchCategoryId ? 1 : r.matchLocationTypeId ? 2 : r.matchPriority ? 3 : 4))
    expect([...tiers].sort((a: number, b: number) => a - b)).toEqual(tiers)
  })
})

describe('the source-app registry', () => {
  // Leaves behind: one extra registry entry (a-test-app).

  it('is readable by any authenticated user, with the platform badge colours', () => {
    const staff = login('staff', 'staff123')
    const apps = call('/v1/source-apps', { headers: h(staff, '1') }).data
    expect(apps.length).toBeGreaterThanOrEqual(6)
    const butler = apps.find((a: any) => a.code === 'sentec-butler')
    expect(butler.badgeColor).toBe('#7c3aed')
  })

  it('is curated by operators only, with validated colours', () => {
    const admin = login('admin', 'admin123')
    const operator = login('operator', 'operator123')
    expect(errCode(() => call('/v1/operator/source-apps/upsert', { method: 'POST', body: { code: 'a-test-app', name: 'Test App', badgeColor: '#112233' }, headers: h(admin, '1') })))
      .toBe('FORBIDDEN')
    expect(errCode(() => call('/v1/operator/source-apps/upsert', { method: 'POST', body: { code: 'a-test-app', name: 'Test App', badgeColor: 'purple' }, headers: h(operator) })))
      .toBe('BAD_REQUEST')
    call('/v1/operator/source-apps/upsert', { method: 'POST', body: { code: 'a-test-app', name: 'Test App', badgeColor: '#112233' }, headers: h(operator) })
    const staff = login('staff', 'staff123')
    expect(call('/v1/source-apps', { headers: h(staff, '1') }).data.some((a: any) => a.code === 'a-test-app')).toBe(true)
  })

  it('badges partner-sourced tasks with their registry entry', () => {
    const staff = login('staff', 'staff123')
    // Task 1 was dispatched by the Butler partner.
    const task = call('/v1/tasks/1', { headers: h(staff, '1') }).data
    expect(task.partner.sourceAppCode).toBe('sentec-butler')
    expect(task.partner.badgeColor).toBe('#7c3aed')
  })
})

describe('direct task editing (the admin board dialog)', () => {
  // Leaves behind: task 1 retitled.

  it('lets a leader edit an open task and records it in history', () => {
    const leader = login('leader', 'leader123')
    const updated = call('/v1/tasks/update', { method: 'POST', body: { taskId: '1', title: 'Extra towels — room 1204', description: 'Two bath towels please', priority: 'HIGH' }, headers: h(leader, '1') }).data
    expect(updated.title).toBe('Extra towels — room 1204')
    expect(updated.priority).toBe('HIGH')
    expect(updated.history.some((entry: any) => String(entry.description).startsWith('Edited:'))).toBe(true)
  })

  it('is a manager action on open work only, and a title is required', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    expect(errCode(() => call('/v1/tasks/update', { method: 'POST', body: { taskId: '1', title: 'X', priority: 'NORMAL' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
    // Task 7 is FINISHED — history, not editable.
    expect(errCode(() => call('/v1/tasks/update', { method: 'POST', body: { taskId: '7', title: 'X', priority: 'NORMAL' }, headers: h(leader, '1') })))
      .toBe('TASK_CLOSED')
    expect(errCode(() => call('/v1/tasks/update', { method: 'POST', body: { taskId: '1', title: '  ', priority: 'NORMAL' }, headers: h(leader, '1') })))
      .toBe('BAD_REQUEST')
  })
})
