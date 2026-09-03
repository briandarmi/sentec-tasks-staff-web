import { describe, expect, it } from 'vitest'
import {
  CLAIMABLE_STATUSES,
  OPEN_STATUSES,
  TASK_PRIORITIES,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  displayName,
  dueIn,
  dueLabel,
  formatClockTime,
  initials,
  isClaimable,
  isOpen,
  priorityMeta,
  relativeTime,
  runningDueAt,
  slaAccent,
  slaState,
  statusMeta,
  taskRef,
} from '~/utils/task-ui'
import { TASK_STATUSES } from '~/utils/clientFakeApi'

// Presentation helpers, pinned so a rename or colour change is a deliberate act.

describe('status metadata', () => {
  it('covers every one of the API\'s seven statuses', () => {
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_META[status]).toBeDefined()
      expect(statusMeta(status).label.length).toBeGreaterThan(0)
    }
  })

  it('uses only semantic colour tokens, never literals', () => {
    const all = [
      ...Object.values(TASK_STATUS_META).flatMap(m => [m.dot, m.badge]),
      ...Object.values(TASK_PRIORITY_META).map(m => m.badge),
    ].join(' ')
    expect(all).not.toMatch(/#|rgb|hsl/)
  })

  it('keeps SUBMITTED open (attention moved to the reviewer) and unclaimable', () => {
    expect(OPEN_STATUSES).toContain('SUBMITTED')
    expect(isOpen('SUBMITTED')).toBe(true)
    expect(CLAIMABLE_STATUSES).toEqual(['NEW', 'IN_PROGRESS'])
    expect(isClaimable('SUBMITTED')).toBe(false)
  })

  it('orders priorities least → most urgent', () => {
    expect(TASK_PRIORITIES).toEqual(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
    expect(priorityMeta('URGENT').label).toBe('Urgent')
  })
})

describe('SLA presentation', () => {
  it('shows the worse of the two clocks', () => {
    expect(slaState({ responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED' })).toBe('BREACHED')
    expect(slaState({ responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'EMPTY' })).toBe('ON_TIME')
    expect(slaState({ responseSlaStatus: 'EMPTY', resolutionSlaStatus: 'EMPTY' })).toBe('EMPTY')
  })

  it('maps the accent stripe to the state', () => {
    expect(slaAccent({ responseSlaStatus: 'BREACHED', resolutionSlaStatus: 'EMPTY' })).toBe('border-l-destructive')
    expect(slaAccent({ responseSlaStatus: 'EMPTY', resolutionSlaStatus: 'EMPTY' })).toBe('border-l-transparent')
  })

  it('counts down toward a due date and flips to overdue', () => {
    const now = Date.parse('2026-08-25T03:00:00.000Z')
    expect(dueIn('2026-08-25T03:30:00.000Z', now)).toMatchObject({ overdue: false })
    expect(dueIn('2026-08-25T02:30:00.000Z', now)).toMatchObject({ overdue: true })
    expect(dueIn(null, now)).toBeNull()
  })

  it('runs the response clock until pickup, the resolution clock while worked, none once submitted', () => {
    const clocks = { responseDueAt: '2026-08-25T03:30:00.000Z', resolutionDueAt: '2026-08-25T05:00:00.000Z' }
    expect(runningDueAt({ status: 'NEW', ...clocks })).toBe(clocks.responseDueAt)
    expect(runningDueAt({ status: 'IN_PROGRESS', ...clocks })).toBe(clocks.resolutionDueAt)
    expect(runningDueAt({ status: 'PENDING', ...clocks })).toBe(clocks.resolutionDueAt)
    expect(runningDueAt({ status: 'SUBMITTED', ...clocks })).toBeNull()
    expect(runningDueAt({ status: 'FINISHED', ...clocks })).toBeNull()
    expect(runningDueAt({ status: 'NEW', resolutionDueAt: clocks.resolutionDueAt })).toBeNull()
  })

  it('labels a due time by urgency: countdown, amber inside 30 minutes, "due HH:MM · over" once breached', () => {
    const now = Date.parse('2026-08-25T03:00:00.000Z')
    expect(dueLabel('2026-08-25T05:00:00.000Z', now)).toEqual({ label: '2h left', tone: 'ok' })
    expect(dueLabel('2026-08-25T03:20:00.000Z', now)).toEqual({ label: '20m left', tone: 'soon' })
    expect(dueLabel('2026-08-25T03:30:00.000Z', now)?.tone).toBe('soon')
    const late = dueLabel('2026-08-25T02:35:00.000Z', now)!
    expect(late.tone).toBe('breached')
    expect(late.label).toBe(`due ${formatClockTime('2026-08-25T02:35:00.000Z')} · 25m over`)
    expect(dueLabel(null, now)).toBeNull()
  })

  it('formats a wall-clock time and never says "Invalid Date"', () => {
    // Built from the Date's local getters, like the helper, so the expectation
    // holds in every host time zone (the dev host is not in WIB).
    const iso = '2026-08-25T03:07:00.000Z'
    const date = new Date(iso)
    expect(formatClockTime(iso)).toBe(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
    expect(formatClockTime(iso)).toMatch(/^\d{2}:\d{2}$/)
    expect(formatClockTime(null)).toBe('—')
    expect(formatClockTime('not a date')).toBe('—')
  })
})

describe('people and references (single-name model)', () => {
  it('derives initials from one display-name field', () => {
    expect(initials('Budi Santoso')).toBe('BS')
    expect(initials('Cher')).toBe('C')
    expect(initials('  ')).toBe('?')
    expect(initials(null)).toBe('?')
  })

  it('never fabricates a name for a null staffName', () => {
    expect(displayName('Sari Dewi')).toBe('Sari Dewi')
    expect(displayName(null)).toBe('Team member')
    expect(displayName('', 'System')).toBe('System')
  })

  it('renders a short human reference from a UUID', () => {
    expect(taskRef('a1b2c3d4-0000-4000-8000-000000000001')).toBe('TSK-A1B2C3D4')
  })

  it('formats relative time compactly', () => {
    const now = Date.parse('2026-08-25T03:00:00.000Z')
    expect(relativeTime('2026-08-25T02:59:40.000Z', now)).toBe('just now')
    expect(relativeTime('2026-08-25T02:00:00.000Z', now)).toBe('1h ago')
  })
})
