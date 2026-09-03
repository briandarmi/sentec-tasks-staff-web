import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '~/utils/clientFakeApi'
import { OTHER_LANE_KEY, OTHER_LANE_LABEL, groupIntoLanes, laneUrgency } from '~/utils/source-lanes'

// The task list's "Group by source" view: lanes keyed by sourceProduct, labeled
// from the registry, ordered so a lane with a fire in it is on top.

const REGISTRY = new Map([
  ['sentec-pms', { shortName: 'PMS', color: '#059669' }],
  ['sentec-ems', { shortName: 'EMS', color: '#dc2626' }],
])
const now = Date.parse('2026-09-03T12:00:00.000Z')
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

function task(id: string, sourceProduct: string, dueInMinutes: number | null, status: TaskStatus = 'IN_PROGRESS') {
  return {
    id,
    sourceProduct,
    status,
    responseSlaStatus: 'EMPTY' as const,
    resolutionSlaStatus: 'EMPTY' as const,
    responseDueAt: null,
    resolutionDueAt: dueInMinutes === null ? null : at(dueInMinutes),
  }
}

describe('groupIntoLanes', () => {
  it('groups by sourceProduct with the registry\'s label and colour, keeping row order inside a lane', () => {
    const lanes = groupIntoLanes([task('a', 'sentec-pms', 600), task('b', 'sentec-pms', 600), task('c', 'sentec-ems', 600)], REGISTRY, now)
    expect(lanes.map(l => l.key).sort()).toEqual(['sentec-ems', 'sentec-pms'])
    const pms = lanes.find(l => l.key === 'sentec-pms')!
    expect(pms.tasks.map(t => t.id)).toEqual(['a', 'b'])
    expect(pms).toMatchObject({ label: 'PMS', color: '#059669' })
  })

  it('folds unregistered codes into one uncoloured Other lane', () => {
    const lanes = groupIntoLanes([task('a', 'mystery-app', 600), task('b', '', 600)], REGISTRY, now)
    expect(lanes).toHaveLength(1)
    expect(lanes[0]).toMatchObject({ key: OTHER_LANE_KEY, label: OTHER_LANE_LABEL, color: null })
    expect(lanes[0]!.tasks).toHaveLength(2)
  })

  it('puts the lane with a breached task first, then due-soon, then calm — even when calm is bigger', () => {
    const lanes = groupIntoLanes([
      task('ok1', 'sentec-pms', 600),
      task('ok2', 'sentec-pms', 600),
      task('ok3', 'sentec-pms', 600),
      task('late', 'sentec-ems', -5),
      task('soonish', 'mystery-app', 5),
    ], REGISTRY, now)
    expect(lanes.map(l => l.key)).toEqual(['sentec-ems', OTHER_LANE_KEY, 'sentec-pms'])
  })

  it('breaks urgency ties by lane size, then label', () => {
    const bySize = groupIntoLanes([task('a', 'sentec-pms', 600), task('b', 'sentec-ems', 600), task('c', 'sentec-ems', 600)], REGISTRY, now)
    expect(bySize.map(l => l.key)).toEqual(['sentec-ems', 'sentec-pms'])
    const byLabel = groupIntoLanes([task('a', 'sentec-pms', 600), task('b', 'sentec-ems', 600)], REGISTRY, now)
    expect(byLabel.map(l => l.label)).toEqual(['EMS', 'PMS'])
  })
})

describe('laneUrgency', () => {
  it('reads a stamped BREACHED verdict as a fire even with no clock running', () => {
    const submitted = { ...task('s', 'sentec-pms', null, 'SUBMITTED'), resolutionSlaStatus: 'BREACHED' as const }
    expect(laneUrgency([submitted], now)).toBe(0)
  })

  it('uses only the clock that is running: a NEW task counts down its response target', () => {
    const fresh = { ...task('n', 'sentec-pms', 600, 'NEW'), responseDueAt: at(-1) }
    expect(laneUrgency([fresh], now)).toBe(0)
    const calmNew = { ...task('n2', 'sentec-pms', -60, 'NEW'), responseDueAt: at(120) }
    expect(laneUrgency([calmNew], now)).toBe(2)
  })

  it('treats submitted and closed work as calm, and an empty lane as calm', () => {
    expect(laneUrgency([task('s', 'sentec-pms', -60, 'SUBMITTED'), task('f', 'sentec-pms', -60, 'FINISHED')], now)).toBe(2)
    expect(laneUrgency([], now)).toBe(2)
  })

  it('flags due-soon at exactly the 30-minute boundary and not a minute later', () => {
    expect(laneUrgency([task('a', 'sentec-pms', 30)], now)).toBe(1)
    expect(laneUrgency([task('b', 'sentec-pms', 31)], now)).toBe(2)
  })
})
