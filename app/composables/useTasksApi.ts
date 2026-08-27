import { useSession } from '~/composables/useSession'
import type {
  AuditEvent,
  BoardWithColumns,
  CatalogCategory,
  CatalogItem,
  Department,
  GroupGrant,
  Partner,
  RoutingRule,
  Sla,
  StaffProfile,
  TaskDetail,
  TaskListItem,
  Tenant,
  TenantGroup,
  TenantRole,
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
  scope?: 'mine' | 'unclaimed' | 'breached' | ''
  q?: string
  limit?: number
  cursor?: string | null
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
    async createTask(payload: {
      itemId?: string | null
      title: string
      description?: string | null
      location?: string | null
      quantity?: number | null
      requestedFor?: string | null
    }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks', { method: 'POST', body: payload })).data
    },
    /** Claim: creates an assignment. Never changes status; 409 if held by someone else. */
    async claimTask(taskId: string) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/claim', { method: 'POST', body: { taskId } })).data
    },
    /** Assign / hand over. Leaders and admins only — the deliberate path. */
    async assignTask(payload: { taskId: string, userId: string, remark?: string | null }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/assign', { method: 'POST', body: payload })).data
    },
    async moveTask(payload: { taskId: string, columnId: string, description?: string | null }) {
      return (await session.request<SingleResponse<TaskDetail>>('/v1/tasks/status', { method: 'PATCH', body: payload })).data
    },
    async addComment(payload: { taskId: string, comment: string }) {
      return (await session.request<SingleResponse<unknown>>('/v1/tasks/comments', { method: 'POST', body: payload })).data
    },
    /** Attach an already-hosted file by URL. There is no upload endpoint yet. */
    async attachUrl(payload: { taskId: string, url: string }) {
      return (await session.request<SingleResponse<unknown>>('/v1/tasks/attachments', { method: 'POST', body: payload })).data
    },

    // ── board ─────────────────────────────────────────────────────────────────
    async getBoard() {
      return (await session.request<SingleResponse<BoardWithColumns>>('/v1/board')).data
    },
    async upsertBoardColumn(payload: { id?: string, name: string, description?: string | null, status: string, columnSort?: number, isActive?: boolean }) {
      return (await session.request<SingleResponse<unknown>>('/v1/board/columns/upsert', { method: 'POST', body: payload })).data
    },

    // ── catalog ───────────────────────────────────────────────────────────────
    async listCatalogCategories() {
      return (await session.request<ListResponse<CatalogCategory>>('/v1/catalog/categories')).data
    },
    async listCatalogItems() {
      return (await session.request<ListResponse<CatalogItem>>('/v1/catalog/items')).data
    },
    async upsertCatalogItem(payload: { id?: string, categoryId: string, name: string, quantityEnabled: boolean, isActive?: boolean }) {
      return (await session.request<SingleResponse<CatalogItem>>('/v1/catalog/items/upsert', { method: 'POST', body: payload })).data
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
    async upsertRoutingRule(payload: {
      id?: string
      priority: number
      matchItemId?: string | null
      matchCategoryId?: string | null
      matchPartnerId?: string | null
      departmentId: string
      slaId: string
      remark?: string | null
      isActive?: boolean
    }) {
      return (await session.request<SingleResponse<RoutingRule>>('/v1/routing-rules/upsert', { method: 'POST', body: payload })).data
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
    async createPartner(payload: { name: string, kind?: string }) {
      return (await session.request<SingleResponse<Partner>>('/v1/operator/partners', { method: 'POST', body: payload })).data
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
