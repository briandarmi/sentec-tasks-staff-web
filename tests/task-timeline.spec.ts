import { describe, expect, it } from 'vitest'
import type { TaskHistory } from '~/utils/clientFakeApi'
import { buildTaskTimeline, formatAxisTime, formatDuration } from '~/utils/task-timeline'

// Geometry of the graphical timeline, pinned so a phase or marker landing in
// the wrong place is a failing test rather than a squint at a screenshot.

const T0 = Date.parse('2026-08-25T02:30:00.000Z')
const min = (n: number) => T0 + n * 60_000
const iso = (n: number) => new Date(min(n)).toISOString()

function row(status: string, atMin: number, seq: number): TaskHistory {
  return { id: `h${seq}`, hotelRef: 'hotel', taskId: 'task', staffId: null, status, description: null, seq, createdAt: iso(atMin) }
}

function fixture(overrides: Partial<Parameters<typeof buildTaskTimeline>[0]> = {}) {
  return {
    status: 'NEW' as const,
    activationDate: iso(0),
    createdAt: iso(0),
    history: null,
    responseDueAt: iso(15),
    resolutionDueAt: iso(60),
    dueAt: null,
    responseSlaStatus: 'EMPTY' as const,
    resolutionSlaStatus: 'EMPTY' as const,
    ...overrides,
  }
}

describe('buildTaskTimeline', () => {
  it('synthesises the NEW phase from activation when a dispatch wrote no history', () => {
    const model = buildTaskTimeline(fixture(), min(10))!
    expect(model.start).toBe(min(0))
    // Open and early: the axis runs out to the furthest target, not just to now.
    expect(model.end).toBe(min(60))
    expect(model.phases).toHaveLength(1)
    expect(model.phases[0]).toMatchObject({ status: 'NEW', left: 0, minutes: 10, current: true })
    expect(model.phases[0]!.width).toBeCloseTo((10 / 60) * 100)
    expect(model.markers.map(m => m.kind)).toEqual(['response', 'resolution', 'now'])
    expect(model.markers.find(m => m.kind === 'response')!.left).toBeCloseTo(25)
    expect(model.scheduled).toBe(false)
  })

  it('draws one phase per status entered, the current one running to now', () => {
    const model = buildTaskTimeline(fixture({
      status: 'IN_PROGRESS',
      history: [row('NEW', 0, 1), row('IN_PROGRESS', 6, 2)],
      responseSlaStatus: 'ON_TIME',
    }), min(30))!
    expect(model.phases.map(p => [p.status, p.minutes, p.current])).toEqual([
      ['NEW', 6, false],
      ['IN_PROGRESS', 24, true],
    ])
    expect(model.markers.find(m => m.kind === 'response')!.verdict).toBe('ON_TIME')
  })

  it('treats a closing status as a moment: no phase, no now marker, axis stops at the close', () => {
    const model = buildTaskTimeline(fixture({
      status: 'FINISHED',
      history: [row('NEW', 0, 1), row('IN_PROGRESS', 5, 2), row('SUBMITTED', 40, 3), row('FINISHED', 45, 4)],
      responseSlaStatus: 'ON_TIME',
      resolutionSlaStatus: 'ON_TIME',
    }), min(500))!
    expect(model.phases.map(p => p.status)).toEqual(['NEW', 'IN_PROGRESS', 'SUBMITTED'])
    expect(model.phases.every(p => !p.current)).toBe(true)
    expect(model.markers.some(m => m.kind === 'now')).toBe(false)
    // The resolution target (60) lies beyond the close (45), so it still bounds the axis.
    expect(model.end).toBe(min(60))
  })

  it('runs the axis past the targets when open work is late, pinning now at the right edge', () => {
    const model = buildTaskTimeline(fixture({
      status: 'IN_PROGRESS',
      history: [row('IN_PROGRESS', 20, 1)],
      responseSlaStatus: 'BREACHED',
    }), min(120))!
    expect(model.end).toBe(min(120))
    expect(model.markers.find(m => m.kind === 'now')!.left).toBe(100)
    expect(model.markers.find(m => m.kind === 'resolution')!.left).toBe(50)
    // No NEW row was written, so NEW is synthesised from activation up to the claim.
    expect(model.phases[0]).toMatchObject({ status: 'NEW', minutes: 20 })
  })

  it('shows an empty track while activation is still ahead', () => {
    const model = buildTaskTimeline(fixture(), min(-30))!
    expect(model.scheduled).toBe(true)
    expect(model.phases).toEqual([])
    expect(model.markers.some(m => m.kind === 'now')).toBe(false)
  })

  it('orders by seq and skips rows with a status it cannot draw', () => {
    const model = buildTaskTimeline(fixture({
      status: 'PENDING',
      history: [row('PENDING', 10, 3), row('MYSTERY', 5, 2), row('NEW', 0, 1)],
    }), min(20))!
    expect(model.phases.map(p => p.status)).toEqual(['NEW', 'PENDING'])
  })

  it('includes the explicit due date as its own marker, without a verdict', () => {
    const model = buildTaskTimeline(fixture({ dueAt: iso(90) }), min(10))!
    expect(model.end).toBe(min(90))
    expect(model.markers.find(m => m.kind === 'due')).toMatchObject({ left: 100, verdict: null })
  })

  it('returns null when there is no usable start time', () => {
    expect(buildTaskTimeline(fixture({ activationDate: 'nonsense', createdAt: 'nonsense' }), min(0))).toBeNull()
  })
})

describe('formatDuration', () => {
  it('scales units with the length', () => {
    expect(formatDuration(0)).toBe('<1m')
    expect(formatDuration(6)).toBe('6m')
    expect(formatDuration(80)).toBe('1h 20m')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(27 * 60)).toBe('1d 3h')
    expect(formatDuration(48 * 60)).toBe('2d')
  })
})

describe('formatAxisTime', () => {
  it('adds the day only once the axis spans a day or more', () => {
    const noon = new Date(2026, 7, 25, 12, 5).getTime()
    expect(formatAxisTime(noon, 60 * 60_000)).toBe('12:05')
    // Day/month order is the runtime locale's business; the day, the month and
    // the clock time must all be present.
    const withDay = formatAxisTime(noon, 36 * 60 * 60_000)
    expect(withDay).toContain('25')
    expect(withDay).toContain('Aug')
    expect(withDay).toMatch(/12:05$/)
  })
})
