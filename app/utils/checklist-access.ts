import type { ChecklistItem, ProjectLevel, StaffRole, TaskStatus } from '~/utils/clientFakeApi'

// Cosmetic gates for the checklist card, mirroring the feat/projects rules so
// a person never sees a control that can only 403 or 409. The API is the
// authority — this decides what to SHOW, and the server's message wins
// whenever the two disagree (a leader outside the task's department, say).
//
//   done   — step assignee, task assignee, helpers, dept leader, admin,
//            project manager
//   add / remove / assign — admin, dept leader, task assignee, project manager
//   all four routes 409 once the task is FINISHED, VERIFIED or CANCELLED;
//   SUBMITTED still takes edits.
//
// A step assignee gets read-only access to the task: they may tick and
// annotate THEIR OWN step and nothing else.

/** The task states the checklist routes refuse outright. */
export const CHECKLIST_CLOSED_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['FINISHED', 'VERIFIED', 'CANCELLED'])

export interface ChecklistViewer {
  userId: string | null
  /** Role at the selected hotel. `null` when signed out. */
  role: StaffRole | null
  /** Holds the task personally (active STAFF assignment). */
  isAssignee: boolean
  /** Active helper on the task. */
  isHelper: boolean
  /** The viewer's standing in the task's project, when it has one. */
  projectLevel: ProjectLevel | null
}

export interface ChecklistAccess {
  /** Nothing may change: the task is closed. Every control hides. */
  closed: boolean
  /** May add, remove and assign steps. */
  canManage: boolean
  /** May tick / annotate this particular step. */
  canTick: (item: Pick<ChecklistItem, 'assignedStaffId'>) => boolean
  /** True when the viewer may do at least one thing to at least one step — else the card is read-only. */
  canEditAny: (items: Array<Pick<ChecklistItem, 'assignedStaffId'>>) => boolean
}

export function checklistAccess(status: TaskStatus, viewer: ChecklistViewer): ChecklistAccess {
  const closed = CHECKLIST_CLOSED_STATUSES.has(status)
  const isLeader = viewer.role === 'leader' || viewer.role === 'admin'
  const managesProject = viewer.projectLevel === 'MANAGER'
  const canManage = !closed && (isLeader || viewer.isAssignee || managesProject)
  const canTick = (item: Pick<ChecklistItem, 'assignedStaffId'>) =>
    !closed && (canManage || viewer.isHelper || (Boolean(viewer.userId) && item.assignedStaffId === viewer.userId))
  return {
    closed,
    canManage,
    canTick,
    canEditAny: items => canManage || items.some(canTick),
  }
}

/** Steps done over total, for a one-line progress read ("2 of 5 done"). */
export function checklistProgress(items: Array<Pick<ChecklistItem, 'isDone'>>): { done: number, total: number } {
  return { done: items.filter(item => item.isDone).length, total: items.length }
}
