import { describe, expect, it } from 'vitest'
import {
  CLOCK_WORDS,
  HEAT_RANK,
  HEAT_TONE,
  STATUS_SIGNAL,
  clockSignals,
  compareByHeat,
  escalationSignal,
  hotter,
  isRunning,
  prioritySignal,
  spellDuration,
  statusSignal,
  taskHeat,
  taskSignals,
} from '~/utils/task-signals'
import type { SignalInput } from '~/utils/task-signals'
import { TASK_STATUSES } from '~/utils/clientFakeApi'

// The one traffic light: red, amber and green mean only "how urgently", and
// the icon says why. Pinned so a colour or a word changes on purpose.

const NOW = Date.parse('2026-10-08T06:00:00.000Z')

function task(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    escalationLevel: 0,
    responseSlaStatus: 'EMPTY',
    resolutionSlaStatus: 'EMPTY',
    responseDueAt: null,
    resolutionDueAt: null,
    ...overrides,
  }
}

const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString()

describe('heat', () => {
  it('ranks late over soon over ok over none', () => {
    expect(hotter('soon', 'late')).toBe('late')
    expect(hotter('ok', 'soon')).toBe('soon')
    expect(hotter('none', 'ok')).toBe('ok')
    expect(HEAT_RANK.late).toBeGreaterThan(HEAT_RANK.soon)
  })

  it('uses semantic tokens only, never literals', () => {
    const all = Object.values(HEAT_TONE).flatMap(t => [t.chip, t.edge, t.text, t.band, t.solid]).join(' ')
    expect(all).not.toMatch(/#|rgb|hsl/)
  })

  it('follows the live clock while the work runs', () => {
    expect(taskHeat(task({ resolutionDueAt: inMinutes(90) }), NOW)).toBe('ok')
    expect(taskHeat(task({ resolutionDueAt: inMinutes(20) }), NOW)).toBe('soon')
    expect(taskHeat(task({ resolutionDueAt: inMinutes(-5) }), NOW)).toBe('late')
  })

  it('is raised by priority and by escalation', () => {
    expect(taskHeat(task({ priority: 'HIGH' }), NOW)).toBe('soon')
    expect(taskHeat(task({ priority: 'URGENT' }), NOW)).toBe('late')
    expect(taskHeat(task({ escalationLevel: 1 }), NOW)).toBe('late')
    // Low priority never cools a task that the clock says is hot.
    expect(taskHeat(task({ priority: 'LOW', resolutionDueAt: inMinutes(-5) }), NOW)).toBe('late')
  })

  it('is none once the work has stopped, whatever the verdict', () => {
    expect(taskHeat(task({ status: 'SUBMITTED', resolutionSlaStatus: 'BREACHED', priority: 'URGENT' }), NOW)).toBe('none')
    expect(taskHeat(task({ status: 'VERIFIED', priority: 'URGENT' }), NOW)).toBe('none')
    expect(taskHeat(task({ status: 'CANCELLED', escalationLevel: 3 }), NOW)).toBe('none')
    expect(isRunning('PENDING')).toBe(true)
    expect(isRunning('SUBMITTED')).toBe(false)
  })

  it('sorts hottest first, then by priority, then oldest first', () => {
    const rows = [
      { ...task({ priority: 'HIGH' }), createdAt: '2026-10-08T05:00:00.000Z' },
      { ...task({ resolutionDueAt: inMinutes(-1) }), createdAt: '2026-10-08T05:30:00.000Z' },
      { ...task(), createdAt: '2026-10-08T04:00:00.000Z' },
      { ...task(), createdAt: '2026-10-08T03:00:00.000Z' },
    ]
    const sorted = [...rows].sort((a, b) => compareByHeat(a, b, NOW)).map(r => r.createdAt)
    expect(sorted).toEqual([
      '2026-10-08T05:30:00.000Z',
      '2026-10-08T05:00:00.000Z',
      '2026-10-08T03:00:00.000Z',
      '2026-10-08T04:00:00.000Z',
    ])
  })
})

describe('the clock in words', () => {
  it('counts down in green, turns amber inside the last half hour, red once late', () => {
    expect(clockSignals(task({ resolutionDueAt: inMinutes(90) }), NOW)[0]).toMatchObject({ kind: 'clock', heat: 'ok', label: '2h left' })
    expect(clockSignals(task({ resolutionDueAt: inMinutes(12) }), NOW)[0]).toMatchObject({ kind: 'clock', heat: 'soon', label: '12m left' })
    const late = clockSignals(task({ resolutionDueAt: inMinutes(-25) }), NOW)[0]!
    expect(late).toMatchObject({ kind: 'clock', heat: 'late', label: '25m late' })
    expect(late.detail).toMatch(/^Late by 25 min\. It was due at \d\d:\d\d\.$/)
  })

  it('runs the pick-up clock before claim and the finish clock after', () => {
    const fresh = task({ status: 'NEW', responseDueAt: inMinutes(10), resolutionDueAt: inMinutes(60) })
    expect(clockSignals(fresh, NOW)[0]!.label).toBe('10m left')
    const claimed = task({ status: 'IN_PROGRESS', responseDueAt: inMinutes(10), resolutionDueAt: inMinutes(60) })
    expect(clockSignals(claimed, NOW)[0]!.label).toBe('1h left')
  })

  it('adds "Picked up late" beside a running countdown when that already happened', () => {
    const rows = clockSignals(task({ responseSlaStatus: 'BREACHED', resolutionDueAt: inMinutes(40) }), NOW)
    expect(rows.map(r => r.label)).toEqual(['40m left', 'Picked up late'])
    expect(rows[1]).toMatchObject({ kind: 'verdict', heat: 'late' })
  })

  it('shows only the stamped verdict once the work has stopped', () => {
    expect(clockSignals(task({ status: 'SUBMITTED', resolutionSlaStatus: 'BREACHED', resolutionDueAt: inMinutes(30) }), NOW))
      .toEqual([expect.objectContaining({ kind: 'verdict', heat: 'late', label: 'Finished late' })])
    expect(clockSignals(task({ status: 'CANCELLED', responseSlaStatus: 'BREACHED' }), NOW))
      .toEqual([expect.objectContaining({ heat: 'late', label: 'Picked up late' })])
    expect(clockSignals(task({ status: 'VERIFIED', responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME' }), NOW))
      .toEqual([expect.objectContaining({ heat: 'ok', label: 'On time' })])
    expect(clockSignals(task({ status: 'FINISHED' }), NOW)).toEqual([])
  })

  it('says nothing for a running task with no clock', () => {
    expect(clockSignals(task(), NOW)).toEqual([])
    expect(clockSignals(task({ responseSlaStatus: 'ON_TIME' }), NOW)).toEqual([])
  })

  it('spells the chip unit out in prose', () => {
    expect(spellDuration('25m')).toBe('25 min')
    expect(spellDuration('2h')).toBe('2 hr')
    expect(spellDuration('1d')).toBe('1 day')
    expect(spellDuration('3d')).toBe('3 days')
  })

  it('names the two clocks in plain words', () => {
    expect(CLOCK_WORDS).toEqual({ response: 'Pick up by', resolution: 'Finish by' })
  })
})

describe('priority and escalation', () => {
  it('flags urgent red, high amber, low grey and normal not at all', () => {
    expect(prioritySignal('URGENT')).toMatchObject({ heat: 'late', label: 'Urgent' })
    expect(prioritySignal('HIGH')).toMatchObject({ heat: 'soon', label: 'High priority' })
    expect(prioritySignal('LOW')).toMatchObject({ heat: 'none', label: 'Low priority' })
    expect(prioritySignal('NORMAL')).toBeNull()
  })

  it('names the escalation level rather than counting', () => {
    expect(escalationSignal(0)).toBeNull()
    expect(escalationSignal(1)).toMatchObject({ heat: 'late', label: 'Escalated' })
    expect(escalationSignal(3)).toMatchObject({ heat: 'late', label: 'Escalated · level 3' })
  })

  it('lists clock, verdict, escalation, priority in that order', () => {
    const rows = taskSignals(task({ responseSlaStatus: 'BREACHED', resolutionDueAt: inMinutes(5), escalationLevel: 2, priority: 'URGENT' }), NOW)
    expect(rows.map(r => r.kind)).toEqual(['clock', 'verdict', 'escalation', 'priority'])
  })
})

describe('lifecycle status', () => {
  it('covers every one of the API\'s seven statuses with an icon and a plain word', () => {
    for (const status of TASK_STATUSES) {
      const meta = STATUS_SIGNAL[status]
      expect(meta).toBeDefined()
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.icon).toBeTruthy()
      expect(statusSignal(status)).toBe(meta)
    }
  })

  it('never borrows the traffic light: cancelled and on hold are grey', () => {
    for (const status of TASK_STATUSES) {
      const classes = `${STATUS_SIGNAL[status].chip} ${STATUS_SIGNAL[status].dot}`
      expect(classes).not.toMatch(/danger|destructive|warning/)
    }
    expect(STATUS_SIGNAL.CANCELLED.chip).toContain('neutral-tint')
  })

  it('calls a submitted task "In review" and keeps the API term for the tooltip', () => {
    expect(STATUS_SIGNAL.SUBMITTED).toMatchObject({ label: 'In review', term: 'Submitted' })
  })

  it('uses semantic tokens only, never literals', () => {
    const all = Object.values(STATUS_SIGNAL).flatMap(m => [m.chip, m.dot]).join(' ')
    expect(all).not.toMatch(/#|rgb|hsl/)
  })
})
