import type { SlaStatus, TaskStatus } from '~/utils/clientFakeApi'

// Shared presentation metadata for tasks. Every colour is a semantic design
// token from tailwind.css — no hardcoded hex — so light and dark both resolve
// automatically and the palette stays in step with the Butler consoles.

export interface StatusMeta {
  label: string
  /** Solid accent dot, used on board columns, pills and timeline nodes. */
  dot: string
  /** Soft badge surface + matching text colour. */
  badge: string
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  NEW: { label: 'New', dot: 'bg-muted-foreground/40', badge: 'bg-muted text-muted-foreground' },
  IN_PROGRESS: { label: 'In Progress', dot: 'bg-primary', badge: 'bg-primary/10 text-primary' },
  PENDING: { label: 'On Hold', dot: 'bg-primary/50', badge: 'bg-secondary text-secondary-foreground' },
  FINISHED: { label: 'Finished', dot: 'bg-success/70', badge: 'bg-success/10 text-success' },
  VERIFIED: { label: 'Verified', dot: 'bg-success', badge: 'bg-success/15 text-success' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-destructive', badge: 'bg-destructive/10 text-destructive' },
}

export function statusMeta(status: TaskStatus): StatusMeta {
  return TASK_STATUS_META[status] ?? TASK_STATUS_META.NEW
}

/** Statuses that still need someone's attention. */
export const OPEN_STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'PENDING']

export function isOpen(status: TaskStatus) {
  return OPEN_STATUSES.includes(status)
}

/**
 * Worst-of the two SLA clocks. A task that responded on time but blew its
 * resolution target is a breach, so the badge has to show the worse of the two
 * rather than the most recent.
 */
export function slaState(task: { responseSlaStatus: SlaStatus, resolutionSlaStatus: SlaStatus }): SlaStatus {
  if (task.responseSlaStatus === 'BREACHED' || task.resolutionSlaStatus === 'BREACHED') return 'BREACHED'
  if (task.responseSlaStatus === 'ON_TIME' || task.resolutionSlaStatus === 'ON_TIME') return 'ON_TIME'
  return 'EMPTY'
}

/** Left border accent matching the SLA state, for cards. */
export function slaAccent(task: { responseSlaStatus: SlaStatus, resolutionSlaStatus: SlaStatus }) {
  switch (slaState(task)) {
    case 'BREACHED': return 'border-l-destructive'
    case 'ON_TIME': return 'border-l-success'
    default: return 'border-l-transparent'
  }
}

export function initials(user: { firstName: string, lastName: string }): string {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()
}

export function fullName(user: { firstName: string, lastName: string } | null | undefined): string {
  return user ? `${user.firstName} ${user.lastName}`.trim() : ''
}

/** Human task reference. Shown everywhere an id would otherwise leak. */
export function taskRef(id: string) {
  return `TSK-${id}`
}

/** Compact relative time, e.g. "3h ago", "in 12m". */
export function relativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diff = nowMs - then
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (abs < minute) return 'just now'
  const suffix = diff >= 0 ? 'ago' : ''
  const prefix = diff < 0 ? 'in ' : ''
  if (abs < hour) return `${prefix}${Math.round(abs / minute)}m ${suffix}`.trim()
  if (abs < day) return `${prefix}${Math.round(abs / hour)}h ${suffix}`.trim()
  if (abs < 30 * day) return `${prefix}${Math.round(abs / day)}d ${suffix}`.trim()
  return new Date(then).toLocaleDateString()
}

/**
 * Time left against a due date, as a short countdown. Returns null when there is
 * no target — a task with no SLA should show nothing rather than "0m".
 */
export function dueIn(iso: string | null, nowMs = Date.now()): { label: string, overdue: boolean } | null {
  if (!iso) return null
  const due = Date.parse(iso)
  if (Number.isNaN(due)) return null
  const diff = due - nowMs
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute

  const value = abs < hour
    ? `${Math.max(1, Math.round(abs / minute))}m`
    : abs < 24 * hour
      ? `${Math.round(abs / hour)}h`
      : `${Math.round(abs / (24 * hour))}d`

  return diff >= 0 ? { label: `${value} left`, overdue: false } : { label: `${value} over`, overdue: true }
}

/** Minutes rendered as a duration, for SLA targets in config screens. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!rest) return `${hours} hr`
  return `${hours} hr ${rest} min`
}
