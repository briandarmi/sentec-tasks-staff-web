import { describe, expect, it } from 'vitest'
import { CHECKLIST_CLOSED_STATUSES, checklistAccess, checklistProgress } from '~/utils/checklist-access'
import type { ChecklistViewer } from '~/utils/checklist-access'
import { TASK_STATUSES } from '~/utils/clientFakeApi'

// The checklist card's cosmetic gates, pinned to the feat/projects rules:
//   done   — step assignee, task assignee, helpers, dept leader, admin, manager
//   edit   — admin, dept leader, task assignee, project manager
//   closed — FINISHED / VERIFIED / CANCELLED refuse everything; SUBMITTED does not.

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const plain: ChecklistViewer = { userId: ME, role: 'staff', isAssignee: false, isHelper: false, projectLevel: null }
const ownStep = { assignedStaffId: ME }
const someoneElsesStep = { assignedStaffId: OTHER }
const freeStep = { assignedStaffId: null }

describe('closed tasks', () => {
  it('names exactly the three closed statuses', () => {
    expect([...CHECKLIST_CLOSED_STATUSES].sort()).toEqual(['CANCELLED', 'FINISHED', 'VERIFIED'])
  })

  it('hides every control once the task is closed, whoever is looking', () => {
    for (const status of ['FINISHED', 'VERIFIED', 'CANCELLED'] as const) {
      const access = checklistAccess(status, { ...plain, role: 'admin', isAssignee: true, isHelper: true, projectLevel: 'MANAGER' })
      expect(access.closed).toBe(true)
      expect(access.canManage).toBe(false)
      expect(access.canTick(ownStep)).toBe(false)
      expect(access.canEditAny([ownStep, freeStep])).toBe(false)
    }
  })

  it('still takes edits while SUBMITTED, and in every other open state', () => {
    for (const status of TASK_STATUSES.filter(s => !CHECKLIST_CLOSED_STATUSES.has(s))) {
      expect(checklistAccess(status, { ...plain, isAssignee: true }).canManage).toBe(true)
    }
  })
})

describe('who may manage steps (add / remove / assign)', () => {
  it('the task assignee, a leader, an admin and the project manager', () => {
    expect(checklistAccess('NEW', { ...plain, isAssignee: true }).canManage).toBe(true)
    expect(checklistAccess('NEW', { ...plain, role: 'leader' }).canManage).toBe(true)
    expect(checklistAccess('NEW', { ...plain, role: 'admin' }).canManage).toBe(true)
    expect(checklistAccess('NEW', { ...plain, projectLevel: 'MANAGER' }).canManage).toBe(true)
  })

  it('not a helper, a project member or viewer, or a step assignee', () => {
    expect(checklistAccess('IN_PROGRESS', { ...plain, isHelper: true }).canManage).toBe(false)
    expect(checklistAccess('IN_PROGRESS', { ...plain, projectLevel: 'MEMBER' }).canManage).toBe(false)
    expect(checklistAccess('IN_PROGRESS', { ...plain, projectLevel: 'VIEWER' }).canManage).toBe(false)
    expect(checklistAccess('IN_PROGRESS', plain).canManage).toBe(false)
  })
})

describe('who may tick a step', () => {
  it('a helper may tick any step but manage none', () => {
    const access = checklistAccess('IN_PROGRESS', { ...plain, isHelper: true })
    expect(access.canTick(freeStep)).toBe(true)
    expect(access.canTick(someoneElsesStep)).toBe(true)
    expect(access.canManage).toBe(false)
    expect(access.canEditAny([freeStep])).toBe(true)
  })

  it('a step assignee may tick their own step only — read-only otherwise', () => {
    const access = checklistAccess('NEW', plain)
    expect(access.canTick(ownStep)).toBe(true)
    expect(access.canTick(someoneElsesStep)).toBe(false)
    expect(access.canTick(freeStep)).toBe(false)
    expect(access.canManage).toBe(false)
    expect(access.canEditAny([someoneElsesStep, freeStep])).toBe(false)
    expect(access.canEditAny([someoneElsesStep, ownStep])).toBe(true)
  })

  it('a plain staff member who is none of those sees a read-only list', () => {
    const access = checklistAccess('NEW', plain)
    expect(access.canEditAny([freeStep, someoneElsesStep])).toBe(false)
  })

  it('anyone who may manage may also tick', () => {
    for (const viewer of [{ ...plain, isAssignee: true }, { ...plain, role: 'leader' as const }, { ...plain, projectLevel: 'MANAGER' as const }]) {
      expect(checklistAccess('NEW', viewer).canTick(someoneElsesStep)).toBe(true)
    }
  })

  it('never matches a step against a missing viewer id', () => {
    const access = checklistAccess('NEW', { ...plain, userId: null })
    expect(access.canTick({ assignedStaffId: null })).toBe(false)
  })
})

describe('progress', () => {
  it('counts done over total', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 })
    expect(checklistProgress([{ isDone: true }, { isDone: false }, { isDone: true }])).toEqual({ done: 2, total: 3 })
  })
})
