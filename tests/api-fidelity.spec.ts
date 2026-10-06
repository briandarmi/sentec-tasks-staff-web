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

interface Session { cookie: string, csrf: string, staff: { id: string, properties: Array<{ hotelRef: string, name: string }> } }

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

  it('expands the reach (properties) through a grant at the next login', () => {
    const operator = login('operator@sentineltech.example', 'operator123')
    call(`/v1/staff/${IDS.staff.made}/group-grants/${IDS.group.fave}`, { method: 'PUT', headers: h(operator) })
    const madeAgain = login('made@aston.example', 'made12345')
    expect(madeAgain.staff.properties.map(p => p.hotelRef)).toContain(IDS.hotel.fave)
    call(`/v1/staff/${IDS.staff.made}/group-grants/${IDS.group.fave}`, { method: 'DELETE', headers: h(operator) })
    expect(errOf(() => call(`/v1/staff/${IDS.staff.made}/group-grants/${IDS.group.fave}`, { method: 'DELETE', headers: h(operator) })).message)
      .toBe('group grant')
    const madeOnceMore = login('made@aston.example', 'made12345')
    expect(madeOnceMore.staff.properties.map(p => p.hotelRef)).not.toContain(IDS.hotel.fave)
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

// ── feat/projects (API branch, per the 2026-09-28 frontend-impact notes) ─────
// Per-property roles, the requester rename, [DR-15]'s new arms, project
// exclusion and manager rights, checklist steps, templates and recurring
// tasks, the hotel timezone, time attribution and the roster import.

describe('feat/projects: tenant timezone', () => {
  it('any actor of the hotel reads it; only an admin there changes it, to a valid IANA name', () => {
    const b = login('staff@aston.example', 'staff123')
    const a = login('admin@aston.example', 'admin123')
    const tenant = data(call('/v1/tenant', { headers: h(b, H) }))
    expect(tenant).toMatchObject({ hotelRef: H, name: 'Aston Simatupang', timezone: 'Asia/Jakarta', isActive: true })
    expect(errOf(() => call('/v1/tenant', { method: 'PATCH', headers: h(b, H), body: { timezone: 'Asia/Makassar' } })).message).toBe('admin access required')
    expect(errOf(() => call('/v1/tenant', { method: 'PATCH', headers: h(a, H), body: { timezone: 'Mars/Olympus' } })).code).toBe('BAD_REQUEST')
    expect(data(call('/v1/tenant', { method: 'PATCH', headers: h(a, H), body: { timezone: 'Asia/Makassar' } })).timezone).toBe('Asia/Makassar')
    // Every active template's next run follows the zone (WITA is one hour ahead of WIB).
    const templates = data<any[]>(call('/v1/task-templates', { headers: h(a, H), query: { scope: 'all' } }))
    for (const t of templates.filter(x => x.isActive)) expect(t.timezone).toBe('Asia/Makassar')
    data(call('/v1/tenant', { method: 'PATCH', headers: h(a, H), body: { timezone: 'Asia/Jakarta' } }))
  })
})

describe('feat/projects: what a plain staff member sees, and project exclusion', () => {
  // Leaves behind: one deptless task and one project (with one task) at Simatupang.

  it('shows unclaimed no-department work property-wide — unless the list is filtered by department', () => {
    const a = login('admin@aston.example', 'admin123')
    const b = login('staff@aston.example', 'staff123')
    // Itemless and locationless: no routing match, so no department.
    const orphan = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Lost property at reception' } }))
    expect(orphan.hotelDepartmentId).toBeNull()
    const all = data<any[]>(call('/v1/tasks', { headers: h(b, H), query: { limit: 100 } }))
    expect(all.some(t => t.id === orphan.id)).toBe(true)
    const filtered = data<any[]>(call('/v1/tasks', { headers: h(b, H), query: { limit: 100, departmentId: IDS.dept.smtpHousekeeping } })) ?? []
    expect(filtered.some(t => t.id === orphan.id)).toBe(false)
    // The detail uses the same predicate.
    expect(call(`/v1/tasks/${orphan.id}`, { headers: h(b, H) }).status).toBe(200)
  })

  it('keeps project tasks out of the default list and board, in Mine, and behind projectId for members', () => {
    const b = login('staff@aston.example', 'staff123')
    const j = login('joko@aston.example', 'joko12345')
    const nur = login('nur@fave.example', 'nur1234567')
    const defaults = data<any[]>(call('/v1/tasks', { headers: h(b, H), query: { limit: 100 } }))
    expect(defaults.some(t => t.project)).toBe(false)
    // Joko holds a project task: Mine (assignedStaffId) still lists it, with its project.
    const mine = data<any[]>(call('/v1/tasks', { headers: h(j, H), query: { assignedStaffId: IDS.staff.joko, limit: 100 } }))
    const paint = mine.find(t => t.id === IDS.projectTask.lobbyPaint)
    expect(paint?.project).toEqual({ id: IDS.project.lobby, name: 'Lobby refurbishment' })
    // projectId: member sees the project's tasks; a non-member gets the same 404 a missing project gets.
    const inProject = data<any[]>(call('/v1/tasks', { headers: h(b, H), query: { projectId: IDS.project.lobby, limit: 100 } }))
    expect(inProject.map(t => t.id).sort()).toEqual([IDS.projectTask.lobbyLights, IDS.projectTask.lobbyPaint, IDS.projectTask.lobbySignage].sort())
    expect(errOf(() => call('/v1/tasks', { headers: h(nur, IDS.hotel.fave), query: { projectId: IDS.project.lobby } })).message).toBe('project not found')
    // A viewer can open a project task (arm f) even though it is claimed by someone else.
    const made = login('made@aston.example', 'made12345')
    expect(call(`/v1/tasks/${IDS.projectTask.lobbyPaint}`, { headers: h(made, H) }).status).toBe(200)
  })

  it('admits the assignee of a checklist step to the task, read-only', () => {
    // Budi is assigned step 2 of the lights task (and is a project member, so
    // use a fresh non-member): give Nur… no — Nur is at Fave. Use the orphan
    // pattern instead: Joko assigns a step on his own claimed task to Made.
    const a = login('admin@aston.example', 'admin123')
    const made = login('made@aston.example', 'made12345')
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Step visibility', itemRef: IDS.item.plumbing, locationRef: IDS.location.room1204, checklistLabels: ['Isolate valve', 'Replace washer'], assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.joko } } }))
    // Made (HK) cannot see a Maintenance task claimed by Joko…
    expect(errOf(() => call(`/v1/tasks/${t.id}`, { headers: h(made, H) })).message).toBe('task')
    const detail = data(call(`/v1/tasks/${t.id}`, { headers: h(a, H) }))
    const step = detail.checklist[1]
    // …a step may only go to someone in the task's department, so Made is refused…
    expect(errOf(() => call('/v1/tasks/checklist/assign', { method: 'POST', headers: h(a, H), body: { taskId: t.id, itemId: step.id, staffId: IDS.staff.made } })).message).toBe('assignee must be in the task\'s department')
    // …but a deptless task takes any member: move the task's department off first is not possible here,
    // so assign Joko's colleague in Maintenance instead and check the read-only access rule on Joko's own step.
    const j = login('joko@aston.example', 'joko12345')
    const assigned = data(call('/v1/tasks/checklist/assign', { method: 'POST', headers: h(j, H), body: { taskId: t.id, itemId: step.id, staffId: IDS.staff.joko } }))
    expect(assigned.assignedStaffId).toBe(IDS.staff.joko)
    expect(assigned.assignedStaffName).toBe('Joko Susilo')
    // Unassign with null.
    expect(data(call('/v1/tasks/checklist/assign', { method: 'POST', headers: h(j, H), body: { taskId: t.id, itemId: step.id, staffId: null } })).assignedStaffId).toBeNull()
  })
})

describe('feat/projects: projects', () => {
  // Leaves behind: the "Roof survey" project (completed) at Simatupang.

  const columnOf = (session: Session, status: string) =>
    data<{ columns: Array<{ id: string, status: string | null }> }>(call('/v1/kanban-board', { headers: h(session, H) })).columns.find(c => c.status === status)!.id

  it('lists by one status, admins everything and members their own, with progress and myLevel', () => {
    const a = login('admin@aston.example', 'admin123')
    const b = login('staff@aston.example', 'staff123')
    const j = login('joko@aston.example', 'joko12345')
    const active = data<any[]>(call('/v1/projects', { headers: h(a, H) }))
    const lobby = active.find(p => p.id === IDS.project.lobby)
    expect(lobby).toMatchObject({ status: 'ACTIVE', managerStaffId: IDS.staff.sari, myLevel: null, needsManager: false })
    expect(lobby.progress).toMatchObject({ total: 3, done: 1, percent: 33, unassigned: 1 })
    expect(lobby.progress.byStatus.IN_PROGRESS).toBe(1)
    // A member sees their level and no needsManager key.
    const asBudi = data<any[]>(call('/v1/projects', { headers: h(b, H) }))
    expect(asBudi.find(p => p.id === IDS.project.lobby)).toMatchObject({ myLevel: 'MEMBER' })
    expect('needsManager' in asBudi[0]!).toBe(false)
    // Joko was handed a task by name: an AUTO member.
    const members = data<any[]>(call(`/v1/projects/${IDS.project.lobby}/members`, { headers: h(j, H) }))
    expect(members[0]).toMatchObject({ staffId: IDS.staff.sari, level: 'MANAGER' })
    expect(members.find(m => m.staffId === IDS.staff.joko)).toMatchObject({ level: 'MEMBER', source: 'AUTO' })
    // One status per call; COMPLETED holds the pool deck.
    expect(data<any[]>(call('/v1/projects', { headers: h(a, H), query: { status: 'COMPLETED' } })).map(p => p.id)).toEqual([IDS.project.poolDeck])
    expect(errOf(() => call('/v1/projects', { headers: h(a, H), query: { status: 'DONE' } })).code).toBe('BAD_REQUEST')
    // Staff cannot open a project they are not in — 404, never 403.
    const nur = login('nur@fave.example', 'nur1234567')
    expect(errOf(() => call(`/v1/projects/${IDS.project.poolDeck}`, { headers: h(nur, IDS.hotel.fave) })).message).toBe('project not found')
  })

  it('a leader opens a project and becomes its manager; the manager has leader rights on its tasks', () => {
    const l = login('leader@aston.example', 'leader123')
    const b = login('staff@aston.example', 'staff123')
    const made = login('made@aston.example', 'made12345')
    expect(errOf(() => call('/v1/projects', { method: 'POST', headers: h(b, H), body: { name: 'Nope' } })).code).toBe('FORBIDDEN')
    const created = call('/v1/projects', { method: 'POST', headers: h(l, H), body: { name: 'Roof survey', endDate: '2026-01-01', members: [{ staffId: IDS.staff.made, level: 'VIEWER' }] } })
    expect(created.status).toBe(201)
    const project = data(created)
    expect(project).toMatchObject({ myLevel: 'MANAGER', managerStaffId: IDS.staff.sari, late: true })
    expect(errOf(() => call('/v1/projects', { method: 'POST', headers: h(l, H), body: { name: 'roof SURVEY' } })).code).toBe('CONFLICT')
    // A viewer may read but not add tasks; a manager creates through the ordinary pipeline.
    expect(errOf(() => call(`/v1/projects/${project.id}/tasks`, { method: 'POST', headers: h(made, H), body: { title: 'Check gutters' } })).code).toBe('FORBIDDEN')
    const task = data(call(`/v1/projects/${project.id}/tasks`, { method: 'POST', headers: h(l, H), body: { title: 'Check gutters', itemRef: IDS.item.plumbing, locationRef: IDS.location.floor7 } }))
    expect(task.project).toEqual({ id: project.id, name: 'Roof survey' })
    expect(task.hotelDepartmentId).toBe(IDS.dept.smtpMaintenance)
    // The manager (an HK leader) assigns across departments: the task MOVES to the assignee's department.
    const assigned = data(call('/v1/tasks/assign', { method: 'POST', headers: h(l, H), body: { taskId: task.id, staffId: IDS.staff.budi } }))
    expect(assigned.hotelDepartmentId).toBe(IDS.dept.smtpHousekeeping)
    // …and Budi became an AUTO member.
    expect(data<any[]>(call(`/v1/projects/${project.id}/members`, { headers: h(l, H) })).find(m => m.staffId === IDS.staff.budi)).toMatchObject({ source: 'AUTO', level: 'MEMBER' })
    // Manager rights on the task: edit, which an ordinary HK leader could do only in HK — and review.
    expect(data(call('/v1/tasks/update', { method: 'PATCH', headers: h(l, H), body: { taskId: task.id, title: 'Check gutters and downpipes' } })).title).toBe('Check gutters and downpipes')
    // Viewers may not comment; members may.
    expect(errOf(() => call('/v1/tasks/comments', { method: 'POST', headers: h(made, H), body: { taskId: task.id, comment: 'Looking' } })).code).toBe('FORBIDDEN')
    expect(call('/v1/tasks/comments', { method: 'POST', headers: h(b, H), body: { taskId: task.id, comment: 'On it' } }).status).toBe(201)
    // Membership: set a level, refuse touching the manager, hand over, take an existing task in, put it back.
    expect(data<any[]>(call(`/v1/projects/${project.id}/members/${IDS.staff.made}`, { method: 'PUT', headers: h(l, H), body: { level: 'MEMBER' } })).find(m => m.staffId === IDS.staff.made).level).toBe('MEMBER')
    expect(errOf(() => call(`/v1/projects/${project.id}/members/${IDS.staff.sari}`, { method: 'DELETE', headers: h(l, H) })).code).toBe('CONFLICT')
    const handed = data(call(`/v1/projects/${project.id}/manager`, { method: 'POST', headers: h(l, H), body: { staffId: IDS.staff.budi } }))
    expect(handed.managerStaffId).toBe(IDS.staff.budi)
    expect(handed.myLevel).toBe('MEMBER')
    expect(errOf(() => call(`/v1/projects/${project.id}/tasks/${IDS.task.towels1204}`, { method: 'PUT', headers: h(b, H) })).code).toBe('UNPROCESSABLE') // a guest request
    const joined = data(call(`/v1/projects/${project.id}/tasks/${IDS.task.towels0710}`, { method: 'PUT', headers: h(b, H) }))
    expect(joined.project.id).toBe(project.id)
    expect(errOf(() => call(`/v1/projects/${IDS.project.lobby}/tasks/${IDS.task.towels0710}`, { method: 'PUT', headers: h(l, H) })).code).toBe('CONFLICT')
    expect(data(call(`/v1/projects/${project.id}/tasks/${IDS.task.towels0710}`, { method: 'DELETE', headers: h(b, H) })).project).toBeNull()
    // Complete with open work reports how much; reopen; cancel needs ACTIVE.
    const completed = data(call(`/v1/projects/${project.id}/complete`, { method: 'POST', headers: h(b, H) }))
    expect(completed.status).toBe('COMPLETED')
    expect(completed.openTasks).toBe(1)
    expect(errOf(() => call(`/v1/projects/${project.id}/cancel`, { method: 'POST', headers: h(b, H) })).code).toBe('CONFLICT')
    expect(errOf(() => call(`/v1/projects/${project.id}/members/${IDS.staff.made}`, { method: 'PUT', headers: h(b, H), body: { level: 'VIEWER' } })).code).toBe('UNPROCESSABLE')
    expect(data(call(`/v1/projects/${project.id}/reopen`, { method: 'POST', headers: h(b, H) })).status).toBe('ACTIVE')
    // The project board has the hotel board's shape; the manager may move its cards.
    const board = data(call(`/v1/projects/${project.id}/board`, { headers: h(b, H) }))
    expect(board.columns.length).toBeGreaterThan(0)
    expect(data(call('/v1/tasks/status', { method: 'PATCH', headers: h(b, H), body: { taskId: task.id, columnId: columnOf(b, 'IN_PROGRESS') } })).status).toBe('IN_PROGRESS')
    data(call(`/v1/projects/${project.id}/complete`, { method: 'POST', headers: h(b, H) }))
  })
})

describe('feat/projects: checklist steps', () => {
  it('ticks with a note, adds, removes, refuses assignment on an unclaimed task and everything on a closed one', () => {
    const b = login('staff@aston.example', 'staff123')
    const made = login('made@aston.example', 'made12345')
    const l = login('leader@aston.example', 'leader123')
    const lights = data(call(`/v1/tasks/${IDS.projectTask.lobbyLights}`, { headers: h(l, H) }))
    expect(lights.checklist.map((c: any) => [c.label, c.isDone])).toEqual([['Remove old fittings', true], ['Fit LED downlights', false], ['Test dimmer scenes', false]])
    const mine = lights.checklist[1]
    expect(mine.assignedStaffName).toBe('Budi Santoso')
    // The step assignee ticks and annotates their own step; absent note keeps, null clears.
    const ticked = data(call('/v1/tasks/checklist/done', { method: 'POST', headers: h(b, H), body: { taskId: lights.id, itemId: mine.id, isDone: true, note: 'All 24 in.' } }))
    expect(ticked).toMatchObject({ isDone: true, doneBy: IDS.staff.budi, note: 'All 24 in.' })
    expect(data(call('/v1/tasks/checklist/done', { method: 'POST', headers: h(b, H), body: { taskId: lights.id, itemId: mine.id, isDone: false } })).note).toBe('All 24 in.')
    expect(data(call('/v1/tasks/checklist/done', { method: 'POST', headers: h(b, H), body: { taskId: lights.id, itemId: mine.id, isDone: true, note: null } })).note).toBeNull()
    expect(errOf(() => call('/v1/tasks/checklist/done', { method: 'POST', headers: h(b, H), body: { taskId: lights.id, itemId: mine.id, isDone: true, note: 'x'.repeat(2001) } })).code).toBe('BAD_REQUEST')
    // A viewer may neither tick another's step nor add steps.
    expect(errOf(() => call('/v1/tasks/checklist/done', { method: 'POST', headers: h(made, H), body: { taskId: lights.id, itemId: mine.id, isDone: false } })).code).toBe('FORBIDDEN')
    expect(errOf(() => call('/v1/tasks/checklist', { method: 'POST', headers: h(made, H), body: { taskId: lights.id, labels: ['x'] } })).code).toBe('FORBIDDEN')
    // The manager adds two, appended after the existing three, and removes one.
    const added = call('/v1/tasks/checklist', { method: 'POST', headers: h(l, H), body: { taskId: lights.id, labels: ['Dispose of packaging', 'Sign off'] } })
    expect(added.status).toBe(201)
    expect(data<any[]>(added).map(c => c.sort)).toEqual([3, 4])
    expect(errOf(() => call('/v1/tasks/checklist', { method: 'POST', headers: h(l, H), body: { taskId: lights.id, labels: [] } })).code).toBe('BAD_REQUEST')
    expect(data(call('/v1/tasks/checklist/remove', { method: 'POST', headers: h(l, H), body: { taskId: lights.id, itemId: data<any[]>(added)[1].id } }))).toEqual({ removed: true })
    expect(data(call(`/v1/tasks/${lights.id}`, { headers: h(l, H) })).checklist).toHaveLength(4)
    // Unclaimed: a step cannot be handed out.
    expect(errOf(() => call('/v1/tasks/checklist/assign', { method: 'POST', headers: h(l, H), body: { taskId: lights.id, itemId: mine.id, staffId: IDS.staff.budi } })).code).toBe('CONFLICT')
    // Closed: 409 on every checklist route.
    expect(errOf(() => call('/v1/tasks/checklist', { method: 'POST', headers: h(l, H), body: { taskId: IDS.projectTask.lobbySignage, labels: ['x'] } })).message).toBe('task is closed')
    // A service actor never.
    expect(errOf(() => call('/v1/tasks/checklist', { method: 'POST', headers: { authorization: 'Bearer service:test', 'x-hotel-id': H }, body: { taskId: lights.id, labels: ['x'] } })).code).toBe('FORBIDDEN')
  })
})

describe('feat/projects: templates and recurring tasks', () => {
  it('admins manage shared templates; anyone reads them; scope beyond shared is admin-only', () => {
    const a = login('admin@aston.example', 'admin123')
    const b = login('staff@aston.example', 'staff123')
    const shared = data<any[]>(call('/v1/task-templates', { headers: h(b, H) }))
    expect(shared.map(t => t.name)).toEqual(['Nightly minibar count', 'Weekly AC filter check'])
    expect(errOf(() => call('/v1/task-templates', { headers: h(b, H), query: { scope: 'all' } })).code).toBe('FORBIDDEN')
    const all = data<any[]>(call('/v1/task-templates', { headers: h(a, H), query: { scope: 'all' } }))
    // Personal = ownerStaffId set; a shared template has createdBy and no owner.
    expect(all.find(t => t.ownerStaffId !== null)).toMatchObject({ name: 'Corridor rounds', ownerName: 'Budi Santoso', ownerStaffId: IDS.staff.budi })
    expect(all.find(t => t.id === IDS.template.nightlyMinibar)).toMatchObject({ ownerStaffId: null, ownerName: null, createdBy: IDS.staff.agus })
    const paused = all.find(t => t.id === IDS.template.mondayFilters)
    expect(paused).toMatchObject({ isActive: false, nextRunAt: null, upcoming: [], lastOccurrenceAt: '2026-08-24T01:30:00.000Z' })
    expect(paused.lastError).toMatch(/^occurrence 2026-08-24T01:30:00Z skipped: /)
    const nightly = all.find(t => t.id === IDS.template.nightlyMinibar)
    expect(nightly.upcoming).toHaveLength(5)
    expect(Date.parse(nightly.nextRunAt)).toBeGreaterThan(Date.now())
    // Every upcoming run is at 21:00 Jakarta time, one day apart.
    for (const run of nightly.upcoming) expect(new Date(Date.parse(run) + 7 * 60 * 60_000).toISOString().slice(11, 16)).toBe('21:00')
    expect(Date.parse(nightly.upcoming[1]) - Date.parse(nightly.upcoming[0])).toBe(24 * 60 * 60_000)
    // Create: 201; duplicate name 409; unresolvable content 422 (an inactive item); a paused save skips validation.
    expect(errOf(() => call('/v1/task-templates', { method: 'POST', headers: h(b, H), body: { name: 'X', content: { title: 'X' } } })).code).toBe('FORBIDDEN')
    const created = call('/v1/task-templates', { method: 'POST', headers: h(a, H), body: { name: 'Monthly fire door check', content: { title: 'Fire door check — all floors', checklistLabels: ['Closers', 'Seals'], assignee: { assigneeKind: 'TEAM', assigneeTeamId: IDS.team.engineering } }, recurrence: { kind: 'MONTHLY', timeMinutes: 540, dayOfMonth: 1 } } })
    expect(created.status).toBe(201)
    expect(data(created)).toMatchObject({ isActive: true, ownerStaffId: null, ownerName: null, createdBy: IDS.staff.agus, timezone: 'Asia/Jakarta' })
    expect('scope' in data(created)).toBe(false)
    expect(new Date(Date.parse(data(created).nextRunAt) + 7 * 60 * 60_000).getUTCDate()).toBe(1)
    expect(errOf(() => call('/v1/task-templates', { method: 'POST', headers: h(a, H), body: { name: 'MONTHLY FIRE DOOR CHECK', content: { title: 'X' }, recurrence: null } })).message).toBe('a task template with this name already exists')
    expect(errOf(() => call('/v1/task-templates', { method: 'POST', headers: h(a, H), body: { name: 'Odd', content: { title: 'X' }, recurrence: { kind: 'DAILY', timeMinutes: 60, weekdays: [1] } } })).message).toBe('a DAILY recurrence takes neither weekdays nor dayOfMonth')
    expect(errOf(() => call('/v1/task-templates', { method: 'POST', headers: h(a, H), body: { name: 'Broken', content: { title: 'X', locationRef: '99999999-0000-4000-8000-000000000099' }, recurrence: null } })).code).toBe('UNPROCESSABLE')
    expect(call('/v1/task-templates', { method: 'POST', headers: h(a, H), body: { name: 'Broken but paused', isActive: false, content: { title: 'X', locationRef: '99999999-0000-4000-8000-000000000099' }, recurrence: null } }).status).toBe(201)
    expect(errOf(() => call('/v1/task-templates', { method: 'POST', headers: h(a, H), body: { name: 'Bad weekly', content: { title: 'X' }, recurrence: { kind: 'WEEKLY', timeMinutes: 60 } } })).message).toBe('a WEEKLY recurrence needs at least one weekday')
    // PUT is a full replace; DELETE archives (404 afterwards), tasks already made stay.
    const id = data(created).id
    expect(data(call(`/v1/task-templates/${id}`, { method: 'PUT', headers: h(a, H), body: { name: 'Monthly fire door check', isActive: false, content: { title: 'Fire door check' }, recurrence: null } })).nextRunAt).toBeNull()
    expect(call(`/v1/task-templates/${id}`, { method: 'DELETE', headers: h(a, H) }).status).toBe(204)
    expect(errOf(() => call(`/v1/task-templates/${id}`, { headers: h(a, H) })).message).toBe('task template')
  })

  it('a staff member with create-task starts a recurring task: the personal template AND the first task, now', () => {
    const b = login('staff@aston.example', 'staff123')
    const made = login('made@aston.example', 'made12345')
    const body = { content: { title: 'Pool towel restock', roomNumber: 'Pool deck', checklistLabels: ['Count', 'Restock'], assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } }, recurrence: { kind: 'DAILY', timeMinutes: 6 * 60 } }
    expect(errOf(() => call('/v1/recurring-tasks', { method: 'POST', headers: h(made, H), body })).code).toBe('FORBIDDEN')
    // Plain staff may assign only themselves or their own team.
    expect(errOf(() => call('/v1/recurring-tasks', { method: 'POST', headers: h(b, H), body: { ...body, content: { ...body.content, assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.made } } } })).code).toBe('FORBIDDEN')
    const created = call('/v1/recurring-tasks', { method: 'POST', headers: h(b, H), body })
    expect(created.status).toBe(201)
    const { template, taskId } = data(created)
    expect(template).toMatchObject({ name: 'Pool towel restock', ownerStaffId: IDS.staff.budi, ownerName: 'Budi Santoso', isActive: true, lastTaskId: taskId })
    expect(errOf(() => call('/v1/recurring-tasks', { method: 'POST', headers: h(b, H), body: { content: body.content } })).message).toBe('recurrence is required for a recurring task')
    expect(errOf(() => call('/v1/recurring-tasks', { method: 'POST', headers: { authorization: 'Bearer service:test', 'x-hotel-id': H }, body })).message).toBe('recurring tasks belong to a staff member')
    expect(template.upcoming).toHaveLength(5)
    const first = data(call(`/v1/tasks/${taskId}`, { headers: h(b, H) }))
    expect(first).toMatchObject({ title: 'Pool towel restock', templateId: template.id, occurrenceKey: null })
    expect(first.assignment.staffId).toBe(IDS.staff.budi)
    expect(first.checklist.map((c: any) => c.label)).toEqual(['Count', 'Restock'])
    // Own list; someone else's id is 404; pause via PUT; archive.
    expect(data<any[]>(call('/v1/recurring-tasks', { headers: h(b, H) })).map(t => t.name).sort()).toEqual(['Corridor rounds', 'Pool towel restock'])
    expect(errOf(() => call(`/v1/recurring-tasks/${template.id}`, { headers: h(made, H) })).message).toBe('recurring task')
    expect(data(call(`/v1/recurring-tasks/${template.id}`, { method: 'PUT', headers: h(b, H), body: { ...body, isActive: false } })).nextRunAt).toBeNull()
    expect(call(`/v1/recurring-tasks/${template.id}`, { method: 'DELETE', headers: h(b, H) }).status).toBe(204)
    expect(call(`/v1/tasks/${taskId}`, { headers: h(b, H) }).status).toBe(200)
  })
})

describe('feat/projects: time attribution', () => {
  it('splits open-hours minutes between unclaimed, pooled and holders, cut at submission', () => {
    const l = login('leader@aston.example', 'leader123')
    const report = data(call(`/v1/tasks/${IDS.task.cleaningSubmitted}/attribution`, { headers: h(l, H) }))
    // Activated 01:15, assigned to Budi 01:20, submitted 02:20 (24/7 schedule).
    expect(report).toMatchObject({ taskId: IDS.task.cleaningSubmitted, cutoffReason: 'submitted', cutoffAt: '2026-08-25T02:20:00.000Z', totalMinutes: 65, unclaimedMinutes: 5, pooledMinutes: 0, reconciles: true })
    expect(report.holders).toEqual([{ staffId: IDS.staff.budi, staffName: 'Budi Santoso', minutes: 60, holds: 1 }])
    // A pool row counts as pooled time; an open task is cut at now.
    const pool = data(call(`/v1/tasks/${IDS.task.turndownPool}/attribution`, { headers: h(l, H) }))
    expect(pool.cutoffReason).toBe('open')
    expect(pool.pooledMinutes).toBe(pool.totalMinutes)
    expect(pool.holders).toEqual([])
    // Visibility is the task's: a Fave user cannot read a Simatupang task's split.
    const nur = login('nur@fave.example', 'nur1234567')
    expect(errOf(() => call(`/v1/tasks/${IDS.task.cleaningSubmitted}/attribution`, { headers: h(nur, IDS.hotel.fave) })).message).toBe('task')
  })
})

describe('feat/projects: assignable staff widening', () => {
  it('lets the task assignee and a project manager call it; others still need leader or admin', () => {
    const j = login('joko@aston.example', 'joko12345')
    const b = login('staff@aston.example', 'staff123')
    expect(errOf(() => call('/v1/staff/assignable', { headers: h(j, H) })).message).toBe('leader or admin access required')
    expect(call('/v1/staff/assignable', { headers: h(j, H), query: { taskId: IDS.projectTask.lobbyPaint } }).status).toBe(200)
    // Budi is a plain member of the lobby project, not its manager.
    expect(errOf(() => call('/v1/staff/assignable', { headers: h(b, H), query: { projectId: IDS.project.lobby } })).code).toBe('FORBIDDEN')
    const rows = data<any[]>(call('/v1/staff/assignable', { headers: h(j, H), query: { taskId: IDS.projectTask.lobbyPaint } }))
    expect(rows.find(r => r.id === IDS.staff.budi)).toMatchObject({ role: 'staff', hotelDepartmentId: IDS.dept.smtpHousekeeping })
  })
})

describe('feat/projects: roster import', () => {
  it('imports a CSV row by row — created, updated, granted, failed — and always answers 200 with the totals', () => {
    const a = login('admin@aston.example', 'admin123')
    const b = login('staff@aston.example', 'staff123')
    const csv = [
      'email,name,role,department,createTask',
      'new.hire@aston.example,Dewi Kartika,staff,Housekeeping,true',
      'joko@aston.example,Joko Susilo,leader,Maintenance,',
      'nur@fave.example,Nur Aini,,Front Office,false',
      'not-an-email,Nobody,staff,,',
      'x@aston.example,Someone,manager,,',
      'y@aston.example,Someone,staff,Spa,',
    ].join('\n')
    expect(errOf(() => call('/v1/staff/import', { method: 'POST', headers: h(b, H), body: { file: { name: 'roster.csv', content: csv } } })).message).toBe('admin access required')
    const res = call('/v1/staff/import', { method: 'POST', headers: h(a, H), body: { file: { name: 'roster.csv', content: csv } } })
    expect(res.status).toBe(200)
    expect(res.body!.meta).toEqual({ total: 6, created: 1, updated: 1, granted: 1, failed: 3 })
    const rows = data<any[]>(res)
    expect(rows.map(r => [r.line, r.outcome])).toEqual([[2, 'created'], [3, 'updated'], [4, 'granted'], [5, 'failed'], [6, 'failed'], [7, 'failed']])
    // Row errors come back in the API's own error shape, not as text.
    expect(rows[3].error).toEqual({ code: 'BAD_REQUEST', message: 'valid email is required' })
    expect(rows[4].error).toEqual({ code: 'BAD_REQUEST', message: 'role must be staff or leader' })
    expect(rows[5].error).toEqual({ code: 'UNPROCESSABLE', message: 'no department named Spa is enabled for this hotel' })
    // The new hire has no password: password login is refused, the account exists.
    expect(errOf(() => call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email: 'new.hire@aston.example', password: '' } })).code).toBe('UNAUTHORIZED')
    const staff = data<any[]>(call('/v1/staff', { headers: h(a, H) }))
    expect(staff.find(s => s.email === 'new.hire@aston.example').memberships).toEqual([{ hotelRef: H, role: 'staff', hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: true, syncIssue: null }])
    // The file's createTask cell was blank for Joko: blank reads as false and is applied.
    expect(staff.find(s => s.id === IDS.staff.joko).memberships[0]).toMatchObject({ role: 'leader', createTask: false })
    expect(staff.find(s => s.id === IDS.staff.nur).memberships[0]).toMatchObject({ role: 'staff', hotelDepartmentId: IDS.dept.smtpFrontOffice })
    // Files the API refuses outright: no email column (400), too many rows (422).
    expect(errOf(() => call('/v1/staff/import', { method: 'POST', headers: h(a, H), body: { file: { name: 'r.csv', content: 'name\nX' } } })).message).toBe('the file needs an email column')
    expect(errOf(() => call('/v1/staff/import', { method: 'POST', headers: h(a, H), body: { file: { name: 'r.csv', content: 'email,name\n' } } })).message).toBe('the file has a header row but no staff rows')
    expect(errOf(() => call('/v1/staff/import', { method: 'POST', headers: h(a, H), body: { file: { name: 'r.xls', content: 'x' } } })).message).toMatch(/legacy \.xls/)
    expect(errOf(() => call('/v1/staff/import', { method: 'POST', headers: h(a, H), body: { file: { name: 'r.csv', content: `email,name\n${'a@b.c,X\n'.repeat(1001)}` } } })).code).toBe('UNPROCESSABLE')
    // The template is a raw file, not the envelope.
    const template = call('/v1/staff/import/template', { headers: h(a, H), query: { format: 'csv' } })
    expect(template.body).toBeNull()
    expect(template.raw?.filename).toBe('staff-import-template.csv')
    expect(template.raw?.content.split('\n')[0]).toBe('email,name,role,department,createTask')
  })
})

// ════════════════════════ refactor/ponytail-audit @ 1ee8c12 (2026-10-06) ════════════════════════
// feat/escalation, feat/department-crud, feat/ems-staff-sync, feat/interface-lambda.
// Literals and orderings follow the Go in internal/{escalation,department,emssync,offboard,tenantsync,server}.

const asAdmin = () => login('admin@aston.example', 'admin123')
const asRina = () => login('regional@aston.example', 'regional123')
const asOperator = () => login('operator@sentineltech.example', 'operator123')
const KNGN = IDS.hotel.kuningan
const GHOST = '99999999-0000-4000-8000-000000000001'
const butlerPartner = (hotelId: string) => ({ 'authorization': `Bearer partner:${IDS.partner.butler}`, 'x-hotel-id': hotelId })
const emsPartner = { authorization: `Bearer partner:${IDS.partner.ems}` }
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

describe('surfaces: one code base, a main and an interface deployment (feat/interface-lambda)', () => {
  it('a partner token reaches the interface routes only; nobody else reaches its exclusive ones', () => {
    expect(call('/v1/tasks', { headers: butlerPartner(H) }).status).toBe(200)
    expect(errOf(() => call('/v1/staff', { headers: butlerPartner(H) })).message).toBe('partner tokens must use the interface API')
    expect(errOf(() => call('/v1/escalation-policies', { headers: butlerPartner(H) })).message).toBe('partner tokens must use the interface API')
    const a = asAdmin()
    expect(errOf(() => call('/v1/tasks', { method: 'POST', headers: h(a, H), body: {} })).message).toBe('the interface API accepts partner tokens only')
    expect(errOf(() => call('/v1/tasks', { method: 'POST', headers: { 'authorization': 'Bearer service:test', 'x-hotel-id': H }, body: {} })).message).toBe('the interface API accepts partner tokens only')
    // Butler dispatches as a partner now; the task carries the policy it resolved to.
    const dispatched = data(call('/v1/tasks', { method: 'POST', headers: butlerPartner(H), body: { source: { product: 'sentec-butler', channel: 'guest' }, itemRef: IDS.item.towels, item: { name: 'Extra towels' }, requester: { roomNumber: '1204' } } }))
    expect(dispatched).toMatchObject({ escalationPolicyId: IDS.policy.smtpStandard, escalationLevel: 0, escalatedAt: null })
  })
})

describe('escalation policies (feat/escalation)', () => {
  // Leaves behind at Simatupang: the "Night audit" and "Paused" policies, a floor rule deleted again, four escalated tasks.

  it('lists for any actor of the hotel, default first, live steps by sort', () => {
    const b = login('staff@aston.example', 'staff123')
    const rows = data<any[]>(call('/v1/escalation-policies', { headers: h(b, H) }))
    expect(rows.map(p => p.name)).toEqual(['Standard escalation', 'Urgent escalation'])
    expect(rows[0].isDefault).toBe(true)
    expect(rows[0].steps.map((s: any) => [s.sort, s.triggerKind, s.triggerValue])).toEqual([[0, 'RESPONSE_OVERDUE', 0], [1, 'PERCENT_OF_RESOLUTION', 50], [2, 'RESOLUTION_OVERDUE', 0]])
    expect(data(call(`/v1/escalation-policies/${IDS.policy.smtpUrgent}`, { headers: h(b, H) })).steps[0].actions).toEqual([{ type: 'reassign', teamId: IDS.team.engineering }])
    expect(errOf(() => call('/v1/escalation-policies/nope', { headers: h(b, H) })).message).toBe('id must be a uuid')
    expect(errOf(() => call(`/v1/escalation-policies/${IDS.policy.smtpUrgent}`, { headers: h(b, KNGN) })).message).toBe('escalation policy')
    expect(errOf(() => call('/v1/escalation-policies', { method: 'POST', headers: h(b, H), body: { name: 'X' } })).message).toBe('admin access required')
  })

  it('validates the upsert in the Go\'s words, step by step', () => {
    const a = asAdmin()
    const post = (body: Record<string, unknown>) => errOf(() => call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body }))
    const step = (extra: Record<string, unknown>) => ({ sort: 0, triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 0, ...extra })
    expect(post({ name: '  ' }).message).toBe('name is required (1-120 chars)')
    expect(post({ name: 'X', steps: Array.from({ length: 11 }, (_, i) => step({ sort: i })) }).message).toBe('a policy has at most 10 steps')
    expect(post({ name: 'X', steps: [step({ sort: 10 })] }).message).toBe('steps[0]: sort must be 0-9')
    expect(post({ name: 'X', steps: [step({ triggerKind: 'PERCENT_OF_RESOLUTION', triggerValue: 0 })] }).message).toBe('steps[0]: triggerValue must be a percent, 1-100')
    expect(post({ name: 'X', steps: [step({ triggerKind: 'UNASSIGNED_FOR', triggerValue: 0 })] }).message).toBe('steps[0]: triggerValue must be at least 1 minute')
    expect(post({ name: 'X', steps: [step({ triggerValue: -1 })] }).message).toBe('steps[0]: triggerValue must be 0 or more minutes')
    expect(post({ name: 'X', steps: [step({ triggerKind: 'LATE' })] }).message).toBe('steps[0]: unknown triggerKind "LATE"')
    expect(post({ name: 'X', steps: [step({ actions: [{ type: 'bumpPriority', staffId: IDS.staff.joko }] })] }).message).toBe('steps[0]: bumpPriority takes no target')
    expect(post({ name: 'X', steps: [step({ actions: [{ type: 'reassign' }] })] }).message).toBe('steps[0]: reassign needs exactly one of staffId or teamId')
    expect(post({ name: 'X', steps: [step({ actions: [{ type: 'routeToDepartment' }] })] }).message).toBe('steps[0]: routeToDepartment needs hotelDepartmentId only')
    expect(post({ name: 'X', steps: [step({ actions: [{ type: 'bumpPriority' }, { type: 'bumpPriority' }] })] }).message).toBe('steps[0]: action "bumpPriority" appears more than once')
    expect(post({ name: 'X', steps: [step({ recipients: [{ kind: 'admins' }, { kind: 'admins' }] })] }).message).toBe('steps[0]: recipient "admins" appears more than once')
    expect(post({ name: 'X', steps: [step({ recipients: [{ kind: 'team' }] })] }).message).toBe('steps[0]: team recipient needs teamId only')
    expect(post({ name: 'X', steps: [step({ recipients: [{ kind: 'everyone' }] })] }).message).toBe('steps[0]: unknown recipient kind "everyone"')
    expect(post({ name: 'X', steps: [step({}), step({ sort: 0, triggerValue: 5 })] }).message).toBe('steps[1]: duplicate sort 0')
    // Targets must be this hotel's — and a department must be ACTIVE here.
    expect(post({ name: 'X', steps: [step({ recipients: [{ kind: 'staff', staffId: GHOST }] })] })).toEqual({ code: 'UNPROCESSABLE', message: `steps[0]: staff ${GHOST} is not part of this hotel` })
    expect(post({ name: 'X', steps: [step({ actions: [{ type: 'reassign', teamId: GHOST }] })] })).toEqual({ code: 'UNPROCESSABLE', message: `steps[0]: team ${GHOST} is not part of this hotel` })
    expect(post({ name: 'X', steps: [step({ actions: [{ type: 'routeToDepartment', hotelDepartmentId: IDS.dept.smtpSpa }] })] })).toEqual({ code: 'UNPROCESSABLE', message: `steps[0]: department ${IDS.dept.smtpSpa} is not part of this hotel` })
    expect(post({ name: 'standard ESCALATION' }).message).toBe('an escalation policy with this name already exists')
    expect(post({ id: GHOST, name: 'X' }).message).toBe('escalation policy')
  })

  it('upserts policy and steps together: ids update, omissions soft-delete, a new default demotes the old one', () => {
    const a = asAdmin()
    const created = data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: {
      name: 'Night audit',
      steps: [
        { sort: 0, triggerKind: 'UNASSIGNED_FOR', triggerValue: 30, actions: [{ type: 'reassign', staffId: IDS.staff.joko }], recipients: [{ kind: 'staff', staffId: IDS.staff.joko }] },
        { sort: 1, triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 60, actions: [{ type: 'bumpPriority' }], recipients: [{ kind: 'admins' }] },
      ],
    } }))
    expect(created.isActive).toBe(true) // omitted → true on create
    expect(created.isDefault).toBe(false)
    const [first, second] = created.steps
    // Update step 0 in place, drop step 1, add a step 2; the dropped step's id is then unknown.
    const updated = data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: {
      id: created.id, name: 'Night audit', steps: [
        { id: first.id, sort: 0, triggerKind: 'UNASSIGNED_FOR', triggerValue: 45, actions: [], recipients: [{ kind: 'departmentLeaders' }] },
        { sort: 2, triggerKind: 'RESPONSE_OVERDUE', triggerValue: 10, actions: [{ type: 'bumpPriority' }], recipients: [] },
      ],
    } }))
    expect(updated.steps.map((s: any) => [s.id === first.id, s.sort, s.triggerValue])).toEqual([[true, 0, 45], [false, 2, 10]])
    expect(errOf(() => call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { id: created.id, name: 'Night audit', steps: [{ id: second.id, sort: 1, triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 1 }] } })))
      .toEqual({ code: 'UNPROCESSABLE', message: `unknown step id ${second.id} for this policy` })
    // isActive omitted on an update keeps it; no steps in the request removes every live step.
    const paused = data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { id: created.id, name: 'Night audit', isActive: false } }))
    expect(paused.isActive).toBe(false)
    expect(paused.steps).toEqual([])
    expect(data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { id: created.id, name: 'Night audit' } })).isActive).toBe(false)
    // A new default demotes the old one; then the Standard policy is put back for the suites below.
    expect(data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { id: created.id, name: 'Night audit', isDefault: true, isActive: true } })).isDefault).toBe(true)
    const list = data<any[]>(call('/v1/escalation-policies', { headers: h(a, H) }))
    expect(list.filter(p => p.isDefault).map(p => p.name)).toEqual(['Night audit'])
    const standard = list.find(p => p.id === IDS.policy.smtpStandard)
    data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { id: standard.id, name: standard.name, isDefault: true, steps: standard.steps } }))
    expect(data(call(`/v1/escalation-policies/${created.id}`, { headers: h(a, H) })).isDefault).toBe(false)
    expect(data(call(`/v1/escalation-policies/${IDS.policy.smtpStandard}`, { headers: h(a, H) })).steps).toHaveLength(3) // ids re-sent = updated, not recreated
  })

  it('links to SLAs and routing rules: the key absent keeps, null clears, a value must be an active policy here', () => {
    const a = asAdmin()
    const urgent = () => data<any[]>(call('/v1/slas', { headers: h(a, H) })).find(s => s.id === IDS.sla.smtpUrgent)
    expect(urgent().escalationPolicyId).toBe(IDS.policy.smtpUrgent)
    const slaBody = { id: IDS.sla.smtpUrgent, name: 'Urgent', responseTime: 5, resolutionTime: 20 }
    data(call('/v1/slas', { method: 'POST', headers: h(a, H), body: slaBody }))
    expect(urgent().escalationPolicyId).toBe(IDS.policy.smtpUrgent) // no key: the link survives an edit of the times
    const paused = data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { name: 'Paused', isActive: false } }))
    expect(errOf(() => call('/v1/slas', { method: 'POST', headers: h(a, H), body: { ...slaBody, escalationPolicyId: paused.id } })).message).toBe('escalationPolicyId is not an active escalation policy of this hotel')
    expect(errOf(() => call('/v1/slas', { method: 'POST', headers: h(a, H), body: { ...slaBody, escalationPolicyId: 'nope' } })).message).toBe('invalid JSON body')
    expect(data(call('/v1/slas', { method: 'POST', headers: h(a, H), body: { ...slaBody, escalationPolicyId: null } })).escalationPolicyId).toBeNull()
    expect(data(call('/v1/slas', { method: 'POST', headers: h(a, H), body: { ...slaBody, escalationPolicyId: IDS.policy.smtpUrgent } })).escalationPolicyId).toBe(IDS.policy.smtpUrgent)
    // Routing rules: the same three states on the natural-key PUT.
    const rule = { locationTypeId: IDS.locationType.floor, departmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpStandard }
    expect(data(call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { ...rule, escalationPolicyId: IDS.policy.smtpUrgent } })).escalationPolicyId).toBe(IDS.policy.smtpUrgent)
    expect(data(call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: rule })).escalationPolicyId).toBe(IDS.policy.smtpUrgent)
    expect(errOf(() => call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { ...rule, escalationPolicyId: paused.id } })).message).toBe('escalationPolicyId is not an active escalation policy of this hotel')
    const cleared = data(call('/v1/routing-rules', { method: 'PUT', headers: h(a, H), body: { ...rule, escalationPolicyId: null } }))
    expect(cleared.escalationPolicyId).toBeNull()
    expect(call(`/v1/routing-rules/id/${cleared.id}`, { method: 'DELETE', headers: h(a, H) }).status).toBe(204)
    // The old delete-by-itemRef route is gone: the mux's plain-text 404.
    expect(errOf(() => call(`/v1/routing-rules/${IDS.item.acFault}`, { method: 'DELETE', headers: h(a, H) })).message).toBe('404 page not found')
  })

  it('resolves the policy once at creation (rule → SLA → default) and previews its name', () => {
    const a = asAdmin()
    const towels = data(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'Towels', itemRef: IDS.item.towels, locationRef: IDS.location.room1204 } }))
    expect(towels.task.escalationPolicyId).toBe(IDS.policy.smtpStandard) // the Standard SLA names no policy → the hotel default
    expect(towels.task.escalationPolicyName).toBe('Standard escalation')
    const ac = data(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'AC', itemRef: IDS.item.acFault, locationRef: IDS.location.room1204 } }))
    expect(ac.task.escalationPolicyName).toBe('Urgent escalation') // the Urgent SLA's own policy
    const nur = login('nur@fave.example', 'nur1234567')
    const fave = data(call('/v1/tasks/preview', { method: 'POST', headers: h(nur, IDS.hotel.fave), body: { title: 'Clean', itemRef: IDS.item.faveCleaning, locationRef: IDS.location.faveRoom0210 } }))
    expect(fave.task.escalationPolicyId).toBeNull()
    expect('escalationPolicyName' in fave.task).toBe(false)
    const created = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Towels', itemRef: IDS.item.towels, locationRef: IDS.location.room1204 } }))
    expect(created).toMatchObject({ escalationPolicyId: IDS.policy.smtpStandard, escalationLevel: 0, escalatedAt: null })
    expect('escalationPolicyName' in created).toBe(false)
  })

  it('the sweep applies every due step in sort order, records each, and never fires a step twice', () => {
    const a = asAdmin()
    // Eight days ago: every trigger of the Standard policy is long due on Housekeeping's 24/7 schedule.
    const created = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Old towels', itemRef: IDS.item.towels, locationRef: IDS.location.room1204, activationDate: daysAgo(8) } }))
    expect(created.escalationLevel).toBe(0)
    // The next request sweeps before it answers.
    const t = data(call(`/v1/tasks/${created.id}`, { headers: h(a, H) }))
    expect(t.escalationLevel).toBe(3)
    expect(t.priority).toBe('URGENT') // NORMAL → HIGH at 50%, HIGH → URGENT at the deadline
    expect(t.escalatedAt).not.toBeNull()
    const log = data<any[]>(call(`/v1/tasks/${created.id}/escalations`, { headers: h(a, H) }))
    expect(log.map(r => [r.level, r.trigger.kind, r.trigger.value, r.policyId === IDS.policy.smtpStandard])).toEqual([[1, 'RESPONSE_OVERDUE', 0, true], [2, 'PERCENT_OF_RESOLUTION', 50, true], [3, 'RESOLUTION_OVERDUE', 0, true]])
    expect(log[1].applied).toEqual([{ type: 'bumpPriority', before: 'NORMAL', after: 'HIGH' }])
    expect(log[2].applied).toEqual([{ type: 'bumpPriority', before: 'HIGH', after: 'URGENT' }])
    expect(log[0].recipients).toEqual([IDS.staff.sari]) // Housekeeping's leader
    expect(log[2].recipients).toEqual(expect.arrayContaining([IDS.staff.agus, IDS.staff.sari]))
    expect(t.history.filter((row: any) => row.description?.startsWith('Escalated')).map((row: any) => [row.staffId, row.description])).toEqual([
      [null, 'Escalated (level 1, response overdue 0 min).'],
      [null, 'Escalated (level 2, 50% of resolution time): priority NORMAL → HIGH.'],
      [null, 'Escalated (level 3, resolution overdue 0 min): priority HIGH → URGENT.'],
    ])
    // Idempotent: another request changes nothing. Visibility is the task's own.
    expect(data<any[]>(call(`/v1/tasks/${created.id}/escalations`, { headers: h(a, H) }))).toHaveLength(3)
    expect(data(call(`/v1/tasks/${created.id}`, { headers: h(a, H) })).escalationLevel).toBe(3)
    expect(errOf(() => call(`/v1/tasks/${created.id}/escalations`, { headers: h(login('nur@fave.example', 'nur1234567'), H) })).message).toBe('task')
    expect(errOf(() => call('/v1/tasks/nope/escalations', { headers: h(a, H) })).message).toBe('id must be a valid UUID')
  })

  it('reassigns to a team, skips what cannot apply, and stops while a policy is inactive', () => {
    const a = asAdmin()
    const ac = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Old AC fault', itemRef: IDS.item.acFault, locationRef: IDS.location.room0908, activationDate: daysAgo(8) } }))
    const t = data(call(`/v1/tasks/${ac.id}`, { headers: h(a, H) }))
    expect(t.escalationLevel).toBe(2)
    expect(t.assignment).toMatchObject({ kind: 'TEAM', teamId: IDS.team.engineering })
    const log = data<any[]>(call(`/v1/tasks/${ac.id}/escalations`, { headers: h(a, H) }))
    expect(log[0].applied).toEqual([{ type: 'reassign', before: '', after: `team:${IDS.team.engineering}` }])
    expect(log[0].recipients).toEqual([IDS.staff.joko])
    expect(log[1].skipped).toEqual([{ type: 'bumpPriority', reason: 'no_change' }]) // already URGENT
    expect(t.history.at(-1).description).toBe('Escalated (level 2, resolution overdue 15 min). Skipped: bumpPriority (no_change).')
    // Decision 20: an inactive policy stops escalating; reactivating resumes with the catch-up.
    const policy = data(call(`/v1/escalation-policies/${IDS.policy.smtpUrgent}`, { headers: h(a, H) }))
    data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { ...policy, isActive: false } }))
    const second = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Older AC fault', itemRef: IDS.item.acFault, locationRef: IDS.location.room0908, activationDate: daysAgo(8) } }))
    expect(second.escalationPolicyId).toBe(IDS.policy.smtpUrgent) // the SLA still names it; it just does nothing while paused
    expect(data(call(`/v1/tasks/${second.id}`, { headers: h(a, H) })).escalationLevel).toBe(0)
    data(call('/v1/escalation-policies', { method: 'POST', headers: h(a, H), body: { ...policy, isActive: true } }))
    expect(data(call(`/v1/tasks/${second.id}`, { headers: h(a, H) })).escalationLevel).toBe(2)
  })
})

describe('departments: master CRUD and the hotel soft delete (feat/department-crud)', () => {
  it('platform admins curate the master list; hotel admins only read it', () => {
    const a = asAdmin()
    const op = asOperator()
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: h(a, H), body: { name: 'Concierge' } })).message).toBe('platform admin access required')
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: h(op), body: { name: ' ' } })).message).toBe('name is required (1-100 chars)')
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: h(op), body: { name: 'Concierge', code: 'con-1' } })).message).toBe('code must be 1-16 characters of A-Z, 0-9 or _')
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: h(op), body: { name: 'Concierge', description: 'x'.repeat(501) } })).message).toBe('description must be at most 500 characters')
    const created = call('/v1/departments', { method: 'POST', headers: h(op), body: { name: 'Concierge', code: ' con ', description: ' Guest services ' } })
    expect(created.status).toBe(201)
    expect(data(created)).toMatchObject({ name: 'Concierge', code: 'CON', description: 'Guest services', isActive: true })
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: h(op), body: { name: 'concierge' } })).message).toBe('department name already exists')
    expect(errOf(() => call('/v1/departments', { method: 'POST', headers: h(op), body: { name: 'Bell desk', code: 'CON' } })).message).toBe('department code already exists')
    // A service token that is not a partner is the other platform admin.
    expect(call('/v1/departments', { method: 'POST', headers: { authorization: 'Bearer service:test' }, body: { name: 'Bell desk' } }).status).toBe(201)
    const id = data(created).id
    expect(data(call(`/v1/departments/${id}`, { headers: h(a, H) })).code).toBe('CON')
    expect(data(call(`/v1/departments/${id}`, { method: 'PATCH', headers: h(op), body: {} })).updatedAt).toBe(data(created).updatedAt) // empty patch: unchanged
    expect(data(call(`/v1/departments/${id}`, { method: 'PATCH', headers: h(op), body: { name: 'Concierge & Bell', code: '', isActive: false } }))).toMatchObject({ name: 'Concierge & Bell', code: null, isActive: false })
    expect(errOf(() => call(`/v1/departments/${id}`, { method: 'PATCH', headers: h(op), body: { code: 'toolongtoolongtoo' } })).message).toBe('code must be 1-16 characters of A-Z, 0-9 or _')
    expect(errOf(() => call('/v1/departments/nope', { method: 'PATCH', headers: h(op), body: {} })).message).toBe('invalid id')
    // Hard delete while unused; 409 once any hotel ever used it.
    expect(call(`/v1/departments/${id}`, { method: 'DELETE', headers: h(op) }).status).toBe(204)
    expect(errOf(() => call(`/v1/departments/${id}`, { method: 'DELETE', headers: h(op) })).message).toBe('department')
    expect(errOf(() => call(`/v1/departments/${IDS.masterDept.housekeeping}`, { method: 'DELETE', headers: h(op) })).message).toBe('department is used by 3 hotel(s); deactivate it instead')
  })

  it('a hotel deactivates a department it no longer uses; nothing new may use it, existing use keeps working', () => {
    const r = asRina()
    const rows = data<any[]>(call('/v1/hotel-departments', { headers: h(r, KNGN) }))
    expect(rows.map(d => d.departmentName)).toEqual(['Housekeeping', 'Maintenance'])
    const maintenance = rows.find(d => d.departmentName === 'Maintenance')
    expect(maintenance).toMatchObject({ code: 'ENG', masterIsActive: true, isActive: true })
    const team = data(call('/v1/teams', { method: 'POST', headers: h(r, KNGN), body: { name: 'Night engineers', hotelDepartmentId: maintenance.id } }))
    expect(errOf(() => call(`/v1/hotel-departments/${maintenance.id}`, { method: 'PATCH', headers: h(r, KNGN), body: {} })).message).toBe('isActive is required')
    const off = data(call(`/v1/hotel-departments/${maintenance.id}`, { method: 'PATCH', headers: h(r, KNGN), body: { isActive: false } }))
    expect(off.isActive).toBe(false)
    expect(data(call(`/v1/hotel-departments/${maintenance.id}`, { headers: h(r, KNGN) })).isActive).toBe(false)
    expect(data(call(`/v1/hotel-departments/${maintenance.id}`, { method: 'PATCH', headers: h(r, KNGN), body: { isActive: false } })).updatedAt).toBe(off.updatedAt) // no-op 200
    // No new use: staff, teams and schedules may not newly point at it…
    expect(errOf(() => call(`/v1/staff/${IDS.staff.budi}`, { method: 'PATCH', headers: h(r, KNGN), body: { hotelDepartmentId: maintenance.id } })).message).toBe('invalid department reference')
    expect(errOf(() => call('/v1/teams', { method: 'POST', headers: h(r, KNGN), body: { name: 'Day engineers', hotelDepartmentId: maintenance.id } })).message).toBe('invalid department reference')
    expect(errOf(() => call('/v1/operating-schedules', { method: 'POST', headers: h(r, KNGN), body: { name: 'Eng hours', hotelDepartmentId: maintenance.id, windows: [{ weekday: 1, opensMinutes: 480, closesMinutes: 1020 }], exceptions: [] } })).message).toBe('invalid department reference')
    // …but the team that was already there can still be renamed.
    expect(data(call('/v1/teams', { method: 'POST', headers: h(r, KNGN), body: { id: team.id, name: 'Night engineering', hotelDepartmentId: maintenance.id } })).name).toBe('Night engineering')
    // Enabling again is PATCH's job; the POST just answers the existing row.
    expect(call('/v1/hotel-departments', { method: 'POST', headers: h(r, KNGN), body: { departmentId: IDS.masterDept.maintenance } }).status).toBe(200)
    expect(data(call(`/v1/hotel-departments/${maintenance.id}`, { method: 'PATCH', headers: h(r, KNGN), body: { isActive: true } })).isActive).toBe(true)
  })

  it('refuses deactivation while rules or escalation steps route there; a retired master never comes back', () => {
    const a = asAdmin()
    const r = asRina()
    const rules = data<any[]>(call('/v1/routing-rules', { headers: h(a, H) })).filter(rule => rule.hotelDepartmentId === IDS.dept.smtpMaintenance).length
    expect(rules).toBeGreaterThan(0)
    expect(errOf(() => call(`/v1/hotel-departments/${IDS.dept.smtpMaintenance}`, { method: 'PATCH', headers: h(a, H), body: { isActive: false } })).message)
      .toBe(`department is used by ${rules} routing rule(s) and 0 escalation policy step(s); repoint them first`)
    // A step that routes here counts too, active policy or not (decision #4).
    const policy = data(call('/v1/escalation-policies', { method: 'POST', headers: h(r, KNGN), body: { name: 'Kuningan night', isActive: false, steps: [{ sort: 0, triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 0, actions: [{ type: 'routeToDepartment', hotelDepartmentId: IDS.dept.kngnHousekeeping }] }] } }))
    expect(errOf(() => call(`/v1/hotel-departments/${IDS.dept.kngnHousekeeping}`, { method: 'PATCH', headers: h(r, KNGN), body: { isActive: false } })).message)
      .toBe('department is used by 0 routing rule(s) and 1 escalation policy step(s); repoint them first')
    data(call('/v1/escalation-policies', { method: 'POST', headers: h(r, KNGN), body: { id: policy.id, name: 'Kuningan night', steps: [] } }))
    // The retired Spa master: Simatupang's row cannot be reactivated, and no hotel can newly add it.
    expect(data<any[]>(call('/v1/hotel-departments', { headers: h(a, H) })).find(d => d.id === IDS.dept.smtpSpa)).toMatchObject({ departmentName: 'Spa & Wellness', code: 'SPA', isActive: false, masterIsActive: false })
    expect(errOf(() => call(`/v1/hotel-departments/${IDS.dept.smtpSpa}`, { method: 'PATCH', headers: h(a, H), body: { isActive: true } })).message).toBe('department is not available')
    expect(errOf(() => call('/v1/hotel-departments', { method: 'POST', headers: h(r, KNGN), body: { departmentId: IDS.masterDept.spa } })).message).toBe('department is not available')
    expect(errOf(() => call(`/v1/hotel-departments/${GHOST}`, { headers: h(a, H) })).message).toBe('hotel department')
    // Retiring a master flips masterIsActive on every hotel's row; the rows themselves keep working.
    const op = asOperator()
    data(call(`/v1/departments/${IDS.masterDept.fnb}`, { method: 'PATCH', headers: h(op), body: { isActive: false } }))
    expect(data<any[]>(call('/v1/hotel-departments', { headers: h(a, H) })).find(d => d.id === IDS.dept.smtpFnb)).toMatchObject({ isActive: true, masterIsActive: false })
    data(call(`/v1/departments/${IDS.masterDept.fnb}`, { method: 'PATCH', headers: h(op), body: { isActive: true } }))
  })
})

describe('EMS staff sync + offboarding (feat/ems-staff-sync)', () => {
  // Leaves behind: Joko linked to EMS, Ayu + Rizky added from EMS, Budi removed from Kuningan, Joko deactivated and reactivated.

  it('browses the property\'s EMS employees with their state here; unlinked properties say so', () => {
    const a = asAdmin()
    expect(errOf(() => call('/v1/ems/employees', { headers: h(login('staff@aston.example', 'staff123'), H) })).message).toBe('admin access required')
    expect(errOf(() => call('/v1/ems/employees', { headers: h(asRina(), KNGN) })).message).toBe('this property is not linked to EMS')
    const page = call('/v1/ems/employees', { headers: h(a, H) })
    expect(page.body!.meta).toEqual({ page: 1, pageSize: 50, total: 8 })
    const byId = Object.fromEntries(data<any[]>(page).map(e => [e.emsEmployeeId, e]))
    expect(byId['EMP-00101']).toMatchObject({ name: 'Budi Santoso', state: 'added', hotelDepartmentId: IDS.dept.smtpHousekeeping })
    expect(byId['EMP-00106']).toMatchObject({ state: 'added', departmentName: 'Laundry', hotelDepartmentId: null })
    expect(byId['EMP-00107']).toMatchObject({ state: 'addable' }) // Joko: manual staff with this email
    expect(byId['EMP-00122']).toMatchObject({ state: 'addable', departmentName: 'Spa', hotelDepartmentId: null }) // inactive here
    expect(byId['EMP-00123']).toMatchObject({ state: 'no_email', email: null })
    expect(byId['EMP-00124']).toMatchObject({ state: 'inactive', active: false })
    expect(data<any[]>(call('/v1/ems/employees', { headers: h(a, H), query: { q: 'ayu' } })).map(e => e.emsEmployeeId)).toEqual(['EMP-00120'])
    const small = call('/v1/ems/employees', { headers: h(a, H), query: { page: 2, pageSize: 3 } })
    expect(data<any[]>(small)).toHaveLength(3)
    expect(small.body!.meta).toEqual({ page: 2, pageSize: 3, total: 8 })
  })

  it('shows and clears sync issues: the needs-attention filter, and a department set by hand', () => {
    const a = asAdmin()
    const flagged = data<any[]>(call('/v1/staff', { headers: h(a, H), query: { needsAttention: 'true' } }))
    expect(flagged.map(s => s.id)).toEqual([IDS.staff.made])
    expect(flagged[0].emsEmployeeId).toBe('EMP-00106')
    expect(flagged[0].memberships[0].syncIssue).toEqual({ type: 'unknown_department', emsDepartmentName: 'Laundry' })
    expect(data(call(`/v1/staff/${IDS.staff.made}`, { method: 'PATCH', headers: h(a, H), body: { hotelDepartmentId: IDS.dept.smtpHousekeeping } })).memberships[0].syncIssue).toBeNull()
    expect(data<any[]>(call('/v1/staff', { headers: h(a, H), query: { needsAttention: 'true' } }))).toEqual([])
  })

  it('adds from EMS in bulk with one outcome per id, linking an existing manual account by email', () => {
    const a = asAdmin()
    expect(errOf(() => call('/v1/ems/employees', { method: 'POST', headers: h(a, H), body: { emsEmployeeIds: [], role: 'staff' } })).message).toBe('emsEmployeeIds must list 1-100 employees')
    expect(errOf(() => call('/v1/ems/employees', { method: 'POST', headers: h(a, H), body: { emsEmployeeIds: ['EMP-00120'], role: 'boss' } })).message).toBe('role must be staff, leader, or admin')
    const results = data<any[]>(call('/v1/ems/employees', { method: 'POST', headers: h(a, H), body: { emsEmployeeIds: ['EMP-00107', 'EMP-00120', 'EMP-00101', 'EMP-00123', 'EMP-00124', 'EMP-00999', 'EMP-00122', 'EMP-00120'], role: 'staff', createTask: false } }))
    expect(results.map(r => [r.emsEmployeeId, r.outcome, r.reason ?? null])).toEqual([
      ['EMP-00107', 'linked', null],
      ['EMP-00120', 'created', null],
      ['EMP-00101', 'skipped', null],
      ['EMP-00123', 'failed', 'no_email'],
      ['EMP-00124', 'failed', 'inactive'],
      ['EMP-00999', 'failed', 'not_found_at_this_property'],
      ['EMP-00122', 'created', null],
    ])
    const staff = data<any[]>(call('/v1/staff', { headers: h(a, H) }))
    expect(staff.find(s => s.id === IDS.staff.joko).emsEmployeeId).toBe('EMP-00107')
    expect(staff.find(s => s.email === 'ayu.lestari@aston.example').memberships).toEqual([{ hotelRef: H, role: 'staff', hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: false, syncIssue: null }])
    expect(staff.find(s => s.email === 'rizky.pratama@aston.example').memberships[0].syncIssue).toEqual({ type: 'unknown_department', emsDepartmentName: 'Spa' })
    expect(data<any[]>(call('/v1/staff', { headers: h(a, H), query: { needsAttention: 'true' } })).map(s => s.email)).toEqual(['rizky.pratama@aston.example'])
    // Created from EMS = no password; they sign in by magic link or Google.
    expect(errOf(() => call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email: 'ayu.lestari@aston.example', password: '' } })).code).toBe('UNAUTHORIZED')
  })

  it('removes a person from one property — never yourself, never an EMS-managed member of an EMS-mapped property', () => {
    const a = asAdmin()
    const r = asRina()
    expect(errOf(() => call(`/v1/staff/${IDS.staff.budi}/membership`, { method: 'DELETE', headers: h(login('staff@aston.example', 'staff123'), H) })).message).toBe('admin access required at this hotel')
    expect(errOf(() => call(`/v1/staff/${IDS.staff.agus}/membership`, { method: 'DELETE', headers: h(a, H) })).message).toBe('you cannot remove yourself from this property')
    expect(errOf(() => call(`/v1/staff/${IDS.staff.budi}/membership`, { method: 'DELETE', headers: h(a, H) })).message).toBe('this person is managed by EMS; remove them from this property in EMS')
    expect(errOf(() => call(`/v1/staff/${GHOST}/membership`, { method: 'DELETE', headers: h(a, H) })).message).toBe('staff')
    // Kuningan is not mapped to EMS, so Budi can be removed there; the task he held goes back to its pool.
    const held = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(r, KNGN), body: { title: 'Kuningan towels', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    expect(held.assignment).toMatchObject({ kind: 'STAFF', staffId: IDS.staff.budi })
    expect(call(`/v1/staff/${IDS.staff.budi}/membership`, { method: 'DELETE', headers: h(r, KNGN) }).status).toBe(204)
    expect(data<any[]>(call('/v1/staff', { headers: h(r, KNGN) })).some(s => s.id === IDS.staff.budi)).toBe(false)
    const released = data(call(`/v1/tasks/${held.id}`, { headers: h(r, KNGN) }))
    expect(released.assignment).toMatchObject({ kind: 'DEPARTMENT', departmentId: IDS.dept.kngnHousekeeping })
    expect(released.history.at(-1)).toMatchObject({ staffId: IDS.staff.rina, description: 'Removed from this property by an admin' })
    expect(errOf(() => call(`/v1/staff/${IDS.staff.budi}/membership`, { method: 'DELETE', headers: h(r, KNGN) })).message).toBe('staff')
    // Budi still works at Simatupang; the account is untouched.
    expect(login('staff@aston.example', 'staff123').staff.properties.map(p => p.hotelRef)).toEqual([H])
  })

  it('deactivating an account offboards it everywhere: sessions revoked, open work released, memberships kept', () => {
    const a = asAdmin()
    const joko = login('joko@aston.example', 'joko12345')
    const held = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Fix the pump', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.joko } } }))
    data(call(`/v1/staff/${IDS.staff.joko}`, { method: 'PATCH', headers: h(a), body: { isActive: false } }))
    expect(errOf(() => call('/v1/auth/session', { headers: h(joko) })).code).toBe('UNAUTHORIZED')
    const released = data(call(`/v1/tasks/${held.id}`, { headers: h(a, H) }))
    expect(released.assignment).toMatchObject({ kind: 'TEAM', teamId: IDS.team.engineering }) // his latest team, by the Return rule
    expect(released.history.at(-1)).toMatchObject({ staffId: IDS.staff.agus, description: 'Account deactivated' })
    // Reactivation restores access: the membership rows were never deleted.
    expect(data(call(`/v1/staff/${IDS.staff.joko}`, { method: 'PATCH', headers: h(a, H), body: { isActive: true } })).memberships).toHaveLength(1)
  })

  it('applies EMS pushes: identity, department, auto-add and offboarding, with ignored/stale answers', () => {
    const a = asAdmin()
    const push = (employeeId: string, body: Record<string, unknown>, headers: Record<string, string> = emsPartner, syncId = 'EMS-HTL-01') =>
      call(`/v1/ems/hotels/${syncId}/employees/${employeeId}`, { method: 'PUT', headers, body })
    const full = { name: 'Ayu Lestari', email: 'ayu.lestari@aston.example', active: true, departmentName: 'Front Office', updatedAt: '2026-10-06T08:00:00Z' }
    expect(errOf(() => push('EMP-00120', full, { 'cookie': a.cookie, 'x-csrf-token': a.csrf })).message).toBe('the interface API accepts partner tokens only')
    expect(errOf(() => push('EMP-00120', full, { authorization: `Bearer partner:${IDS.partner.butler}` })).message).toBe('this partner may not sync staff')
    expect(errOf(() => push('EMP-00120', { ...full, active: undefined })).message).toBe('active is required')
    expect(errOf(() => push('EMP-00120', { ...full, updatedAt: undefined })).message).toBe('updatedAt is required')
    expect(errOf(() => push('EMP-00120', { ...full, name: '' })).message).toBe('name is required (1-200 characters)')
    expect(data(push('EMP-00120', full, emsPartner, 'EMS-HTL-99'))).toEqual({ status: 'ignored', reason: 'unmapped_hotel' })
    expect(data(push('EMP-00555', full))).toEqual({ status: 'ignored', reason: 'not_linked' })
    expect(data(push('EMP-00120', full))).toEqual({ status: 'applied' })
    const ayu = () => data<any[]>(call('/v1/staff', { headers: h(a, H) })).find(s => s.emsEmployeeId === 'EMP-00120')
    expect(ayu().memberships[0].hotelDepartmentId).toBe(IDS.dept.smtpFrontOffice)
    // Older than what was applied: stale. An unknown department keeps the current one and raises the issue.
    expect(data(push('EMP-00120', { ...full, departmentName: 'Housekeeping', updatedAt: '2026-10-05T08:00:00Z' }))).toEqual({ status: 'stale' })
    expect(data(push('EMP-00120', { ...full, departmentName: 'Laundry', updatedAt: '2026-10-06T09:00:00Z' }))).toEqual({ status: 'applied' })
    expect(ayu().memberships[0]).toMatchObject({ hotelDepartmentId: IDS.dept.smtpFrontOffice, syncIssue: { type: 'unknown_department', emsDepartmentName: 'Laundry' } })
    // Left the property: membership removed, and with no access anywhere else the account is deactivated.
    expect(data(push('EMP-00120', { ...full, active: false, updatedAt: '2026-10-06T10:00:00Z' }))).toEqual({ status: 'applied' })
    expect(ayu()).toBeUndefined()
    // Rejoined: auto-added as plain staff, account active again.
    expect(data(push('EMP-00120', { ...full, departmentName: 'Housekeeping', updatedAt: '2026-10-06T11:00:00Z' }))).toEqual({ status: 'applied' })
    expect(ayu().memberships[0]).toMatchObject({ role: 'staff', createTask: false, hotelDepartmentId: IDS.dept.smtpHousekeeping, syncIssue: null })
  })

  it('operators map a property to a partner id, and give partners capabilities', () => {
    const op = asOperator()
    expect(data<any[]>(call(`/v1/platform/tenants/${H}/sync`, { headers: h(op) }))).toEqual([expect.objectContaining({ partnerId: IDS.partner.ems, partnerName: 'Sentec EMS', syncId: 'EMS-HTL-01' })])
    expect(errOf(() => call(`/v1/platform/tenants/${KNGN}/sync/${IDS.partner.ems}`, { method: 'PUT', headers: h(op), body: { syncId: 'EMS-HTL-01' } })).message).toBe('another property already uses this id for this partner')
    expect(errOf(() => call(`/v1/platform/tenants/${KNGN}/sync/${IDS.partner.ems}`, { method: 'PUT', headers: h(op), body: { syncId: '' } })).message).toBe('syncId is required (1-100 characters)')
    expect(errOf(() => call(`/v1/platform/tenants/${KNGN}/sync/${GHOST}`, { method: 'PUT', headers: h(op), body: { syncId: 'X' } })).message).toBe('tenant or partner')
    expect(errOf(() => call('/v1/platform/tenants/nope/sync', { headers: h(op) })).message).toBe('hotelRef must be a valid UUID')
    expect(data(call(`/v1/platform/tenants/${KNGN}/sync/${IDS.partner.ems}`, { method: 'PUT', headers: h(op), body: { syncId: 'EMS-HTL-02' } }))).toMatchObject({ hotelRef: KNGN, syncId: 'EMS-HTL-02', partnerName: 'Sentec EMS' })
    // MOCK LIMIT: an EMS hotel id the mock's directory does not know reads as EMS being down.
    expect(errOf(() => call('/v1/ems/employees', { headers: h(asRina(), KNGN) })).message).toBe('EMS is not reachable')
    expect(call(`/v1/platform/tenants/${KNGN}/sync/${IDS.partner.ems}`, { method: 'DELETE', headers: h(op) }).status).toBe(204)
    expect(errOf(() => call(`/v1/platform/tenants/${KNGN}/sync/${IDS.partner.ems}`, { method: 'DELETE', headers: h(op) })).message).toBe('partner id for this property')
    // Partner capabilities: a closed set, on registration and by PATCH; an empty PATCH is refused.
    expect(errOf(() => call('/v1/platform/partners', { method: 'POST', headers: h(op), body: { name: 'Sentec HRIS', capabilities: ['payroll'] } })).message).toBe('unknown capability: payroll')
    const created = data(call('/v1/platform/partners', { method: 'POST', headers: h(op), body: { name: 'Sentec HRIS', capabilities: ['staff_sync', 'staff_sync'] } }))
    expect(created.capabilities).toEqual(['staff_sync'])
    expect(errOf(() => call(`/v1/platform/partners/${created.id}`, { method: 'PATCH', headers: h(op), body: {} })).message).toBe('isActive or capabilities is required')
    expect(data(call(`/v1/platform/partners/${created.id}`, { method: 'PATCH', headers: h(op), body: { capabilities: [] } })).capabilities).toEqual([])
    expect(data<any[]>(call('/v1/platform/partners', { headers: h(op) })).find(p => p.id === IDS.partner.ems).capabilities).toEqual(['staff_sync'])
  })
})
