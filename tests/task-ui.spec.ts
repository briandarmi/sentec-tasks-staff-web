import { describe, expect, it } from 'vitest'
import {
  OPEN_STATUSES,
  dueIn,
  formatMinutes,
  fullName,
  initials,
  isOpen,
  relativeTime,
  slaAccent,
  slaState,
  statusMeta,
  taskRef,
} from '~/utils/task-ui'
import type { SlaStatus } from '~/utils/clientFakeApi'

/** Build the SLA pair a task carries, for the worst-of tests below. */
function sla(response: SlaStatus, resolution: SlaStatus) {
  return { responseSlaStatus: response, resolutionSlaStatus: resolution }
}

describe('statusMeta', () => {
  it('labels every status a column can set', () => {
    expect(statusMeta('NEW').label).toBe('New')
    expect(statusMeta('IN_PROGRESS').label).toBe('In Progress')
    expect(statusMeta('PENDING').label).toBe('On Hold')
    expect(statusMeta('FINISHED').label).toBe('Finished')
    expect(statusMeta('VERIFIED').label).toBe('Verified')
    expect(statusMeta('CANCELLED').label).toBe('Cancelled')
  })

  it('uses design tokens rather than literal colours, so dark mode follows', () => {
    const classes = (['NEW', 'IN_PROGRESS', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED'] as const)
      .flatMap(status => [statusMeta(status).dot, statusMeta(status).badge])
      .join(' ')
    expect(classes).not.toMatch(/#[0-9a-f]{3,6}/i)
    expect(classes).not.toMatch(/\b(?:rgb|oklch|hsl)\(/)
  })

  it('falls back to New for an unrecognised status instead of crashing', () => {
    // A column pointed at a status this build does not know about must still render.
    expect(statusMeta('SOMETHING_ELSE' as never).label).toBe('New')
  })
})

describe('open vs closed', () => {
  it('treats work still needing attention as open', () => {
    expect(OPEN_STATUSES).toEqual(['NEW', 'IN_PROGRESS', 'PENDING'])
    expect(isOpen('NEW')).toBe(true)
    expect(isOpen('PENDING')).toBe(true)
    expect(isOpen('FINISHED')).toBe(false)
    expect(isOpen('CANCELLED')).toBe(false)
  })
})

describe('slaState — worst of the two clocks', () => {
  it('reports a breach even when the other clock was fine', () => {
    // Responded promptly, then took far too long: that is a breach, and showing
    // "On time" here would misreport the task.
    expect(slaState(sla('ON_TIME', 'BREACHED'))).toBe('BREACHED')
    expect(slaState(sla('BREACHED', 'ON_TIME'))).toBe('BREACHED')
    expect(slaState(sla('BREACHED', 'EMPTY'))).toBe('BREACHED')
  })

  it('reports on time when one clock has stopped cleanly and none breached', () => {
    expect(slaState(sla('ON_TIME', 'EMPTY'))).toBe('ON_TIME')
    expect(slaState(sla('EMPTY', 'ON_TIME'))).toBe('ON_TIME')
    expect(slaState(sla('ON_TIME', 'ON_TIME'))).toBe('ON_TIME')
  })

  it('reports nothing when neither clock has resolved yet', () => {
    expect(slaState(sla('EMPTY', 'EMPTY'))).toBe('EMPTY')
  })

  it('drives the card accent from the same decision', () => {
    expect(slaAccent(sla('ON_TIME', 'BREACHED'))).toContain('destructive')
    expect(slaAccent(sla('ON_TIME', 'EMPTY'))).toContain('success')
    expect(slaAccent(sla('EMPTY', 'EMPTY'))).toContain('transparent')
  })
})

describe('dueIn', () => {
  const now = Date.parse('2026-08-25T03:00:00.000Z')

  it('counts down while there is time left', () => {
    expect(dueIn('2026-08-25T03:12:00.000Z', now)).toEqual({ label: '12m left', overdue: false })
    expect(dueIn('2026-08-25T06:00:00.000Z', now)).toEqual({ label: '3h left', overdue: false })
    expect(dueIn('2026-08-27T03:00:00.000Z', now)).toEqual({ label: '2d left', overdue: false })
  })

  it('counts up once the target has passed', () => {
    expect(dueIn('2026-08-25T02:45:00.000Z', now)).toEqual({ label: '15m over', overdue: true })
    expect(dueIn('2026-08-25T01:00:00.000Z', now)).toEqual({ label: '2h over', overdue: true })
  })

  it('never rounds a live countdown down to zero', () => {
    // 20 seconds left is still "1m left", not "0m left" — which would read as
    // already late.
    expect(dueIn('2026-08-25T03:00:20.000Z', now)).toEqual({ label: '1m left', overdue: false })
  })

  it('returns nothing when there is no target, rather than inventing one', () => {
    expect(dueIn(null, now)).toBeNull()
    expect(dueIn('not a date', now)).toBeNull()
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-08-25T03:00:00.000Z')

  it('describes the recent past compactly', () => {
    expect(relativeTime('2026-08-25T02:59:30.000Z', now)).toBe('just now')
    expect(relativeTime('2026-08-25T02:30:00.000Z', now)).toBe('30m ago')
    expect(relativeTime('2026-08-25T00:00:00.000Z', now)).toBe('3h ago')
    expect(relativeTime('2026-08-20T03:00:00.000Z', now)).toBe('5d ago')
  })

  it('marks the future as such', () => {
    expect(relativeTime('2026-08-25T03:30:00.000Z', now)).toBe('in 30m')
  })

  it('falls back to a date once it is too far out to be useful', () => {
    expect(relativeTime('2026-01-01T03:00:00.000Z', now)).toMatch(/\d/)
    expect(relativeTime('2026-01-01T03:00:00.000Z', now)).not.toMatch(/ago/)
  })

  it('renders nothing for a missing or unparseable timestamp', () => {
    expect(relativeTime(null, now)).toBe('')
    expect(relativeTime(undefined, now)).toBe('')
    expect(relativeTime('nonsense', now)).toBe('')
  })
})

describe('names and references', () => {
  it('builds initials from both names', () => {
    expect(initials({ firstName: 'Budi', lastName: 'Santoso' })).toBe('BS')
  })

  it('survives a missing surname without producing undefined', () => {
    expect(initials({ firstName: 'Budi', lastName: '' })).toBe('B')
    expect(fullName({ firstName: 'Budi', lastName: '' })).toBe('Budi')
  })

  it('returns an empty string for nobody, so callers can fall back', () => {
    expect(fullName(null)).toBe('')
    expect(fullName(undefined)).toBe('')
  })

  it('shows a human task reference rather than a bare id', () => {
    expect(taskRef('42')).toBe('TSK-42')
  })
})

describe('formatMinutes', () => {
  it('reads naturally across the range an SLA can span', () => {
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(60)).toBe('1 hr')
    expect(formatMinutes(90)).toBe('1 hr 30 min')
    expect(formatMinutes(480)).toBe('8 hr')
  })
})
