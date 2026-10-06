import type { EscalationActionType, EscalationSkipReason, EscalationTriggerKind, TaskHistory, TaskPriority } from '~/utils/clientFakeApi'
import { TASK_PRIORITIES } from '~/utils/task-ui'

// Presentation for task escalation (feat/escalation). The worker records
// each applied step as data (trigger, what changed, what it skipped); these
// turn that into the plain words the card and the pills show. Pure, so a
// wording change is a deliberate act with a failing test behind it.

/** One `applied` entry of a TaskEscalation record. */
export interface EscalationApplied {
  type: EscalationActionType
  before: string
  after: string
}

/** One `skipped` entry of a TaskEscalation record. */
export interface EscalationSkipped {
  type: EscalationActionType
  reason: EscalationSkipReason
}

export type RefKind = 'staff' | 'team' | 'department' | 'priority' | 'none'

export interface ParsedRef {
  kind: RefKind
  /** The id behind a staff/team/department ref, the priority code, or '' for none. */
  id: string
}

/** The timeline actor for rows the worker wrote (task_history.staff_id NULL). */
export const ESCALATION_ACTOR = 'Escalation'

/** Trigger wording, word for word what the API writes into history (task/escalate.go). */
const TRIGGER_LABEL: Record<EscalationTriggerKind, (value: number) => string> = {
  RESPONSE_OVERDUE: value => `response overdue ${value} min`,
  PERCENT_OF_RESOLUTION: value => `${value}% of resolution time`,
  RESOLUTION_OVERDUE: value => `resolution overdue ${value} min`,
  UNASSIGNED_FOR: value => `unassigned for ${value} min`,
}

export function triggerLabel(kind: EscalationTriggerKind, value: number): string {
  return TRIGGER_LABEL[kind]?.(value) ?? `${kind} ${value}`
}

/** The action by name, for a skipped line: "Priority bump skipped — …". */
const ACTION_NAME: Record<EscalationActionType, string> = {
  bumpPriority: 'Priority bump',
  reassign: 'Reassign',
  routeToDepartment: 'Move to another department',
}

export function actionName(type: EscalationActionType): string {
  return ACTION_NAME[type] ?? type
}

/**
 * `before`/`after` on an applied action: a priority code for bumpPriority,
 * `staff:<id>` / `team:<id>` / `department:<id>` for the targeting actions,
 * '' when there was nothing (an unassigned task being reassigned).
 */
export function parseRef(ref: string): ParsedRef {
  if (!ref) return { kind: 'none', id: '' }
  const colon = ref.indexOf(':')
  if (colon > 0) {
    const prefix = ref.slice(0, colon)
    if (prefix === 'staff' || prefix === 'team' || prefix === 'department') return { kind: prefix, id: ref.slice(colon + 1) }
  }
  if (TASK_PRIORITIES.includes(ref as TaskPriority)) return { kind: 'priority', id: ref }
  return { kind: 'none', id: ref }
}

/**
 * Looks a staff/team/department ref up by name. Returns null when the name is
 * not to hand — the label then falls back to "a colleague" / "a team".
 */
export type RefNameResolver = (ref: ParsedRef) => string | null

/**
 * One applied action as a line. Without a resolver the target is named by
 * kind ("Reassigned to team"); with one it is named by name when the resolver
 * knows it, and by a plain noun ("a colleague", "a team") when it does not.
 */
export function actionLabel(applied: EscalationApplied, resolve?: RefNameResolver): string {
  switch (applied.type) {
    case 'bumpPriority':
      return `Priority ${applied.before} → ${applied.after}`
    case 'reassign': {
      const target = parseRef(applied.after)
      if (target.kind === 'team') return `Reassigned to ${resolve ? resolve(target) ?? 'a team' : 'team'}`
      if (target.kind === 'staff') return `Reassigned to ${resolve ? resolve(target) ?? 'a colleague' : 'staff'}`
      return 'Reassigned'
    }
    case 'routeToDepartment': {
      const target = parseRef(applied.after)
      const name = resolve && target.kind === 'department' ? resolve(target) : null
      return name ? `Moved to ${name}` : 'Moved to another department'
    }
    default:
      return applied.type
  }
}

/** Why a step's action did nothing, in plain words. */
export function skipLabel(skipped: EscalationSkipped): string {
  switch (skipped.reason) {
    case 'no_change':
      return skipped.type === 'bumpPriority' ? 'already at the top priority' : 'nothing to change'
    case 'target_invalid':
      return 'target no longer valid'
    case 'not_configured':
      return 'not configured'
    default:
      return 'nothing to change'
  }
}

/** "Level N" — the step's sort + 1, as the API counts it. */
export function levelLabel(level: number): string {
  return `Level ${level}`
}

/**
 * History rows the worker wrote: no staff behind them, and a description the
 * API opens with "Escalated (". Everything else with a nil staffId is some
 * other system or partner action.
 */
export function isEscalationHistoryRow(row: Pick<TaskHistory, 'staffId' | 'description'>): boolean {
  return row.staffId === null && (row.description?.startsWith('Escalated (') ?? false)
}
