import { useSession } from '~/composables/useSession'
import type {
  AssignableStaff,
  Board,
  BoardColumn,
  Category,
  CatalogItem,
  Collaborator,
  HotelDepartment,
  InboxOffer,
  Location,
  LocationType,
  MasterDepartment,
  OperatingException,
  OperatingSchedule,
  OperatingWindow,
  Partner,
  RoutingRule,
  Sla,
  SourceApp,
  Staff,
  Task,
  TaskAttachment,
  TaskComment,
  TaskContextEntry,
  TaskDetail,
  TaskListItem,
  TaskOffer,
  TaskPriority,
  TaskStatus,
  Team,
  Tenant,
  TenantGroup,
} from '~/utils/clientFakeApi'

/**
 * Typed client for the Sentec Tasks API — paths, methods and shapes are the
 * real contract (openapi @ 0c8e1bd). Every call goes through
 * `useSession().request`, which injects the session cookie, the CSRF echo and
 * the X-Hotel-Id scope. Nothing here takes a role as an argument: the server
 * decides what the caller may do, and the UI only decides what to ask for.
 */

export interface ListMeta {
  total: number
  nextCursor?: string
}

export interface TaskQuery {
  status?: TaskStatus | ''
  responseSlaStatus?: string
  resolutionSlaStatus?: string
  columnId?: string
  departmentId?: string
  itemRef?: string
  assignedStaffId?: string
  roomNumber?: string
  createdFrom?: string
  createdTo?: string
  sort?: 'createdAt' | 'status' | 'id' | 'responseDueAt' | 'resolutionDueAt'
  order?: 'asc' | 'desc'
  limit?: number
  cursor?: string | null
  helping?: '1'
}

/** What POST /v1/tasks/staff-create and /v1/tasks/preview accept. One shape for both. */
export interface StaffCreateTaskPayload {
  title: string
  description?: string | null
  notes?: string | null
  roomNumber?: string | null
  quantity?: number | null
  activationDate?: string | null
  dueAt?: string | null
  priority?: TaskPriority | null
  itemRef?: string | null
  locationRef?: string | null
  requesterName?: string | null
  checklistLabels?: string[]
  assignee?: { assigneeKind: 'STAFF' | 'TEAM' | 'UNASSIGNED', assigneeStaffId?: string, assigneeTeamId?: string }
}

export interface TaskPreview {
  task: Task
  checklistLabels: string[]
}

export interface BoardColumnEdit {
  id?: string
  name?: string
  description?: string | null
  columnSort?: number
  status?: TaskStatus
  isRemoved?: boolean
}

export interface GroupStats {
  groupId: string
  tenants: Array<{ hotelRef: string, name: string, byStatus: Record<TaskStatus, number>, responseBreached: number, resolutionBreached: number, openTotal: number }>
  totals: { byStatus: Record<TaskStatus, number>, responseBreached: number, resolutionBreached: number, openTotal: number }
}

function clean(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}

export function useTasksApi() {
  const session = useSession()
  const req = session.request

  return {
    // ── tasks ─────────────────────────────────────────────────────────────────
    async listTasks(query: TaskQuery = {}) {
      const env = await req<TaskListItem[] | null>('/v1/tasks', { query: clean(query as Record<string, unknown>) })
      return { data: env.data ?? [], meta: (env.meta ?? { total: 0 }) as unknown as ListMeta }
    },
    async getTask(id: string) {
      return (await req<TaskDetail>(`/v1/tasks/${id}`)).data
    },
    async getTaskContext(id: string) {
      return (await req<TaskContextEntry[]>(`/v1/tasks/${id}/context`)).data
    },
    async createTask(payload: StaffCreateTaskPayload) {
      return (await req<TaskListItem>('/v1/tasks/staff-create', { method: 'POST', body: payload })).data
    },
    async previewTask(payload: StaffCreateTaskPayload) {
      const env = await req<TaskPreview>('/v1/tasks/preview', { method: 'POST', body: payload })
      return { data: env.data, warnings: ((env.meta as { warnings?: string[] | null } | null)?.warnings ?? null) }
    },
    async claimTask(taskId: string) {
      return (await req<TaskDetail>('/v1/tasks/claim', { method: 'POST', body: { taskId } })).data
    },
    async assignTask(payload: { taskId: string, staffId: string, remark?: string | null }) {
      return (await req<TaskDetail>('/v1/tasks/assign', { method: 'POST', body: payload })).data
    },
    async moveTask(payload: { taskId: string, columnId: string, description?: string | null }) {
      return (await req<TaskDetail>('/v1/tasks/status', { method: 'PATCH', body: payload })).data
    },
    async returnTask(taskId: string, reason: string) {
      return (await req<TaskDetail>('/v1/tasks/return', { method: 'POST', body: { taskId, reason } })).data
    },
    async submitTask(payload: { taskId: string, completionNote?: string | null, attachmentIds?: string[] }) {
      return (await req<TaskDetail>('/v1/tasks/submit', { method: 'POST', body: payload })).data
    },
    async reviewTask(payload: { taskId: string, decision: 'APPROVE' | 'REQUEST_CHANGES', note?: string | null }) {
      return (await req<TaskDetail>('/v1/tasks/review', { method: 'POST', body: payload })).data
    },
    /** Leader-of-the-task's-department only among humans — the API refuses admins. */
    async updateTask(payload: { taskId: string, title?: string | null, description?: string | null, roomNumber?: string | null }) {
      return (await req<TaskListItem>('/v1/tasks/update', { method: 'PATCH', body: payload })).data
    },
    async addComment(payload: { taskId: string, comment: string }) {
      return (await req<TaskComment>('/v1/tasks/comments', { method: 'POST', body: payload })).data
    },

    // ── offers ────────────────────────────────────────────────────────────────
    async sendOffer(payload: { taskId: string, toStaffId: string, note?: string | null }) {
      return (await req<TaskOffer>('/v1/tasks/offers', { method: 'POST', body: payload })).data
    },
    async listOffers() {
      return (await req<InboxOffer[] | null>('/v1/offers')).data ?? []
    },
    async acceptOffer(offerId: string) {
      return (await req<TaskDetail>('/v1/offers/accept', { method: 'POST', body: { offerId } })).data
    },
    async declineOffer(offerId: string) {
      return (await req<TaskOffer>('/v1/offers/decline', { method: 'POST', body: { offerId } })).data
    },
    async cancelOffer(offerId: string) {
      return (await req<TaskOffer>('/v1/offers/cancel', { method: 'POST', body: { offerId } })).data
    },

    // ── helpers ───────────────────────────────────────────────────────────────
    async addHelper(payload: { taskId: string, staffId: string }) {
      return (await req<Collaborator>('/v1/tasks/collaborators', { method: 'POST', body: payload })).data
    },
    async removeHelper(payload: { taskId: string, staffId: string }) {
      await req('/v1/tasks/collaborators/remove', { method: 'POST', body: payload })
    },

    // ── attachments + uploads ─────────────────────────────────────────────────
    async presignUpload(payload: { filename: string, contentType: string, sizeBytes: number }) {
      return (await req<{ uploadUrl: string, storageKey: string, expiresAt: string }>('/v1/uploads', { method: 'POST', body: payload })).data
    },
    async createAttachment(payload: { taskId: string, filetype: 'PHOTO' | 'PDF', url?: string, storageKey?: string }) {
      return (await req<TaskAttachment>('/v1/tasks/attachments', { method: 'POST', body: payload })).data
    },
    async setAttachmentRemoved(payload: { id: string, taskId: string, filetype: 'PHOTO' | 'PDF', isRemoved: boolean }) {
      return (await req<TaskAttachment>('/v1/tasks/attachments', { method: 'POST', body: payload })).data
    },

    // ── board ─────────────────────────────────────────────────────────────────
    async getKanbanBoard() {
      const env = await req<Board & { columns: BoardColumn[] | null }>('/v1/kanban-board')
      return { ...env.data, columns: env.data.columns ?? [] }
    },
    async editKanbanBoard(columns: BoardColumnEdit[]) {
      const env = await req<Board & { columns: BoardColumn[] | null }>('/v1/kanban-board', { method: 'PATCH', body: { columns } })
      return {
        board: { ...env.data, columns: env.data.columns ?? [] },
        warnings: ((env.meta as { warnings?: string[] } | null)?.warnings ?? []),
      }
    },

    // ── staff ─────────────────────────────────────────────────────────────────
    async listAssignableStaff(departmentId?: string | null) {
      return (await req<AssignableStaff[]>('/v1/staff/assignable', { query: clean({ departmentId }) })).data
    },
    async listStaff() {
      return (await req<Staff[]>('/v1/staff')).data
    },
    async createStaff(payload: { email: string, name: string, password: string, role: 'staff' | 'leader', hotels: string[], hotelDepartmentId?: string | null, createTask?: boolean }) {
      return (await req<Staff>('/v1/staff', { method: 'POST', body: payload })).data
    },
    async updateStaff(id: string, payload: { name?: string, role?: 'staff' | 'leader' | 'admin', hotelDepartmentId?: string | null, createTask?: boolean, isActive?: boolean }) {
      return (await req<Staff>(`/v1/staff/${id}`, { method: 'PATCH', body: payload })).data
    },
    async grantGroupAccess(staffId: string, groupId: string) {
      await req(`/v1/staff/${staffId}/group-grants/${groupId}`, { method: 'PUT' })
    },
    async revokeGroupAccess(staffId: string, groupId: string) {
      await req(`/v1/staff/${staffId}/group-grants/${groupId}`, { method: 'DELETE' })
    },

    // ── departments ───────────────────────────────────────────────────────────
    async listMasterDepartments() {
      return (await req<MasterDepartment[]>('/v1/departments')).data
    },
    async listHotelDepartments() {
      return (await req<HotelDepartment[]>('/v1/hotel-departments')).data
    },
    async enableHotelDepartment(hotelRef: string, departmentId: string) {
      return (await req<HotelDepartment>('/v1/hotel-departments', { method: 'POST', body: { hotelRef, departmentId } })).data
    },

    // ── catalog ───────────────────────────────────────────────────────────────
    async listCatalogItems(includeInactive = false) {
      return (await req<CatalogItem[]>('/v1/catalog-items', { query: includeInactive ? { includeInactive: 'true' } : {} })).data
    },
    async upsertCatalogItem(payload: Partial<CatalogItem> & { name: string }) {
      return (await req<CatalogItem>('/v1/catalog-items', { method: 'POST', body: payload })).data
    },
    async listCategories() {
      return (await req<Category[]>('/v1/categories')).data
    },
    async upsertCategory(payload: Partial<Category> & { name: string, code: string }) {
      return (await req<Category>('/v1/categories', { method: 'POST', body: payload })).data
    },

    // ── locations ─────────────────────────────────────────────────────────────
    async listLocationTypes() {
      return (await req<LocationType[]>('/v1/location-types')).data
    },
    async upsertLocationType(payload: Partial<LocationType> & { name: string, code: string }) {
      return (await req<LocationType>('/v1/location-types', { method: 'POST', body: payload })).data
    },
    async listLocations(locationTypeId?: string) {
      return (await req<Location[]>('/v1/locations', { query: clean({ locationTypeId }) })).data
    },
    async upsertLocation(payload: Partial<Location> & { name: string, code: string, locationTypeId: string }) {
      return (await req<Location>('/v1/locations', { method: 'POST', body: payload })).data
    },

    // ── teams ─────────────────────────────────────────────────────────────────
    async listTeams() {
      return (await req<Team[]>('/v1/teams')).data
    },
    async upsertTeam(payload: Partial<Team> & { name: string }) {
      return (await req<Team>('/v1/teams', { method: 'POST', body: payload })).data
    },
    async listTeamMembers(teamId: string) {
      return (await req<string[]>(`/v1/teams/${teamId}/members`)).data
    },
    async addTeamMember(teamId: string, staffId: string) {
      await req(`/v1/teams/${teamId}/members/${staffId}`, { method: 'PUT' })
    },
    async removeTeamMember(teamId: string, staffId: string) {
      await req(`/v1/teams/${teamId}/members/${staffId}`, { method: 'DELETE' })
    },

    // ── SLAs + routing ────────────────────────────────────────────────────────
    async listSlas() {
      return (await req<Sla[]>('/v1/slas')).data
    },
    async upsertSla(payload: { id?: string | null, name: string, responseTime: number, resolutionTime: number, isDefault?: boolean }) {
      return (await req<Sla>('/v1/slas', { method: 'POST', body: payload })).data
    },
    async listRoutingRules() {
      return (await req<RoutingRule[]>('/v1/routing-rules')).data
    },
    /** Natural-key idempotent PUT: at most one matcher; none at all = catch-all. */
    async upsertRoutingRule(payload: { itemRef?: string | null, categoryId?: string | null, locationTypeId?: string | null, priority?: TaskPriority | null, departmentId: string, slaId: string, remark?: string | null }) {
      return (await req<RoutingRule>('/v1/routing-rules', { method: 'PUT', body: payload })).data
    },
    async deleteRoutingRule(id: string) {
      await req(`/v1/routing-rules/id/${id}`, { method: 'DELETE' })
    },

    // ── schedules + terminology ───────────────────────────────────────────────
    async listOperatingSchedules() {
      return (await req<OperatingSchedule[]>('/v1/operating-schedules')).data
    },
    async upsertOperatingSchedule(payload: { id?: string | null, name: string, isDefault?: boolean, hotelDepartmentId?: string | null, windows: OperatingWindow[], exceptions: OperatingException[] }) {
      return (await req<OperatingSchedule>('/v1/operating-schedules', { method: 'POST', body: payload })).data
    },
    async getTerminology() {
      return (await req<Record<string, string>>('/v1/terminology')).data
    },
    async setTerminologyTerm(key: string, value: string) {
      return (await req<Record<string, string>>('/v1/terminology', { method: 'PATCH', body: { key, value } })).data
    },

    // ── source apps ───────────────────────────────────────────────────────────
    async listSourceApps() {
      return (await req<SourceApp[]>('/v1/source-apps')).data
    },
    async upsertSourceApp(payload: SourceApp) {
      return (await req<SourceApp>('/v1/platform/source-apps', { method: 'POST', body: payload })).data
    },

    // ── platform (operator) ───────────────────────────────────────────────────
    async listTenants() {
      return (await req<Tenant[]>('/v1/platform/tenants')).data
    },
    async provisionTenant(payload: { hotelRef: string, name: string }) {
      return (await req<Tenant>('/v1/platform/tenants', { method: 'POST', body: payload })).data
    },
    /** The 201 body is the ONLY place the temporary password ever appears. */
    async createFirstAdmin(hotelRef: string, payload: { email: string, name: string }) {
      return (await req<Staff & { temporaryPassword: string }>(`/v1/platform/tenants/${hotelRef}/first-admin`, { method: 'POST', body: payload })).data
    },
    async listTenantGroups() {
      return (await req<Array<TenantGroup & { tenants: Array<{ hotelRef: string, name: string }> }>>('/v1/platform/tenant-groups')).data
    },
    async createTenantGroup(name: string) {
      return (await req<TenantGroup>('/v1/platform/tenant-groups', { method: 'POST', body: { name } })).data
    },
    async renameTenantGroup(id: string, name: string) {
      return (await req<TenantGroup>(`/v1/platform/tenant-groups/${id}`, { method: 'PATCH', body: { name } })).data
    },
    async addTenantToGroup(groupId: string, hotelRef: string) {
      await req(`/v1/platform/tenant-groups/${groupId}/tenants/${hotelRef}`, { method: 'PUT' })
    },
    async removeTenantFromGroup(groupId: string, hotelRef: string) {
      await req(`/v1/platform/tenant-groups/${groupId}/tenants/${hotelRef}`, { method: 'DELETE' })
    },
    async listPartners() {
      return (await req<Partner[]>('/v1/platform/partners')).data
    },
    /** The 201 body is the ONLY response that ever carries the secret. */
    async registerPartner(name: string) {
      return (await req<Partner & { secret: string }>('/v1/platform/partners', { method: 'POST', body: { name } })).data
    },
    async setPartnerActive(id: string, isActive: boolean) {
      return (await req<Partner>(`/v1/platform/partners/${id}`, { method: 'PATCH', body: { isActive } })).data
    },

    // ── group reports ─────────────────────────────────────────────────────────
    async getGroupStats(groupId: string) {
      return (await req<GroupStats>(`/v1/groups/${groupId}/stats`)).data
    },
    async listGroupTasks(groupId: string, query: TaskQuery = {}) {
      const env = await req<TaskListItem[] | null>(`/v1/groups/${groupId}/tasks`, { query: clean(query as Record<string, unknown>) })
      return { data: env.data ?? [], meta: (env.meta ?? { total: 0 }) as unknown as ListMeta }
    },
  }
}
