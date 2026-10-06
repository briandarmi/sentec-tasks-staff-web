import { useSession } from '~/composables/useSession'
import type {
  AssignableStaff,
  Board,
  BoardColumn,
  Category,
  CatalogItem,
  ChecklistItem,
  Collaborator,
  EmsAddResult,
  EmsEmployee,
  EscalationPolicy,
  EscalationPolicyWrite,
  HotelDepartment,
  InboxOffer,
  Location,
  LocationType,
  MasterDepartment,
  OperatingException,
  OperatingSchedule,
  OperatingWindow,
  Partner,
  PartnerCapability,
  Project,
  ProjectMember,
  ProjectStatus,
  RoutingRule,
  Sla,
  SourceApp,
  Staff,
  StaffImportRowResult,
  Task,
  TaskAttachment,
  TaskComment,
  TaskContextEntry,
  TaskDetail,
  TaskEscalation,
  TaskListItem,
  TaskOffer,
  TaskPriority,
  TaskStatus,
  TaskTemplate,
  TaskTemplateContent,
  TaskTemplateRecurrence,
  TaskTimeAttribution,
  Team,
  Tenant,
  TenantGroup,
  TenantSyncLink,
} from '~/utils/clientFakeApi'

/**
 * Typed client for the Sentec Tasks API — paths, methods and shapes are the
 * real contract (master @ c3f52ad plus the feat/projects and sign-in
 * branches, per the 2026-09-28 frontend-impact notes, and the
 * refactor/ponytail-audit tip @ 1ee8c12: escalation policies, department CRUD,
 * EMS staff sync, partner capabilities, 2026-10-06). Every call goes through
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
  /** Admin or project member only; project tasks appear in the default list ONLY with this, assignedStaffId or helping. */
  projectId?: string
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
    /** `taskId` / `projectId` do not filter; they let the task's assignee or a project manager call this too. */
    async listAssignableStaff(departmentId?: string | null, context: { taskId?: string | null, projectId?: string | null } = {}) {
      return (await req<AssignableStaff[]>('/v1/staff/assignable', { query: clean({ departmentId, taskId: context.taskId, projectId: context.projectId }) })).data
    },
    /** Admin at the active hotel. `needsAttention` narrows to members whose membership here carries an EMS sync issue. */
    async listStaff(filter: { needsAttention?: boolean } = {}) {
      return (await req<Staff[]>('/v1/staff', { query: clean({ needsAttention: filter.needsAttention ? 'true' : undefined }) })).data
    },
    /**
     * DELETE /v1/staff/{id}/membership — remove a person from the ACTIVE
     * property only: their open work here goes back to its pool, their
     * helper/offer/checklist roles and team rows here are cleared. 204; 404
     * for a non-member; 409 for yourself, and for an EMS-linked member of an
     * EMS-mapped property ("remove this person in EMS").
     */
    async removeStaffFromProperty(id: string) {
      await req(`/v1/staff/${id}/membership`, { method: 'DELETE' })
    },

    // ── EMS staff sync (feat/ems-staff-sync) ──────────────────────────────────
    /**
     * The property's people in Sentec EMS, annotated with their `state` here.
     * Admin at the hotel. 422 "this property is not linked to EMS" when the
     * operator has not mapped it; 503 when EMS is down. `meta` is EMS's paging.
     */
    async listEmsEmployees(query: { q?: string, page?: number, pageSize?: number } = {}) {
      const env = await req<EmsEmployee[] | null>('/v1/ems/employees', { query: clean(query as Record<string, unknown>) })
      return { data: env.data ?? [], meta: (env.meta ?? { page: 1, pageSize: 50, total: 0 }) as unknown as { page: number, pageSize: number, total: number } }
    },
    /** Add 1-100 EMS employees here with one role and one create-task flag; one result per id (created/linked/granted/skipped/failed). */
    async addEmsEmployees(payload: { emsEmployeeIds: string[], role: 'staff' | 'leader' | 'admin', createTask: boolean }) {
      return (await req<EmsAddResult[] | null>('/v1/ems/employees', { method: 'POST', body: payload })).data ?? []
    },
    /**
     * 201 for a new account; 200 when the email already exists — then the
     * account is attached to the listed hotels and name/password are ignored.
     * 409 when already at one of those hotels or the account is deactivated.
     */
    async createStaff(payload: { email: string, name: string, password: string, role: 'staff' | 'leader', hotels: string[], hotelDepartmentId?: string | null, createTask?: boolean }) {
      const res = await session.requestRaw<Staff>('/v1/staff', { method: 'POST', body: payload })
      return { data: res.body!.data, attached: res.status === 200 }
    },
    /**
     * name and isActive are account-wide; role, hotelDepartmentId and
     * createTask need a hotel (the active one rides in X-Hotel-Id) and change
     * only that hotel's membership.
     */
    async updateStaff(id: string, payload: { name?: string, role?: 'staff' | 'leader' | 'admin', hotelDepartmentId?: string | null, createTask?: boolean, isActive?: boolean }) {
      return (await req<Staff>(`/v1/staff/${id}`, { method: 'PATCH', body: payload })).data
    },
    async grantGroupAccess(staffId: string, groupId: string) {
      await req(`/v1/staff/${staffId}/group-grants/${groupId}`, { method: 'PUT' })
    },
    async revokeGroupAccess(staffId: string, groupId: string) {
      await req(`/v1/staff/${staffId}/group-grants/${groupId}`, { method: 'DELETE' })
    },

    // ── departments (feat/department-crud) ────────────────────────────────────
    /** The master catalogue: admin at any property, operator or service. Includes retired masters (isActive false). */
    async listMasterDepartments() {
      return (await req<MasterDepartment[]>('/v1/departments')).data
    },
    async getMasterDepartment(id: string) {
      return (await req<MasterDepartment>(`/v1/departments/${id}`)).data
    },
    /** Platform admin (operator). `code`: 1-16 of A-Z 0-9 _, stored upper-case; `description` ≤ 500. 409 on a duplicate name or code. */
    async createMasterDepartment(payload: { name: string, code?: string | null, description?: string | null }) {
      return (await req<MasterDepartment>('/v1/departments', { method: 'POST', body: payload })).data
    },
    /** Platform admin. Omit a field to leave it; send "" to clear code/description (JSON null reads as "unchanged" server-side). */
    async updateMasterDepartment(id: string, payload: { name?: string, code?: string, description?: string, isActive?: boolean }) {
      return (await req<MasterDepartment>(`/v1/departments/${id}`, { method: 'PATCH', body: payload })).data
    },
    /** Platform admin. Hard delete, allowed only while no hotel has EVER used it; otherwise 409 "deactivate it instead". */
    async deleteMasterDepartment(id: string) {
      await req(`/v1/departments/${id}`, { method: 'DELETE' })
    },
    /** This property's rows, active and inactive; `masterIsActive` says whether a retired master is behind one. */
    async listHotelDepartments() {
      return (await req<HotelDepartment[]>('/v1/hotel-departments')).data
    },
    async getHotelDepartment(id: string) {
      return (await req<HotelDepartment>(`/v1/hotel-departments/${id}`)).data
    },
    /** 201 new, 200 existing (whatever its state). 422 "department is not available" for a retired master. */
    async enableHotelDepartment(hotelRef: string, departmentId: string) {
      return (await req<HotelDepartment>('/v1/hotel-departments', { method: 'POST', body: { hotelRef, departmentId } })).data
    },
    /**
     * The hotel's soft delete and its undo. Deactivating is refused (409) while
     * a routing rule or an escalation policy step still points here — the
     * message names both counts; reactivating is refused (422) once the
     * master is retired. Staff, teams and schedules keep an inactive one.
     */
    async setHotelDepartmentActive(id: string, isActive: boolean) {
      return (await req<HotelDepartment>(`/v1/hotel-departments/${id}`, { method: 'PATCH', body: { isActive } })).data
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
    /**
     * `escalationPolicyId` (feat/escalation): the key ABSENT keeps the stored
     * link, `null` clears it, a value must be an active policy of this hotel.
     * The form always sends it, so what is shown is what is saved.
     */
    async upsertSla(payload: { id?: string | null, name: string, responseTime: number, resolutionTime: number, isDefault?: boolean, escalationPolicyId?: string | null }) {
      return (await req<Sla>('/v1/slas', { method: 'POST', body: payload })).data
    },
    async listRoutingRules() {
      return (await req<RoutingRule[]>('/v1/routing-rules')).data
    },
    /** Natural-key idempotent PUT: at most one matcher; none at all = catch-all. `escalationPolicyId` as on SLAs: absent keeps, null clears. */
    async upsertRoutingRule(payload: { itemRef?: string | null, categoryId?: string | null, locationTypeId?: string | null, priority?: TaskPriority | null, departmentId: string, slaId: string, remark?: string | null, escalationPolicyId?: string | null }) {
      return (await req<RoutingRule>('/v1/routing-rules', { method: 'PUT', body: payload })).data
    },
    /** By id only — the old DELETE /v1/routing-rules/{itemRef} is gone from the API. */
    async deleteRoutingRule(id: string) {
      await req(`/v1/routing-rules/id/${id}`, { method: 'DELETE' })
    },

    // ── escalation policies (feat/escalation) ─────────────────────────────────
    /** Any actor of the hotel may read. Default first, then by name; live steps only, by sort. */
    async listEscalationPolicies() {
      return (await req<EscalationPolicy[] | null>('/v1/escalation-policies')).data ?? []
    },
    async getEscalationPolicy(id: string) {
      return (await req<EscalationPolicy>(`/v1/escalation-policies/${id}`)).data
    },
    /**
     * One POST upserts the policy AND its steps (admin at the hotel): a step
     * with an id updates that step, one without is created, a live step left
     * out of the request is removed. A new default demotes the old one.
     * `isActive` omitted means true on create and unchanged on update.
     */
    async upsertEscalationPolicy(payload: EscalationPolicyWrite) {
      return (await req<EscalationPolicy>('/v1/escalation-policies', { method: 'POST', body: payload })).data
    },
    /** GET /v1/tasks/{id}/escalations — the applied steps, oldest first; [] when it never escalated. Anyone who can open the task. */
    async listTaskEscalations(taskId: string) {
      return (await req<TaskEscalation[] | null>(`/v1/tasks/${taskId}/escalations`)).data ?? []
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
    /** The 201 body is the ONLY response that ever carries the secret. `capabilities`: what the partner may do beyond dispatch (staff_sync for EMS). */
    async registerPartner(name: string, capabilities: PartnerCapability[] = []) {
      return (await req<Partner & { secret: string }>('/v1/platform/partners', { method: 'POST', body: { name, capabilities } })).data
    },
    /** isActive and/or capabilities; an empty patch is refused. A revoked capability applies from the partner's next request. */
    async updatePartner(id: string, patch: { isActive?: boolean, capabilities?: PartnerCapability[] }) {
      return (await req<Partner>(`/v1/platform/partners/${id}`, { method: 'PATCH', body: patch })).data
    },
    async setPartnerActive(id: string, isActive: boolean) {
      return (await req<Partner>(`/v1/platform/partners/${id}`, { method: 'PATCH', body: { isActive } })).data
    },
    /** Operator: a property's ids at each partner (its EMS hotel id, for instance). */
    async listTenantSyncLinks(hotelRef: string) {
      return (await req<TenantSyncLink[] | null>(`/v1/platform/tenants/${hotelRef}/sync`)).data ?? []
    },
    /** Create or replace. 409 when another property already holds this id for the partner. */
    async setTenantSyncLink(hotelRef: string, partnerId: string, syncId: string) {
      return (await req<TenantSyncLink>(`/v1/platform/tenants/${hotelRef}/sync/${partnerId}`, { method: 'PUT', body: { syncId } })).data
    },
    /** Memberships are kept; future pushes from that partner for the property are ignored. */
    async removeTenantSyncLink(hotelRef: string, partnerId: string) {
      await req(`/v1/platform/tenants/${hotelRef}/sync/${partnerId}`, { method: 'DELETE' })
    },

    // ── group reports ─────────────────────────────────────────────────────────
    async getGroupStats(groupId: string) {
      return (await req<GroupStats>(`/v1/groups/${groupId}/stats`)).data
    },
    async listGroupTasks(groupId: string, query: TaskQuery = {}) {
      const env = await req<TaskListItem[] | null>(`/v1/groups/${groupId}/tasks`, { query: clean(query as Record<string, unknown>) })
      return { data: env.data ?? [], meta: (env.meta ?? { total: 0 }) as unknown as ListMeta }
    },

    // ── feat/projects: tenant, attribution, checklist, projects, templates ────
    /** The hotel's own record — `timezone` is the zone every time on screen should be shown in. */
    async getTenant() {
      return (await req<TenantSettings>('/v1/tenant')).data
    },
    /** Admin at the hotel. Schedules and templates move to the new zone; existing tasks keep their due dates. */
    async setTenantTimezone(timezone: string) {
      return (await req<TenantSettings>('/v1/tenant', { method: 'PATCH', body: { timezone } })).data
    },
    /** Who held the task for how long. Show the split only when `reconciles` is true. */
    async getTaskAttribution(id: string) {
      return (await req<TaskTimeAttribution>(`/v1/tasks/${id}/attribution`)).data
    },

    async setChecklistDone(payload: { taskId: string, itemId: string, isDone: boolean, note?: string | null }) {
      return (await req<ChecklistItem>('/v1/tasks/checklist/done', { method: 'POST', body: payload })).data
    },
    async addChecklistSteps(taskId: string, labels: string[]) {
      return (await req<ChecklistItem[]>('/v1/tasks/checklist', { method: 'POST', body: { taskId, labels } })).data
    },
    async removeChecklistStep(taskId: string, itemId: string) {
      await req('/v1/tasks/checklist/remove', { method: 'POST', body: { taskId, itemId } })
    },
    /** `staffId: null` unassigns. The task must be claimed first (409). */
    async assignChecklistStep(taskId: string, itemId: string, staffId: string | null) {
      return (await req<ChecklistItem>('/v1/tasks/checklist/assign', { method: 'POST', body: { taskId, itemId, staffId } })).data
    },

    /** One status per call; ACTIVE by default. Admins see every project, others their own. */
    async listProjects(status: ProjectStatus = 'ACTIVE') {
      return (await req<Project[] | null>('/v1/projects', { query: { status } })).data ?? []
    },
    async getProject(id: string) {
      return (await req<Project>(`/v1/projects/${id}`)).data
    },
    async createProject(payload: { name: string, description?: string | null, startDate?: string | null, endDate?: string | null, members?: Array<{ staffId: string, level: 'MEMBER' | 'VIEWER' }> }) {
      return (await req<Project>('/v1/projects', { method: 'POST', body: payload })).data
    },
    /** Absent keeps, null clears (not name). */
    async updateProject(id: string, payload: { name?: string, description?: string | null, startDate?: string | null, endDate?: string | null }) {
      return (await req<Project>(`/v1/projects/${id}`, { method: 'PATCH', body: payload })).data
    },
    /** Complete answers with `openTasks`; warn with it. */
    async completeProject(id: string) {
      return (await req<Project>(`/v1/projects/${id}/complete`, { method: 'POST' })).data
    },
    async cancelProject(id: string) {
      return (await req<Project>(`/v1/projects/${id}/cancel`, { method: 'POST' })).data
    },
    async reopenProject(id: string) {
      return (await req<Project>(`/v1/projects/${id}/reopen`, { method: 'POST' })).data
    },
    async getProjectBoard(id: string) {
      return (await req<Board & { columns: BoardColumn[] | null }>(`/v1/projects/${id}/board`)).data
    },
    async listProjectMembers(id: string) {
      return (await req<ProjectMember[] | null>(`/v1/projects/${id}/members`)).data ?? []
    },
    async setProjectMember(id: string, staffId: string, level: 'MEMBER' | 'VIEWER') {
      return (await req<ProjectMember[] | null>(`/v1/projects/${id}/members/${staffId}`, { method: 'PUT', body: { level } })).data ?? []
    },
    async removeProjectMember(id: string, staffId: string) {
      return (await req<ProjectMember[] | null>(`/v1/projects/${id}/members/${staffId}`, { method: 'DELETE' })).data ?? []
    },
    async handOverProject(id: string, staffId: string) {
      return (await req<Project>(`/v1/projects/${id}/manager`, { method: 'POST', body: { staffId } })).data
    },
    async createProjectTask(id: string, payload: StaffCreateTaskPayload) {
      const env = await req<TaskListItem>(`/v1/projects/${id}/tasks`, { method: 'POST', body: payload })
      return { data: env.data, warnings: ((env.meta as { warnings?: string[] | null } | null)?.warnings ?? null) }
    },
    /** Adds an existing staff-created task; 409 if in another project, 422 for a guest request. */
    async addTaskToProject(id: string, taskId: string) {
      return (await req<TaskListItem>(`/v1/projects/${id}/tasks/${taskId}`, { method: 'PUT' })).data
    },
    async removeTaskFromProject(id: string, taskId: string) {
      return (await req<TaskListItem>(`/v1/projects/${id}/tasks/${taskId}`, { method: 'DELETE' })).data
    },

    /** `scope` other than shared is admin-only. */
    async listTaskTemplates(query: { scope?: 'shared' | 'personal' | 'all', active?: boolean } = {}) {
      return (await req<TaskTemplate[] | null>('/v1/task-templates', { query: clean({ scope: query.scope, active: query.active ? 'true' : undefined }) })).data ?? []
    },
    async getTaskTemplate(id: string) {
      return (await req<TaskTemplate>(`/v1/task-templates/${id}`)).data
    },
    async createTaskTemplate(payload: TaskTemplateWrite) {
      return (await req<TaskTemplate>('/v1/task-templates', { method: 'POST', body: payload })).data
    },
    /** Full replace. */
    async updateTaskTemplate(id: string, payload: TaskTemplateWrite) {
      return (await req<TaskTemplate>(`/v1/task-templates/${id}`, { method: 'PUT', body: payload })).data
    },
    async archiveTaskTemplate(id: string) {
      await req(`/v1/task-templates/${id}`, { method: 'DELETE' })
    },
    /** The caller's own recurring tasks, active and paused. */
    async listRecurringTasks() {
      return (await req<TaskTemplate[] | null>('/v1/recurring-tasks')).data ?? []
    },
    /** Creates the personal template AND the first task now. */
    async createRecurringTask(payload: { isActive?: boolean, content: TaskTemplateContent, recurrence: TaskTemplateRecurrence }) {
      return (await req<{ template: TaskTemplate, taskId?: string | null }>('/v1/recurring-tasks', { method: 'POST', body: payload })).data
    },
    async updateRecurringTask(id: string, payload: { isActive?: boolean, content: TaskTemplateContent, recurrence: TaskTemplateRecurrence }) {
      return (await req<TaskTemplate>(`/v1/recurring-tasks/${id}`, { method: 'PUT', body: payload })).data
    },
    async archiveRecurringTask(id: string) {
      await req(`/v1/recurring-tasks/${id}`, { method: 'DELETE' })
    },

    /**
     * Roster import: `.csv` or `.xlsx`, columns email + name required, role /
     * department / createTask optional. Always 200 once the file parses;
     * `meta` carries the totals. The hotel comes from the header, never the file.
     */
    async importStaff(file: File) {
      const env = await session.upload<StaffImportRowResult[] | null>('/v1/staff/import', file)
      return { data: env.data ?? [], meta: (env.meta ?? { total: 0, created: 0, updated: 0, granted: 0, failed: 0 }) as unknown as { total: number, created: number, updated: number, granted: number, failed: number } }
    },
    /** A raw file, not the envelope. The .xlsx has a department drop-down. */
    async downloadStaffImportTemplate(format: 'csv' | 'xlsx') {
      return session.download('/v1/staff/import/template', { format })
    },
  }
}

/** GET /v1/tenant — the hotel's own record. */
export interface TenantSettings {
  hotelRef: string
  name: string
  timezone: string
  isActive: boolean
  createdAt: string
}

/** POST / PUT /v1/task-templates. */
export interface TaskTemplateWrite {
  name: string
  isActive?: boolean
  content: TaskTemplateContent
  recurrence: TaskTemplateRecurrence | null
}
