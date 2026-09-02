import { describe, expect, it } from 'vitest'
import { ApiError, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// Behavioural contract for the staff-workspace features ported from the
// sentec-tasks-web repo (github.com/SentinelTech-com/sentec-tasks-web):
// server-resolved creation with a write-free preview, pool assignments with
// claim/return, delegation offers, helpers, submit-for-review with proof
// gates, and presigned uploads. Each rule here mirrors a fix that repo made
// after getting it wrong once.
//
// Suites in this file share one mock instance and run in order; each notes
// what it leaves behind.

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

function errMessage(fn: () => unknown): string {
  try {
    fn()
    return 'NO_ERROR'
  }
  catch (e) {
    return (e as Error).message
  }
}

describe('task creation resolves server-side', () => {
  it('lets an explicit priority win, else the item default, else NORMAL', () => {
    const admin = login('admin', 'admin123')
    // Item 8 (late checkout) defaults LOW; an untouched control sends nothing.
    const fromItem = call('/v1/tasks', { method: 'POST', body: { itemId: '8', title: 'Late checkout 0611' }, headers: h(admin, '1') }).data
    expect(fromItem.priority).toBe('LOW')
    const explicit = call('/v1/tasks', { method: 'POST', body: { itemId: '8', title: 'Late checkout VIP', priority: 'URGENT' }, headers: h(admin, '1') }).data
    expect(explicit.priority).toBe('URGENT')
    const bare = call('/v1/tasks', { method: 'POST', body: { title: 'Free-form job' }, headers: h(admin, '1') }).data
    expect(bare.priority).toBe('NORMAL')
  })

  it('resolves the requester from the location, and warns when nobody is there', () => {
    const admin = login('admin', 'admin123')
    // Room 1204 links a requester and has a current guest.
    const resolved = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Towels', locationId: '1' }, headers: h(admin, '1') })
    expect(resolved.data.requestedFor).toBe('Amelia Chen')
    expect(resolved.data.location).toBe('Room 1204')
    expect(resolved.meta.warnings).toEqual([])
    // Room 1102 links a requester but is empty: a warning, never an error.
    const empty = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Towels', locationId: '3' }, headers: h(admin, '1') })
    expect(empty.data.requestedFor).toBeNull()
    expect(empty.meta.warnings.some((w: string) => w.includes('no current guest'))).toBe(true)
    // An explicit name wins and skips the lookup entirely.
    const explicit = call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Towels', locationId: '1', requestedFor: 'Mr Big' }, headers: h(admin, '1') })
    expect(explicit.data.requestedFor).toBe('Mr Big')
  })

  it('prepends the item checklist to the creator\'s own steps', () => {
    const admin = login('admin', 'admin123')
    const created = call('/v1/tasks', {
      method: 'POST',
      body: { itemId: '2', title: 'Deep clean 1109', locationId: '1', checklistLabels: ['Check the balcony', '  '] },
      headers: h(admin, '1'),
    }).data
    expect(created.checklist).toEqual(['Strip and remake the beds', 'Vacuum and mop the floors', 'Restock amenities', 'Check the balcony'])
  })

  it('refuses a location-requiring item with no location', () => {
    const admin = login('admin', 'admin123')
    expect(errMessage(() => call('/v1/tasks', { method: 'POST', body: { itemId: '1', title: 'Towels' }, headers: h(admin, '1') })))
      .toBe('This item requires a location')
  })

  it('runs SLA clocks from a scheduled start', () => {
    const admin = login('admin', 'admin123')
    const start = '2026-08-26T09:00:00.000Z'
    const created = call('/v1/tasks', { method: 'POST', body: { itemId: '4', title: 'AC service', location: '1501', activationDate: start }, headers: h(admin, '1') }).data
    // Item 4 routes to the Urgent SLA: response 5 minutes from activation.
    expect(created.activationDate).toBe(start)
    expect(Date.parse(created.responseDueAt) - Date.parse(start)).toBe(5 * 60_000)
  })

  it('assigns at creation: staff only to themselves, teams as a pool', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    const mine = call('/v1/tasks', { method: 'POST', body: { title: 'Self-assigned', assignee: { kind: 'STAFF', userId: '10' } }, headers: h(staff, '1') }).data
    expect(mine.assignment.kind).toBe('STAFF')
    expect(mine.assignment.userId).toBe('10')
    expect(errCode(() => call('/v1/tasks', { method: 'POST', body: { title: 'For someone else', assignee: { kind: 'STAFF', userId: '12' } }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
    const pooled = call('/v1/tasks', { method: 'POST', body: { title: 'For the on-call crew', assignee: { kind: 'TEAM', teamId: '2' } }, headers: h(leader, '1') }).data
    expect(pooled.assignment.kind).toBe('TEAM')
    expect(pooled.assignment.userId).toBeNull()
  })
})

describe('preview is a write-free dry run of create', () => {
  it('resolves routing, SLA and requester without creating anything', () => {
    const admin = login('admin', 'admin123')
    const before = call('/v1/tasks', { headers: h(admin, '1'), query: { limit: 100 } }).meta.totalCount
    const preview = call('/v1/tasks/preview', { method: 'POST', body: { itemId: '4', title: 'AC dead', locationId: '2' }, headers: h(admin, '1') })
    expect(preview.data.task.slaId).toBe('2')
    expect(preview.data.task.departmentId).toBe('2')
    expect(preview.data.task.priority).toBe('URGENT')
    expect(preview.data.task.requestedFor).toBe('Marcus Reid')
    expect(preview.data.checklistLabels).toEqual([])
    const after = call('/v1/tasks', { headers: h(admin, '1'), query: { limit: 100 } }).meta.totalCount
    expect(after).toBe(before)
  })

  it('runs the same gates as create — an input can never preview clean and fail on create', () => {
    const staff = login('staff', 'staff123')
    expect(errMessage(() => call('/v1/tasks/preview', { method: 'POST', body: { itemId: '1', title: 'Towels' }, headers: h(staff, '1') })))
      .toBe('This item requires a location')
    expect(errCode(() => call('/v1/tasks/preview', { method: 'POST', body: { title: 'X', assignee: { kind: 'STAFF', userId: '12' } }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
  })
})

describe('status-route guards', () => {
  it('never reaches NEW — that is what return-to-pool is for', () => {
    const leader = login('leader', 'leader123')
    // Column 1 sets NEW on this board.
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '3', columnId: '1' }, headers: h(leader, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('keeps verification to leaders and admins', () => {
    const staff = login('staff', 'staff123')
    // Task 3 is Budi's own, so only the VERIFIED guard stands in the way.
    expect(errCode(() => call('/v1/tasks/status', { method: 'PATCH', body: { taskId: '3', columnId: '5' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
  })
})

describe('presigned uploads and attachments', () => {
  it('validates uploads with the server\'s own wording', () => {
    const staff = login('staff', 'staff123')
    expect(errMessage(() => call('/v1/uploads', { method: 'POST', body: { filename: '', contentType: 'image/png', sizeBytes: 100 }, headers: h(staff, '1') })))
      .toBe('filename is required')
    expect(errMessage(() => call('/v1/uploads', { method: 'POST', body: { filename: 'a.gif', contentType: 'image/gif', sizeBytes: 100 }, headers: h(staff, '1') })))
      .toBe('contentType must be one of image/jpeg, image/png, image/webp, image/heic, application/pdf')
    expect(errMessage(() => call('/v1/uploads', { method: 'POST', body: { filename: 'a.png', contentType: 'image/png', sizeBytes: 0 }, headers: h(staff, '1') })))
      .toBe('sizeBytes must be positive')
    expect(errMessage(() => call('/v1/uploads', { method: 'POST', body: { filename: 'a.png', contentType: 'image/png', sizeBytes: 11 * 1024 * 1024 }, headers: h(staff, '1') })))
      .toBe(`sizeBytes exceeds the ${10 * 1024 * 1024} byte limit for image/png`)
  })

  it('attaches by storage key, scoped to the property', () => {
    const staff = login('staff', 'staff123')
    const presigned = call('/v1/uploads', { method: 'POST', body: { filename: 'proof.jpg', contentType: 'image/jpeg', sizeBytes: 1024 }, headers: h(staff, '1') }).data
    expect(presigned.storageKey.startsWith('tenants/1/uploads/')).toBe(true)
    const attached = call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '4', storageKey: presigned.storageKey, filetype: 'PHOTO' }, headers: h(staff, '1') }).data
    expect(attached.url).toContain(presigned.storageKey)
    // A key from another property's partition is refused.
    expect(errCode(() => call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '4', storageKey: 'tenants/2/uploads/9.jpg', filetype: 'PHOTO' }, headers: h(staff, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('takes exactly one of url and storageKey', () => {
    const staff = login('staff', 'staff123')
    expect(errMessage(() => call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '4' }, headers: h(staff, '1') })))
      .toBe('Provide either url or storageKey, not both')
    expect(errMessage(() => call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '4', url: 'https://x.io/a.jpg', storageKey: 'tenants/1/uploads/1.jpg' }, headers: h(staff, '1') })))
      .toBe('Provide either url or storageKey, not both')
  })

  it('changes only isRemoved after creation, and restores against the cap', () => {
    const staff = login('staff', 'staff123')
    const attached = call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '4', url: 'https://cdn.example.com/before.jpg' }, headers: h(staff, '1') }).data
    const removed = call('/v1/tasks/attachments/update', { method: 'POST', body: { id: attached.id, isRemoved: true }, headers: h(staff, '1') }).data
    expect(removed.isRemoved).toBe(true)
    const restored = call('/v1/tasks/attachments/update', { method: 'POST', body: { id: attached.id, isRemoved: false }, headers: h(staff, '1') }).data
    expect(restored.isRemoved).toBe(false)
  })

  it('caps a task at 30 active attachments', () => {
    const admin = login('admin', 'admin123')
    const task = call('/v1/tasks', { method: 'POST', body: { title: 'Attachment magnet' }, headers: h(admin, '1') }).data
    for (let i = 0; i < 30; i += 1) {
      call('/v1/tasks/attachments', { method: 'POST', body: { taskId: task.id, url: `https://cdn.example.com/f${i}.jpg` }, headers: h(admin, '1') })
    }
    expect(errCode(() => call('/v1/tasks/attachments', { method: 'POST', body: { taskId: task.id, url: 'https://cdn.example.com/straw.jpg' }, headers: h(admin, '1') })))
      .toBe('ATTACHMENT_LIMIT')
  })
})

describe('pool assignments', () => {
  it('lists pool tasks as unclaimed, but claim respects membership', () => {
    const admin = login('admin', 'admin123')
    const leader = login('leader', 'leader123')
    const unclaimed = call('/v1/tasks', { headers: h(admin, '1'), query: { scope: 'unclaimed', limit: 100 } }).data
    // Task 10 sits in the Engineering On-Call TEAM pool.
    expect(unclaimed.some((t: any) => t.id === '10')).toBe(true)
    // The leader (housekeeping, not on that team) cannot claim out of it.
    expect(errCode(() => call('/v1/tasks/claim', { method: 'POST', body: { taskId: '10' }, headers: h(leader, '1') })))
      .toBe('FORBIDDEN')
  })

  it('converts a pool assignment into a personal one when a member claims', () => {
    const admin = login('admin', 'admin123')
    // Put the admin on the team, then claim: the pool row is superseded.
    call('/v1/teams/2/members/add', { method: 'POST', body: { userId: '13' }, headers: h(admin, '1') })
    const claimed = call('/v1/tasks/claim', { method: 'POST', body: { taskId: '10' }, headers: h(admin, '1') }).data
    expect(claimed.assignment.kind).toBe('STAFF')
    expect(claimed.assignment.userId).toBe('13')
  })

  it('claims from a department pool as its department\'s staff', () => {
    const staff = login('staff', 'staff123')
    // Task 12 sits in tenant 2's Housekeeping DEPARTMENT pool; Budi works there.
    const claimed = call('/v1/tasks/claim', { method: 'POST', body: { taskId: '12' }, headers: h(staff, '2') }).data
    expect(claimed.assignment.kind).toBe('STAFF')
    expect(claimed.assignment.userId).toBe('10')
  })

  it('returns a held task to its most recent pool, reason required', () => {
    const staff = login('staff', 'staff123')
    expect(errCode(() => call('/v1/tasks/return', { method: 'POST', body: { taskId: '12', reason: '  ' }, headers: h(staff, '2') })))
      .toBe('BAD_REQUEST')
    const returned = call('/v1/tasks/return', { method: 'POST', body: { taskId: '12', reason: 'Guest asked to come back after 15:00' }, headers: h(staff, '2') }).data
    // Rule (a): the task's own most recent pool assignment, recreated.
    expect(returned.assignment.kind).toBe('DEPARTMENT')
    expect(returned.assignment.departmentId).toBe('5')
    expect(returned.assignment.remark).toBe('Guest asked to come back after 15:00')
  })

  it('only the holder can return, and only open work returns', () => {
    const leader = login('leader', 'leader123')
    const staff = login('staff', 'staff123')
    // Task 5 is held by Maya, not the leader.
    expect(errCode(() => call('/v1/tasks/return', { method: 'POST', body: { taskId: '5', reason: 'x' }, headers: h(leader, '1') })))
      .toBe('FORBIDDEN')
    // Task 15 is Budi's, but it is with its reviewer.
    expect(errCode(() => call('/v1/tasks/return', { method: 'POST', body: { taskId: '15', reason: 'x' }, headers: h(staff, '1') })))
      .toBe('AWAITING_REVIEW')
    // A held task parked on hold is closed to returns.
    const parked = call('/v1/tasks', { method: 'POST', body: { title: 'Parked job', assignee: { kind: 'STAFF', userId: '10' } }, headers: h(staff, '1') }).data
    call('/v1/tasks/status', { method: 'PATCH', body: { taskId: parked.id, columnId: '3' }, headers: h(staff, '1') })
    expect(errCode(() => call('/v1/tasks/return', { method: 'POST', body: { taskId: parked.id, reason: 'x' }, headers: h(staff, '1') })))
      .toBe('TASK_CLOSED')
  })
})

describe('delegation offers', () => {
  it('shows the target their pending inbox, newest first', () => {
    const leader = login('leader', 'leader123')
    const inbox = call('/v1/offers', { headers: h(leader, '1') }).data
    expect(inbox.some((o: any) => o.taskId === '3' && o.taskTitle === 'Room cleaning')).toBe(true)
  })

  it('allows one pending offer per task, cancellable only by its sender', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    expect(errCode(() => call('/v1/tasks/offers', { method: 'POST', body: { taskId: '3', toUserId: '11' }, headers: h(staff, '1') })))
      .toBe('OFFER_PENDING')
    expect(errCode(() => call('/v1/offers/cancel', { method: 'POST', body: { offerId: '1' }, headers: h(leader, '1') })))
      .toBe('FORBIDDEN')
    // Declining changes nothing about the task; the holder stays.
    const declined = call('/v1/offers/decline', { method: 'POST', body: { offerId: '1' }, headers: h(leader, '1') }).data
    expect(declined.state).toBe('DECLINED')
    const task = call('/v1/tasks/3', { headers: h(staff, '1') }).data
    expect(task.assignment.userId).toBe('10')
    expect(task.pendingOffer).toBeNull()
  })

  it('gates sending: holder only, open statuses only, no self, same department', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    expect(errCode(() => call('/v1/tasks/offers', { method: 'POST', body: { taskId: '5', toUserId: '11' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN') // held by Maya, not Budi
    expect(errCode(() => call('/v1/tasks/offers', { method: 'POST', body: { taskId: '3', toUserId: '10' }, headers: h(staff, '1') })))
      .toBe('BAD_REQUEST') // to yourself
    expect(errCode(() => call('/v1/tasks/offers', { method: 'POST', body: { taskId: '3', toUserId: '12' }, headers: h(staff, '1') })))
      .toBe('BAD_REQUEST') // Agus works Maintenance; task 3 is Housekeeping
    // Offers only travel on open work.
    const parked = call('/v1/tasks', { method: 'POST', body: { title: 'Parked for offer', assignee: { kind: 'STAFF', userId: '11' } }, headers: h(leader, '1') }).data
    call('/v1/tasks/status', { method: 'PATCH', body: { taskId: parked.id, columnId: '3' }, headers: h(leader, '1') })
    expect(errCode(() => call('/v1/tasks/offers', { method: 'POST', body: { taskId: parked.id, toUserId: '14' }, headers: h(leader, '1') })))
      .toBe('TASK_NOT_OPEN')
  })

  it('accepting hands the task over; only the target may accept', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    const task = call('/v1/tasks', { method: 'POST', body: { title: 'Cover my shift job', assignee: { kind: 'STAFF', userId: '10' } }, headers: h(staff, '1') }).data
    const offer = call('/v1/tasks/offers', { method: 'POST', body: { taskId: task.id, toUserId: '11', note: 'Please take this one' }, headers: h(staff, '1') }).data
    expect(errCode(() => call('/v1/offers/accept', { method: 'POST', body: { offerId: offer.id }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
    const accepted = call('/v1/offers/accept', { method: 'POST', body: { offerId: offer.id }, headers: h(leader, '1') }).data
    expect(accepted.assignment.userId).toBe('11')
    expect(accepted.assignment.assignedBy).toBe('10')
    // The status never changes on delegation.
    expect(accepted.status).toBe('NEW')
  })

  it('a reassignment supersedes the pending offer', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    const task = call('/v1/tasks', { method: 'POST', body: { title: 'Soon reassigned', assignee: { kind: 'STAFF', userId: '10' } }, headers: h(staff, '1') }).data
    const offer = call('/v1/tasks/offers', { method: 'POST', body: { taskId: task.id, toUserId: '11' }, headers: h(staff, '1') }).data
    call('/v1/tasks/assign', { method: 'POST', body: { taskId: task.id, userId: '14' }, headers: h(leader, '1') })
    expect(errCode(() => call('/v1/offers/accept', { method: 'POST', body: { offerId: offer.id }, headers: h(leader, '1') })))
      .toBe('OFFER_DECIDED')
  })
})

describe('helpers', () => {
  it('gives a helper the task: visibility, the helping queue, and submit rights', () => {
    const staff = login('staff', 'staff123')
    // Budi helps on task 5 — another department's task, readable through it.
    expect(call('/v1/tasks/5', { headers: h(staff, '1') }).data.id).toBe('5')
    const helping = call('/v1/tasks', { headers: h(staff, '1'), query: { scope: 'helping', limit: 100 } }).data
    expect(helping.map((t: any) => t.id)).toEqual(['5'])
    // A helper can submit the work, exactly like the assignee.
    const submitted = call('/v1/tasks/submit', { method: 'POST', body: { taskId: '5' }, headers: h(staff, '1') }).data
    expect(submitted.status).toBe('SUBMITTED')
    expect(submitted.submittedBy).toBe('10')
  })

  it('is managed by leaders, admins and the assignee — helpers may always leave', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    // Staff who neither hold nor lead cannot manage someone else's helpers.
    expect(errCode(() => call('/v1/tasks/collaborators', { method: 'POST', body: { taskId: '5', userId: '14' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
    const added = call('/v1/tasks/collaborators', { method: 'POST', body: { taskId: '5', userId: '14' }, headers: h(leader, '1') }).data
    expect(added.userId).toBe('14')
    // Adding again is idempotent, not an error.
    expect(call('/v1/tasks/collaborators', { method: 'POST', body: { taskId: '5', userId: '14' }, headers: h(leader, '1') }).data.id).toBe(added.id)
    // The assignee cannot also be a helper.
    expect(errCode(() => call('/v1/tasks/collaborators', { method: 'POST', body: { taskId: '5', userId: '15' }, headers: h(leader, '1') })))
      .toBe('BAD_REQUEST')
    // Leaving is a self-remove that needs no rank.
    call('/v1/tasks/collaborators/remove', { method: 'POST', body: { taskId: '5', userId: '10' }, headers: h(staff, '1') })
    expect(call('/v1/tasks', { headers: h(staff, '1'), query: { scope: 'helping', limit: 100 } }).data).toEqual([])
  })

  it('closes helper changes on finished work — but not on submitted work', () => {
    const leader = login('leader', 'leader123')
    // Task 7 is FINISHED: closed to helper changes.
    expect(errCode(() => call('/v1/tasks/collaborators', { method: 'POST', body: { taskId: '7', userId: '14' }, headers: h(leader, '1') })))
      .toBe('TASK_CLOSED')
    // Task 15 is SUBMITTED: review can still send it back, so helpers may change.
    expect(call('/v1/tasks/collaborators', { method: 'POST', body: { taskId: '15', userId: '14' }, headers: h(leader, '1') }).data.userId).toBe('14')
  })
})

describe('submit for review and the review decision', () => {
  it('enforces the item\'s proof gates at submission', () => {
    const staff = login('staff', 'staff123')
    // Task 3 (Room cleaning) needs 2 photos and a completion note.
    expect(errMessage(() => call('/v1/tasks/submit', { method: 'POST', body: { taskId: '3', completionNote: 'Done' }, headers: h(staff, '1') })))
      .toContain('proof photo')
    call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '3', url: 'https://cdn.example.com/proof-1.jpg' }, headers: h(staff, '1') })
    call('/v1/tasks/attachments', { method: 'POST', body: { taskId: '3', url: 'https://cdn.example.com/proof-2.jpg' }, headers: h(staff, '1') })
    expect(errMessage(() => call('/v1/tasks/submit', { method: 'POST', body: { taskId: '3' }, headers: h(staff, '1') })))
      .toBe('This task requires a completion note')
    const submitted = call('/v1/tasks/submit', { method: 'POST', body: { taskId: '3', completionNote: 'All three steps done, room ready' }, headers: h(staff, '1') }).data
    expect(submitted.status).toBe('SUBMITTED')
    // The resolution verdict is stamped at submission, not at approval.
    expect(submitted.resolutionDuration).not.toBeNull()
    // Submitting again is a 409, not a duplicate.
    expect(errCode(() => call('/v1/tasks/submit', { method: 'POST', body: { taskId: '3', completionNote: 'again' }, headers: h(staff, '1') })))
      .toBe('NOT_IN_PROGRESS')
  })

  it('review is for leaders of the task\'s department; changes reset the clock', () => {
    const staff = login('staff', 'staff123')
    const leader = login('leader', 'leader123')
    expect(errCode(() => call('/v1/tasks/review', { method: 'POST', body: { taskId: '3', decision: 'APPROVE' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
    expect(errCode(() => call('/v1/tasks/review', { method: 'POST', body: { taskId: '3', decision: 'REQUEST_CHANGES', note: '' }, headers: h(leader, '1') })))
      .toBe('BAD_REQUEST')
    const sentBack = call('/v1/tasks/review', { method: 'POST', body: { taskId: '3', decision: 'REQUEST_CHANGES', note: 'Balcony rail still dusty' }, headers: h(leader, '1') }).data
    expect(sentBack.status).toBe('IN_PROGRESS')
    // The next submission re-accumulates from a clean clock.
    expect(sentBack.resolutionDuration).toBeNull()
    expect(sentBack.resolutionSlaStatus).toBe('EMPTY')

    const resubmitted = call('/v1/tasks/submit', { method: 'POST', body: { taskId: '3', completionNote: 'Rail wiped down too' }, headers: h(staff, '1') }).data
    expect(resubmitted.completionNote).toBe('Rail wiped down too')
    const approved = call('/v1/tasks/review', { method: 'POST', body: { taskId: '3', decision: 'APPROVE' }, headers: h(leader, '1') }).data
    expect(approved.status).toBe('FINISHED')
  })

  it('keeps admin-only review for tasks with no department', () => {
    const leader = login('leader', 'leader123')
    const admin = login('admin', 'admin123')
    const task = call('/v1/tasks', { method: 'POST', body: { title: 'Unrouted odd job', assignee: { kind: 'STAFF', userId: '11' } }, headers: h(admin, '1') }).data
    expect(task.departmentId).toBeNull()
    call('/v1/tasks/status', { method: 'PATCH', body: { taskId: task.id, columnId: '2' }, headers: h(leader, '1') })
    call('/v1/tasks/submit', { method: 'POST', body: { taskId: task.id }, headers: h(leader, '1') })
    expect(errCode(() => call('/v1/tasks/review', { method: 'POST', body: { taskId: task.id, decision: 'APPROVE' }, headers: h(leader, '1') })))
      .toBe('FORBIDDEN')
    expect(call('/v1/tasks/review', { method: 'POST', body: { taskId: task.id, decision: 'APPROVE' }, headers: h(admin, '1') }).data.status)
      .toBe('FINISHED')
  })
})
