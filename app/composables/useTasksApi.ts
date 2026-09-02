import { useSession } from '~/composables/useSession'
import type {
  AuditEvent,
  BoardWithColumns,
  CatalogCategory,
  CatalogItem,
  Department,
  GroupGrant,
  LocationType,
  OperatingException,
  OperatingSchedule,
  OperatingWindow,
  Partner,
  PropertyLocation,
  RoutingRule,
  Sla,
  SourceApp,
  StaffProfile,
  TaskAttachment,
  TaskDetail,
  TaskListItem,
  TaskOffer,
  TaskPriority,
  Team,
  Tenant,
  TenantGroup,
  TenantRole,
  TerminologyKey,
} from '~/utils/clientFakeApi'

/**
 * Typed client for the Sentec Tasks API.
 *
 * Every call goes through `useSession().request`, which attaches the session and
 * the active property. Nothing here takes a user id or a role as an argument:
 * the server decides what the caller may see, and the UI only decides what to
 * ask for. That split is what keeps the client-side gates cosmetic rather than
 * load-bearing.
 */

interface ListResponse<T> {
  version: 'v1'
  data: T[]
  meta: { totalCount: number, nextCursor: string | null }
}

interface SingleResponse<T> {
  version: 'v1'
  data: T
}

export interface TaskQuery {
  status?: string
  departmentId?: string
  partnerId?: string
  scope?: 'mine' | 'unclaimed' | 'breached' | 'helping' | ''
  q?: string
  limit?: number
  cursor?: string | null
}

/** What POST /v1/tasks and /v1/tasks/preview accept. One shape for both. */
export interface StaffCreateTaskPayload {
  itemId?: string | null
  title: string
  description?: string | null
  location?: string | null
  locationId?: string | null
  quantity?: number | null
  requestedFor?: string | null
  /** null lets the server resolve it: item default, then NORMAL. */
  priority?: TaskPriority | null
  /** Steps ADDED by the creator; the item's own checklist is prepended. */
  checklistLabels?: string[]
  /** Schedule for later: SLA clocks run from this instant. */
  activationDate?: string | null
  assignee?: { kind: 'STAFF', userId: string } | { kind: 'TEAM', teamId: string } | null
}

/** The resolved-but-unwritten task the preview endpoint returns. */
export interface TaskPreview {
  task: {
    title: string
    priority: TaskPriority
    departmentId: string | null
    department: { id: string, name: string } | null
    slaId: string | null
    sla: { id: string, name: string, responseTime: number, resolutionTime: number } | null
    requestedFor: string | null
    location: string | null
    locationId: string | null
    quantity: number | null
    activationDate: string
    responseDueAt: string | null
    resolutionDueAt: string | null
  }
  checklistLabels: string[]
}

export interface StaffMember {
  profileId: string
  userId: string
  firstName: string
  lastName: string
  email: string
  picture: string | null
  position: string | null
  role: TenantRole
  departmentId: string | null
  department: { id: string, name: string } | null
  canCreateTask: boolean
  isActive: boolean
  openTaskCount: number
}

export interface PropertySummary {
  tenantId: string
  total: number
  open: number
  unclaimed: number
  breached: number
  finishedToday: number
  byStatus: Array<{ status: string, count: number }>
  byDepartment: Array<{ departmentId: string, name: string, open: number }>
}

export interface GroupReport {
  tenantGroupId: string
  tenantGroupName: string
  hiddenPropertyCount: number
  properties: Array<{ tenantId: string, tenantName: string, total: number, open: number, unclaimed: number, breached: number }>
  totals: { total: number, open: number, unclaimed: number, breached: number }
}

export function useTasksApi() {
  const session = useSession()

  /** Strip empty values so the mock does not see `status=''` as a filter. */
  function clean(query: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    )
  }

  return {
    // ── tasks ─────────────────────────────────────────────────────────────────
    async listTasks(query: TaskQuery = {}) {
      return session.request<ListResponse<TaskListItem>>('/v1/tasks', { query: clean(query as Record<string, unknown>) })
    },
    async getTask(id: string) {
      return (await session.request<SingleResponse<TaskDetail>>(`/v1/tasks/${id}`)).data
    },
    async createTask(payload: StaffCreateTaskPayload) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks', { method: 'POST', body: payload })).data
    },
    /**
     * Dry-run of createTask: the same resolution pipeline and the same gates,
     * with nothing written. Warnings ride in the envelope's meta, never inside
     * the resolved data.
     */
    async previewTask(payload: StaffCreateTaskPayload) {
      return session.request<SingleResponse<TaskPreview> & { meta?: { warnings?: string[] } }>('/v1/tasks/preview', { method: 'POST', body: payload })
    },
    /**
     * Claim: creates a personal assignment. Never changes status; 409 if a
     * person holds it, 403 if it sits in a pool the caller is not a member of.
     */
    async claimTask(taskId: string) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/claim', { method: 'POST', body: { taskId } })).data
    },
    /** Hand a held task back to its pool, with a required reason. */
    async returnTask(taskId: string, reason: string) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/return', { method: 'POST', body: { taskId, reason } })).data
    },

    // ── delegation offers ─────────────────────────────────────────────────────
    async sendOffer(payload: { taskId: string, toUserId: string, note?: string | null }) {
      return (await session.request<SingleResponse<TaskOffer>>('/v1/tasks/offers', { method: 'POST', body: payload })).data
    },
    /** Pending offers addressed to the caller, newest first. */
    async listOffers() {
      return (await session.request<ListResponse<TaskOffer & { fromUser: unknown, taskTitle: string }>>('/v1/offers')).data
    },
    async acceptOffer(offerId: string) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/offers/accept', { method: 'POST', body: { offerId } })).data
    },
    async declineOffer(offerId: string) {
      return (await session.request<SingleResponse<TaskOffer>>('/v1/offers/decline', { method: 'POST', body: { offerId } })).data
    },
    async cancelOffer(offerId: string) {
      return (await session.request<SingleResponse<TaskOffer>>('/v1/offers/cancel', { method: 'POST', body: { offerId } })).data
    },

    // ── helpers ───────────────────────────────────────────────────────────────
    async addHelper(taskId: string, userId: string) {
      return (await session.request<SingleResponse<unknown>>('/v1/tasks/collaborators', { method: 'POST', body: { taskId, userId } })).data
    },
    /** Also the "leave" path: anyone may remove themselves. */
    async removeHelper(taskId: string, userId: string) {
      return (await session.request<SingleResponse<unknown>>('/v1/tasks/collaborators/remove', { method: 'POST', body: { taskId, userId } })).data
    },

    // ── submit & review ───────────────────────────────────────────────────────
    async submitTask(payload: { taskId: string, completionNote?: string | null }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/submit', { method: 'POST', body: payload })).data
    },
    async reviewTask(payload: { taskId: string, decision: 'APPROVE' | 'REQUEST_CHANGES', note?: string | null }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/review', { method: 'POST', body: payload })).data
    },
    /** Assign / hand over. Leaders and admins only — the deliberate path. */
    async assignTask(payload: { taskId: string, userId: string, remark?: string | null }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/assign', { method: 'POST', body: payload })).data
    },
    async moveTask(payload: { taskId: string, columnId: string, description?: string | null }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/status', { method: 'PATCH', body: payload })).data
    },
    /** Direct edit of a task's describing fields (leader/admin, open tasks only). */
    async updateTask(payload: { taskId: string, title: string, description?: string | null, priority: TaskPriority }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/update', { method: 'POST', body: payload })).data
    },
    async addComment(payload: { taskId: string, comment: string }) {
      return (await session.request<SingleResponse<unknown>>('/v1/tasks/comments', { method: 'POST', body: payload })).data
    },
    /** Attach an already-hosted file by URL. */
    async attachUrl(payload: { taskId: string, url: string }) {
      return (await session.request<SingleResponse<TaskAttachment>>('/v1/tasks/attachments', { method: 'POST', body: payload })).data
    },
    /**
     * The presigned-upload path: presign, then attach the storage key. The
     * mock's store is virtual, so there is no PUT step here; the validation
     * (type allow-list, size caps) is the real contract.
     */
    async createUpload(payload: { filename: string, contentType: string, sizeBytes: number }) {
      return (await session.request<SingleResponse<{ uploadUrl: string, storageKey: string, expiresAt: string }>>('/v1/uploads', { method: 'POST', body: payload })).data
    },
    async attachUpload(payload: { taskId: string, storageKey: string, filetype: 'PHOTO' | 'PDF', filename?: string }) {
      return (await session.request<SingleResponse<TaskAttachment>>('/v1/tasks/attachments', { method: 'POST', body: payload })).data
    },
    /** Remove / restore. Only `isRemoved` can change once a file is attached. */
    async updateAttachment(payload: { id: string, isRemoved: boolean }) {
      return (await session.request<SingleResponse<TaskAttachment>>('/v1/tasks/attachments/update', { method: 'POST', body: payload })).data
    },

    // ── board ─────────────────────────────────────────────────────────────────
    async getBoard() {
      return (await session.request<SingleResponse<BoardWithColumns>>('/v1/board')).data
    },
    async upsertBoardColumn(payload: { id?: string, name: string, description?: string | null, status: string, columnSort?: number, isActive?: boolean }) {
      return (await session.request<SingleResponse<unknown>>('/v1/board/columns/upsert', { method: 'POST', body: payload })).data
    },
    /**
     * Soft-remove a column. A 200 does not mean it happened: a column that
     * still holds open work is skipped, and `warning` says so.
     */
    async removeBoardColumn(id: string) {
      return (await session.request<SingleResponse<{ removed: boolean, warning: string | null }>>('/v1/board/columns/remove', { method: 'POST', body: { id } })).data
    },

    // ── catalog ───────────────────────────────────────────────────────────────
    async listCatalogCategories() {
      return (await session.request<ListResponse<CatalogCategory>>('/v1/catalog/categories')).data
    },
    async upsertCatalogCategory(payload: { id?: string, name: string, code: string, icon?: string | null, sort: number, isActive?: boolean }) {
      return (await session.request<SingleResponse<CatalogCategory>>('/v1/catalog/categories/upsert', { method: 'POST', body: payload })).data
    },
    async listCatalogItems() {
      return (await session.request<ListResponse<CatalogItem>>('/v1/catalog/items')).data
    },
    /**
     * FULL REPLACE: every field is written from this payload. A caller that
     * does not edit a field (the admin screen has no control for
     * `defaultDurationMinutes`) must echo the stored value back, or it is
     * cleared.
     */
    async upsertCatalogItem(payload: {
      id?: string
      categoryId: string
      name: string
      description?: string | null
      quantityEnabled: boolean
      defaultPriority: TaskPriority
      requiresLocation: boolean
      defaultChecklist: string[]
      defaultDurationMinutes: number | null
      minProofPhotos: number
      requiresCompletionNote: boolean
      isActive?: boolean
    }) {
      return (await session.request<SingleResponse<CatalogItem>>('/v1/catalog/items/upsert', { method: 'POST', body: payload })).data
    },

    // ── locations ─────────────────────────────────────────────────────────────
    async listLocationTypes() {
      return (await session.request<ListResponse<LocationType>>('/v1/location-types')).data
    },
    async upsertLocationType(payload: { id?: string, name: string, code: string, linksRequester: boolean, sort: number, isActive?: boolean }) {
      return (await session.request<SingleResponse<LocationType>>('/v1/location-types/upsert', { method: 'POST', body: payload })).data
    },
    async listLocations() {
      return (await session.request<ListResponse<PropertyLocation>>('/v1/locations')).data
    },
    async upsertLocation(payload: { id?: string, locationTypeId: string, name: string, code: string, isActive?: boolean }) {
      return (await session.request<SingleResponse<PropertyLocation>>('/v1/locations/upsert', { method: 'POST', body: payload })).data
    },

    // ── teams ─────────────────────────────────────────────────────────────────
    async listTeams() {
      return (await session.request<ListResponse<Team & { memberCount: number }>>('/v1/teams')).data
    },
    async upsertTeam(payload: { id?: string, name: string, description?: string | null, departmentId?: string | null, isActive?: boolean }) {
      return (await session.request<SingleResponse<Team>>('/v1/teams/upsert', { method: 'POST', body: payload })).data
    },
    /** Member user ids for one team. */
    async listTeamMembers(teamId: string) {
      return (await session.request<ListResponse<string>>(`/v1/teams/${teamId}/members`)).data
    },
    /** 409 when the person is already on the team — a double-click is not two adds. */
    async addTeamMember(teamId: string, userId: string) {
      return (await session.request<SingleResponse<unknown>>(`/v1/teams/${teamId}/members/add`, { method: 'POST', body: { userId } })).data
    },
    async removeTeamMember(teamId: string, userId: string) {
      return (await session.request<SingleResponse<unknown>>(`/v1/teams/${teamId}/members/remove`, { method: 'POST', body: { userId } })).data
    },

    // ── operating schedules ───────────────────────────────────────────────────
    async listOperatingSchedules() {
      return (await session.request<ListResponse<OperatingSchedule>>('/v1/operating-schedules')).data
    },
    /** FULL REPLACE of the windows/exceptions set on every save. */
    async upsertOperatingSchedule(payload: {
      id?: string
      name: string
      isDefault: boolean
      departmentId?: string | null
      windows: OperatingWindow[]
      exceptions: OperatingException[]
    }) {
      return (await session.request<SingleResponse<OperatingSchedule>>('/v1/operating-schedules/upsert', { method: 'POST', body: payload })).data
    },

    // ── terminology ───────────────────────────────────────────────────────────
    async getTerminology() {
      return (await session.request<SingleResponse<Record<TerminologyKey, string>>>('/v1/terminology')).data
    },
    async setTerminology(key: TerminologyKey, value: string) {
      return (await session.request<SingleResponse<Record<TerminologyKey, string>>>('/v1/terminology', { method: 'PATCH', body: { key, value } })).data
    },

    // ── property configuration ────────────────────────────────────────────────
    async listDepartments() {
      return (await session.request<ListResponse<Department>>('/v1/departments')).data
    },
    async upsertDepartment(payload: { id?: string, name: string, isActive?: boolean }) {
      return (await session.request<SingleResponse<Department>>('/v1/departments/upsert', { method: 'POST', body: payload })).data
    },
    async listSlas() {
      return (await session.request<ListResponse<Sla>>('/v1/slas')).data
    },
    async upsertSla(payload: { id?: string, name: string, responseTime: number, resolutionTime: number, isDefault: boolean }) {
      return (await session.request<SingleResponse<Sla>>('/v1/slas/upsert', { method: 'POST', body: payload })).data
    },
    async listRoutingRules() {
      return (await session.request<ListResponse<RoutingRule>>('/v1/routing-rules')).data
    },
    /** Exactly one matcher, or none at all for a catch-all rule. */
    async upsertRoutingRule(payload: {
      id?: string
      matchItemId?: string | null
      matchCategoryId?: string | null
      matchLocationTypeId?: string | null
      matchPriority?: TaskPriority | null
      departmentId: string
      slaId: string
      remark?: string | null
      isActive?: boolean
    }) {
      return (await session.request<SingleResponse<RoutingRule>>('/v1/routing-rules/upsert', { method: 'POST', body: payload })).data
    },
    async deleteRoutingRule(id: string) {
      return (await session.request<SingleResponse<unknown>>('/v1/routing-rules/delete', { method: 'POST', body: { id } })).data
    },

    // ── staff directory ───────────────────────────────────────────────────────
    /**
     * The assign picker calls this with the task's own department by default;
     * omitting `departmentId` is the "show all" toggle. Scrolling every person
     * at the property on a phone was the problem this replaced.
     */
    async listStaff(departmentId?: string | null) {
      return (await session.request<ListResponse<StaffMember>>('/v1/staff', {
        query: clean({ departmentId }),
      })).data
    },
    async upsertStaff(payload: {
      profileId?: string
      email?: string
      firstName?: string
      lastName?: string
      position?: string | null
      role: TenantRole
      departmentId?: string | null
      canCreateTask: boolean
      isActive?: boolean
    }) {
      return (await session.request<SingleResponse<StaffProfile>>('/v1/staff/upsert', { method: 'POST', body: payload })).data
    },

    // ── reports ───────────────────────────────────────────────────────────────
    async getSummary() {
      return (await session.request<SingleResponse<PropertySummary>>('/v1/reports/summary')).data
    },
    async listTenantGroups() {
      return (await session.request<ListResponse<TenantGroup>>('/v1/tenant-groups')).data
    },
    async getGroupReport(tenantGroupId: string) {
      return (await session.request<SingleResponse<GroupReport>>('/v1/reports/group', { query: { tenantGroupId } })).data
    },

    // ── audit ─────────────────────────────────────────────────────────────────
    async listAuditEvents(query: { action?: string, limit?: number, cursor?: string | null } = {}) {
      return session.request<ListResponse<AuditEvent & { actor: unknown, tenant: unknown }>>('/v1/audit-events', { query: clean(query) })
    },

    // ── operator / platform ───────────────────────────────────────────────────
    async listTenants() {
      return (await session.request<ListResponse<Tenant & { tenantGroup: TenantGroup | null, staffCount: number, openTaskCount: number }>>('/v1/operator/tenants')).data
    },
    async createTenant(payload: { name: string, code: string, tenantGroupId?: string | null, timezone?: string }) {
      return (await session.request<SingleResponse<Tenant>>('/v1/operator/tenants', { method: 'POST', body: payload })).data
    },
    async listOperatorGroups() {
      return (await session.request<ListResponse<TenantGroup & { propertyCount: number, grantCount: number }>>('/v1/operator/tenant-groups')).data
    },
    async createTenantGroup(payload: { name: string }) {
      return (await session.request<SingleResponse<TenantGroup>>('/v1/operator/tenant-groups', { method: 'POST', body: payload })).data
    },
    async listPartners() {
      return (await session.request<ListResponse<Partner & { taskCount: number, undeliveredEventCount: number }>>('/v1/operator/partners')).data
    },
    /** The response carries the only copy of the secret the caller will ever see. */
    async createPartner(payload: { name: string, kind?: string, sourceAppCode?: string | null }) {
      return (await session.request<SingleResponse<Partner>>('/v1/operator/partners', { method: 'POST', body: payload })).data
    },
    /** Platform-wide registry — readable by every authenticated user. */
    async listSourceApps() {
      return (await session.request<ListResponse<SourceApp>>('/v1/source-apps')).data
    },
    /** Operator-only curation of the registry; `code` is the identity. */
    async upsertSourceApp(payload: { code: string, name: string, badgeColor: string, isActive?: boolean }) {
      return (await session.request<SingleResponse<SourceApp>>('/v1/operator/source-apps/upsert', { method: 'POST', body: payload })).data
    },
    async rotatePartnerSecret(partnerId: string) {
      return (await session.request<SingleResponse<Partner>>('/v1/operator/partners/rotate-secret', { method: 'POST', body: { partnerId } })).data
    },
    async listGroupGrants() {
      return (await session.request<ListResponse<GroupGrant & { tenantGroup: TenantGroup | null, user: unknown, grantedByUser: unknown, propertyCount: number }>>('/v1/operator/group-grants')).data
    },
    async grantGroupAccess(payload: { tenantGroupId: string, userId: string }) {
      return (await session.request<SingleResponse<GroupGrant>>('/v1/operator/group-grants', { method: 'POST', body: payload })).data
    },
    async revokeGroupAccess(grantId: string) {
      return (await session.request<SingleResponse<GroupGrant>>('/v1/operator/group-grants/revoke', { method: 'POST', body: { grantId } })).data
    },
    async listOperatorUsers() {
      return (await session.request<ListResponse<{ id: string, displayName: string, email: string, isOperator: boolean, tenantCount: number, grantCount: number }>>('/v1/operator/users')).data
    },
    async listStatusEvents() {
      return session.request<ListResponse<Record<string, unknown>>>('/v1/operator/status-events', { query: { limit: 50 } })
    },
  }
}
