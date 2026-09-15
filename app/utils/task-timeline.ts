import type { SlaStatus, TaskDetail, TaskHistory, TaskStatus } from '~/utils/clientFakeApi'
import { TASK_STATUS_META, isOpen } from '~/utils/task-ui'

// The graphical timeline's model: pure arithmetic over a task detail, kept out
// of the component so the geometry (where each phase and target lands on the
// axis) can be pinned by tests without a DOM.

export interface TimelinePhase {
  status: TaskStatus
  /** Epoch ms the task entered this status. */
  from: number
  /** Epoch ms it left — or `now` while it is still the current status. */
  to: number
  /** Position and width on the axis, 0–100. */
  left: number
  width: number
  /** Whole minutes spent in the phase. */
  minutes: number
  /** True for the phase the task is in right now (open work only). */
  current: boolean
}

export type TimelineMarkerKind = 'response' | 'resolution' | 'due' | 'now'

export interface TimelineMarker {
  kind: TimelineMarkerKind
  at: number
  /** Position on the axis, 0–100 — always clamped inside the track. */
  left: number
  /** The clock's verdict, when it has one. `null` for `due` and `now`. */
  verdict: SlaStatus | null
}

export interface TaskTimelineModel {
  /** Axis bounds, epoch ms. */
  start: number
  end: number
  phases: TimelinePhase[]
  markers: TimelineMarker[]
  /** Activation is still ahead: nothing has happened yet, so the track is empty. */
  scheduled: boolean
}

const MINUTE = 60_000

/** Never divide by zero on a task whose whole life is one instant. */
const MIN_SPAN_MS = MINUTE

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

function isTaskStatus(value: string): value is TaskStatus {
  return value in TASK_STATUS_META
}

/**
 * History rows say which status was ENTERED and when. Sorted by `seq`, with
 * `createdAt` as the fallback so seed rows without a meaningful seq still
 * read left to right. Rows carrying an unknown status are skipped rather than
 * drawn in a fallback colour that would misstate the lifecycle.
 */
function orderedHistory(history: TaskHistory[] | null | undefined) {
  return [...(history ?? [])]
    .filter(row => isTaskStatus(row.status) && parse(row.createdAt) !== null)
    .sort((a, b) => (a.seq - b.seq) || a.createdAt.localeCompare(b.createdAt))
}

type TimelineInput = Pick<TaskDetail,
  'status' | 'activationDate' | 'createdAt' | 'history'
  | 'responseDueAt' | 'resolutionDueAt' | 'dueAt'
  | 'responseSlaStatus' | 'resolutionSlaStatus'
>

/**
 * Build the axis, the status phases and the target markers for one task.
 *
 * - The axis starts at activation (that is when the SLA clock starts), or at
 *   the first history row if one is somehow earlier.
 * - It ends at whichever is latest of: now (open work only), the last status
 *   change, and every target — so a late task visibly runs past its targets,
 *   and a closed task's axis stops at the moment it closed unless a target
 *   still lies beyond it.
 * - Dispatches write no NEW row, so a NEW phase is synthesised from activation
 *   when the first row is not NEW.
 * - Closed statuses are drawn as a point in time, not a phase: FINISHED,
 *   VERIFIED and CANCELLED have no duration that means anything.
 */
export function buildTaskTimeline(task: TimelineInput, nowMs = Date.now()): TaskTimelineModel | null {
  const activation = parse(task.activationDate) ?? parse(task.createdAt)
  if (activation === null) return null

  const rows = orderedHistory(task.history)
  const events = rows.map(row => ({ status: row.status as TaskStatus, at: parse(row.createdAt)! }))
  if (events.length === 0 || events[0]!.status !== 'NEW') {
    events.unshift({ status: 'NEW', at: Math.min(activation, events[0]?.at ?? activation) })
  }

  const open = isOpen(task.status)
  const scheduled = nowMs < activation && events.length === 1
  const lastEventAt = events[events.length - 1]!.at

  const targets: Array<{ kind: TimelineMarkerKind, at: number | null, verdict: SlaStatus | null }> = [
    { kind: 'response', at: parse(task.responseDueAt), verdict: task.responseSlaStatus },
    { kind: 'resolution', at: parse(task.resolutionDueAt), verdict: task.resolutionSlaStatus },
    { kind: 'due', at: parse(task.dueAt), verdict: null },
  ]

  const start = Math.min(activation, events[0]!.at)
  const candidates = [lastEventAt, ...targets.map(t => t.at ?? start)]
  if (open) candidates.push(nowMs)
  const end = Math.max(start + MIN_SPAN_MS, ...candidates)
  const span = end - start
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100))

  const phases: TimelinePhase[] = []
  events.forEach((event, index) => {
    const next = events[index + 1]
    const isLast = !next
    // A closing status is a moment, not a stretch of time.
    if (isLast && !open) return
    // A phase the task has not reached yet (scheduled activation) draws nothing.
    if (isLast && nowMs < event.at) return
    const to = next ? next.at : nowMs
    const from = event.at
    phases.push({
      status: event.status,
      from,
      to,
      left: pct(from),
      width: Math.max(0, pct(to) - pct(from)),
      minutes: Math.max(0, Math.round((to - from) / MINUTE)),
      current: isLast,
    })
  })

  const markers: TimelineMarker[] = targets
    .filter((t): t is { kind: TimelineMarkerKind, at: number, verdict: SlaStatus | null } => t.at !== null)
    .map(t => ({ kind: t.kind, at: t.at, left: pct(t.at), verdict: t.verdict }))
  if (open && !scheduled) markers.push({ kind: 'now', at: nowMs, left: pct(nowMs), verdict: null })

  return { start, end, phases, markers, scheduled }
}

/**
 * Axis end-labels: clock time when the whole axis fits in a day, day + time
 * once it does not — a task that ran overnight must not read as if it took
 * minutes.
 */
export function formatAxisTime(ms: number, spanMs: number): string {
  const date = new Date(ms)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (spanMs < 24 * 60 * MINUTE) return time
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`
}

/** Compact duration for the phase legend: "6m", "1h 20m", "2d 3h". */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest ? `${hours}h ${rest}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days}d ${restHours}h` : `${days}d`
}
