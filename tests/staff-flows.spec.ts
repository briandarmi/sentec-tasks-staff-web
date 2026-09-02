import { describe, expect, it } from 'vitest'
import { ApiError, ERR_ALREADY_CLAIMED, ERR_CROSS_DEPARTMENT, IDS, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// The task-lifecycle contract of sentec-tasks-api, pinned against the mock:
// creation + preview (one resolution pipeline), claim/assign with department
// sync, the status-route guard chain, submit/review with proof gates, return-
// to-pool selection, delegation offers, helpers, attachments and uploads —
// with the REAL routes' exact error strings.
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

const service = (hotelId?: string) => ({ authorization: 'Bearer service:test', ...(hotelId ? { 'x-hotel-id': hotelId } : {}) })

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
const leader = () => login('leader@aston.example', 'leader123')
const budi = () => login('staff@aston.example', 'staff123')
const made = () => login('made@aston.example', 'made12345')
const joko = () => login('joko@aston.example', 'joko12345')

/** Column ids by status, resolved once — tests never hardcode board layout. */
function columnFor(session: Session, status: string): string {
  const board = data<{ columns: Array<{ id: string, status: string | null }> }>(call('/v1/kanban-board', { headers: h(session, H) }))
  return board.columns.find(c => c.status === status)!.id
}

describe('creation resolves server-side (staff-create + preview share one pipeline)', () => {
  // Leaves behind: a handful of NEW tasks at Simatupang.

  it('lets an explicit priority win, else the item default, else NORMAL', () => {
    const a = admin()
    const fromItem = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'AC check', itemRef: IDS.item.acFault, locationRef: IDS.location.room1204 } }))
    expect(fromItem.priority).toBe('URGENT')
    const explicit = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'AC check', itemRef: IDS.item.acFault, locationRef: IDS.location.room1204, priority: 'low' } }))
    expect(explicit.priority).toBe('LOW') // case-insensitive input, stored upper
    const bare = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Something else' } }))
    expect(bare.priority).toBe('NORMAL')
  })

  it('falls back to the item name when the title is blank — the only title validation', () => {
    const a = admin()
    const created = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: '', itemRef: IDS.item.towels, locationRef: IDS.location.room1204 } }))
    expect(created.title).toBe('Extra towels')
    expect(errOf(() => call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: '   ' } })).message)
      .toBe('title is required (1-255 chars)')
  })

  it('requires a location for flagged items — on the staff channel only', () => {
    const a = admin()
    expect(errOf(() => call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Clean 1204', itemRef: IDS.item.roomCleaning } })).message)
      .toBe('this item requires a location')
    // The dispatch path has no locationRef field and is deliberately exempt.
    const dispatched = data(call('/v1/tasks', { method: 'POST', headers: service(H), body: { source: { product: 'sentec-butler', channel: 'guest' }, itemRef: IDS.item.roomCleaning, item: { name: 'Room cleaning' }, requester: { roomNumber: '0908' } } }))
    expect(dispatched.status).toBe('NEW')
  })

  it('keeps quantity only for quantity-enabled items, defaulting to 1', () => {
    const a = admin()
    const counted = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Towels', itemRef: IDS.item.towels, locationRef: IDS.location.room1204, quantity: 3 } }))
    expect(counted.quantity).toBe(3)
    const uncounted = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Clean', itemRef: IDS.item.roomCleaning, locationRef: IDS.location.room1204, quantity: 9 } }))
    expect(uncounted.quantity).toBeNull()
  })

  it('auto-fills roomNumber and the requester from a guest-linked location', () => {
    const a = admin()
    const created = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Towels', itemRef: IDS.item.towels, locationRef: IDS.location.room1204 } }))
    expect(created.roomNumber).toBe('Room 1204')
    expect(created.guestName).toBe('Amelia Chen')
    expect(created.locationTypeName).toBe('Guest Room')
  })

  it('is silent about a vacant room, and an explicit requester skips the lookup', () => {
    const a = admin()
    const vacant = call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Clean', itemRef: IDS.item.roomCleaning, locationRef: IDS.location.room1102 } })
    expect(data(vacant).guestName).toBeNull()
    // found=false adds NO warning; the meta carries warnings: null.
    expect(vacant.body!.meta).toEqual({ warnings: null })
    const explicit = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Towels', itemRef: IDS.item.towels, locationRef: IDS.location.room1204, requesterName: 'Walk-in' } }))
    expect(explicit.guestName).toBe('Walk-in')
  })

  it('previews the identical resolution without persisting anything', () => {
    const a = admin()
    const before = call('/v1/tasks', { headers: h(a, H), query: { limit: 1 } }).body!.meta as { total: number }
    const body = { title: 'AC dead', itemRef: IDS.item.acFault, locationRef: IDS.location.room0908, activationDate: '2026-08-26T02:00:00.000Z' }
    const preview = call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body })
    const previewTask = data<{ task: any, checklistLabels: string[] }>(preview).task
    const created = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body }))
    expect(previewTask.responseDueAt).toBe(created.responseDueAt)
    expect(previewTask.resolutionDueAt).toBe(created.resolutionDueAt)
    expect(previewTask.hotelDepartmentId).toBe(created.hotelDepartmentId)
    const after = call('/v1/tasks', { headers: h(a, H), query: { limit: 1 } }).body!.meta as { total: number }
    expect(after.total).toBe(before.total + 1) // only the create wrote
  })

  it('prepends the item checklist to the request\'s own labels', () => {
    const a = admin()
    const preview = data<{ checklistLabels: string[] }>(call('/v1/tasks/preview', { method: 'POST', headers: h(a, H), body: { title: 'Clean', itemRef: IDS.item.roomCleaning, locationRef: IDS.location.room1102, checklistLabels: ['Photograph the minibar'] } }))
    expect(preview.checklistLabels).toEqual(['Strip and remake the beds', 'Vacuum and mop the floors', 'Restock amenities', 'Photograph the minibar'])
  })

  it('refuses a dueAt before the activation date', () => {
    const a = admin()
    expect(errOf(() => call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'X', activationDate: '2026-09-02T10:00:00.000Z', dueAt: '2026-09-02T09:00:00.000Z' } })).message)
      .toBe('dueAt cannot be before activationDate')
  })

  it('gates creation-time assignees before any write, identically in preview', () => {
    const b = budi()
    const m = made()
    // Staff may self-assign only.
    expect(errOf(() => call('/v1/tasks/staff-create', { method: 'POST', headers: h(b, H), body: { title: 'X', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.made } } })).message)
      .toBe('staff may only self-assign at creation')
    expect(errOf(() => call('/v1/tasks/preview', { method: 'POST', headers: h(b, H), body: { title: 'X', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.made } } })).message)
      .toBe('staff may only self-assign at creation')
    // Staff may target only a team they belong to (Budi is not in Engineering).
    expect(errOf(() => call('/v1/tasks/staff-create', { method: 'POST', headers: h(b, H), body: { title: 'X', assignee: { assigneeKind: 'TEAM', assigneeTeamId: IDS.team.engineering } } })).message)
      .toBe('staff may only assign to a team they belong to')
    // Made has no createTask claim at all.
    expect(errOf(() => call('/v1/tasks/staff-create', { method: 'POST', headers: h(m, H), body: { title: 'X' } })).message).toBe('forbidden')
    // DEPARTMENT is rejected at creation for everyone.
    expect(errOf(() => call('/v1/tasks/staff-create', { method: 'POST', headers: h(admin(), H), body: { title: 'X', assignee: { assigneeKind: 'DEPARTMENT' } } })).message)
      .toBe('assigneeKind=DEPARTMENT is not yet supported at creation — use hotelDepartmentId routing instead')
  })

  it('dispatch is service-only and idempotent on idempotencyKey', () => {
    const a = admin()
    expect(errOf(() => call('/v1/tasks', { method: 'POST', headers: h(a, H), body: {} })).message).toBe('forbidden')
    const key = '12345678-0000-4000-8000-000000000042'
    const first = call('/v1/tasks', { method: 'POST', headers: service(H), body: { idempotencyKey: key, source: { product: 'sentec-butler', channel: 'guest' }, item: { name: 'Slippers' }, requester: {} } })
    expect(first.status).toBe(201)
    const replay = call('/v1/tasks', { method: 'POST', headers: service(H), body: { idempotencyKey: key, source: { product: 'sentec-butler', channel: 'guest' }, item: { name: 'Slippers' }, requester: {} } })
    expect(replay.status).toBe(200)
    expect(data(replay).id).toBe(data(first).id)
    expect(replay.body!.meta).toEqual({ warnings: null })
  })

  it('refuses a past activationDate on the guest channel only', () => {
    expect(errOf(() => call('/v1/tasks', { method: 'POST', headers: service(H), body: { source: { product: 'sentec-butler', channel: 'guest' }, item: { name: 'X' }, requester: {}, activationDate: '2020-01-01T00:00:00.000Z' } })).message)
      .toBe('activationDate cannot be in the past')
    // Staff may backdate freely.
    const backdated = call('/v1/tasks/staff-create', { method: 'POST', headers: h(admin(), H), body: { title: 'Backdated', activationDate: '2020-01-01T00:00:00.000Z' } })
    expect(backdated.status).toBe(201)
  })
})

describe('claim, assign and department sync', () => {
  // Leaves behind: the turndown pool task claimed by Made, then returned.

  it('is idempotent for the holder and never steals', () => {
    const b = budi()
    const twice = call('/v1/tasks/claim', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels0710 } })
    expect(data(twice).assignment.staffId).toBe(IDS.staff.budi)
    const thief = errOf(() => call('/v1/tasks/claim', { method: 'POST', headers: h(made(), H), body: { taskId: IDS.task.towels0710 } }))
    expect(thief.code).toBe('CONFLICT')
    expect(thief.message).toBe(ERR_ALREADY_CLAIMED)
  })

  it('gates pool claims on membership, naming the pool kind', () => {
    // Joko (Engineering) is not in HK Morning Shift.
    expect(errOf(() => call('/v1/tasks/claim', { method: 'POST', headers: h(joko(), H), body: { taskId: IDS.task.turndownPool } })).message)
      .toBe('task is held by a team you are not a member of')
    // Budi (HK) is not in the Maintenance department.
    expect(errOf(() => call('/v1/tasks/claim', { method: 'POST', headers: h(budi(), H), body: { taskId: IDS.task.bulbsDeptPool } })).message)
      .toBe('task is held by a different department')
    // A member converts the pool row to a personal assignment.
    const m = made()
    const claimed = data(call('/v1/tasks/claim', { method: 'POST', headers: h(m, H), body: { taskId: IDS.task.turndownPool } }))
    expect(claimed.assignment.kind).toBe('STAFF')
    expect(claimed.assignment.staffId).toBe(IDS.staff.made)
  })

  it('returns a claimed pool task to the SAME pool, reason on the remark', () => {
    const m = made()
    expect(errOf(() => call('/v1/tasks/return', { method: 'POST', headers: h(m, H), body: { taskId: IDS.task.turndownPool, reason: '' } })).message)
      .toBe('reason is required (1-500 chars)')
    const returned = data(call('/v1/tasks/return', { method: 'POST', headers: h(m, H), body: { taskId: IDS.task.turndownPool, reason: 'Shift ending' } }))
    expect(returned.assignment.kind).toBe('TEAM')
    expect(returned.assignment.teamId).toBe(IDS.team.hkMorning)
    expect(returned.assignment.remark).toBe('Shift ending')
    expect(returned.status).toBe('NEW')
  })

  it('syncs departments on assign: adopt, match, admin-bypass, else refuse', () => {
    const l = leader()
    const a = admin()
    // A leader assigning cross-department is refused with the em-dash message.
    const hkTask = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(l, H), body: { title: 'HK job', itemRef: IDS.item.towels, locationRef: IDS.location.room1204 } }))
    const crossed = errOf(() => call('/v1/tasks/assign', { method: 'POST', headers: h(l, H), body: { taskId: hkTask.id, staffId: IDS.staff.joko } }))
    expect(crossed.message).toBe(ERR_CROSS_DEPARTMENT)
    // An admin may cross; the task's department is left unchanged.
    const adminAssigned = data(call('/v1/tasks/assign', { method: 'POST', headers: h(a, H), body: { taskId: hkTask.id, staffId: IDS.staff.joko } }))
    expect(adminAssigned.assignment.staffId).toBe(IDS.staff.joko)
    expect(adminAssigned.hotelDepartmentId).toBe(IDS.dept.smtpHousekeeping)
    // A department-less task ADOPTS the assignee's department.
    const bare = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Deptless' } }))
    expect(bare.hotelDepartmentId).toBeNull()
    const adopted = data(call('/v1/tasks/assign', { method: 'POST', headers: h(l, H), body: { taskId: bare.id, staffId: IDS.staff.budi } }))
    expect(adopted.hotelDepartmentId).toBe(IDS.dept.smtpHousekeeping)
  })
})

describe('the status route guard chain', () => {
  it('derives the status from the column and walks the guards in order', () => {
    const a = admin()
    const b = budi()
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(a, H), body: { taskId: IDS.task.towels1204, columnId: '99999999-0000-4000-8000-000000000009' } })).message)
      .toBe('column not found or has no linked status')
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(b, H), body: { taskId: IDS.task.towels0710, columnId: columnFor(b, 'VERIFIED') } })).message)
      .toBe('only leaders or admins can set status to VERIFIED')
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(a, H), body: { taskId: IDS.task.towels1204, columnId: columnFor(a, 'NEW') } })).message)
      .toBe('cannot change status back to NEW')
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(b, H), body: { taskId: IDS.task.towels0710, columnId: columnFor(b, 'SUBMITTED') } })).message)
      .toBe('use the submit action to move a task to SUBMITTED')
    // Staff must hold the task.
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(made(), H), body: { taskId: IDS.task.towels1204, columnId: columnFor(b, 'IN_PROGRESS') } })).message)
      .toBe('not assigned to this task')
  })

  it('freezes a SUBMITTED task for staff; leaders may only park or cancel it', () => {
    const b = budi()
    const l = leader()
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(b, H), body: { taskId: IDS.task.cleaningSubmitted, columnId: columnFor(b, 'PENDING') } })).message)
      .toBe('task is awaiting review')
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(l, H), body: { taskId: IDS.task.cleaningSubmitted, columnId: columnFor(l, 'FINISHED') } })).message)
      .toBe('use the review action to decide a submitted task')
    expect(errOf(() => call('/v1/tasks/status', { method: 'PATCH', headers: h(l, H), body: { taskId: IDS.task.cleaningSubmitted, columnId: columnFor(l, 'VERIFIED') } })).message)
      .toBe('a submitted task is reviewed to FINISHED before it can be VERIFIED')
    // PENDING from SUBMITTED is allowed for a leader — and back, for review later.
    const parked = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(l, H), body: { taskId: IDS.task.cleaningSubmitted, columnId: columnFor(l, 'PENDING') } }))
    expect(parked.status).toBe('PENDING')
  })

  it('stamps response on first IN_PROGRESS only, and accumulates resolution minutes', () => {
    const a = admin()
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Clock test', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    // NEW → PENDING is a park, not a response.
    const parked = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(a, H), body: { taskId: t.id, columnId: columnFor(a, 'PENDING') } }))
    expect(parked.responseDuration).toBeNull()
    expect(parked.responseSlaStatus).toBe('EMPTY')
    const started = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(a, H), body: { taskId: t.id, columnId: columnFor(a, 'IN_PROGRESS') } }))
    expect(started.responseDuration).not.toBeNull()
    expect(started.responseSlaStatus).toBe('ON_TIME')
    // Leaving IN_PROGRESS accumulates; entering FINISHED (not via review) stamps.
    const done = data(call('/v1/tasks/status', { method: 'PATCH', headers: h(a, H), body: { taskId: t.id, columnId: columnFor(a, 'FINISHED') } }))
    expect(done.resolutionDuration).not.toBeNull()
    expect(done.resolutionSlaStatus).toBe('ON_TIME')
  })
})

describe('submit and review', () => {
  // Builds a fresh proof-gated task and walks it through the whole loop.

  function freshInProgress(): { id: string } {
    const l = leader()
    const b = budi()
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(l, H), body: { title: 'Deep clean', itemRef: IDS.item.roomCleaning, locationRef: IDS.location.room1102, assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    call('/v1/tasks/status', { method: 'PATCH', headers: h(b, H), body: { taskId: t.id, columnId: columnFor(b, 'IN_PROGRESS') } })
    return t
  }

  function attachPhoto(session: Session, taskId: string) {
    const upload = data<{ storageKey: string }>(call('/v1/uploads', { method: 'POST', headers: h(session, H), body: { filename: 'proof.jpg', contentType: 'image/jpeg', sizeBytes: 1000 } }))
    return data(call('/v1/tasks/attachments', { method: 'POST', headers: h(session, H), body: { taskId, filetype: 'PHOTO', storageKey: upload.storageKey } }))
  }

  it('enforces the proof gates with the exact counting message', () => {
    const b = budi()
    const t = freshInProgress()
    expect(errOf(() => call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: 'done' } })).message)
      .toBe('this task type requires at least 1 photo proofs (0 attached)')
    attachPhoto(b, t.id)
    expect(errOf(() => call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: '   ' } })).message)
      .toBe('this task type requires a completion note')
    expect(errOf(() => call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: 'done', attachmentIds: ['88888888-0000-4000-8000-000000000001'] } })).message)
      .toBe('attachment does not belong to this task')
    const submitted = data(call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: 'All done, restocked.' } }))
    expect(submitted.status).toBe('SUBMITTED')
    expect(submitted.submittedBy).toBe(IDS.staff.budi)
    expect(submitted.resolutionSlaStatus).not.toBe('EMPTY') // verdict stamps at submission
    // Not IN_PROGRESS any more: a second submit conflicts.
    expect(errOf(() => call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id } })).message)
      .toBe('task is not in progress')
  })

  it('reviews: leader-of-department decides; request-changes needs a note and resets the verdict', () => {
    const b = budi()
    const l = leader()
    const t = freshInProgress()
    attachPhoto(b, t.id)
    call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: 'First pass.' } })
    expect(errOf(() => call('/v1/tasks/review', { method: 'POST', headers: h(b, H), body: { taskId: t.id, decision: 'APPROVE' } })).message)
      .toBe('only leaders or admins may review a submitted task')
    expect(errOf(() => call('/v1/tasks/review', { method: 'POST', headers: h(l, H), body: { taskId: t.id, decision: 'REQUEST_CHANGES' } })).message)
      .toBe('a note is required when requesting changes')
    const bounced = data(call('/v1/tasks/review', { method: 'POST', headers: h(l, H), body: { taskId: t.id, decision: 'REQUEST_CHANGES', note: 'Minibar photo missing' } }))
    expect(bounced.status).toBe('IN_PROGRESS')
    expect(bounced.resolutionSlaStatus).toBe('EMPTY') // clock reset for the rework
    // Re-submit overwrites the completion data; approve keeps the new verdict.
    const resubmitted = data(call('/v1/tasks/submit', { method: 'POST', headers: h(b, H), body: { taskId: t.id, completionNote: 'Second pass.' } }))
    const verdict = resubmitted.resolutionSlaStatus
    const approved = data(call('/v1/tasks/review', { method: 'POST', headers: h(l, H), body: { taskId: t.id, decision: 'APPROVE' } }))
    expect(approved.status).toBe('FINISHED')
    expect(approved.resolutionSlaStatus).toBe(verdict) // approval never re-stamps
    expect(approved.completionNote).toBe('Second pass.')
  })

  it('lets an active helper submit, and a service actor never', () => {
    const b = budi()
    const m = made()
    const t = freshInProgress()
    call('/v1/tasks/collaborators', { method: 'POST', headers: h(b, H), body: { taskId: t.id, staffId: IDS.staff.made } })
    attachPhoto(b, t.id)
    expect(errOf(() => call('/v1/tasks/submit', { method: 'POST', headers: h(joko(), H), body: { taskId: t.id, completionNote: 'x' } })).message)
      .toBe('only the assignee or a helper can submit this task')
    expect(errOf(() => call('/v1/tasks/submit', { method: 'POST', headers: service(H), body: { taskId: t.id } })).message).toBe('forbidden')
    const submitted = data(call('/v1/tasks/submit', { method: 'POST', headers: h(m, H), body: { taskId: t.id, completionNote: 'Helped out.' } }))
    expect(submitted.submittedBy).toBe(IDS.staff.made)
  })
})

describe('return-to-pool selection', () => {
  it('walks the fallback chain: last pool, latest team, own department, unassigned', () => {
    const b = budi()
    const a = admin()
    // (b) Budi has a team: his own task goes back to HK Morning Shift.
    const own = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(b, H), body: { title: 'Own job', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    const teamPooled = data(call('/v1/tasks/return', { method: 'POST', headers: h(b, H), body: { taskId: own.id, reason: 'Break' } }))
    expect(teamPooled.assignment.kind).toBe('TEAM')
    expect(teamPooled.assignment.teamId).toBe(IDS.team.hkMorning)
    // (c) The admin has no team: the task's own department takes it.
    const bulbs = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Bulbs', itemRef: IDS.item.lightBulb, locationRef: IDS.location.floor7, assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.agus } } }))
    const deptPooled = data(call('/v1/tasks/return', { method: 'POST', headers: h(a, H), body: { taskId: bulbs.id, reason: 'Need the ladder' } }))
    expect(deptPooled.assignment.kind).toBe('DEPARTMENT')
    expect(deptPooled.assignment.departmentId).toBe(IDS.dept.smtpMaintenance)
    // (d) No pool history, no team, no department: fully unassigned.
    const bare = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(a, H), body: { title: 'Bare', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.agus } } }))
    const unassigned = data(call('/v1/tasks/return', { method: 'POST', headers: h(a, H), body: { taskId: bare.id, reason: 'Nobody owns this' } }))
    expect(unassigned.assignment).toBeNull()
  })

  it('refuses returns off submitted and closed work with distinct 409s', () => {
    const b = budi()
    expect(errOf(() => call('/v1/tasks/return', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.transferHold, reason: 'x' } })).message)
      .toBe('task is closed') // PENDING counts as closed for Return
    expect(errOf(() => call('/v1/tasks/return', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towelsDone, reason: 'x' } })).message)
      .toBe('task is closed')
  })
})

describe('delegation offers', () => {
  it('walks the send gates in order, including department compatibility', () => {
    const b = budi()
    expect(errOf(() => call('/v1/tasks/offers', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels0710, toStaffId: IDS.staff.budi } })).message)
      .toBe('cannot offer a task to yourself')
    expect(errOf(() => call('/v1/tasks/offers', { method: 'POST', headers: h(made(), H), body: { taskId: IDS.task.towels0710, toStaffId: IDS.staff.joko } })).message)
      .toBe('only the active assignee can offer this task')
    expect(errOf(() => call('/v1/tasks/offers', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels0710, toStaffId: IDS.staff.joko } })).message)
      .toBe(ERR_CROSS_DEPARTMENT)
    const offer = data(call('/v1/tasks/offers', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels0710, toStaffId: IDS.staff.made, note: 'Taking my break' } }))
    expect(offer.state).toBe('PENDING')
    expect(errOf(() => call('/v1/tasks/offers', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels0710, toStaffId: IDS.staff.made } })).message)
      .toBe('an offer is already pending for this task')
    // The inbox joins the sender name and task title.
    const inbox = data<any[]>(call('/v1/offers', { headers: h(made(), H) }))
    const row = inbox.find(o => o.id === offer.id)
    expect(row.fromStaffName).toBe('Budi Santoso')
    expect(row.taskTitle).toBe('Extra towels')
    // Clean up for later suites: cancel (sender-only).
    expect(errOf(() => call('/v1/offers/cancel', { method: 'POST', headers: h(made(), H), body: { offerId: offer.id } })).message)
      .toBe("only the offer's sender can cancel it")
    const cancelled = data(call('/v1/offers/cancel', { method: 'POST', headers: h(b, H), body: { offerId: offer.id } }))
    expect(cancelled.state).toBe('CANCELLED')
  })

  it('accepts only while fresh: a reassignment flips the offer stale', () => {
    const b = budi()
    const l = leader()
    const m = made()
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(b, H), body: { title: 'Stale test', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    const offer = data(call('/v1/tasks/offers', { method: 'POST', headers: h(b, H), body: { taskId: t.id, toStaffId: IDS.staff.made } }))
    // Assign supersedes: the pending offer is auto-cancelled…
    call('/v1/tasks/assign', { method: 'POST', headers: h(l, H), body: { taskId: t.id, staffId: IDS.staff.budi } })
    const stale = errOf(() => call('/v1/offers/accept', { method: 'POST', headers: h(m, H), body: { offerId: offer.id } }))
    // …so the accept finds it no longer pending.
    expect(stale.message).toBe('offer is not pending')
  })

  it('applies an accepted offer: reassigns, drops the helper row, decides the offer', () => {
    const b = budi()
    const m = made()
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(b, H), body: { title: 'Handover', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    call('/v1/tasks/collaborators', { method: 'POST', headers: h(b, H), body: { taskId: t.id, staffId: IDS.staff.made } })
    const offer = data(call('/v1/tasks/offers', { method: 'POST', headers: h(b, H), body: { taskId: t.id, toStaffId: IDS.staff.made } }))
    expect(errOf(() => call('/v1/offers/accept', { method: 'POST', headers: h(b, H), body: { offerId: offer.id } })).message)
      .toBe("only the offer's target can accept it")
    const accepted = data(call('/v1/offers/accept', { method: 'POST', headers: h(m, H), body: { offerId: offer.id } }))
    expect(accepted.assignment.staffId).toBe(IDS.staff.made)
    // The acceptor's helper row is deactivated — an assignee is not their own helper.
    expect((accepted.collaborators ?? []).some((c: any) => c.staffId === IDS.staff.made)).toBe(false)
    expect(errOf(() => call('/v1/offers/decline', { method: 'POST', headers: h(m, H), body: { offerId: offer.id } })).message)
      .toBe('offer is not pending')
  })
})

describe('helpers', () => {
  it('is human-only, closed-status-guarded, idempotent, and leave is always allowed', () => {
    const b = budi()
    const m = made()
    expect(errOf(() => call('/v1/tasks/collaborators', { method: 'POST', headers: service(H), body: { taskId: IDS.task.towels0710, staffId: IDS.staff.made } })).message)
      .toBe('helpers are human-only')
    expect(errOf(() => call('/v1/tasks/collaborators', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towelsDone, staffId: IDS.staff.made } })).message)
      .toBe('task is closed')
    expect(errOf(() => call('/v1/tasks/collaborators', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels0710, staffId: IDS.staff.budi } })).message)
      .toBe('assignee cannot be a helper')
    // The seed already has Made helping — a duplicate add returns the row, 200.
    const again = call('/v1/tasks/collaborators', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels0710, staffId: IDS.staff.made } })
    expect(again.status).toBe(200)
    // helping=1 scopes the list to the caller's active helper rows.
    const helping = data<any[]>(call('/v1/tasks', { headers: h(m, H), query: { helping: '1' } }))
    expect(helping!.some(t => t.id === IDS.task.towels0710)).toBe(true)
    // Leave (self-removal) responds 204 with no body, idempotently.
    const left = call('/v1/tasks/collaborators/remove', { method: 'POST', headers: h(m, H), body: { taskId: IDS.task.towels0710, staffId: IDS.staff.made } })
    expect(left.status).toBe(204)
    expect(left.body).toBeNull()
    expect(call('/v1/tasks/collaborators/remove', { method: 'POST', headers: h(m, H), body: { taskId: IDS.task.towels0710, staffId: IDS.staff.made } }).status).toBe(204)
  })
})

describe('uploads and attachments', () => {
  it('validates uploads with the exact messages, staff identity required', () => {
    const b = budi()
    expect(errOf(() => call('/v1/uploads', { method: 'POST', headers: service(H), body: { filename: 'x.jpg', contentType: 'image/jpeg', sizeBytes: 10 } })).message)
      .toBe('uploads require a staff identity')
    expect(errOf(() => call('/v1/uploads', { method: 'POST', headers: h(b, H), body: { filename: '', contentType: 'image/jpeg', sizeBytes: 10 } })).message)
      .toBe('filename is required')
    expect(errOf(() => call('/v1/uploads', { method: 'POST', headers: h(b, H), body: { filename: 'x', contentType: 'image/jpeg', sizeBytes: 0 } })).message)
      .toBe('sizeBytes must be positive')
    expect(errOf(() => call('/v1/uploads', { method: 'POST', headers: h(b, H), body: { filename: 'x', contentType: 'image/gif', sizeBytes: 10 } })).message)
      .toBe('contentType must be one of image/jpeg, image/png, image/webp, image/heic, application/pdf')
    expect(errOf(() => call('/v1/uploads', { method: 'POST', headers: h(b, H), body: { filename: 'x.jpg', contentType: 'image/jpeg', sizeBytes: 10485761 } })).message)
      .toBe('sizeBytes exceeds the 10485760 byte limit for image/jpeg')
    const upload = data<{ storageKey: string, uploadUrl: string }>(call('/v1/uploads', { method: 'POST', headers: h(b, H), body: { filename: 'anything.png', contentType: 'application/pdf', sizeBytes: 100 } }))
    // Extension comes from the contentType, never the filename.
    expect(upload.storageKey.startsWith(`hotels/${H}/uploads/`)).toBe(true)
    expect(upload.storageKey.endsWith('.pdf')).toBe(true)
  })

  it('creates by url XOR storageKey, scoped to this hotel, 201/200 statuses', () => {
    const b = budi()
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(b, H), body: { title: 'Attach test', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    expect(errOf(() => call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'PHOTO' } })).message)
      .toBe('provide either url or storageKey, not both')
    expect(errOf(() => call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'PHOTO', url: 'x', storageKey: 'y' } })).message)
      .toBe('provide either url or storageKey, not both')
    expect(errOf(() => call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'PHOTO', storageKey: `hotels/${IDS.hotel.fave}/uploads/x.jpg` } })).message)
      .toBe('storageKey does not belong to this hotel')
    expect(errOf(() => call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'GIF', url: 'https://x.example/a.gif' } })).message)
      .toBe('filetype must be PHOTO or PDF')
    const created = call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'PHOTO', url: 'https://cdn.example/a.jpg' } })
    expect(created.status).toBe(201)
    // Update: only isRemoved changes; 200; absence of isRemoved un-removes.
    const removed = call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { id: data(created).id, taskId: t.id, filetype: 'PHOTO', isRemoved: true } })
    expect(removed.status).toBe(200)
    expect(data(removed).isRemoved).toBe(true)
    const restored = call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { id: data(created).id, taskId: t.id, filetype: 'PHOTO' } })
    expect(data(restored).isRemoved).toBe(false)
  })

  it('caps a task at 30 active attachments — create only, toggles still work', () => {
    const b = budi()
    const t = data(call('/v1/tasks/staff-create', { method: 'POST', headers: h(b, H), body: { title: 'Cap test', assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } } }))
    let lastId = ''
    for (let i = 0; i < 30; i++) {
      lastId = data(call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'PHOTO', url: `https://cdn.example/${i}.jpg` } })).id
    }
    const capped = errOf(() => call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { taskId: t.id, filetype: 'PHOTO', url: 'https://cdn.example/31.jpg' } }))
    expect(capped.code).toBe('CONFLICT')
    expect(capped.message).toBe('attachment limit reached (30)')
    // Toggling at the cap still works.
    expect(call('/v1/tasks/attachments', { method: 'POST', headers: h(b, H), body: { id: lastId, taskId: t.id, filetype: 'PHOTO', isRemoved: true } }).status).toBe(200)
  })

  it('guest attachments are service-only and URL-only', () => {
    const b = budi()
    expect(errOf(() => call('/v1/tasks/guest-attachments', { method: 'POST', headers: h(b, H), body: { taskId: IDS.task.towels1204, guestRef: IDS.guest.amelia, filetype: 'PHOTO', url: 'https://x.example/a.jpg' } })).message)
      .toBe('forbidden')
    expect(errOf(() => call('/v1/tasks/guest-attachments', { method: 'POST', headers: service(H), body: { taskId: IDS.task.towels1204, guestRef: IDS.guest.amelia, filetype: 'PHOTO', storageKey: `hotels/${H}/uploads/x.jpg` } })).message)
      .toBe('guest attachments are URL-only')
    expect(errOf(() => call('/v1/tasks/guest-attachments', { method: 'POST', headers: service(H), body: { taskId: IDS.task.towels1204, guestRef: IDS.guest.marcus, filetype: 'PHOTO', url: 'https://x.example/a.jpg' } })).message)
      .toBe('not authorized for this task')
    const created = call('/v1/tasks/guest-attachments', { method: 'POST', headers: service(H), body: { taskId: IDS.task.towels1204, guestRef: IDS.guest.amelia, filetype: 'PHOTO', url: 'https://x.example/a.jpg' } })
    expect(created.status).toBe(201)
    expect(data(created).staffId).toBeNull()
  })
})

describe('comments', () => {
  it('checks length before the service gate, then department truth', () => {
    const long = 'x'.repeat(501)
    expect(errOf(() => call('/v1/tasks/comments', { method: 'POST', headers: service(H), body: { taskId: IDS.task.towels0710, comment: long } })).message)
      .toBe('comment is required (1-500 chars)')
    expect(errOf(() => call('/v1/tasks/comments', { method: 'POST', headers: service(H), body: { taskId: IDS.task.towels0710, comment: 'hi' } })).message)
      .toBe('comments require a staff identity')
    // Wrong department denies even a leader; the HK leader cannot comment on Maintenance work.
    expect(errOf(() => call('/v1/tasks/comments', { method: 'POST', headers: h(leader(), H), body: { taskId: IDS.task.bulbsDeptPool, comment: 'hi' } })).message)
      .toBe('not authorized to comment on this task')
    const posted = call('/v1/tasks/comments', { method: 'POST', headers: h(budi(), H), body: { taskId: IDS.task.towels0710, comment: 'On my way up.' } })
    expect(posted.status).toBe(201)
  })
})
