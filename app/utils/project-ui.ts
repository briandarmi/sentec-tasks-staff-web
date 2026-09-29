import type { ProjectLevel, ProjectStatus } from '~/utils/clientFakeApi'

// Presentation for projects (feat/projects). Same token discipline as
// task-ui: semantic classes only, so light and dark both resolve.

export interface ProjectStatusMeta {
  label: string
  dot: string
  badge: string
}

export const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED']

export const PROJECT_STATUS_META: Record<ProjectStatus, ProjectStatusMeta> = {
  ACTIVE: { label: 'Active', dot: 'bg-primary', badge: 'bg-primary/10 text-primary' },
  COMPLETED: { label: 'Completed', dot: 'bg-success', badge: 'bg-success/15 text-success' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-destructive', badge: 'bg-destructive/10 text-destructive' },
}

export function projectStatusMeta(status: ProjectStatus): ProjectStatusMeta {
  return PROJECT_STATUS_META[status] ?? PROJECT_STATUS_META.ACTIVE
}

export const PROJECT_LEVEL_LABEL: Record<ProjectLevel, string> = {
  MANAGER: 'Manager',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
}

export function projectLevelLabel(level: ProjectLevel | null | undefined): string {
  return level ? PROJECT_LEVEL_LABEL[level] ?? level : ''
}

/**
 * What the viewer may do on a project page. `myLevel` is null for a
 * non-member admin, who still holds every manager right; the API enforces
 * all of it — this only decides what to show.
 */
export function projectRights(input: { myLevel: ProjectLevel | null | undefined, isAdmin: boolean, canCreateTask: boolean, status: ProjectStatus }) {
  const manages = input.isAdmin || input.myLevel === 'MANAGER'
  const isMember = manages || input.myLevel === 'MEMBER'
  const active = input.status === 'ACTIVE'
  return {
    /** Edit, complete, cancel, reopen, hand over, members, add/remove tasks. */
    manages,
    /** Manager, admin, or a member with create-task — and only while the project is active. */
    canCreateTask: active && (manages || (input.myLevel === 'MEMBER' && input.canCreateTask)),
    /** Members and managers may comment on project tasks; viewers may not. */
    canComment: isMember,
    /** Membership changes 422 on a closed project. */
    canEditMembers: manages && active,
  }
}
