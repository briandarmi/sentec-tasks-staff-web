import type { SlaStatus, SourceApp, TaskStatus } from '~/utils/clientFakeApi'
import { DUE_SOON_MS, runningDueAt, slaState } from '~/utils/task-ui'

// Pure grouping for the task list's "Group by source" view: one lane per
// originating app, most urgent lane first. Kept free of Vue so it unit-tests
// without mounting anything.

/** The lane an unregistered or retired source code falls into. */
export const OTHER_LANE_KEY = '__other'
export const OTHER_LANE_LABEL = 'Other'

export interface LaneTask {
  sourceProduct: string
  status: TaskStatus
  responseSlaStatus: SlaStatus
  resolutionSlaStatus: SlaStatus
  responseDueAt?: string | null
  resolutionDueAt?: string | null
}

export interface Lane<T extends LaneTask> {
  key: string
  label: string
  /** The registry colour — data, not a theme token — or null for the Other lane. */
  color: string | null
  tasks: T[]
}

export type LaneUrgency = 0 | 1 | 2

/**
 * 0 = something in the lane is breached (a stamped verdict, or a running clock
 * already past due), 1 = something is due within DUE_SOON_MS, 2 = calm.
 */
export function laneUrgency(tasks: LaneTask[], nowMs: number): LaneUrgency {
  let urgency: LaneUrgency = 2
  for (const task of tasks) {
    if (slaState(task) === 'BREACHED') return 0
    const due = runningDueAt(task)
    if (!due) continue
    const remaining = Date.parse(due) - nowMs
    if (Number.isNaN(remaining)) continue
    if (remaining < 0) return 0
    if (remaining <= DUE_SOON_MS) urgency = 1
  }
  return urgency
}

/**
 * A manager opens the grouped view to find fires, so a lane holding a breached
 * task leads, then lanes with something due soon, then the rest. Ties break on
 * lane size (bigger first), then label, so the order is stable between renders
 * and never depends on the fetch order of the rows.
 */
export function groupIntoLanes<T extends LaneTask>(
  tasks: T[],
  byCode: Map<string, Pick<SourceApp, 'shortName' | 'color'>>,
  nowMs = Date.now(),
): Lane<T>[] {
  const lanes = new Map<string, Lane<T>>()
  for (const task of tasks) {
    const app = byCode.get(task.sourceProduct)
    const key = app ? task.sourceProduct : OTHER_LANE_KEY
    let lane = lanes.get(key)
    if (!lane) {
      lane = { key, label: app?.shortName ?? OTHER_LANE_LABEL, color: app?.color ?? null, tasks: [] }
      lanes.set(key, lane)
    }
    lane.tasks.push(task)
  }
  const urgency = new Map([...lanes.values()].map(lane => [lane.key, laneUrgency(lane.tasks, nowMs)]))
  return [...lanes.values()].sort((a, b) =>
    urgency.get(a.key)! - urgency.get(b.key)!
    || b.tasks.length - a.tasks.length
    || a.label.localeCompare(b.label),
  )
}
