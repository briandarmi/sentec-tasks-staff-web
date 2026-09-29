import { describe, expect, it } from 'vitest'
import { PROJECT_LEVEL_LABEL, PROJECT_STATUSES, PROJECT_STATUS_META, projectLevelLabel, projectRights, projectStatusMeta } from '~/utils/project-ui'

// Presentation and cosmetic rights for projects (feat/projects). The API
// enforces everything; these pin what the screens SHOW so a copy change is
// deliberate.

describe('status metadata', () => {
  it('covers the three project statuses, one status per list call', () => {
    expect(PROJECT_STATUSES).toEqual(['ACTIVE', 'COMPLETED', 'CANCELLED'])
    for (const status of PROJECT_STATUSES) expect(PROJECT_STATUS_META[status].label).toBeTruthy()
  })

  it('falls back to ACTIVE for an unknown value from the wire', () => {
    expect(projectStatusMeta('SOMETHING' as never)).toBe(PROJECT_STATUS_META.ACTIVE)
  })

  it('names the three levels and nothing for a non-member', () => {
    expect(PROJECT_LEVEL_LABEL).toEqual({ MANAGER: 'Manager', MEMBER: 'Member', VIEWER: 'Viewer' })
    expect(projectLevelLabel(null)).toBe('')
    expect(projectLevelLabel(undefined)).toBe('')
  })
})

describe('project rights', () => {
  const base = { isAdmin: false, canCreateTask: false, status: 'ACTIVE' as const }

  it('the manager holds every right; so does a non-member admin (myLevel null)', () => {
    for (const input of [{ ...base, myLevel: 'MANAGER' as const }, { ...base, myLevel: null, isAdmin: true }]) {
      const rights = projectRights(input)
      expect(rights.manages).toBe(true)
      expect(rights.canCreateTask).toBe(true)
      expect(rights.canComment).toBe(true)
      expect(rights.canEditMembers).toBe(true)
    }
  })

  it('a member comments, and raises tasks only with create-task', () => {
    expect(projectRights({ ...base, myLevel: 'MEMBER' })).toEqual({ manages: false, canCreateTask: false, canComment: true, canEditMembers: false })
    expect(projectRights({ ...base, myLevel: 'MEMBER', canCreateTask: true }).canCreateTask).toBe(true)
  })

  it('a viewer neither comments nor creates', () => {
    expect(projectRights({ ...base, myLevel: 'VIEWER', canCreateTask: true })).toEqual({ manages: false, canCreateTask: false, canComment: false, canEditMembers: false })
  })

  it('a closed project takes no new tasks and no membership changes, but the manager keeps edit / reopen', () => {
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      const rights = projectRights({ ...base, myLevel: 'MANAGER', status })
      expect(rights.manages).toBe(true)
      expect(rights.canCreateTask).toBe(false)
      expect(rights.canEditMembers).toBe(false)
    }
  })
})
