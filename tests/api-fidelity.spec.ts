import { describe, expect, it } from 'vitest'
import { ApiError, IDS, demoSlamath, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// Fidelity pins for the parts of sentec-tasks-api (master @ c3f52ad) that are
// easiest to get subtly wrong: schedule-aware SLA clock chaining and the
// open-hours durations stamped with their verdicts, specificity-tiered routing
// with its natural-key PUT, the [DR-15] staff visibility scope, keyset
// pagination, and the cross-tenant group surface.
//
// Suites share one mock instance and run in order; each notes what it leaves
// behind.

interface Session { cookie: string, csrf: string, staff: { id: string, hotels: string[] } }

function login(email: string, password: string): Session {
  const res = call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
  const data = res.body!.data as { csrfToken: string, staff: Session['staff'], _sessionCookie: string }
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

describe('SLA clocks are schedule-aware, and resolution CHAINS off the response due', () => {
  it('rolls both deadlines across a closed Sunday to Engineering hours', () => {
    const a = login('admin@aston.example', 'admin123')
    // Sunday 07:00 WIB — Engineering is closed; the clock starts Monday 08:00.
    // Urgent SLA is 5/20: response Mon 08:05, resolution 20 MORE open minutes
    // from the response due — 08:25 WIB, not from activation.
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'AC service', itemRef: IDS.item.acFault, locationRef: IDS.location.room1204, activationDate: '2026-09-06T00:00:00.000Z' } }))
    expect(t.responseDueAt).toBe('2026-09-07T01:05:00.000Z')
    expect(t.resolutionDueAt).toBe('2026-09-07T01:25:00.000Z')
    // The budgets are snapshotted onto the task at creation.
    expect(t.responseSlaMinutes).toBe(5)
    expect(t.resolutionSlaMinutes).toBe(20)
  })

  it('honours a dated closed exception', () => {
    const a = login('admin@aston.example', 'admin123')
    // 2026-08-17 (a Monday) is Engineering's closed exception day.
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'AC service', itemRef: IDS.item.acFault, locationRef: IDS.location.room1204, activationDate: '2026-08-17T02:00:00.000Z' } }))
    expect(t.responseDueAt).toBe('2026-08-18T01:05:00.000Z')
  })

  it('falls back to always-open where no schedule exists (plain addition)', () => {
    const nur = login('nur@fave.example', 'nur1234567')
    const start = '2026-09-06T00:00:00.000Z' // a Sunday — irrelevant with no schedule
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(nur, IDS.hotel.fave), body: { title: 'Clean', itemRef: IDS.item.faveCleaning, locationRef: IDS.location.faveRoom0210, activationDate: start } }))
    expect(Date.parse(t.responseDueAt) - Date.parse(start)).toBe(30 * 60_000)
    expect(Date.parse(t.resolutionDueAt) - Date.parse(t.responseDueAt)).toBe(90 * 60_000)
  })
})

describe('SLA durations are open-hours minutes from activation, stamped with their verdicts (c3f52ad)', () => {
  // Leaves behind: three tasks at Simatupang (two FINISHED, one PENDING).

  const WIB = (local: string) => new Date(`${local}+07:00`).toISOString()

  it('elapsedScheduleMinutes is the exact inverse of the due-date walk', () => {
    const engineering = demoSlamath(H, IDS.dept.smtpMaintenance)
    // Sunday 07:00 WIB — closed until Monday 08:00. Budgets that stay inside
    // one day, cross a 17:00 close, and span the following weekend.
    const sunday = '2026-09-06T00:00:00.000Z'
    for (const minutes of [5, 20, 540, 541, 1500, 3000]) {
      expect(engineering.elapsed(sunday, engineering.advance(sunday, minutes))).toBe(minutes)
    }
    // Across the dated closed exception (2026-08-17).
    const beforeException = WIB('2026-08-16T22:00:00')
    expect(engineering.elapsed(beforeException, engineering.advance(beforeException, 100))).toBe(100)
  })

  it('counts open time only, floors once, and equals raw minutes where no schedule exists', () => {
    const engineering = demoSlamath(H, IDS.dept.smtpMaintenance)
    // A start after close: nothing counts until 08:00 the next morning.
    expect(engineering.elapsed(WIB('2026-08-24T18:00:00'), WIB('2026-08-25T08:30:00'))).toBe(30)
    // 30 s before Monday's close plus 45 s after Tuesday's open is 75 s: one
    // minute when floored once, zero if each window were floored on its own.
    expect(engineering.elapsed(WIB('2026-08-24T16:59:30'), WIB('2026-08-25T08:00:45'))).toBe(1)
    // Friday close to Monday open: only Saturday's 08:00–13:00 window counts.
    expect(engineering.elapsed(WIB('2026-08-28T17:00:00'), WIB('2026-08-31T08:00:00'))).toBe(300)
    expect(engineering.elapsed(WIB('2026-08-29T13:00:00'), WIB('2026-08-31T08:00:00'))).toBe(0)
    // Fave has no schedule at all: always-open, so plain (floored) elapsed — negative included.
    const fave = demoSlamath(IDS.hotel.fave, null)
    expect(fave.elapsed('2026-09-06T00:00:00.000Z', '2026-09-06T02:30:30.000Z')).toBe(150)
    expect(fave.elapsed('2026-09-06T02:30:00.000Z', '2026-09-06T02:29:30.000Z')).toBe(-1)
  })

  it('stamps resolution at submission from activation, keeps the superseded number through rework, and never re-stamps on review or parking', () => {
    const l = login('leader@aston.example', 'leader123')
    const b = login('staff@aston.example', 'staff123')
    const columns = data<{ columns: Array<{ id: string, status: string | null }> }>(call('/v1/kanban-board', { headers: h(l, H) })).columns
    const column = (status: string) => columns.find(c => c.status === status)!.id
    // Activated 90 minutes ago at Housekeeping (the 24/7 default schedule):
    // both budgets (15/45) are already blown, and both numbers must read ~90.
    const activation = new Date(Date.now() - 90 * 60_000).toISOString()
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(l, H), body: { title: 'Clock test', itemRef: IDS.item.roomCleaning, locationRef: IDS.location.room1102, activationDate: activation, assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    const started = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(b, H), body: { taskId: t.id, columnId: column('IN_PROGRESS') } }))
    expect(started.responseDuration).toBeGreaterThanOrEqual(90)
    expect(started.responseDuration).toBeLessThanOrEqual(91)
    expect(started.responseSlaStatus).toBe('BREACHED')
    expect(started.resolutionDuration).toBeNull()

    const upload = data<{ storageKey: string }>(call('/v1/uploads', { method: 'POST', headers: h(b, H), body: { filename: 'proof.jpg', contentType: 'image/jpeg', sizeBytes: 1000 } }))
    call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'PHOTO', storageKey: upload.storageKey } })
    const submitted = data(call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: 'First pass.' } }))
    expect(submitted.resolutionSlaStatus).toBe('BREACHED')
    expect(submitted.resolutionDuration).toBeGreaterThanOrEqual(90)
    expect(submitted.resolutionDuration).toBeLessThanOrEqual(91)

    // Review bounce: the verdict resets, the number is retained as superseded.
    const bounced = data(call('/v1/tasks/review', { method: 'POST', headers: h(l, H), body: { taskId: t.id, decision: 'REQUEST_CHANGES', note: 'Again, please' } }))
    expect(bounced.resolutionSlaStatus).toBe('EMPTY')
    expect(bounced.resolutionDuration).toBe(submitted.resolutionDuration)
    // Resubmission re-stamps both — still measured from activation.
    const resubmitted = data(call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: 'Second pass.' } }))
    expect(resubmitted.resolutionSlaStatus).toBe('BREACHED')
    expect(resubmitted.resolutionDuration).toBeGreaterThanOrEqual(submitted.resolutionDuration)
    // SUBMITTED → PENDING → FINISHED: a detour after work stopped re-stamps neither.
    const parked = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(l, H), body: { taskId: t.id, columnId: column('PENDING') } }))
    expect(parked.resolutionDuration).toBe(resubmitted.resolutionDuration)
    expect(parked.resolutionSlaStatus).toBe('BREACHED')
    const finished = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(l, H), body: { taskId: t.id, columnId: column('FINISHED') } }))
    expect(finished.resolutionDuration).toBe(resubmitted.resolutionDuration)
    expect(finished.resolutionSlaStatus).toBe('BREACHED')
    expect(finished.responseDuration).toBe(started.responseDuration)
  })

  it('excludes the department\'s closed hours from a stamped number', () => {
    const a = login('admin@aston.example', 'admin123')
    const columns = data<{ columns: Array<{ id: string, status: string | null }> }>(call('/v1/kanban-board', { headers: h(a, H) })).columns
    // Activated on a past Sunday for Engineering: every night and weekend since
    // then is closed time, so the stamp is well short of the wall clock.
    const sunday = '2026-09-06T00:00:00.000Z'
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'AC service', itemRef: IDS.item.acFault, locationRef: IDS.location.room1204, activationDate: sunday, assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.joko } } }))
    const before = Date.now()
    const started = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(a, H), body: { taskId: t.id, columnId: columns.find(c => c.status === 'IN_PROGRESS')!.id } }))
    const raw = Math.floor((before - Date.parse(sunday)) / 60_000)
    const expected = demoSlamath(H, IDS.dept.smtpMaintenance).elapsed(sunday, new Date(before).toISOString())
    expect(started.responseDuration).toBeLessThan(raw)
    expect(Math.abs(started.responseDuration - expected)).toBeLessThanOrEqual(1)
    // Parked afterwards: leaving IN_PROGRESS writes nothing.
    const parked = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(a, H), body: { taskId: t.id, columnId: columns.find(c => c.status === 'PENDING')!.id } }))
    expect(parked.resolutionDuration).toBeNull()
  })

  it('keeps every task\'s stamped numbers consistent with its own history rows', () => {
    // Seeds and everything the suites created so far: for each stamped verdict,
    // the duration must be the open-hours elapsed from activation to the
    // history row that stamped it (first IN_PROGRESS; latest SUBMITTED, else
    // latest FINISHED). A seed edited by hand that drifts from this fails here.
    const a = login('admin@aston.example', 'admin123')
    const rows = data<Array<{ id: string }>>(call('/v1/tasks', { headers: h(a, H), query: { limit: 100 } })) ?? []
    expect(rows.length).toBeGreaterThan(5)
    let checked = 0
    for (const row of rows) {
      const t = data(call(`/v1/tasks/${row.id}`, { headers: h(a, H) }))
      const history = [...(t.history ?? [])].sort((x: any, y: any) => x.seq - y.seq)
      const math = demoSlamath(H, t.hotelDepartmentId)
      if (t.responseSlaStatus !== 'EMPTY') {
        const first = history.find((x: any) => x.status === 'IN_PROGRESS')
        expect(first, `${t.title} (${t.id}) has a response verdict but no IN_PROGRESS row`).toBeTruthy()
        expect(t.responseDuration, `${t.title} responseDuration`).toBe(math.elapsed(t.activationDate, first.createdAt))
        checked++
      }
      if (t.resolutionSlaStatus !== 'EMPTY') {
        const stamp = [...history].reverse().find((x: any) => x.status === 'SUBMITTED') ?? [...history].reverse().find((x: any) => x.status === 'FINISHED')
        expect(stamp, `${t.title} (${t.id}) has a resolution verdict but no SUBMITTED/FINISHED row`).toBeTruthy()
        expect(t.resolutionDuration, `${t.title} resolutionDuration`).toBe(math.elapsed(t.activationDate, stamp.createdAt))
        checked++
      }
      else {
        // No verdict, no measurement — except a superseded number after a review bounce.
        const bounced = history.some((x: any) => x.status === 'SUBMITTED')
        if (!bounced) expect(t.resolutionDuration, `${t.title} resolutionDuration without a verdict`).toBeNull()
      }
    }
    expect(checked).toBeGreaterThan(4)
  })
})

describe('routing: specificity tiers with a natural-key PUT', () => {
  // Leaves behind: an extra category rule at Fave, deleted again at the end.

  it('resolves most-specific-first: item over location type over priority', () => {
    const a = login('admin@aston.example', 'admin123')
    // Item rule (tier 4) wins even at the Lobby (a location-type-ruled area).
    const viaItem = data(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'Lobby AC', itemRef: IDS.item.acFault, locationRef: IDS.location.lobby } }))
    expect(viaItem.task.hotelDepartmentId).toBe(IDS.dept.smtpMaintenance)
    // Category (tier 3) beats the Lobby's location-type rule (tier 2).
    const viaCategory = data(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'Lobby towels', itemRef: IDS.item.towels, locationRef: IDS.location.lobby } }))
    expect(viaCategory.task.hotelDepartmentId).toBe(IDS.dept.smtpHousekeeping)
    // Itemless at the Lobby: the location-type rule takes it.
    const viaLocationType = data(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'Spill in the lobby', locationRef: IDS.location.lobby } }))
    expect(viaLocationType.task.hotelDepartmentId).toBe(IDS.dept.smtpFrontOffice)
    // Itemless URGENT anywhere: the priority rule (tier 1).
    const viaPriority = data(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'Water on the stairs', priority: 'URGENT' } }))
    expect(viaPriority.task.hotelDepartmentId).toBe(IDS.dept.smtpMaintenance)
    // Nothing matches: default SLA, department-less.
    const fallback = data(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'Plain job' } }))
    expect(fallback.task.hotelDepartmentId).toBeNull()
    expect(fallback.task.slaId).toBe(IDS.sla.smtpStandard)
  })

  it('the catch-all (tier 0) matches whatever nothing above claims', () => {
    const nur = login('nur@fave.example', 'nur1234567')
    const routed = data(call('/v1/tasks/preview', { method: 'POST', headers: h(nur, IDS.hotel.fave), body: { title: 'Tidy the store room' } }))
    expect(routed.task.hotelDepartmentId).toBe(IDS.dept.faveHousekeeping)
  })

  it('PUT upserts by natural key: repeating a criterion updates in place', () => {
    const a = login('admin@aston.example', 'admin123')
    expect(errOf(() => call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { categoryId: IDS.category.hk, priority: 'URGENT', departmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpStandard } })).message)
      .toBe('a routing rule may set at most one of itemRef, categoryId, locationTypeId or priority')
    expect(errOf(() => call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { categoryId: IDS.category.faveHk, departmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpStandard } })).code)
      .toBe('UNPROCESSABLE') // a foreign hotel's category
    const first = data(call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { categoryId: IDS.category.hk, departmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpUrgent, remark: 'tightened' } }))
    const second = data(call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { categoryId: IDS.category.hk, departmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpStandard } }))
    expect(second.id).toBe(first.id) // same natural key → same rule
    expect(second.slaId).toBe(IDS.sla.smtpStandard)
    expect(second.specificity).toBe(3)
  })

  it('lists rules by specificity, deletes by id with 204', () => {
    const a = login('admin@aston.example', 'admin123')
    const rules = data<any[]>(call('/v1/routing-rules', { headers: h(a, H) }))
    const tiers = rules.map(r => r.specificity)
    expect([...tiers].sort((x, y) => y - x)).toEqual(tiers)
    const created = data(call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { locationTypeId: IDS.locationType.floor, departmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpStandard } }))
    const deleted = call(`/v1/routing-rules/id/${created.id}`, { method: 'DELETE', headers: h(a, H) })
    expect(deleted.status).toBe(204)
    expect(deleted.body).toBeNull()
    expect(errOf(() => call(`/v1/routing-rules/id/${created.id}`, { method: 'DELETE', headers: h(a, H) })).code).toBe('NOT_FOUND')
  })
})

describe('[DR-15] staff visibility', () => {
  it('auto-scopes plain staff to own work plus the department\'s unclaimed queue', () => {
    const m = login('made@aston.example', 'made12345')
    const rows = data<any[]>(call('/v1/tasks', { headers: h(m, H), query: { limit: 100 } }))
    // The HK TEAM pool task is unclaimed HK work — visible.
    expect(rows.some(t => t.id === IDS.task.turndownPool)).toBe(true)
    // Joko's claimed Maintenance work is neither Made's nor unclaimed — hidden.
    expect(rows.some(t => t.id === IDS.task.plumbingVerified)).toBe(false)
  })

  it('clamps an explicit assignedStaffId to the caller\'s own id', () => {
    const m = login('made@aston.example', 'made12345')
    const rows = data<any[]>(call('/v1/tasks', { headers: h(m, H), query: { assignedStaffId: IDS.staff.budi, limit: 100 } })) ?? []
    expect(rows.every(t => t.assignment?.staffId !== IDS.staff.budi || t.assignment?.staffId === IDS.staff.made)).toBe(true)
    expect(rows.some(t => t.id === IDS.task.towels0710)).toBe(false) // Budi's task
  })

  it('reports an out-of-scope detail as the same 404 a missing task gets', () => {
    const m = login('made@aston.example', 'made12345')
    expect(errOf(() => call(`/v1/tasks/${IDS.task.plumbingVerified}`, { headers: h(m, H) })).message).toBe('task')
    expect(errOf(() => call('/v1/tasks/99999999-0000-4000-8000-000000000404', { headers: h(m, H) })).message).toBe('task')
  })
})

describe('keyset pagination', () => {
  it('walks pages without overlap, total independent of the page size', () => {
    const a = login('admin@aston.example', 'admin123')
    const first = call('/v1/tasks', { headers: h(a, H), query: { limit: 3 } })
    const meta = first.body!.meta as { total: number, nextCursor?: string }
    expect(meta.total).toBeGreaterThan(6)
    expect(meta.nextCursor).toBeTruthy()
    const seen = new Set<string>((data<any[]>(first) ?? []).map(t => t.id))
    let cursor = meta.nextCursor
    while (cursor) {
      const page = call('/v1/tasks', { headers: h(a, H), query: { limit: 3, cursor } })
      for (const row of data<any[]>(page) ?? []) {
        expect(seen.has(row.id)).toBe(false)
        seen.add(row.id)
      }
      cursor = (page.body!.meta as { nextCursor?: string }).nextCursor
    }
    expect(seen.size).toBe(meta.total)
  })

  it('rejects a malformed cursor and validates sort fields', () => {
    const a = login('admin@aston.example', 'admin123')
    expect(errOf(() => call('/v1/tasks', { headers: h(a, H), query: { cursor: '!!!' } })).message).toBe('invalid cursor token')
    expect(errOf(() => call('/v1/tasks', { headers: h(a, H), query: { sort: 'title' } })).message).toBe('invalid sort field')
    expect(errOf(() => call('/v1/tasks', { headers: h(a, H), query: { status: 'DONE' } })).message).toBe('invalid status filter')
    expect(errOf(() => call('/v1/tasks', { headers: h(a, H), query: { departmentId: 'garbage' } })).message).toBe('invalid departmentId')
  })
})

describe('cross-tenant groups', () => {
  it('authorizes group reads by operator flag or a grant on that group', () => {
    const agus = login('admin@aston.example', 'admin123')
    const rina = login('regional@aston.example', 'regional123')
    const operator = login('operator@sentineltech.example', 'operator123')
    // Agus holds no grant — refused before any group lookup happens.
    expect(errOf(() => call(`/v1/groups/${IDS.group.aston}/stats`, { headers: h(agus) })).message).toBe('forbidden')
    const viaGrant = data(call(`/v1/groups/${IDS.group.aston}/stats`, { headers: h(rina) }))
    expect(viaGrant.tenants.length).toBe(2)
    // byStatus always carries all seven status keys, zero-filled.
    expect(Object.keys(viaGrant.totals.byStatus).sort()).toEqual(['CANCELLED', 'FINISHED', 'IN_PROGRESS', 'NEW', 'PENDING', 'SUBMITTED', 'VERIFIED'])
    const viaOperator = data(call(`/v1/groups/${IDS.group.aston}/stats`, { headers: h(operator) }))
    expect(viaOperator.totals.openTotal).toBe(viaGrant.totals.openTotal)
  })

  it('expands the hotels claim through a grant at the next login', () => {
    const operator = login('operator@sentineltech.example', 'operator123')
    call(`/v1/staff/${IDS.staff.made}/group-grants/${IDS.group.fave}`, { method: 'PUT', headers: h(operator) })
    const madeAgain = login('made@aston.example', 'made12345')
    expect(madeAgain.staff.hotels).toContain(IDS.hotel.fave)
    call(`/v1/staff/${IDS.staff.made}/group-grants/${IDS.group.fave}`, { method: 'DELETE', headers: h(operator) })
    expect(errOf(() => call(`/v1/staff/${IDS.staff.made}/group-grants/${IDS.group.fave}`, { method: 'DELETE', headers: h(operator) })).message)
      .toBe('group grant')
    const madeOnceMore = login('made@aston.example', 'made12345')
    expect(madeOnceMore.staff.hotels).not.toContain(IDS.hotel.fave)
  })

  it('group task lists reuse the filter grammar with hotel-aware cursors', () => {
    const rina = login('regional@aston.example', 'regional123')
    const page = call(`/v1/groups/${IDS.group.aston}/tasks`, { headers: h(rina), query: { limit: 2 } })
    const meta = page.body!.meta as { total: number, nextCursor?: string }
    expect(meta.total).toBeGreaterThan(2)
    expect(meta.nextCursor).toBeTruthy()
    const next = call(`/v1/groups/${IDS.group.aston}/tasks`, { headers: h(rina), query: { limit: 2, cursor: meta.nextCursor } })
    const firstIds = new Set((data<any[]>(page) ?? []).map(t => t.id))
    for (const row of data<any[]>(next) ?? []) expect(firstIds.has(row.id)).toBe(false)
  })
})

describe('task context', () => {
  it('reads context entries ordered by source app, then sort', () => {
    const b = login('staff@aston.example', 'staff123')
    const rows = data<any[]>(call(`/v1/tasks/${IDS.task.plumbingVerified}/context`, { headers: h(b, H) }))
    expect(rows.map(r => r.label)).toEqual(['Work order', 'Loyalty tier'])
    expect(errOf(() => call('/v1/tasks/nope/context', { headers: h(b, H) })).message).toBe('invalid id')
  })

  it('writes ride PATCH /v1/tasks/update, service-only, after the field patch', () => {
    const l = login('leader@aston.example', 'leader123')
    // The HK leader may patch fields on an HK task…
    const patched = data(call('/v1/tasks/update', { method: 'PATCH', headers: h(l, H), body: { taskId: IDS.task.towels0710, title: 'Extra towels — pool deck' } }))
    expect(patched.title).toBe('Extra towels — pool deck')
    // …but a human with a context array is 403 AFTER the fields landed.
    const err = errOf(() => call('/v1/tasks/update', { method: 'PATCH', headers: h(l, H), body: { taskId: IDS.task.towels0710, title: 'Extra towels — rooftop', context: [{ sourceAppCode: 'sentec-crm', label: 'X', value: 'Y' }] } }))
    expect(err.message).toBe('only service or partner actors may write task context')
    const reread = data(call(`/v1/tasks/${IDS.task.towels0710}`, { headers: h(l, H) }))
    expect(reread.title).toBe('Extra towels — rooftop') // the patch was NOT rolled back
    // A tenant admin human is rejected outright — update is leader-only among humans.
    const a = login('admin@aston.example', 'admin123')
    expect(errOf(() => call('/v1/tasks/update', { method: 'PATCH', headers: h(a, H), body: { taskId: IDS.task.towels0710, title: 'X' } })).message).toBe('forbidden')
    // Service actors may patch and write context in one call.
    const service = { 'authorization': 'Bearer service:test', 'x-hotel-id': H }
    call('/v1/tasks/update', { method: 'PATCH', headers: service, body: { taskId: IDS.task.towels0710, description: 'CRM flagged this guest.', context: [{ sourceAppCode: 'sentec-crm', label: 'Sentiment', value: 'At risk', sort: 0 }] } })
    const context = data<any[]>(call(`/v1/tasks/${IDS.task.towels0710}/context`, { headers: h(l, H) }))
    expect(context.some(entry => entry.sourceAppCode === 'sentec-crm' && entry.value === 'At risk')).toBe(true)
  })

  it('refuses updates on VERIFIED/CANCELLED with the status in the message', () => {
    const service = { 'authorization': 'Bearer service:test', 'x-hotel-id': H }
    expect(errOf(() => call('/v1/tasks/update', { method: 'PATCH', headers: service, body: { taskId: IDS.task.plumbingVerified, title: 'X' } })).message)
      .toBe('cannot update task in VERIFIED status')
    expect(errOf(() => call('/v1/tasks/update', { method: 'PATCH', headers: service, body: { taskId: IDS.task.checkoutCancelled } })).message)
      .toBe('at least one field (title, description, roomNumber) is required')
  })
})

describe('source-app registry', () => {
  it('is platform-wide, readable by anyone, curated by operators', () => {
    const b = login('staff@aston.example', 'staff123')
    const apps = data<any[]>(call('/v1/source-apps', { headers: h(b) }))
    expect(apps.length).toBeGreaterThanOrEqual(6)
    expect(apps.find(a => a.code === 'sentec-butler')?.shortName).toBe('Butler')
    const operator = login('operator@sentineltech.example', 'operator123')
    expect(errOf(() => call('/v1/platform/source-apps', { method: 'POST', headers: h(b), body: { code: 'x', name: 'X' } })).message)
      .toBe('operator access required')
    const upserted = data(call('/v1/platform/source-apps', { method: 'POST', headers: h(operator), body: { code: 'sentec-butler', name: 'Sentec Butler', shortName: 'Butler', color: '#111111' } }))
    expect(upserted.color).toBe('#111111')
    // Put the seed colour back so later suites see the registry unchanged.
    call('/v1/platform/source-apps', { method: 'POST', headers: h(operator), body: { code: 'sentec-butler', name: 'Sentec Butler', shortName: 'Butler', color: '#7c3aed' } })
  })
})
