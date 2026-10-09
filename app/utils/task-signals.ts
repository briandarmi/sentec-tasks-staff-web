import type { Component } from 'vue'
import {
  ArrowDownIcon,
  BanIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleDashedIcon,
  ClockAlertIcon,
  ClockIcon,
  EyeIcon,
  FlagIcon,
  FlameIcon,
  PauseIcon,
  PlayIcon,
  SirenIcon,
} from '@lucide/vue'
import type { SlaStatus, TaskPriority, TaskStatus } from '~/utils/clientFakeApi'
import { DUE_SOON_MS, dueIn, formatClockTime, runningDueAt, slaState } from '~/utils/task-ui'

// ── One traffic light ────────────────────────────────────────────────────────
//
// Red, amber and green mean ONE thing in this app: how urgently a task needs
// a person. Three things can raise it — the running clock, the priority the
// request carries, and the escalation policy stepping in — and each has an
// icon of its own, so the colour says HOW MUCH and the icon says WHY. A card
// with a red edge is "act now" whatever the reason; the chip beside it says
// which reason.
//
// Lifecycle status never borrows these colours (its own set is below): a
// cancelled task needs nobody, so it is grey, not red.
//
// This file is staff-web's own. `task-ui.ts` is shared byte-for-byte with the
// admin console and stays as it is; this builds on its clock helpers.

export type Heat = 'late' | 'soon' | 'ok' | 'none'

export const HEAT_RANK: Record<Heat, number> = { none: 0, ok: 1, soon: 2, late: 3 }

export function hotter(a: Heat, b: Heat): Heat {
  return HEAT_RANK[a] >= HEAT_RANK[b] ? a : b
}

export interface HeatTone {
  /** A tinted chip: fill plus text. */
  chip: string
  /** A card's left edge. */
  edge: string
  /** Text alone on a plain surface. */
  text: string
  /** A banner: fill, text and border. */
  band: string
  /** A solid dot or bar. */
  solid: string
}

/** Semantic tokens only (tailwind.css), so light and dark both resolve. */
export const HEAT_TONE: Record<Heat, HeatTone> = {
  late: {
    chip: 'bg-danger-tint text-danger-tint-foreground',
    edge: 'border-l-destructive',
    text: 'text-danger-tint-foreground',
    band: 'border-destructive/40 bg-danger-tint text-danger-tint-foreground',
    solid: 'bg-destructive',
  },
  soon: {
    chip: 'bg-warning-tint text-warning-tint-foreground',
    edge: 'border-l-warning',
    text: 'text-warning-tint-foreground',
    band: 'border-warning/40 bg-warning-tint text-warning-tint-foreground',
    solid: 'bg-warning',
  },
  ok: {
    chip: 'bg-success-tint text-success-tint-foreground',
    edge: 'border-l-success',
    text: 'text-success-tint-foreground',
    band: 'border-success/40 bg-success-tint text-success-tint-foreground',
    solid: 'bg-success',
  },
  none: {
    chip: 'bg-neutral-tint text-neutral-tint-foreground',
    edge: 'border-l-transparent',
    text: 'text-muted-foreground',
    band: 'border-border bg-muted text-muted-foreground',
    solid: 'bg-muted-foreground/40',
  },
}

export type SignalKind = 'clock' | 'verdict' | 'escalation' | 'priority'

export interface Signal {
  kind: SignalKind
  heat: Heat
  /** Short, for a chip: "25m late", "40m left", "Urgent", "Escalated". */
  label: string
  /** One plain sentence, for a banner or a tooltip. */
  detail: string
  icon: Component
}

export interface SignalInput {
  status: TaskStatus
  priority: TaskPriority
  escalationLevel: number
  responseSlaStatus: SlaStatus
  resolutionSlaStatus: SlaStatus
  responseDueAt?: string | null
  resolutionDueAt?: string | null
}

/** Statuses where the work is still running and the traffic light applies. */
export const RUNNING_STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'PENDING']

export function isRunning(status: TaskStatus): boolean {
  return RUNNING_STATUSES.includes(status)
}

/** "25m" → "25 min", "2h" → "2 hr", "3d" → "3 days": the chip's unit, in prose. */
export function spellDuration(compact: string): string {
  const match = /^(\d+)([mhd])$/.exec(compact.trim())
  if (!match) return compact
  const n = Number(match[1])
  switch (match[2]) {
    case 'm': return `${n} min`
    case 'h': return `${n} hr`
    default: return n === 1 ? '1 day' : `${n} days`
  }
}

/**
 * The clock, in words. While the work runs it is the live countdown — green
 * with time to spare, amber inside the last half hour, red once late — and if
 * the task was picked up late, that verdict rides along, because a green
 * countdown on its own would read as "all fine" when the pick-up deadline was
 * already missed. Once the work has stopped (submitted or closed) only the
 * stamped verdict shows: there is no clock left to count.
 */
export function clockSignals(task: SignalInput, nowMs = Date.now()): Signal[] {
  const out: Signal[] = []
  const due = isRunning(task.status) ? runningDueAt(task) : null
  const countdown = due ? dueIn(due, nowMs) : null
  if (due && countdown) {
    const at = formatClockTime(due)
    const amount = countdown.label.replace(/ (left|over)$/, '')
    if (countdown.overdue) {
      out.push({ kind: 'clock', heat: 'late', label: `${amount} late`, detail: `Late by ${spellDuration(amount)}. It was due at ${at}.`, icon: ClockAlertIcon })
    }
    else {
      const soon = Date.parse(due) - nowMs <= DUE_SOON_MS
      out.push({ kind: 'clock', heat: soon ? 'soon' : 'ok', label: `${amount} left`, detail: `${spellDuration(amount)} left. Due at ${at}.`, icon: ClockIcon })
    }
    if (task.responseSlaStatus === 'BREACHED') {
      out.push({ kind: 'verdict', heat: 'late', label: 'Picked up late', detail: 'It was picked up after its pick-up deadline.', icon: ClockAlertIcon })
    }
    return out
  }
  if (task.resolutionSlaStatus === 'BREACHED') {
    const finished = task.status === 'FINISHED' || task.status === 'VERIFIED' || task.status === 'SUBMITTED'
    out.push({ kind: 'verdict', heat: 'late', label: finished ? 'Finished late' : 'Late', detail: 'It missed its finish deadline.', icon: ClockAlertIcon })
  }
  else if (task.responseSlaStatus === 'BREACHED') {
    out.push({ kind: 'verdict', heat: 'late', label: 'Picked up late', detail: 'It was picked up after its pick-up deadline.', icon: ClockAlertIcon })
  }
  else if (slaState(task) === 'ON_TIME' && !isRunning(task.status)) {
    out.push({ kind: 'verdict', heat: 'ok', label: 'On time', detail: 'It met its deadlines.', icon: CheckIcon })
  }
  return out
}

/**
 * Priority: a flame for Urgent (the one that cannot wait), a flag for High, a
 * down arrow for Low. Normal is the default and carries no chip at all.
 */
export function prioritySignal(priority: TaskPriority): Signal | null {
  switch (priority) {
    case 'URGENT':
      return { kind: 'priority', heat: 'late', label: 'Urgent', detail: 'Marked urgent: do this one first.', icon: FlameIcon }
    case 'HIGH':
      return { kind: 'priority', heat: 'soon', label: 'High priority', detail: 'Marked high priority.', icon: FlagIcon }
    case 'LOW':
      return { kind: 'priority', heat: 'none', label: 'Low priority', detail: 'Marked low priority: it can wait.', icon: ArrowDownIcon }
    default:
      return null
  }
}

/**
 * The policy stepped in. `level` is the highest step that fired, not a count
 * (steps are independent), so the chip names the level — the escalation
 * card's and the API's own word — rather than saying "times".
 */
export function escalationSignal(level: number): Signal | null {
  if (!(level > 0)) return null
  return {
    kind: 'escalation',
    heat: 'late',
    label: level >= 2 ? `Escalated · level ${level}` : 'Escalated',
    detail: level >= 2
      ? `The escalation policy has stepped in, up to level ${level}.`
      : 'The escalation policy has stepped in.',
    icon: SirenIcon,
  }
}

/** Every signal on a task, hottest reason first within its kind order: clock, verdict, escalation, priority. */
export function taskSignals(task: SignalInput, nowMs = Date.now()): Signal[] {
  const out = clockSignals(task, nowMs)
  const escalation = escalationSignal(task.escalationLevel)
  if (escalation) out.push(escalation)
  const priority = prioritySignal(task.priority)
  if (priority) out.push(priority)
  return out
}

/**
 * The card's traffic light: the hottest signal while the work is running.
 * Submitted and closed work needs no one's hurry, so it carries none — the
 * verdict chip still says how it went.
 */
export function taskHeat(task: SignalInput, nowMs = Date.now()): Heat {
  if (!isRunning(task.status)) return 'none'
  return taskSignals(task, nowMs).reduce<Heat>((heat, signal) => hotter(heat, signal.heat), 'none')
}

/** Sort key: hottest first, then priority, then oldest first. */
export function compareByHeat(a: SignalInput & { createdAt: string }, b: SignalInput & { createdAt: string }, nowMs = Date.now()): number {
  const byHeat = HEAT_RANK[taskHeat(b, nowMs)] - HEAT_RANK[taskHeat(a, nowMs)]
  if (byHeat) return byHeat
  const byPriority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
  if (byPriority) return byPriority
  return a.createdAt.localeCompare(b.createdAt)
}

export const PRIORITY_RANK: Record<TaskPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 }

/** The two SLA clocks, in the words staff use. */
export const CLOCK_WORDS = { response: 'Pick up by', resolution: 'Finish by' } as const

// ── Lifecycle status ─────────────────────────────────────────────────────────
//
// Its own icon and a neutral or brand tone each, never the traffic light.
// Blue is "someone is on it", green is "done", grey is "nothing happening".

export interface StatusSignal {
  /** Plain word on screen. */
  label: string
  /** The API's own term, for a tooltip where it differs. */
  term: string
  icon: Component
  /** Tinted chip: fill plus text. */
  chip: string
  /** Solid dot, for board columns and timeline nodes. */
  dot: string
}

export const STATUS_SIGNAL: Record<TaskStatus, StatusSignal> = {
  NEW: { label: 'New', term: 'New', icon: CircleDashedIcon, chip: 'bg-neutral-tint text-neutral-tint-foreground', dot: 'bg-muted-foreground/50' },
  IN_PROGRESS: { label: 'In progress', term: 'In progress', icon: PlayIcon, chip: 'bg-primary-tint text-primary-tint-foreground', dot: 'bg-primary' },
  SUBMITTED: { label: 'In review', term: 'Submitted', icon: EyeIcon, chip: 'bg-primary-tint text-primary-tint-foreground', dot: 'bg-primary/60' },
  PENDING: { label: 'On hold', term: 'Pending', icon: PauseIcon, chip: 'bg-neutral-tint text-neutral-tint-foreground', dot: 'bg-muted-foreground/70' },
  FINISHED: { label: 'Finished', term: 'Finished', icon: CheckIcon, chip: 'bg-success-tint text-success-tint-foreground', dot: 'bg-success/70' },
  VERIFIED: { label: 'Verified', term: 'Verified', icon: CheckCheckIcon, chip: 'bg-success-tint text-success-tint-foreground', dot: 'bg-success' },
  CANCELLED: { label: 'Cancelled', term: 'Cancelled', icon: BanIcon, chip: 'bg-neutral-tint text-neutral-tint-foreground', dot: 'bg-muted-foreground/40' },
}

export function statusSignal(status: TaskStatus): StatusSignal {
  return STATUS_SIGNAL[status] ?? STATUS_SIGNAL.NEW
}
