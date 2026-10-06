import { describe, expect, it } from 'vitest'
import { ESCALATION_TRIGGER_KINDS, escalationDescription } from '~/utils/clientFakeApi'
import {
  ESCALATION_ACTOR,
  actionLabel,
  actionName,
  isEscalationHistoryRow,
  levelLabel,
  parseRef,
  skipLabel,
  triggerLabel,
} from '~/utils/escalation-ui'

// Plain-words presentation of task escalation records (feat/escalation).
// The API writes the history wording; these pin what the card, the pills and
// the timeline SHOW so a copy change is deliberate.

describe('triggerLabel', () => {
  it('uses the API\'s own wording for each trigger kind', () => {
    expect(triggerLabel('RESPONSE_OVERDUE', 0)).toBe('response overdue 0 min')
    expect(triggerLabel('PERCENT_OF_RESOLUTION', 50)).toBe('50% of resolution time')
    expect(triggerLabel('RESOLUTION_OVERDUE', 15)).toBe('resolution overdue 15 min')
    expect(triggerLabel('UNASSIGNED_FOR', 30)).toBe('unassigned for 30 min')
  })

  it('agrees with the history row the worker writes, for every kind', () => {
    for (const kind of ESCALATION_TRIGGER_KINDS) {
      const row = escalationDescription({ level: 1, trigger: { kind, value: 7 }, applied: [], skipped: [] })
      expect(row).toContain(triggerLabel(kind, 7))
    }
  })

  it('falls back to the raw kind rather than hiding an unknown trigger', () => {
    expect(triggerLabel('SOMETHING_NEW' as never, 3)).toBe('SOMETHING_NEW 3')
  })
})

describe('parseRef', () => {
  it('splits the targeting refs on their prefix', () => {
    expect(parseRef('staff:abc')).toEqual({ kind: 'staff', id: 'abc' })
    expect(parseRef('team:t-1')).toEqual({ kind: 'team', id: 't-1' })
    expect(parseRef('department:d-9')).toEqual({ kind: 'department', id: 'd-9' })
  })

  it('reads a bare priority code as a priority', () => {
    for (const code of ['LOW', 'NORMAL', 'HIGH', 'URGENT']) expect(parseRef(code)).toEqual({ kind: 'priority', id: code })
  })

  it('treats the empty string as no target and keeps anything unknown as-is', () => {
    expect(parseRef('')).toEqual({ kind: 'none', id: '' })
    expect(parseRef('mystery:1')).toEqual({ kind: 'none', id: 'mystery:1' })
  })
})

describe('actionLabel', () => {
  it('shows a priority bump as before → after', () => {
    expect(actionLabel({ type: 'bumpPriority', before: 'NORMAL', after: 'HIGH' })).toBe('Priority NORMAL → HIGH')
  })

  it('names the reassignment target by kind without a resolver', () => {
    expect(actionLabel({ type: 'reassign', before: '', after: 'team:t-1' })).toBe('Reassigned to team')
    expect(actionLabel({ type: 'reassign', before: 'staff:a', after: 'staff:b' })).toBe('Reassigned to staff')
    expect(actionLabel({ type: 'reassign', before: 'staff:a', after: '' })).toBe('Reassigned')
    expect(actionLabel({ type: 'routeToDepartment', before: 'department:d-1', after: 'department:d-2' })).toBe('Moved to another department')
  })

  it('names the target when the resolver knows it, and falls back to a plain noun when it does not', () => {
    const known = (ref: { kind: string, id: string }) => (ref.id === 'known' ? 'Agus' : null)
    expect(actionLabel({ type: 'reassign', before: '', after: 'staff:known' }, known)).toBe('Reassigned to Agus')
    expect(actionLabel({ type: 'reassign', before: '', after: 'staff:other' }, known)).toBe('Reassigned to a colleague')
    expect(actionLabel({ type: 'reassign', before: '', after: 'team:known' }, known)).toBe('Reassigned to Agus')
    expect(actionLabel({ type: 'reassign', before: '', after: 'team:other' }, known)).toBe('Reassigned to a team')
    expect(actionLabel({ type: 'routeToDepartment', before: '', after: 'department:known' }, known)).toBe('Moved to Agus')
    expect(actionLabel({ type: 'routeToDepartment', before: '', after: 'department:other' }, known)).toBe('Moved to another department')
  })
})

describe('skipLabel + actionName', () => {
  it('says why the step did nothing, in plain words', () => {
    expect(skipLabel({ type: 'bumpPriority', reason: 'no_change' })).toBe('already at the top priority')
    expect(skipLabel({ type: 'reassign', reason: 'no_change' })).toBe('nothing to change')
    expect(skipLabel({ type: 'reassign', reason: 'target_invalid' })).toBe('target no longer valid')
    expect(skipLabel({ type: 'routeToDepartment', reason: 'not_configured' })).toBe('not configured')
    expect(skipLabel({ type: 'bumpPriority', reason: 'later' as never })).toBe('nothing to change')
  })

  it('names each action for the skipped line', () => {
    expect(actionName('bumpPriority')).toBe('Priority bump')
    expect(actionName('reassign')).toBe('Reassign')
    expect(actionName('routeToDepartment')).toBe('Move to another department')
  })
})

describe('levelLabel', () => {
  it('reads "Level N"', () => {
    expect(levelLabel(1)).toBe('Level 1')
    expect(levelLabel(10)).toBe('Level 10')
  })
})

describe('isEscalationHistoryRow', () => {
  it('matches the rows the worker writes: no staff, description opening with "Escalated ("', () => {
    const description = escalationDescription({
      level: 3,
      trigger: { kind: 'RESOLUTION_OVERDUE', value: 0 },
      applied: [],
      skipped: [{ type: 'bumpPriority', reason: 'no_change' }],
    })
    expect(description).toBe('Escalated (level 3, resolution overdue 0 min). Skipped: bumpPriority (no_change).')
    expect(isEscalationHistoryRow({ staffId: null, description })).toBe(true)
    expect(ESCALATION_ACTOR).toBe('Escalation')
  })

  it('leaves other system rows and every human row alone', () => {
    expect(isEscalationHistoryRow({ staffId: null, description: null })).toBe(false)
    expect(isEscalationHistoryRow({ staffId: null, description: 'Dispatched by Butler' })).toBe(false)
    expect(isEscalationHistoryRow({ staffId: 'someone', description: 'Escalated (level 1, response overdue 0 min).' })).toBe(false)
  })
})
