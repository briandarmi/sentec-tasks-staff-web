import { describe, expect, it } from 'vitest'
import { ApiError, demoLogins, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// Behavioural contract for the Sentec Tasks mock API.
//
// These are not incidental unit tests: the three findings from the Plan E review
// (claim cannot steal an assignment, task detail is authorization-checked,
// logout drops the session) are each pinned here, along with the operational
// rule changes that went with them. Break any of them and a test fails.

type Session = { sessionId: string, csrfToken: string, user: any }

function login(username: string, password: string): Session {
  return call('/v1/auth/login', { method: 'POST', body: { username, password } }).data as Session
}

/** Request headers for a session, optionally pinned to one property. */
function h(session: Session, tenantId?: string) {
  return { 'x-session-id': session.sessionId, ...(tenantId ? { 'x-tenant-id': tenantId } : {}) }
}

/** Assert a call fails with a specific API error code. */
function errCode(fn: () => unknown): string {
  try {
    fn()
    return 'NO_ERROR'
  }
  catch (e) {
    return e instanceof ApiError ? e.code : `UNEXPECTED:${String(e)}`
  }
}

describe('authentication and session', () => {
  it('offers five demo logins', () => {
    expect(demoLogins()).toHaveLength(5)
  })

  it('rejects a wrong password without saying which half was wrong', () => {
    expect(errCode(() => login('staff', 'wrong'))).toBe('INVALID_CREDENTIALS')
    expect(errCode(() => login('nobody', 'staff123'))).toBe('INVALID_CREDENTIALS')
  })

  it('resolves the properties a user can reach', () => {
    expect(login('staff', 'staff123').user.tenants).toHaveLength(2)
    expect(login('operator', 'operator123').user.tenants.length).toBeGreaterThanOrEqual(4)
  })

  it('reaches grouped properties through a group grant, and marks them as such', () => {
    const regional = login('regional', 'regional123')
    const granted = regional.user.tenants.filter((t: any) => t.viaGroupGrant)
    expect(granted.length).toBeGreaterThan(0)
    // A grant confers admin rights across the group.
    expect(granted.every((t: any) => t.role === 'admin')).toBe(true)
  })

  it('drops the session on logout, and logging out twice is not an error', () => {
    const session = login('staff', 'staff123')
    expect(call('/v1/auth/session', { headers: h(session) }).data.userId).toBe('10')
    call('/v1/auth/logout', { method: 'POST', headers: h(session) })
    // Finding 3: nothing survives that could show the next user the last one's work.
    expect(errCode(() => call('/v1/auth/session', { headers: h(session) }))).toBe('UNAUTHORIZED')
    expect(call('/v1/auth/logout', { method: 'POST', headers: h(session) }).data.ok).toBe(true)
  })

  it('refuses every task route without a session', () => {
    expect(errCode(() => call('/v1/tasks', { headers: {} }))).toBe('UNAUTHORIZED')
  })
})

describe('finding 1 — claiming never steals an assignment', () => {
  it('refuses to claim a task somebody else is handling', () => {
    const leader = login('leader', 'leader123')
    // Task 5 is held by Maya. The old behaviour silently moved it.
    expect(errCode(() => call('/v1/tasks/claim', { method: 'POST', body: { taskId: '5' }, headers: h(leader, '1') })))
      .toBe('ALREADY_ASSIGNED')
  })

  it('is idempotent when you already hold the task', () => {
    const staff = login('staff', 'staff123')
    const first = call('/v1/tasks/claim', { method: 'POST', body: { taskId: '3' }, headers: h(staff, '1') }).data
    const second = call('/v1/tasks/claim', { method: 'POST', body: { taskId: '3' }, headers: h(staff, '1') }).data
    // Double-tap on flaky wifi must not error or duplicate the assignment.
    expect(second.assignment.id).toBe(first.assignment.id)
  })

  it('assigns an unheld task without touching its status', () => {
    const admin = login('admin', 'admin123')
    const staff = login('staff', 'staff123')
    const created = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Towels for 1408', location: '1408' }, headers: h(admin, '1') }).data
    const claimed = call('/v1/tasks/claim', { method: 'POST', body: { taskId: created.id }, headers: h(staff, '1') }).data
    expect(claimed.assignment.userId).toBe('10')
    // There is no CLAIMED status; claiming is an assignment, not a transition.
    expect(claimed.status).toBe('NEW')
  })

  it('routes deliberate hand-over through assign, which staff cannot call', () => {
    const leader = login('leader', 'leader123')
    const staff = login('staff', 'staff123')
    const handover = call('/v1/tasks/assign', { method: 'POST', body: { taskId: '5', userId: '10', remark: 'handover' }, headers: h(leader, '1') }).data
    expect(handover.assignment.userId).toBe('10')
    expect(errCode(() => call('/v1/tasks/assign', { method: 'POST', body: { taskId: '5', userId: '12' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
  })

  it('refuses to assign someone who does not work at the property', () => {
    const leader = login('leader', 'leader123')
    expect(errCode(() => call('/v1/tasks/assign', { method: 'POST', body: { taskId: '1', userId: '30' }, headers: h(leader, '1') })))
      .toBe('BAD_REQUEST')
  })
})

describe('finding 2 — task detail is authorization-checked', () => {
  it('refuses a staff member reading another department\'s task', () => {
    const staff = login('staff', 'staff123') // Housekeeping
    // Task 8 is Maintenance. Knowing the id used to be enough to read the lot.
    expect(errCode(() => call('/v1/tasks/8', { headers: h(staff, '1') }))).toBe('FORBIDDEN')
  })

  it('lets a staff member read their own department\'s task', () => {
    const staff = login('staff', 'staff123')
    expect(call('/v1/tasks/1', { headers: h(staff, '1') }).data.id).toBe('1')
  })

  it('lets leaders and admins read anything in the property', () => {
    const leader = login('leader', 'leader123')
    expect(call('/v1/tasks/8', { headers: h(leader, '1') }).data.id).toBe('8')
  })

  it('isolates properties from each other', () => {
    const staff = login('staff', 'staff123')
    // Task 14 belongs to another property: not found rather than forbidden,
    // because the query is scoped to the caller's partition.
    expect(errCode(() => call('/v1/tasks/14', { headers: h(staff, '1') }))).toBe('NOT_FOUND')
    expect(errCode(() => call('/v1/tasks', { headers: h(staff, '3') }))).toBe('FORBIDDEN')
  })
})

describe('staff task visibility', () => {
  it('shows staff their own work plus their department\'s unclaimed queue', () => {
    const leader = login('leader', 'leader123')
    const staff = login('staff', 'staff123')
    const fresh = call('/v1/tasks', { method: 'POST', body: { itemId: '3', title: 'Turndown floor 14', location: 'Floor 14' }, headers: h(leader, '1') }).data
    const visible = call('/v1/tasks', { headers: h(staff, '1'), query: { limit: 100 } }).data
    // The Butler-era rule hid unclaimed work from the very people meant to claim it.
    expect(visible.some((t: any) => t.id === fresh.id && !t.assignment)).toBe(true)
    expect(visible.every((t: any) => t.departmentId === '1' || t.assignment?.userId === '10')).toBe(true)
  })

  it('gives managers the whole property, as a superset of the staff view', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    const staffView = call('/v1/tasks', { headers: h(staff, '1'), query: { limit: 100 } }).data
    const leaderView = call('/v1/tasks', { headers: h(leader, '1'), query: { limit: 100 } }).data
    expect(leaderView.length).toBeGreaterThan(staffView.length)
    expect(staffView.every((t: any) => leaderView.some((x: any) => x.id === t.id))).toBe(true)
  })

  it('stops staff moving work they do not hold', () => {
    const staff = login('staff', 'staff123')
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '10', columnId: '2' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
  })
})

describe('routing rules and SLA stamping', () => {
  it('prefers the most specific rule and stamps that SLA', () => {
    const admin = login('admin', 'admin123')
    // Item 4 (AC fault) has its own rule → Maintenance on the Urgent SLA (5/20).
    // A fixed activation inside Engineering's open hours (Wed 09:00 WIB) keeps
    // the schedule-aware deadline math deterministic: both budgets count from
    // activation, resolution is NOT stacked on response.
    const start = '2026-08-26T02:00:00.000Z'
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '4', title: 'AC dead', location: '1501', activationDate: start }, headers: h(admin, '1') }).data
    expect(task.departmentId).toBe('2')
    expect(task.slaId).toBe('2')
    const activation = Date.parse(task.activationDate)
    expect(Date.parse(task.responseDueAt) - activation).toBe(5 * 60_000)
    expect(Date.parse(task.resolutionDueAt) - activation).toBe(20 * 60_000)
    expect(task.column.status).toBe('NEW')
  })

  it('falls back to the category rule when no item rule matches', () => {
    const admin = login('admin', 'admin123')
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Towels', location: '1408' }, headers: h(admin, '1') }).data
    expect(task.departmentId).toBe('1')
  })

  it('keeps a quantity only for items that take one', () => {
    const admin = login('admin', 'admin123')
    expect(call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'T', location: '1408', quantity: 3 }, headers: h(admin, '1') }).data.quantity).toBe(3)
    expect(call('/v1/tasks', { method: 'POST', body: { itemId: '2', title: 'C', location: '1408', quantity: 9 }, headers: h(admin, '1') }).data.quantity).toBeNull()
  })

  it('requires a title', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/tasks', { method: 'POST', body: { itemId: '1' }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
  })
})

describe('status transitions', () => {
  it('records response and resolution timings against the SLA', () => {
    const admin = login('admin', 'admin123')
    const task = call('/v1/tasks', { method: 'POST', body: { itemId: '4', title: 'AC 1502', location: '1502' }, headers: h(admin, '1') }).data
    const started = call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '2' }, headers: h(admin, '1') }).data
    expect(started.status).toBe('IN_PROGRESS')
    expect(started.responseDuration).not.toBeNull()
    expect(started.responseSlaStatus).toBe('ON_TIME')
    const done = call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '4' }, headers: h(admin, '1') }).data
    expect(done.resolutionDuration).not.toBeNull()
    expect(done.resolutionSlaStatus).toBe('ON_TIME')
    expect(done.history.length).toBeGreaterThanOrEqual(3)
  })

  it('refuses a column belonging to another property\'s board', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '1', columnId: '7' }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('emits a status event for partner-sourced tasks only', () => {
    const operator = login('operator', 'operator123')
    const leader = login('leader', 'leader123')
    const admin = login('admin', 'admin123')
    const countEvents = () => call('/v1/operator/status-events', { headers: h(operator), query: { limit: 200 } }).data.length

    // Task 3 came from Butler — the partner has to hear about the change.
    const beforePartner = countEvents()
    call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '3', columnId: '4' }, headers: h(leader, '1') })
    expect(countEvents()).toBe(beforePartner + 1)

    // A task raised inside Tasks has no partner to notify.
    const native = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Native', location: '0705' }, headers: h(admin, '1') }).data
    const beforeNative = countEvents()
    call('/v1/tasks/status', { method: 'PATCH', body: { taskId: native.id, columnId: '2' }, headers: h(admin, '1') })
    expect(countEvents()).toBe(beforeNative)
  })
})

describe('attachments are URL-only', () => {
  it('accepts a hosted URL and infers the type', () => {
    const staff = login('staff', 'staff123')
    const photo = call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '1', url: 'https://cdn.example.com/a/photo.jpg' }, headers: h(staff, '1') }).data
    expect(photo.filetype).toBe('PHOTO')
    expect(photo.filename).toBe('photo.jpg')
    expect(call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '1', url: 'https://x.io/a/doc.pdf' }, headers: h(staff, '1') }).data.filetype).toBe('PDF')
  })

  it('rejects anything that is not a URL, because there is no upload path yet', () => {
    const staff = login('staff', 'staff123')
    expect(errCode(() => call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '1', url: 'photo.jpg' }, headers: h(staff, '1') })))
      .toBe('BAD_REQUEST')
  })
})

describe('assign picker', () => {
  it('narrows to one department, and can show the whole property', () => {
    const leader = login('leader', 'leader123')
    const inDepartment = call('/v1/staff', { headers: h(leader, '1'), query: { departmentId: '1' } }).data
    const everyone = call('/v1/staff', { headers: h(leader, '1') }).data
    expect(inDepartment.length).toBeLessThan(everyone.length)
    expect(inDepartment.every((s: any) => s.departmentId === '1')).toBe(true)
  })

  it('reports how much open work each person already carries', () => {
    const leader = login('leader', 'leader123')
    expect(call('/v1/staff', { headers: h(leader, '1') }).data.every((s: any) => typeof s.openTaskCount === 'number')).toBe(true)
  })
})

describe('list filters and cursor pagination', () => {
  it('pages without overlap and reports the full count', () => {
    const admin = login('admin', 'admin123')
    const first = call('/v1/tasks', { headers: h(admin, '1'), query: { limit: 3 } })
    expect(first.data).toHaveLength(3)
    expect(first.meta.nextCursor).toBe('3')
    expect(first.meta.totalCount).toBeGreaterThan(3)
    const second = call('/v1/tasks', { headers: h(admin, '1'), query: { limit: 3, cursor: first.meta.nextCursor } })
    expect(second.data.some((t: any) => first.data.some((x: any) => x.id === t.id))).toBe(false)
  })

  it('filters by status, scope, source and free text', () => {
    const admin = login('admin', 'admin123')
    const q = (query: Record<string, unknown>) => call('/v1/tasks', { headers: h(admin, '1'), query: { limit: 100, ...query } }).data
    expect(q({ status: 'NEW' }).every((t: any) => t.status === 'NEW')).toBe(true)
    expect(q({ status: 'FINISHED,VERIFIED' }).every((t: any) => ['FINISHED', 'VERIFIED'].includes(t.status))).toBe(true)
    // Unclaimed = owned by no individual: unassigned, or sitting in a pool.
    expect(q({ scope: 'unclaimed' }).every((t: any) => !t.assignment || t.assignment.kind !== 'STAFF')).toBe(true)
    expect(q({ scope: 'breached' }).every((t: any) => t.responseSlaStatus === 'BREACHED' || t.resolutionSlaStatus === 'BREACHED')).toBe(true)
    expect(q({ partnerId: 'native' }).every((t: any) => !t.partnerId)).toBe(true)
    expect(q({ q: 'towel' }).length).toBeGreaterThan(0)
  })
})

describe('property configuration is admin-only', () => {
  it('stops a leader editing SLAs', () => {
    const leader = login('leader', 'leader123')
    expect(errCode(() => call('/v1/slas/upsert', { method: 'POST', body: { name: 'X', responseTime: 5, resolutionTime: 5 }, headers: h(leader, '1') })))
      .toBe('FORBIDDEN')
  })

  it('keeps exactly one default SLA per property', () => {
    const admin = login('admin', 'admin123')
    call('/v1/slas/upsert', { method: 'POST', body: { name: 'Overnight', responseTime: 60, resolutionTime: 240, isDefault: true }, headers: h(admin, '1') })
    const defaults = call('/v1/slas', { headers: h(admin, '1') }).data.filter((s: any) => s.isDefault)
    expect(defaults).toHaveLength(1)
  })

  it('validates SLA targets', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/slas/upsert', { method: 'POST', body: { name: 'Bad', responseTime: 0, resolutionTime: 5 }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('allows at most one matcher on a routing rule, within the property', () => {
    const admin = login('admin', 'admin123')
    // No matcher at all is the catch-all tier — legal. Two matchers is not:
    // a rule cannot sit in two specificity tiers at once.
    expect(errCode(() => call('/v1/routing-rules/upsert', { method: 'POST', body: { departmentId: '1', slaId: '1', matchCategoryId: '1', matchPriority: 'URGENT' }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
    // Department 7 belongs to a different property.
    expect(errCode(() => call('/v1/routing-rules/upsert', { method: 'POST', body: { departmentId: '7', slaId: '1', matchCategoryId: '1' }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('refuses to add the same person to a property twice', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/staff/upsert', { method: 'POST', body: { email: 'budi.s@aston.example', firstName: 'Budi', role: 'staff' }, headers: h(admin, '1') })))
      .toBe('ALREADY_MEMBER')
  })
})

describe('operator surface', () => {
  it('is closed to property admins, including group-grant holders', () => {
    const admin = login('admin', 'admin123')
    const regional = login('regional', 'regional123')
    expect(errCode(() => call('/v1/operator/tenants', { headers: h(admin, '1') }))).toBe('FORBIDDEN')
    // A group grant is wide, but it is still not the operator role: an admin
    // must never be able to widen their own access.
    expect(errCode(() => call('/v1/operator/group-grants', { method: 'POST', body: { tenantGroupId: '1', userId: '13' }, headers: h(regional, '1') })))
      .toBe('FORBIDDEN')
  })

  it('provisions a new property complete with a board and a default SLA', () => {
    const operator = login('operator', 'operator123')
    const created = call('/v1/operator/tenants', { method: 'POST', body: { name: 'Harper Malioboro', code: 'HRP-MLB', tenantGroupId: '1' }, headers: h(operator) }).data
    expect(created.code).toBe('HRP-MLB')
    // Onboarding is done by us, so the property must arrive usable.
    expect(call('/v1/board', { headers: h(operator, created.id) }).data.columns).toHaveLength(6)
    expect(call('/v1/slas', { headers: h(operator, created.id) }).data.some((s: any) => s.isDefault)).toBe(true)
    expect(errCode(() => call('/v1/operator/tenants', { method: 'POST', body: { name: 'Dup', code: 'HRP-MLB' }, headers: h(operator) })))
      .toBe('DUPLICATE_CODE')
  })

  it('shows a partner secret exactly once and never again', () => {
    const operator = login('operator', 'operator123')
    const created = call('/v1/operator/partners', { method: 'POST', body: { name: 'Sentec Spa', kind: 'Wellness' }, headers: h(operator) }).data
    expect(created.secretPreview).toMatch(/^sk_live_/)
    // Listing partners must never echo a secret back.
    expect(call('/v1/operator/partners', { headers: h(operator) }).data.every((p: any) => p.secretPreview === undefined)).toBe(true)
    // Rotating must mint a genuinely different value, even in the same millisecond.
    const rotated = call('/v1/operator/partners/rotate-secret', { method: 'POST', body: { partnerId: created.id }, headers: h(operator) }).data
    expect(rotated.secretPreview).not.toBe(created.secretPreview)
  })
})

describe('group grants', () => {
  it('are audited, widen access, and stop working once revoked', () => {
    const operator = login('operator', 'operator123')
    const grant = call('/v1/operator/group-grants', { method: 'POST', body: { tenantGroupId: '2', userId: '13' }, headers: h(operator) }).data

    const trail = () => call('/v1/audit-events', { headers: h(operator), query: { limit: 200 } }).data
    expect(trail().some((e: any) => e.action === 'group_grant.granted' && e.target.includes('user:13'))).toBe(true)

    // The grant must actually confer reach, not just record intent.
    expect(login('admin', 'admin123').user.tenants.some((t: any) => t.id === '3' && t.viaGroupGrant)).toBe(true)

    expect(errCode(() => call('/v1/operator/group-grants', { method: 'POST', body: { tenantGroupId: '2', userId: '13' }, headers: h(operator) })))
      .toBe('ALREADY_GRANTED')

    call('/v1/operator/group-grants/revoke', { method: 'POST', body: { grantId: grant.id }, headers: h(operator) })
    expect(trail().some((e: any) => e.action === 'group_grant.revoked')).toBe(true)
    expect(login('admin', 'admin123').user.tenants.some((t: any) => t.id === '3')).toBe(false)
  })
})

describe('reports', () => {
  it('summarises one property consistently', () => {
    const admin = login('admin', 'admin123')
    const summary = call('/v1/reports/summary', { headers: h(admin, '1') }).data
    expect(summary.byStatus.reduce((n: number, s: any) => n + s.count, 0)).toBe(summary.total)
    expect(summary.byDepartment).toHaveLength(4)
  })

  it('bounds a group report to the properties the caller can actually reach', () => {
    const regional = login('regional', 'regional123')
    const staff = login('staff', 'staff123')

    const full = call('/v1/reports/group', { headers: h(regional, '1'), query: { tenantGroupId: '1' } }).data
    expect(full.totals.total).toBe(full.properties.reduce((n: number, p: any) => n + p.total, 0))

    // A staff member in one Aston property must not get the whole brand's numbers.
    const narrow = call('/v1/reports/group', { headers: h(staff, '1'), query: { tenantGroupId: '1' } }).data
    expect(narrow.properties.length).toBeLessThan(full.properties.length)
    expect(narrow.hiddenPropertyCount).toBeGreaterThan(0)

    expect(errCode(() => call('/v1/reports/group', { headers: h(staff, '1'), query: { tenantGroupId: '3' } }))).toBe('FORBIDDEN')
  })
})

describe('audit trail scoping', () => {
  it('shows a property admin only their own property', () => {
    const admin = login('admin', 'admin123')
    expect(call('/v1/audit-events', { headers: h(admin, '1'), query: { limit: 100 } }).data.every((e: any) => e.tenantId === '1')).toBe(true)
  })

  it('shows an operator the platform-level rows too', () => {
    const operator = login('operator', 'operator123')
    expect(call('/v1/audit-events', { headers: h(operator), query: { limit: 100 } }).data.some((e: any) => e.tenantId === null)).toBe(true)
  })

  it('is closed to staff', () => {
    const staff = login('staff', 'staff123')
    expect(errCode(() => call('/v1/audit-events', { headers: h(staff, '1') }))).toBe('FORBIDDEN')
  })
})

describe('unknown routes', () => {
  it('fail loudly rather than returning empty data', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/nope', { headers: h(admin, '1') }))).toBe('NOT_IMPLEMENTED')
  })
})

describe('session resume', () => {
  it('re-establishes a session from the resume token', () => {
    const session = login('staff', 'staff123')
    const resumed = call('/v1/auth/resume', { method: 'POST', body: { token: (session as any).resumeToken } }).data
    expect(resumed.user.userId).toBe('10')
    // A fresh session id, so the old one is not silently shared.
    expect(resumed.sessionId).not.toBe(session.sessionId)
    expect(call('/v1/auth/session', { headers: h(resumed) }).data.userId).toBe('10')
  })

  it('does not extend the shift window when resuming', () => {
    const session = login('staff', 'staff123') as any
    const resumed = call('/v1/auth/resume', { method: 'POST', body: { token: session.resumeToken } }).data
    expect(resumed.resumeToken).toBe(session.resumeToken)
  })

  it('rejects a malformed, tampered or expired token', () => {
    expect(errCode(() => call('/v1/auth/resume', { method: 'POST', body: { token: 'nonsense' } }))).toBe('UNAUTHORIZED')
    expect(errCode(() => call('/v1/auth/resume', { method: 'POST', body: { token: btoa('v1.10') } }))).toBe('UNAUTHORIZED')
    // Unknown user id in an otherwise well-formed token.
    expect(errCode(() => call('/v1/auth/resume', { method: 'POST', body: { token: btoa(`v1.9999.${Date.now()}`) } }))).toBe('UNAUTHORIZED')
    // Issued 13 hours ago — past the 12 hour shift window.
    const stale = btoa(`v1.10.${Date.now() - 13 * 60 * 60 * 1000}`)
    expect(errCode(() => call('/v1/auth/resume', { method: 'POST', body: { token: stale } }))).toBe('UNAUTHORIZED')
  })
})
