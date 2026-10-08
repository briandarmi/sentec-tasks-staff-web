import type { Component } from 'vue'
import { BanIcon, CheckCheckIcon, PlayIcon } from '@lucide/vue'
import type { ProjectLevel, ProjectStatus } from '~/utils/clientFakeApi'

// Presentation for projects (feat/projects). Same token discipline as
// task-ui: semantic classes only, so light and dark both resolve — and the
// same rule as task-signals: lifecycle status never borrows the traffic
// light, so a cancelled project is grey, not red. "Late" is the one red
// thing a project card carries.

export interface ProjectStatusMeta {
  label: string
  icon: Component
  dot: string
  badge: string
}

export const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED']

export const PROJECT_STATUS_META: Record<ProjectStatus, ProjectStatusMeta> = {
  ACTIVE: { label: 'Active', icon: PlayIcon, dot: 'bg-primary', badge: 'bg-primary-tint text-primary-tint-foreground' },
  COMPLETED: { label: 'Completed', icon: CheckCheckIcon, dot: 'bg-success', badge: 'bg-success-tint text-success-tint-foreground' },
  CANCELLED: { label: 'Cancelled', icon: BanIcon, dot: 'bg-muted-foreground/40', badge: 'bg-neutral-tint text-neutral-tint-foreground' },
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
