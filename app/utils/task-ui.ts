import type { SlaStatus, TaskPriority, TaskStatus } from '~/utils/clientFakeApi'

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
  SUBMITTED: { label: 'Submitted', dot: 'bg-primary/70', badge: 'bg-primary/15 text-primary' },
  PENDING: { label: 'On Hold', dot: 'bg-primary/50', badge: 'bg-secondary text-secondary-foreground' },
  FINISHED: { label: 'Finished', dot: 'bg-success/70', badge: 'bg-success/10 text-success' },
  VERIFIED: { label: 'Verified', dot: 'bg-success', badge: 'bg-success/15 text-success' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-destructive', badge: 'bg-destructive/10 text-destructive' },
}

export function statusMeta(status: TaskStatus): StatusMeta {
  return TASK_STATUS_META[status] ?? TASK_STATUS_META.NEW
}

export interface PriorityMeta {
  label: string
  /** Soft badge surface + matching text colour. */
  badge: string
}

/** Ordered least → most urgent, which is also the order pickers offer them in. */
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

export const TASK_PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  LOW: { label: 'Low', badge: 'bg-muted text-muted-foreground' },
  NORMAL: { label: 'Normal', badge: 'bg-secondary text-secondary-foreground' },
  HIGH: { label: 'High', badge: 'bg-primary/10 text-primary' },
  URGENT: { label: 'Urgent', badge: 'bg-destructive/10 text-destructive' },
}

export function priorityMeta(priority: TaskPriority): PriorityMeta {
  return TASK_PRIORITY_META[priority] ?? TASK_PRIORITY_META.NORMAL
}

/**
 * Statuses that still need someone's attention. SUBMITTED is open — the
 * attention has just moved from the assignee to the reviewer.
 */
export const OPEN_STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING']

export function isOpen(status: TaskStatus) {
  return OPEN_STATUSES.includes(status)
}

/** Statuses a task can be claimed in: real work, not yet under review. */
export const CLAIMABLE_STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS']

export function isClaimable(status: TaskStatus) {
  return CLAIMABLE_STATUSES.includes(status)
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

/** Two-letter initials from a single display-name field (the API has no split). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return `${parts[0]![0] ?? ''}${parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : ''}`.toUpperCase()
}

/** Render a nullable staffName the API's way: never fabricate a name. */
export function displayName(name: string | null | undefined, fallback = 'Team member'): string {
  return (name ?? '').trim() || fallback
}

/** Human task reference: the UUID's first block, shown where an id would leak. */
export function taskRef(id: string) {
  return `TSK-${id.slice(0, 8).toUpperCase()}`
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
  return formatShortDate(then)
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

// ── The display zone ────────────────────────────────────────────────────────
//
// Every clock time on screen is the HOTEL's (GET /v1/tenant → timezone), not
// the device's: a due time read on a phone left on Singapore time must still
// say what the corridor clock says. `useTenant()` points this at the selected
// hotel's zone; with nothing set (signed out, the tenant read refused), the
// device zone is the fallback.

let displayTimeZone: string | null = null

/** Point the time helpers at a zone (an IANA name), or null for the device's. */
export function setDisplayTimeZone(timeZone: string | null) {
  displayTimeZone = timeZone && isKnownTimeZone(timeZone) ? timeZone : null
}

export function getDisplayTimeZone(): string | null {
  return displayTimeZone
}

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  }
  catch {
    return false
  }
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

/** Hour/minute/day/month/year of an instant in the display zone. */
export function zonedParts(ms: number): { year: number, month: number, day: number, hour: number, minute: number, weekday: number } {
  const key = displayTimeZone ?? 'device'
  let formatter = zonedFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { ...(displayTimeZone ? { timeZone: displayTimeZone } : {}), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    zonedFormatters.set(key, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(part => [part.type, part.value]))
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: weekdays.indexOf(parts.weekday ?? '') }
}

/** Wall-clock "HH:MM" in the hotel's zone; '—' when there is nothing to show. */
export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const { hour, minute } = zonedParts(ms)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** "25 Aug" in the hotel's zone. */
export function formatShortDate(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  const ms = typeof iso === 'number' ? iso : Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  return new Intl.DateTimeFormat(undefined, { ...(displayTimeZone ? { timeZone: displayTimeZone } : {}), day: 'numeric', month: 'short' }).format(new Date(ms))
}

/** "25 Aug, 14:05" in the hotel's zone — absolute times staff plan a route around. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  return `${formatShortDate(ms)}, ${formatClockTime(iso)}`
}

/** A running clock inside this window reads as "soon" — amber, not yet red. */
export const DUE_SOON_MS = 30 * 60_000

/**
 * Which SLA clock is actually running: the response target until the task is
 * picked up, the resolution target while it is worked or parked. Submitted and
 * closed work has no running clock — its verdict is already stamped, and
 * showing a countdown there would be showing the wrong number.
 */
export function runningDueAt(task: { status: TaskStatus, responseDueAt?: string | null, resolutionDueAt?: string | null }): string | null {
  switch (task.status) {
    case 'NEW': return task.responseDueAt ?? null
    case 'IN_PROGRESS':
    case 'PENDING': return task.resolutionDueAt ?? null
    default: return null
  }
}

export type DueTone = 'ok' | 'soon' | 'breached'

/**
 * The due label for a running clock. While there is time it is the countdown
 * ("40m left", amber once inside DUE_SOON_MS); once breached it says WHEN the
 * task was due as well as by how much — "due 14:30 · 25m over" — because a
 * leader triaging late work needs both, and a bare "25m over" answers only
 * one of the two questions. Null when there is no target, like `dueIn`.
 */
export function dueLabel(iso: string | null, nowMs = Date.now()): { label: string, tone: DueTone } | null {
  const countdown = dueIn(iso, nowMs)
  if (!countdown) return null
  if (countdown.overdue) return { label: `due ${formatClockTime(iso)} · ${countdown.label}`, tone: 'breached' }
  const remaining = Date.parse(iso!) - nowMs
  return { label: countdown.label, tone: remaining <= DUE_SOON_MS ? 'soon' : 'ok' }
}

/** Minutes rendered as a duration, for SLA targets in config screens. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!rest) return `${hours} hr`
  return `${hours} hr ${rest} min`
}
