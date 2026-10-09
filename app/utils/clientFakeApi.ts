/**
 * In-browser mock of the REAL Sentec Tasks API (sentec-tasks-api master
 * @ c3f52ad, plus the passwordless sign-in branch
 * feat/google-and-magic-link-auth @ 48756a3 — see "Passwordless sign-in" —
 * plus the `feat/projects` branch @ fe5e99d (which contains the sign-in,
 * per-hotel-membership, checklist, template/recurrence, roster-import and
 * partner-dispatch branches): per-property roles, the requester rename,
 * projects, checklist steps, templates and recurring tasks, the hotel
 * timezone, time attribution and the roster import. Error literals and
 * shapes for those come from the branch's Go handlers and openapi.yaml
 * (reconciled 2026-09-29); the few places a browser mock cannot follow the
 * server are marked "MOCK LIMIT".)
 *
 * 2026-10-06: re-aligned to `refactor/ponytail-audit` @ 1ee8c12, the tip the
 * dev Lambda serves. It contains feat/escalation (escalation policies, the
 * escalation sweep, task escalation fields), feat/department-crud (master
 * department CRUD, hotel-department soft delete), feat/ems-staff-sync (EMS
 * employee browse/add, inbound EMS push, offboarding, tenant sync ids,
 * partner capabilities) and feat/interface-lambda (the main/interface
 * surface split). Each is marked in place; literals come from the Go.
 *
 * Wire-faithful by decision: exact paths, envelope, error codes and message
 * literals, UUID ids, X-Hotel-Id scoping, cookie-session + CSRF shape, and the
 * null-vs-[] serialization quirks — extracted from the Go handlers and their
 * tests, not just the OpenAPI file. Where the mock cannot be the real thing
 * (JWT verification, S3, SQS, PostgreSQL partitions) it simulates the seam and
 * says so at the seam.
 *
 * Token stand-ins (a browser mock cannot verify HS256):
 *   Authorization: Bearer service:<anything>     → Butler service actor
 *   Authorization: Bearer partner:<partnerId>    → partner actor (active only)
 *   Authorization: Bearer <token from login>     → staff bearer actor
 *   Cookie: st_session=<session id>              → cookie actor (CSRF applies)
 *
 * The two browser-facing sign-in legs (Google callback, magic-link verify)
 * answer a 302 whose Set-Cookie a browser mock cannot honour, so the session
 * id rides in the response's `headers['set-cookie']` for the client to adopt
 * — the same seam as the login response's `_sessionCookie`.
 *
 * Deliberately NOT simulated: CORS, the 1 MiB body cap, SQS event egress
 * (events are queued in-memory for inspection only… no, see below: the real
 * API has no HTTP egress for events, so neither does this mock).
 */

// ════════════════════════ Enums & core types ════════════════════════

export type TaskStatus = 'NEW' | 'IN_PROGRESS' | 'SUBMITTED' | 'FINISHED' | 'VERIFIED' | 'PENDING' | 'CANCELLED'

/** Enum-definition order of the real task_status type (seven, incl. SUBMITTED). */
export const TASK_STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'FINISHED', 'VERIFIED', 'PENDING', 'CANCELLED']

export type SlaStatus = 'EMPTY' | 'ON_TIME' | 'BREACHED'

export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export const TASK_PRIORITY_VALUES: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

export type StaffRole = 'staff' | 'leader' | 'admin'

export type Id = string

export interface Tenant {
  hotelRef: Id
  name: string
  timezone: string
  groupId: Id | null
  isActive: boolean
  createdAt: string
}

export interface TenantGroup {
  id: Id
  name: string
  createdAt: string
  updatedAt: string
}

/**
 * Master (Sentinel-curated) department vocabulary — global, not hotel-scoped;
 * `Department` on the wire. feat/department-crud gave it `code`,
 * `description` and `updatedAt`, and an operator (or a non-partner service
 * token) may now create, patch and delete it.
 */
export interface MasterDepartment {
  id: Id
  name: string
  /** Optional, 1-16 chars of A-Z 0-9 _ (stored upper-case). */
  code: string | null
  description: string | null
  /** false retires it for NEW use only: hotels already using it keep it. */
  isActive: boolean
  updatedAt: string
}

/**
 * A master department enabled for one hotel. Tasks reference THESE ids.
 * `isActive:false` is the hotel's soft delete (PATCH /v1/hotel-departments/{id}):
 * nothing new may use it, but staff, teams, schedules and tasks that already
 * point at it keep working and show it as inactive.
 */
export interface HotelDepartment {
  id: Id
  hotelRef: Id
  departmentId: Id
  departmentName: string
  code: string | null
  description: string | null
  isActive: boolean
  /** false means the master is retired; the hotel cannot reactivate it. */
  masterIsActive: boolean
  updatedAt: string
}

export interface StaffAccount {
  id: Id
  email: string
  /** One display-name field — the real staff table has no first/last split. */
  name: string
  isActive: boolean
  isOperator: boolean
  /**
   * Links this person to Sentec EMS (feat/ems-staff-sync); null for manual
   * staff. EMS then owns their name, email and membership at EMS-mapped
   * properties — an admin's edit lasts until the next EMS push.
   */
  emsEmployeeId: string | null
}

/** A property the person can reach — directly or through a group grant. Sorted by name. */
export interface Property {
  hotelRef: Id
  name: string
}

/**
 * The person's standing at ONE property (feat/projects, commit 55db919): role,
 * department and the create-task permission are per hotel now, not per
 * account. The staff JWT dropped its role/deptId/createTask claims too — read
 * everything from the membership whose hotelRef matches the selected hotel.
 */
export interface HotelMembership {
  hotelRef: Id
  role: StaffRole
  hotelDepartmentId: Id | null
  createTask: boolean
  /** Something EMS sent for this membership that Tasks could not apply; null when clean. */
  syncIssue: SyncIssue | null
}

/** One kind today: EMS named a department this property does not have (decision #7). */
export interface SyncIssue {
  type: 'unknown_department'
  emsDepartmentName: string
}

/**
 * The Staff read model every staff-surface response uses (never a hash).
 * `role`, `hotelDepartmentId`, `createTask` and `hotels` are GONE from the
 * wire; `properties` is the reach, `memberships` the per-property standing
 * (always an array — GET /v1/staff narrows it to the listed hotel).
 */
export interface Staff extends StaffAccount {
  properties: Property[]
  memberships: HotelMembership[]
  groupGrants: Id[]
}

export interface AssignableStaff {
  id: Id
  name: string
  role: StaffRole
  hotelDepartmentId: Id | null
}

export interface Board {
  id: Id
  hotelRef: Id
  name: string
  createdAt: string
  updatedAt: string
}

export interface BoardColumn {
  id: Id
  boardId: Id
  name: string
  description: string | null
  columnSort: number
  isActive: boolean
  isRemoved: boolean
  status: TaskStatus | null
}

export interface Sla {
  id: Id
  hotelRef: Id
  name: string
  /** Minutes of open time from activation until first IN_PROGRESS. */
  responseTime: number
  /** Minutes of open time from responseDueAt — the clocks CHAIN. */
  resolutionTime: number
  isDefault: boolean
  /** feat/escalation: the policy tasks routed to this SLA escalate by, unless the rule names one. */
  escalationPolicyId: Id | null
  createdAt: string
  updatedAt: string
}

export interface RoutingRule {
  id: Id
  hotelRef: Id
  itemRef: Id | null
  categoryId: Id | null
  locationTypeId: Id | null
  priority: TaskPriority | null
  /** Derived: 4 item, 3 category, 2 location type, 1 priority, 0 catch-all. */
  specificity: number
  hotelDepartmentId: Id
  slaId: Id
  remark: string | null
  /** feat/escalation: wins over the SLA's policy for tasks this rule routes. */
  escalationPolicyId: Id | null
  createdAt: string
  updatedAt: string
}

export interface CatalogItem {
  id: Id
  hotelRef: Id
  name: string
  description: string | null
  itemQuantity: boolean
  isActive: boolean
  categoryId: Id | null
  defaultPriority: TaskPriority
  requiresLocation: boolean
  defaultChecklist: string[]
  defaultDurationMinutes: number | null
  minProofPhotos: number
  requiresCompletionNote: boolean
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: Id
  hotelRef: Id
  name: string
  code: string
  sort: number
  isActive: boolean
  icon: string | null
  createdAt: string
  updatedAt: string
}

export interface LocationType {
  id: Id
  hotelRef: Id
  name: string
  code: string
  /** Gates the PMS requester lookup during task creation. */
  linksRequester: boolean
  sort: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Location {
  id: Id
  hotelRef: Id
  locationTypeId: Id
  name: string
  code: string
  parentId: Id | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Team {
  id: Id
  hotelRef: Id
  name: string
  description: string | null
  hotelDepartmentId: Id | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface OperatingWindow {
  /** 0=Sunday … 6=Saturday. */
  weekday: number
  opensMinutes: number
  closesMinutes: number
}

export interface OperatingException {
  /** Bare YYYY-MM-DD, never RFC3339. */
  date: string
  isClosed: boolean
  opensMinutes: number | null
  closesMinutes: number | null
}

export interface OperatingSchedule {
  id: Id
  hotelRef: Id
  name: string
  isDefault: boolean
  hotelDepartmentId: Id | null
  windows: OperatingWindow[]
  exceptions: OperatingException[]
  createdAt: string
  updatedAt: string
}

/** Platform-level registry (no hotelRef): resolves a task's sourceProduct to a badge. */
export interface SourceApp {
  code: string
  name: string
  shortName: string
  icon: string | null
  color: string | null
  isActive: boolean
}

/** Per-partner permissions beyond dispatch. `staff_sync` lets EMS push employee changes. */
export type PartnerCapability = 'staff_sync'
export const PARTNER_CAPABILITIES: PartnerCapability[] = ['staff_sync']

export interface Partner {
  id: Id
  name: string
  isActive: boolean
  capabilities: PartnerCapability[]
  createdAt: string
  updatedAt: string
}

export interface Task {
  hotelRef: Id
  id: Id
  status: TaskStatus
  title: string
  description: string | null
  notes: string | null
  roomNumber: string | null
  quantity: number | null
  sourceProduct: string
  sourceChannel: string
  idempotencyKey: Id | null
  itemRef: Id | null
  itemName: string
  categoryName: string | null
  /** Renamed from guestRef/guestName (feat/projects 55d56c4); the create bodies already said requester*. */
  requesterRef: Id | null
  requesterName: string | null
  visitRef: string | null
  priority: TaskPriority
  locationId: Id | null
  locationTypeName: string | null
  slaId: Id | null
  hotelDepartmentId: Id | null
  columnId: Id | null
  activationDate: string
  dueAt: string | null
  responseDueAt: string | null
  resolutionDueAt: string | null
  /** Budget snapshots, written once at creation — never accumulated. */
  responseSlaMinutes: number | null
  resolutionSlaMinutes: number | null
  /** Actual elapsed minutes activation → first IN_PROGRESS. Null until then. */
  responseDuration: number | null
  /** Actual minutes ACCUMULATED across every IN_PROGRESS period. */
  resolutionDuration: number | null
  responseSlaStatus: SlaStatus
  resolutionSlaStatus: SlaStatus
  completionNote: string | null
  submittedBy: Id | null
  submittedAt: string | null
  /** Set on tasks a recurring template made (feat/projects). */
  templateId: Id | null
  occurrenceKey: string | null
  /**
   * feat/escalation. Resolved ONCE at creation: the matched routing rule's
   * policy, else the SLA's, else the hotel's active default, else none.
   * Tasks created before a policy existed are not backfilled.
   */
  escalationPolicyId: Id | null
  /** Highest applied step's sort + 1; 0 = never escalated. Steps are independent, so a level does not imply every lower step fired. */
  escalationLevel: number
  /** When the most recent escalation step was applied. */
  escalatedAt: string | null
  /** POST /v1/tasks/preview only (omitempty): the resolved policy's name. */
  escalationPolicyName?: string
  /** Storage column; the wire shows it as `project: {id, name}` on the read models. */
  projectId: Id | null
  createdAt: string
  updatedAt: string
}

export type AssignmentKind = 'STAFF' | 'TEAM' | 'DEPARTMENT'

export interface TaskAssignment {
  id: Id
  taskId: Id
  kind: AssignmentKind
  staffId: Id | null
  teamId: Id | null
  hotelDepartmentId: Id | null
  assignedBy: Id | null
  actingUser: string | null
  remark: string | null
  isActive: boolean
  createdAt: string
}

export interface AssignmentRef {
  id: Id
  kind: AssignmentKind
  staffId: Id | null
  staffName: string | null
  teamId: Id | null
  teamName: string | null
  departmentId: Id | null
  departmentName: string | null
  remark: string | null
}

export interface TaskHistory {
  id: Id
  hotelRef: Id
  taskId: Id
  staffId: Id | null
  status: string
  description: string | null
  seq: number
  createdAt: string
}

export interface TaskComment {
  id: Id
  hotelRef: Id
  taskId: Id
  staffId: Id
  comment: string
  createdAt: string
  staffName: string | null
}

export interface TaskAttachment {
  id: Id
  hotelRef: Id
  taskId: Id
  staffId: Id | null
  filetype: 'PHOTO' | 'PDF'
  /** URL verbatim for legacy rows; a fresh signed GET for storage-backed rows; '' = preview unavailable. */
  filepath: string
  isRemoved: boolean
  createdAt: string
}

export interface Collaborator {
  id: Id
  hotelRef: Id
  taskId: Id
  staffId: Id
  staffName: string | null
  addedBy: Id | null
  isActive: boolean
  createdAt: string
}

export type OfferState = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED'

export interface TaskOffer {
  id: Id
  hotelRef: Id
  taskId: Id
  fromStaff: Id
  toStaff: Id
  toStaffName?: string | null
  note: string | null
  state: OfferState
  decidedAt: string | null
  createdAt: string
}

export interface InboxOffer extends TaskOffer {
  fromStaffName: string | null
  taskTitle: string
}

export interface TaskContextEntry {
  id: Id
  hotelRef: Id
  taskId: Id
  sourceAppCode: string
  label: string
  value: string
  url: string | null
  sort: number
}

export interface ChecklistItem {
  id: Id
  hotelRef: Id
  taskId: Id
  sort: number
  label: string
  isDone: boolean
  doneBy: Id | null
  doneAt: string | null
  /** A step may be handed to one person, who then gets read-only access to the task. */
  assignedStaffId: Id | null
  assignedStaffName: string | null
  assignedBy: Id | null
  assignedAt: string | null
  /** ≤ 2000 chars; survives an untick. */
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskListItem extends Task {
  department: { id: Id, name: string, isActive: boolean } | null
  column: { id: Id, name: string, columnSort: number } | null
  sla: { id: Id, name: string } | null
  assignment: AssignmentRef | null
  /** The project this task belongs to; project tasks leave the hotel board and default list. */
  project: { id: Id, name: string } | null
}

export interface TaskDetail extends TaskListItem {
  slaFull: Sla | null
  history: TaskHistory[] | null
  comments: TaskComment[] | null
  attachments: TaskAttachment[] | null
  collaborators: Collaborator[] | null
  /** The steps, in sort order. There is no separate GET; this is the only read. */
  checklist: ChecklistItem[]
  proofRequirements: { minProofPhotos: number, requiresCompletionNote: boolean }
  pendingOffer: { id: Id, toStaffId: Id, toStaffName: string | null, note: string | null, createdAt: string } | null
}

/** GET /v1/tasks/{id}/attribution — who held the task for how long, in open-schedule minutes. */
export interface TaskTimeAttribution {
  taskId: Id
  activationDate: string
  cutoffAt: string
  cutoffReason: 'submitted' | 'open'
  totalMinutes: number
  unclaimedMinutes: number
  pooledMinutes: number
  holders: Array<{ staffId: Id, staffName?: string | null, minutes: number, holds: number }>
  /** False means the split does not add up to the total — do not show it. */
  reconciles: boolean
}

// ── Projects (feat/projects, ADR 0001) ──────────────────────────────────────

export type ProjectStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
export type ProjectLevel = 'MANAGER' | 'MEMBER' | 'VIEWER'

export interface ProjectProgress {
  byStatus: Record<TaskStatus, number>
  /** FINISHED + VERIFIED. */
  done: number
  /** Everything but CANCELLED. */
  total: number
  /** Rounded down. */
  percent: number
  overdue: number
  unassigned: number
}

export interface Project {
  id: Id
  hotelRef: Id
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
  status: ProjectStatus
  completedAt: string | null
  createdBy: Id | null
  managerStaffId: Id | null
  /** The caller's own level; null for a non-member admin. */
  myLevel: ProjectLevel | null
  late: boolean
  /** Admins only: the project manager no longer has an active membership at this hotel. */
  needsManager?: boolean
  progress: ProjectProgress
  /** On the complete response only. */
  openTasks?: number
  createdAt: string
  updatedAt: string
}

export interface ProjectMember {
  staffId: Id
  name: string
  level: ProjectLevel
  source: 'MANUAL' | 'AUTO'
  addedBy: Id | null
  addedAt: string
}

// ── Task templates and recurring tasks (feat/projects) ──────────────────────

export type RecurrenceKind = 'DAILY' | 'WEEKLY' | 'MONTHLY'

/** Same names as the staff-create body; no DEPARTMENT kind. */
export interface TaskTemplateAssignee {
  assigneeKind: 'STAFF' | 'TEAM' | 'UNASSIGNED'
  assigneeStaffId?: Id | null
  assigneeTeamId?: Id | null
}

/** Task content without a due date, activation date or requester. */
export interface TaskTemplateContent {
  title: string
  description?: string | null
  itemRef?: Id | null
  locationRef?: Id | null
  roomNumber?: string | null
  priority?: TaskPriority | null
  quantity?: number | null
  checklistLabels: string[]
  assignee?: TaskTemplateAssignee | null
}

export interface TaskTemplateRecurrence {
  kind: RecurrenceKind
  /** Minutes after local midnight, 0–1439. */
  timeMinutes: number
  /** 0 = Sunday; required for WEEKLY. */
  weekdays?: number[] | null
  /** 1–28; required for MONTHLY. */
  dayOfMonth?: number | null
  /** Hotel-local dates, YYYY-MM-DD. */
  startsOn?: string | null
  endsOn?: string | null
}

export interface TaskTemplate {
  id: Id
  hotelRef: Id
  name: string
  isActive: boolean
  content: TaskTemplateContent
  recurrence: TaskTemplateRecurrence | null
  /** Null when nothing will fire: manual-only, inactive, or past endsOn. */
  nextRunAt: string | null
  /** When the worker last handled this template, successfully or not. */
  lastRunAt: string | null
  /** The scheduled time of the last occurrence a task was created for. */
  lastOccurrenceAt: string | null
  lastTaskId: Id | null
  /**
   * Why the last run skipped its occurrence, created the task without its
   * assignee, or paused a personal template whose owner lost access. Null
   * after a clean run. Show it.
   */
  lastError: string | null
  createdBy: Id | null
  /** Set on a personal template (a staff member's own recurring task); null on a shared one. */
  ownerStaffId: Id | null
  ownerName: string | null
  timezone: string
  /** The next five runs, hotel offset applied. */
  upcoming: string[]
  createdAt: string
  updatedAt: string
}

/** POST /v1/staff/import — one row of the roster file. */
export interface StaffImportRowResult {
  line: number
  email: string
  outcome: 'created' | 'updated' | 'granted' | 'failed'
  staffId?: Id
  /** The row's refusal, in the API's own error shape. */
  error?: ApiErrorBody
}

// ── Escalation (feat/escalation, spec 2026-09-29) ────────────────────────────

export type EscalationTriggerKind = 'RESPONSE_OVERDUE' | 'PERCENT_OF_RESOLUTION' | 'RESOLUTION_OVERDUE' | 'UNASSIGNED_FOR'
export const ESCALATION_TRIGGER_KINDS: EscalationTriggerKind[] = ['RESPONSE_OVERDUE', 'PERCENT_OF_RESOLUTION', 'RESOLUTION_OVERDUE', 'UNASSIGNED_FOR']
export type EscalationActionType = 'bumpPriority' | 'reassign' | 'routeToDepartment'
export const ESCALATION_ACTION_TYPES: EscalationActionType[] = ['bumpPriority', 'reassign', 'routeToDepartment']
export type EscalationRecipientKind = 'departmentLeaders' | 'admins' | 'team' | 'staff' | 'assignee'
export const ESCALATION_RECIPIENT_KINDS: EscalationRecipientKind[] = ['departmentLeaders', 'admins', 'team', 'staff', 'assignee']
/** A policy holds at most this many steps; `sort` runs 0-9. */
export const ESCALATION_MAX_STEPS = 10

/** `reassign` names exactly one of staffId/teamId; `routeToDepartment` names hotelDepartmentId only; `bumpPriority` takes no target. */
export interface EscalationAction {
  type: EscalationActionType
  staffId?: Id
  teamId?: Id
  hotelDepartmentId?: Id
}

/** `team` carries teamId, `staff` carries staffId; the other kinds take no target. */
export interface EscalationRecipient {
  kind: EscalationRecipientKind
  teamId?: Id
  staffId?: Id
}

export interface EscalationStep {
  id: Id
  sort: number
  triggerKind: EscalationTriggerKind
  /** Minutes (≥0; ≥1 for UNASSIGNED_FOR) or a percent 1-100 for PERCENT_OF_RESOLUTION. Working minutes on the task's operating schedule. */
  triggerValue: number
  actions: EscalationAction[]
  recipients: EscalationRecipient[]
}

export interface EscalationPolicy {
  id: Id
  hotelRef: Id
  name: string
  /** New tasks with no rule/SLA policy get the hotel's active default. A new default demotes the old one. */
  isDefault: boolean
  /** An inactive policy stops escalating; reactivating resumes, including any catch-up burst. */
  isActive: boolean
  /** Live steps only, by sort. */
  steps: EscalationStep[]
  createdAt: string
  updatedAt: string
}

/** A step with an id updates that step; without one it is created; a live step missing from the request is soft-deleted. */
export interface EscalationStepWrite {
  id?: Id | null
  sort: number
  triggerKind: EscalationTriggerKind
  triggerValue: number
  actions?: EscalationAction[]
  recipients?: EscalationRecipient[]
}

/** POST /v1/escalation-policies — upsert the policy AND its steps in one call. */
export interface EscalationPolicyWrite {
  /** Omit to create; set to update. */
  id?: Id | null
  name: string
  isDefault?: boolean
  /** Omit: true on create, unchanged on update. */
  isActive?: boolean | null
  steps?: EscalationStepWrite[]
}

export type EscalationSkipReason = 'no_change' | 'target_invalid' | 'not_configured'

/** GET /v1/tasks/{id}/escalations — one applied step: what changed, what was skipped, who was told. */
export interface TaskEscalation {
  hotelRef: Id
  taskId: Id
  appliedAt: string
  policyId: Id
  stepId: Id
  level: number
  trigger: { kind: EscalationTriggerKind, value: number }
  /** before/after: a priority, or staff:<id> / team:<id> / department:<id>, or '' for none. */
  applied: Array<{ type: EscalationActionType, before: string, after: string }>
  skipped: Array<{ type: EscalationActionType, reason: EscalationSkipReason }>
  /** Staff ids resolved when the step fired. */
  recipients: Id[]
}

// ── EMS staff sync (feat/ems-staff-sync, spec 2026-10-06) ───────────────────

export type EmsEmployeeState = 'added' | 'addable' | 'no_email' | 'inactive'

/** GET /v1/ems/employees — one EMS row, annotated with this property's view of it. */
export interface EmsEmployee {
  emsEmployeeId: string
  name: string
  email: string | null
  /** Works at this property now, per EMS. */
  active: boolean
  departmentName: string | null
  /** The property's department matching departmentName by name, or null. */
  hotelDepartmentId: Id | null
  state: EmsEmployeeState
}

export type EmsAddOutcome = 'created' | 'linked' | 'granted' | 'skipped' | 'failed'

/** POST /v1/ems/employees — one result per requested id. */
export interface EmsAddResult {
  emsEmployeeId: string
  outcome: EmsAddOutcome
  staffId?: Id
  /** Set on `failed`: not_found_at_this_property | inactive | no_email | invalid_email | email_taken | email_linked_to_other_employee | error. */
  reason?: string
}

/** /v1/platform/tenants/{hotelRef}/sync — a partner's own id for one property (EMS's hotel id). */
export interface TenantSyncLink {
  id: Id
  hotelRef: Id
  partnerId: Id
  partnerName: string
  syncId: string
  createdAt: string
  updatedAt: string
}

export interface ApiErrorBody { code: string, message: string }

export interface Envelope<T = unknown> {
  version: 'v1'
  data: T
  meta?: Record<string, unknown> | null
  errors?: ApiErrorBody[]
}

/** Transport result: status + enveloped body (null for 204, a 302, or a raw file). */
export interface FakeResponse<T = unknown> {
  status: number
  body: Envelope<T> | null
  /**
   * The browser-facing sign-in legs only: the 302's Location, and — on
   * success — the st_session Set-Cookie a browser mock cannot honour, so the
   * client adopts it from here instead (see the header comment).
   */
  headers?: { 'location': string, 'set-cookie'?: string }
  /** A raw download (GET /v1/staff/import/template): no envelope, Content-Disposition: attachment. */
  raw?: { filename: string, contentType: string, content: string }
}

/**
 * The ?authError= vocabulary the two redirecting sign-in legs append on
 * failure (openapi AuthErrorCode / internal/authflow). A CLOSED set: the apps
 * render their own copy per code and a generic line for anything else — never
 * the raw query value. Two are deliberately coarse and must stay so:
 * no_account also covers "deactivated", link_invalid also covers expired and
 * already-used; splitting either makes the query string an account oracle.
 */
export type AuthErrorCode
  = 'google_denied' | 'invalid_state' | 'expired_flow' | 'exchange_failed' | 'id_token_invalid' | 'email_unverified'
    | 'link_invalid' | 'no_account' | 'invalid_return_to' | 'unavailable'

// ════════════════════════ Error model ════════════════════════

const STATUS_BY_CODE: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
}

export class ApiError extends Error {
  code: string
  status: number
  /** True for the mux-level plain-text 404/405 that bypass the envelope. */
  plain: boolean
  constructor(code: string, message: string, plain = false) {
    super(message)
    this.code = code
    this.status = STATUS_BY_CODE[code] ?? 500
    this.plain = plain
  }
}

const badRequest = (message: string) => new ApiError('BAD_REQUEST', message)
const unauthorized = (message: string) => new ApiError('UNAUTHORIZED', message)
const forbidden = (message: string) => new ApiError('FORBIDDEN', message)
const notFound = (entity: string) => new ApiError('NOT_FOUND', entity)
const conflict = (message: string) => new ApiError('CONFLICT', message)
const unprocessable = (message: string) => new ApiError('UNPROCESSABLE', message)

/** Single-source copy constants (em dashes are part of the literals). */
export const ERR_CROSS_DEPARTMENT = 'cannot claim/assign — task belongs to a different department'
export const ERR_ALREADY_CLAIMED = 'task is already claimed by another staff member'
export const WARN_NO_NEW_COLUMN = 'no active column is linked to status NEW — new tasks will be columnless'

// ════════════════════════ Deterministic seed ids ════════════════════════

/** Stable, readable UUIDs: one hex "kind" digit + a 12-digit ordinal. */
function uid(kind: string, n: number): Id {
  return `${kind.padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value)

/** Every seed id, exported so tests and demo tooling never hardcode UUIDs. */
export const IDS = {
  hotel: { simatupang: uid('a1', 1), kuningan: uid('a1', 2), fave: uid('a1', 3) },
  group: { aston: uid('a2', 1), fave: uid('a2', 2) },
  masterDept: { housekeeping: uid('a3', 1), maintenance: uid('a3', 2), frontOffice: uid('a3', 3), fnb: uid('a3', 4), spa: uid('a3', 5) },
  dept: {
    smtpHousekeeping: uid('a4', 1),
    smtpMaintenance: uid('a4', 2),
    smtpFrontOffice: uid('a4', 3),
    smtpFnb: uid('a4', 4),
    kngnHousekeeping: uid('a4', 5),
    kngnMaintenance: uid('a4', 6),
    faveHousekeeping: uid('a4', 7),
    faveFrontOffice: uid('a4', 8),
    /** Soft-deleted at Simatupang under a retired master: shows the "cannot reactivate" case. */
    smtpSpa: uid('a4', 9),
  },
  staff: {
    budi: uid('a5', 1), // staff@aston.example — HK staff, works two hotels
    sari: uid('a5', 2), // leader@aston.example — HK leader
    agus: uid('a5', 3), // admin@aston.example — tenant admin
    operator: uid('a5', 4), // operator@sentineltech.example — platform operator
    rina: uid('a5', 5), // regional@aston.example — admin at Kuningan + Aston group grant
    made: uid('a5', 6), // made@aston.example — HK staff, no createTask claim
    joko: uid('a5', 7), // joko@aston.example — maintenance staff
    nur: uid('a5', 8), // nur@fave.example — Fave HK staff
  },
  board: { smtp: uid('a6', 1), kngn: uid('a6', 2), fave: uid('a6', 3) },
  column: {
    smtpNew: uid('a7', 1),
    smtpInProgress: uid('a7', 2),
    smtpAwaitingReview: uid('a7', 3),
    smtpOnHold: uid('a7', 4),
    smtpFinished: uid('a7', 5),
    smtpVerified: uid('a7', 6),
    smtpCancelled: uid('a7', 7),
  },
  sla: { smtpStandard: uid('a8', 1), smtpUrgent: uid('a8', 2), smtpScheduled: uid('a8', 3), kngnStandard: uid('a8', 4), faveStandard: uid('a8', 5) },
  category: { hk: uid('a9', 1), mnt: uid('a9', 2), concierge: uid('a9', 3), fnb: uid('a9', 4), faveHk: uid('a9', 5) },
  item: {
    towels: uid('b1', 1),
    roomCleaning: uid('b1', 2),
    turndown: uid('b1', 3),
    acFault: uid('b1', 4),
    lightBulb: uid('b1', 5),
    plumbing: uid('b1', 6),
    transfer: uid('b1', 7),
    lateCheckout: uid('b1', 8),
    inRoomDining: uid('b1', 9),
    minibar: uid('b1', 10),
    faveCleaning: uid('b1', 11),
  },
  locationType: { room: uid('b2', 1), floor: uid('b2', 2), publicArea: uid('b2', 3), backOffice: uid('b2', 4), faveRoom: uid('b2', 5) },
  location: { room1204: uid('b3', 1), room0908: uid('b3', 2), room1102: uid('b3', 3), floor7: uid('b3', 4), lobby: uid('b3', 5), faveRoom0210: uid('b3', 6) },
  team: { hkMorning: uid('b4', 1), engineering: uid('b4', 2) },
  schedule: { smtpDefault: uid('b5', 1), smtpEngineering: uid('b5', 2) },
  rule: {
    acFault: uid('b6', 1),
    hk: uid('b6', 2),
    mnt: uid('b6', 3),
    concierge: uid('b6', 4),
    fnb: uid('b6', 5),
    publicArea: uid('b6', 6),
    urgent: uid('b6', 7),
    faveHk: uid('b6', 8),
    faveCatchAll: uid('b6', 9),
  },
  partner: { butler: uid('b7', 1), pms: uid('b7', 2), ems: uid('b7', 3) },
  policy: { smtpStandard: uid('b8', 1), smtpUrgent: uid('b8', 2) },
  step: { stdResponse: uid('b9', 1), stdHalfway: uid('b9', 2), stdOverdue: uid('b9', 3), urgUnassigned: uid('b9', 4), urgOverdue: uid('b9', 5) },
  syncLink: { smtpEms: uid('c9', 1) },
  task: {
    towels1204: uid('c1', 1),
    acFault0908: uid('c1', 2),
    cleaning1102: uid('c1', 3),
    turndownPool: uid('c1', 4),
    towels0710: uid('c1', 5),
    transferHold: uid('c1', 6),
    towelsDone: uid('c1', 7),
    plumbingVerified: uid('c1', 8),
    checkoutCancelled: uid('c1', 9),
    bulbsDeptPool: uid('c1', 10),
    cleaningSubmitted: uid('c1', 11),
    acFilterOffer: uid('c1', 12),
    faveCleaning: uid('c1', 13),
    kngnAircon: uid('c1', 14),
    /** Escalated three times by the Standard policy yesterday; sits in the Maintenance pool. */
    leakEscalated: uid('c1', 15),
  },
  /**
   * Live-clock tasks (2026-10-09): one per traffic-light condition, timed
   * from the moment the mock boots so green, amber and red always show
   * together. Seeded at the end of seedDemoData; never pinned by tests.
   */
  liveTask: {
    greenNew: uid('d1', 1),
    soonNew: uid('d1', 2),
    lateNew: uid('d1', 3),
    highTeamPool: uid('d1', 4),
    urgentDeptPool: uid('d1', 5),
    budiGreen: uid('d1', 6),
    budiPickedUpLate: uid('d1', 7),
    escalatedLevel1: uid('d1', 8),
    escalatedLevel2: uid('d1', 9),
    lowNoClock: uid('d1', 10),
    onHoldSoon: uid('d1', 11),
    scheduledLater: uid('d1', 12),
    hardDue: uid('d1', 13),
    submittedOnTime: uid('d1', 14),
    finishedLate: uid('d1', 15),
    verifiedPickedUpLate: uid('d1', 16),
    offerToBudi: uid('d1', 17),
    inactiveDept: uid('d1', 18),
    helpingBudi: uid('d1', 19),
  },
  guest: { amelia: uid('c2', 1), marcus: uid('c2', 2) },
  offer: { filterToMade: uid('c3', 1), vipToBudi: uid('c3', 2) },
  project: { lobby: uid('c6', 1), poolDeck: uid('c6', 2), rooftop: uid('c6', 3) },
  projectTask: { lobbyPaint: uid('c7', 1), lobbyLights: uid('c7', 2), lobbySignage: uid('c7', 3), rooftopArt: uid('c7', 4) },
  template: { nightlyMinibar: uid('c8', 1), mondayFilters: uid('c8', 2), budiRounds: uid('c8', 3) },
} as const

// ════════════════════════ Seed data ════════════════════════

const SEED = '2026-08-01T00:00:00.000Z'
/** The demo dataset is staged around this instant (10:00 WIB, 25 Aug 2026). */
const SEED_NOW = '2026-08-25T03:00:00.000Z'

const nowIso = () => new Date().toISOString()

const tenants: Tenant[] = [
  { hotelRef: IDS.hotel.simatupang, name: 'Aston Simatupang', timezone: 'Asia/Jakarta', groupId: IDS.group.aston, isActive: true, createdAt: SEED },
  { hotelRef: IDS.hotel.kuningan, name: 'Aston Kuningan Suites', timezone: 'Asia/Jakarta', groupId: IDS.group.aston, isActive: true, createdAt: SEED },
  { hotelRef: IDS.hotel.fave, name: 'Favehotels Wahid Hasyim', timezone: 'Asia/Jakarta', groupId: IDS.group.fave, isActive: true, createdAt: SEED },
]

const tenantGroups: TenantGroup[] = [
  { id: IDS.group.aston, name: 'Aston', createdAt: SEED, updatedAt: SEED },
  { id: IDS.group.fave, name: 'Favehotels', createdAt: SEED, updatedAt: SEED },
]

const masterDepartments: MasterDepartment[] = [
  { id: IDS.masterDept.housekeeping, name: 'Housekeeping', code: 'HK', description: 'Rooms, public areas and linen', isActive: true, updatedAt: SEED },
  { id: IDS.masterDept.maintenance, name: 'Maintenance', code: 'ENG', description: 'Engineering and repairs', isActive: true, updatedAt: SEED },
  { id: IDS.masterDept.frontOffice, name: 'Front Office', code: 'FO', description: null, isActive: true, updatedAt: SEED },
  { id: IDS.masterDept.fnb, name: 'Food & Beverage', code: 'FNB', description: null, isActive: true, updatedAt: SEED },
  // Retired by the platform (decision #6): no hotel may add it or reactivate it.
  { id: IDS.masterDept.spa, name: 'Spa & Wellness', code: 'SPA', description: 'Retired 2026-09: spa operations moved to a separate system', isActive: false, updatedAt: '2026-09-01T00:00:00.000Z' },
]

/** A hotel_department row joined to its master, as the API reads it. */
function seedHotelDept(id: Id, hotelRef: Id, departmentId: Id, isActive = true, updatedAt = SEED): HotelDepartment {
  const master = masterDepartments.find(d => d.id === departmentId)!
  return { id, hotelRef, departmentId, departmentName: master.name, code: master.code, description: master.description, isActive, masterIsActive: master.isActive, updatedAt }
}

const hotelDepartments: HotelDepartment[] = [
  seedHotelDept(IDS.dept.smtpHousekeeping, IDS.hotel.simatupang, IDS.masterDept.housekeeping),
  seedHotelDept(IDS.dept.smtpMaintenance, IDS.hotel.simatupang, IDS.masterDept.maintenance),
  seedHotelDept(IDS.dept.smtpFrontOffice, IDS.hotel.simatupang, IDS.masterDept.frontOffice),
  seedHotelDept(IDS.dept.smtpFnb, IDS.hotel.simatupang, IDS.masterDept.fnb),
  seedHotelDept(IDS.dept.kngnHousekeeping, IDS.hotel.kuningan, IDS.masterDept.housekeeping),
  seedHotelDept(IDS.dept.kngnMaintenance, IDS.hotel.kuningan, IDS.masterDept.maintenance),
  seedHotelDept(IDS.dept.faveHousekeeping, IDS.hotel.fave, IDS.masterDept.housekeeping),
  seedHotelDept(IDS.dept.faveFrontOffice, IDS.hotel.fave, IDS.masterDept.frontOffice),
  // Simatupang deactivated its spa department before the master was retired.
  seedHotelDept(IDS.dept.smtpSpa, IDS.hotel.simatupang, IDS.masterDept.spa, false, '2026-08-15T00:00:00.000Z'),
]

/** Storage row: the wire's StaffAccount plus the password; emsEmployeeId is null unless EMS linked the person. */
interface SeedAccount extends Omit<StaffAccount, 'emsEmployeeId'> {
  password: string
  emsEmployeeId?: string | null
  /** staff.ems_updated_at: the newest EMS push applied to the person at any hotel. */
  emsUpdatedAt?: string | null
}

/**
 * Accounts are identity only. A password of '' is an account made by the
 * roster import — it has no password and signs in by magic link or Google.
 */
const staffAccounts: SeedAccount[] = [
  // Budi and Made were added from EMS (EMP-00101 / EMP-00106): EMS owns their
  // name, email and membership at Simatupang, which is mapped to EMS below.
  { id: IDS.staff.budi, email: 'staff@aston.example', name: 'Budi Santoso', isActive: true, isOperator: false, password: 'staff123', emsEmployeeId: 'EMP-00101' },
  { id: IDS.staff.sari, email: 'leader@aston.example', name: 'Sari Dewi', isActive: true, isOperator: false, password: 'leader123' },
  { id: IDS.staff.agus, email: 'admin@aston.example', name: 'Agus Wijaya', isActive: true, isOperator: false, password: 'admin123' },
  // A platform operator has ZERO staff_hotel rows: hotel-scoped routes refuse
  // them (auth.HotelFor requires membership for humans) — platform-only actor.
  { id: IDS.staff.operator, email: 'operator@sentineltech.example', name: 'Platform Operator', isActive: true, isOperator: true, password: 'operator123' },
  { id: IDS.staff.rina, email: 'regional@aston.example', name: 'Rina Hartono', isActive: true, isOperator: false, password: 'regional123' },
  { id: IDS.staff.made, email: 'made@aston.example', name: 'Made Putra', isActive: true, isOperator: false, password: 'made12345', emsEmployeeId: 'EMP-00106' },
  { id: IDS.staff.joko, email: 'joko@aston.example', name: 'Joko Susilo', isActive: true, isOperator: false, password: 'joko12345' },
  { id: IDS.staff.nur, email: 'nur@fave.example', name: 'Nur Aini', isActive: true, isOperator: false, password: 'nur1234567' },
]

/**
 * staff_hotel rows ARE the memberships now (feat/projects 55db919): direct
 * hotel access, each row carrying that hotel's role, department and
 * create-task permission. Group grants expand the REACH (`properties`) on top
 * but add no membership row.
 *
 * MOCK ASSUMPTION, flagged for the API team: at a hotel reached only through
 * a group grant there is no membership, so the person is treated as plain
 * staff with no department and no create-task permission there (least
 * privilege). The branch notes do not say what role a grant confers; the
 * old account-wide model made Rina admin everywhere in the Aston group.
 */
interface MembershipRow {
  staffId: Id
  hotelRef: Id
  role: StaffRole
  hotelDepartmentId: Id | null
  createTask: boolean
  /** staff_profile.sync_issue: the EMS department name Tasks could not match (null = clean). */
  syncIssue?: string | null
  /** staff_profile.ems_updated_at: the newest EMS push applied to this membership; null = any push is newer. */
  emsUpdatedAt?: string | null
}
const staffHotels: MembershipRow[] = [
  { staffId: IDS.staff.budi, hotelRef: IDS.hotel.simatupang, role: 'staff', hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: true },
  { staffId: IDS.staff.budi, hotelRef: IDS.hotel.kuningan, role: 'staff', hotelDepartmentId: IDS.dept.kngnHousekeeping, createTask: true },
  { staffId: IDS.staff.sari, hotelRef: IDS.hotel.simatupang, role: 'leader', hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: true },
  { staffId: IDS.staff.agus, hotelRef: IDS.hotel.simatupang, role: 'admin', hotelDepartmentId: null, createTask: true },
  { staffId: IDS.staff.rina, hotelRef: IDS.hotel.kuningan, role: 'admin', hotelDepartmentId: null, createTask: true },
  // EMS says Made is in "Laundry", which Simatupang has no department for:
  // the membership keeps its department and carries the sync issue.
  { staffId: IDS.staff.made, hotelRef: IDS.hotel.simatupang, role: 'staff', hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: false, syncIssue: 'Laundry', emsUpdatedAt: '2026-08-20T01:00:00.000Z' },
  { staffId: IDS.staff.joko, hotelRef: IDS.hotel.simatupang, role: 'staff', hotelDepartmentId: IDS.dept.smtpMaintenance, createTask: true },
  { staffId: IDS.staff.nur, hotelRef: IDS.hotel.fave, role: 'staff', hotelDepartmentId: IDS.dept.faveHousekeeping, createTask: true },
]

/** The membership row for (staff, hotel), or null where there is none. */
const membershipAt = (staffId: Id | null | undefined, hotelRef: Id | null | undefined): MembershipRow | null =>
  (staffId && hotelRef ? staffHotels.find(r => r.staffId === staffId && r.hotelRef === hotelRef) ?? null : null)

/** The person's role at a hotel: the membership's, or plain `staff` where there is none (see above). */
const roleAt = (staffId: Id | null | undefined, hotelRef: Id | null | undefined): StaffRole => membershipAt(staffId, hotelRef)?.role ?? 'staff'

/** staff_tenant_group rows: cross-tenant grants (operator-managed). */
const groupGrants: Array<{ staffId: Id, groupId: Id }> = [
  { staffId: IDS.staff.rina, groupId: IDS.group.aston },
]

const boards: Board[] = [
  { id: IDS.board.smtp, hotelRef: IDS.hotel.simatupang, name: 'Operations Board', createdAt: SEED, updatedAt: SEED },
  { id: IDS.board.kngn, hotelRef: IDS.hotel.kuningan, name: 'Operations Board', createdAt: SEED, updatedAt: SEED },
  { id: IDS.board.fave, hotelRef: IDS.hotel.fave, name: 'Operations Board', createdAt: SEED, updatedAt: SEED },
]

const seedColumn = (id: Id, boardId: Id, name: string, sort: number, status: TaskStatus, description: string | null = null): BoardColumn =>
  ({ id, boardId, name, description, columnSort: sort, isActive: true, isRemoved: false, status })

const boardColumns: BoardColumn[] = [
  seedColumn(IDS.column.smtpNew, IDS.board.smtp, 'New', 1, 'NEW', 'Waiting to be picked up'),
  seedColumn(IDS.column.smtpInProgress, IDS.board.smtp, 'In Progress', 2, 'IN_PROGRESS', 'Being worked on now'),
  seedColumn(IDS.column.smtpAwaitingReview, IDS.board.smtp, 'Awaiting Review', 3, 'SUBMITTED', 'Submitted, waiting for a leader'),
  seedColumn(IDS.column.smtpOnHold, IDS.board.smtp, 'On Hold', 4, 'PENDING', 'Blocked or waiting on the requester'),
  seedColumn(IDS.column.smtpFinished, IDS.board.smtp, 'Finished', 5, 'FINISHED', 'Work done, awaiting verification'),
  seedColumn(IDS.column.smtpVerified, IDS.board.smtp, 'Verified', 6, 'VERIFIED', 'Checked and closed'),
  seedColumn(IDS.column.smtpCancelled, IDS.board.smtp, 'Cancelled', 7, 'CANCELLED', 'No longer required'),
  // Kuningan + Fave carry the provisioning template's standard six columns.
  ...(['kngn', 'fave'] as const).flatMap((key, hotelIndex) => {
    const boardId = key === 'kngn' ? IDS.board.kngn : IDS.board.fave
    const statuses: Array<[string, TaskStatus]> = [['New', 'NEW'], ['In Progress', 'IN_PROGRESS'], ['Awaiting Review', 'SUBMITTED'], ['Finished', 'FINISHED'], ['Verified', 'VERIFIED'], ['Cancelled', 'CANCELLED']]
    return statuses.map(([name, status], index) => seedColumn(uid('a7', 10 + hotelIndex * 10 + index), boardId, name, index + 1, status))
  }),
]

const slas: Sla[] = [
  { id: IDS.sla.smtpStandard, hotelRef: IDS.hotel.simatupang, name: 'Standard', responseTime: 15, resolutionTime: 45, isDefault: true, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  // The Urgent SLA names its own policy; everything else falls through to the hotel's default policy.
  { id: IDS.sla.smtpUrgent, hotelRef: IDS.hotel.simatupang, name: 'Urgent', responseTime: 5, resolutionTime: 20, isDefault: false, escalationPolicyId: IDS.policy.smtpUrgent, createdAt: SEED, updatedAt: SEED },
  { id: IDS.sla.smtpScheduled, hotelRef: IDS.hotel.simatupang, name: 'Scheduled', responseTime: 120, resolutionTime: 480, isDefault: false, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.sla.kngnStandard, hotelRef: IDS.hotel.kuningan, name: 'Standard', responseTime: 20, resolutionTime: 60, isDefault: true, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.sla.faveStandard, hotelRef: IDS.hotel.fave, name: 'Standard', responseTime: 30, resolutionTime: 90, isDefault: true, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
]

const categories: Category[] = [
  { id: IDS.category.hk, hotelRef: IDS.hotel.simatupang, name: 'Housekeeping', code: 'HK', sort: 1, isActive: true, icon: 'vacuum', createdAt: SEED, updatedAt: SEED },
  { id: IDS.category.mnt, hotelRef: IDS.hotel.simatupang, name: 'Maintenance', code: 'MNT', sort: 2, isActive: true, icon: 'wrench', createdAt: SEED, updatedAt: SEED },
  { id: IDS.category.concierge, hotelRef: IDS.hotel.simatupang, name: 'Concierge', code: 'CNS', sort: 3, isActive: true, icon: 'bell', createdAt: SEED, updatedAt: SEED },
  { id: IDS.category.fnb, hotelRef: IDS.hotel.simatupang, name: 'Food & Beverage', code: 'FNB', sort: 4, isActive: true, icon: 'utensils', createdAt: SEED, updatedAt: SEED },
  { id: IDS.category.faveHk, hotelRef: IDS.hotel.fave, name: 'Housekeeping', code: 'HK', sort: 1, isActive: true, icon: null, createdAt: SEED, updatedAt: SEED },
]

const seedItem = (partial: Pick<CatalogItem, 'id' | 'hotelRef' | 'name' | 'categoryId'> & Partial<CatalogItem>): CatalogItem => ({
  description: null,
  itemQuantity: false,
  isActive: true,
  defaultPriority: 'NORMAL',
  requiresLocation: false,
  defaultChecklist: [],
  defaultDurationMinutes: null,
  minProofPhotos: 0,
  requiresCompletionNote: false,
  createdAt: SEED,
  updatedAt: SEED,
  ...partial,
})

const catalogItems: CatalogItem[] = [
  seedItem({ id: IDS.item.towels, hotelRef: IDS.hotel.simatupang, name: 'Extra towels', categoryId: IDS.category.hk, itemQuantity: true, requiresLocation: true }),
  seedItem({
    id: IDS.item.roomCleaning, hotelRef: IDS.hotel.simatupang, name: 'Room cleaning', categoryId: IDS.category.hk,
    requiresLocation: true, defaultDurationMinutes: 60, minProofPhotos: 1, requiresCompletionNote: true,
    defaultChecklist: ['Strip and remake the beds', 'Vacuum and mop the floors', 'Restock amenities'],
  }),
  seedItem({ id: IDS.item.turndown, hotelRef: IDS.hotel.simatupang, name: 'Turndown service', categoryId: IDS.category.hk, defaultDurationMinutes: 30 }),
  seedItem({ id: IDS.item.acFault, hotelRef: IDS.hotel.simatupang, name: 'Air conditioner not cooling', categoryId: IDS.category.mnt, defaultPriority: 'URGENT', requiresLocation: true, minProofPhotos: 1, requiresCompletionNote: true }),
  seedItem({ id: IDS.item.lightBulb, hotelRef: IDS.hotel.simatupang, name: 'Light bulb replacement', categoryId: IDS.category.mnt, itemQuantity: true, requiresLocation: true }),
  seedItem({ id: IDS.item.plumbing, hotelRef: IDS.hotel.simatupang, name: 'Plumbing / leak', categoryId: IDS.category.mnt, defaultPriority: 'HIGH', requiresLocation: true, minProofPhotos: 2, requiresCompletionNote: true }),
  seedItem({ id: IDS.item.transfer, hotelRef: IDS.hotel.simatupang, name: 'Airport transfer', categoryId: IDS.category.concierge, description: 'Arrange the hotel car or a taxi' }),
  seedItem({ id: IDS.item.lateCheckout, hotelRef: IDS.hotel.simatupang, name: 'Late checkout request', categoryId: IDS.category.concierge, defaultPriority: 'LOW' }),
  seedItem({ id: IDS.item.inRoomDining, hotelRef: IDS.hotel.simatupang, name: 'In-room dining', categoryId: IDS.category.fnb, itemQuantity: true, requiresLocation: true, defaultDurationMinutes: 30 }),
  seedItem({ id: IDS.item.minibar, hotelRef: IDS.hotel.simatupang, name: 'Minibar restock', categoryId: IDS.category.fnb, itemQuantity: true, requiresLocation: true }),
  seedItem({ id: IDS.item.faveCleaning, hotelRef: IDS.hotel.fave, name: 'Room cleaning', categoryId: IDS.category.faveHk, requiresLocation: true }),
]

const locationTypes: LocationType[] = [
  { id: IDS.locationType.room, hotelRef: IDS.hotel.simatupang, name: 'Guest Room', code: 'RM', linksRequester: true, sort: 1, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.locationType.floor, hotelRef: IDS.hotel.simatupang, name: 'Floor', code: 'FL', linksRequester: false, sort: 2, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.locationType.publicArea, hotelRef: IDS.hotel.simatupang, name: 'Public Area', code: 'PA', linksRequester: false, sort: 3, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.locationType.backOffice, hotelRef: IDS.hotel.simatupang, name: 'Back Office', code: 'BO', linksRequester: false, sort: 4, isActive: false, createdAt: SEED, updatedAt: SEED },
  { id: IDS.locationType.faveRoom, hotelRef: IDS.hotel.fave, name: 'Guest Room', code: 'RM', linksRequester: true, sort: 1, isActive: true, createdAt: SEED, updatedAt: SEED },
]

const locations: Location[] = [
  { id: IDS.location.room1204, hotelRef: IDS.hotel.simatupang, locationTypeId: IDS.locationType.room, name: 'Room 1204', code: '1204', parentId: null, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.location.room0908, hotelRef: IDS.hotel.simatupang, locationTypeId: IDS.locationType.room, name: 'Room 0908', code: '0908', parentId: null, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.location.room1102, hotelRef: IDS.hotel.simatupang, locationTypeId: IDS.locationType.room, name: 'Room 1102', code: '1102', parentId: null, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.location.floor7, hotelRef: IDS.hotel.simatupang, locationTypeId: IDS.locationType.floor, name: 'Floor 7', code: 'F7', parentId: null, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.location.lobby, hotelRef: IDS.hotel.simatupang, locationTypeId: IDS.locationType.publicArea, name: 'Lobby', code: 'LBY', parentId: null, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.location.faveRoom0210, hotelRef: IDS.hotel.fave, locationTypeId: IDS.locationType.faveRoom, name: 'Room 0210', code: '0210', parentId: null, isActive: true, createdAt: SEED, updatedAt: SEED },
]

const teams: Team[] = [
  { id: IDS.team.hkMorning, hotelRef: IDS.hotel.simatupang, name: 'HK Morning Shift', description: 'Rooms and corridors, 06:00–14:00', hotelDepartmentId: IDS.dept.smtpHousekeeping, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.team.engineering, hotelRef: IDS.hotel.simatupang, name: 'Engineering On-Call', description: null, hotelDepartmentId: IDS.dept.smtpMaintenance, isActive: true, createdAt: SEED, updatedAt: SEED },
]

const teamMembers: Array<{ teamId: Id, staffId: Id, createdAt: string }> = [
  { teamId: IDS.team.hkMorning, staffId: IDS.staff.budi, createdAt: SEED },
  { teamId: IDS.team.hkMorning, staffId: IDS.staff.made, createdAt: SEED },
  { teamId: IDS.team.engineering, staffId: IDS.staff.joko, createdAt: SEED },
]

const operatingSchedules: OperatingSchedule[] = [
  {
    id: IDS.schedule.smtpDefault, hotelRef: IDS.hotel.simatupang, name: 'Property 24/7', isDefault: true, hotelDepartmentId: null,
    windows: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensMinutes: 0, closesMinutes: 1440 })),
    exceptions: [],
    createdAt: SEED, updatedAt: SEED,
  },
  {
    id: IDS.schedule.smtpEngineering, hotelRef: IDS.hotel.simatupang, name: 'Engineering Hours', isDefault: false, hotelDepartmentId: IDS.dept.smtpMaintenance,
    windows: [
      { weekday: 1, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 2, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 3, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 4, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 5, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 6, opensMinutes: 480, closesMinutes: 780 },
    ],
    exceptions: [{ date: '2026-08-17', isClosed: true, opensMinutes: null, closesMinutes: null }],
    createdAt: SEED, updatedAt: SEED,
  },
]

/** Per-hotel terminology overrides, merged over the vertical profile. */
const terminologyOverrides: Array<{ hotelRef: Id, key: string, value: string }> = [
  { hotelRef: IDS.hotel.simatupang, key: 'requester', value: 'Guest' },
]

/** The vertical profile's terms; `project` joined with feat/projects (there is no `projects` key). */
const TERMINOLOGY_DEFAULT_PROFILE: Record<string, string> = {
  requester: 'Requester',
  visit: 'Visit',
  location: 'Location',
  department: 'Department',
  project: 'Project',
}

const sourceApps: SourceApp[] = [
  { code: 'sentec-tasks', name: 'Sentec Tasks', shortName: 'Tasks', icon: null, color: '#2563eb', isActive: true },
  { code: 'sentec-butler', name: 'Sentec Butler', shortName: 'Butler', icon: null, color: '#7c3aed', isActive: true },
  { code: 'sentec-pms', name: 'Sentec PMS', shortName: 'PMS', icon: null, color: '#059669', isActive: true },
  { code: 'sentec-crm', name: 'Sentec CRM', shortName: 'CRM', icon: null, color: '#d97706', isActive: true },
  { code: 'sentec-ems', name: 'Sentec EMS', shortName: 'EMS', icon: null, color: '#dc2626', isActive: true },
  { code: 'sentec-sbe', name: 'Booking Engine', shortName: 'SBE', icon: null, color: '#0891b2', isActive: true },
]

const partners: Partner[] = [
  { id: IDS.partner.butler, name: 'Sentec Butler', isActive: true, capabilities: [], createdAt: SEED, updatedAt: SEED },
  { id: IDS.partner.pms, name: 'Sentec PMS', isActive: true, capabilities: [], createdAt: SEED, updatedAt: SEED },
  // EMS is the one partner allowed to push staff changes (capability staff_sync).
  { id: IDS.partner.ems, name: 'Sentec EMS', isActive: true, capabilities: ['staff_sync'], createdAt: SEED, updatedAt: SEED },
]

/** Env EMS_PARTNER_ID: which partner row IS Sentec EMS, for the outbound directory calls and the "managed by EMS" check. */
const EMS_PARTNER_ID: Id = IDS.partner.ems

/**
 * tenant_sync rows (feat/ems-staff-sync): a partner's own id for a property.
 * Only Simatupang is mapped to EMS; the other two answer 422 "this property
 * is not linked to EMS" on the EMS routes and are never touched by a push.
 */
const tenantSyncLinks: TenantSyncLink[] = [
  { id: IDS.syncLink.smtpEms, hotelRef: IDS.hotel.simatupang, partnerId: IDS.partner.ems, partnerName: 'Sentec EMS', syncId: 'EMS-HTL-01', createdAt: SEED, updatedAt: SEED },
]

/**
 * The EMS seam (ems.Directory): what GET {EMS_BASE_URL}/employees?hotelId=
 * would return per EMS hotel id. A browser mock cannot call EMS, so the
 * directory lives here; an unknown hotel id reads as EMS being unreachable.
 */
interface EmsDirectoryRow { id: string, name: string, email: string | null, active: boolean, departmentName: string | null }
const emsDirectory = new Map<string, EmsDirectoryRow[]>([
  ['EMS-HTL-01', [
    { id: 'EMP-00101', name: 'Budi Santoso', email: 'staff@aston.example', active: true, departmentName: 'Housekeeping' },
    { id: 'EMP-00106', name: 'Made Putra', email: 'made@aston.example', active: true, departmentName: 'Laundry' },
    // Joko exists as MANUAL staff with this email: adding him LINKS the account.
    { id: 'EMP-00107', name: 'Joko Susilo', email: 'joko@aston.example', active: true, departmentName: 'Maintenance' },
    { id: 'EMP-00120', name: 'Ayu Lestari', email: 'ayu.lestari@aston.example', active: true, departmentName: 'Housekeeping' },
    { id: 'EMP-00121', name: 'Dewi Kartika', email: 'dewi.kartika@aston.example', active: true, departmentName: 'Front Office' },
    // "Spa" matches nothing active here: addable, but with a sync issue once added.
    { id: 'EMP-00122', name: 'Rizky Pratama', email: 'rizky.pratama@aston.example', active: true, departmentName: 'Spa' },
    { id: 'EMP-00123', name: 'Wayan Suardika', email: null, active: true, departmentName: 'Maintenance' },
    { id: 'EMP-00124', name: 'Siti Rahma', email: 'siti.rahma@aston.example', active: false, departmentName: 'Housekeeping' },
  ]],
])

// ── Escalation policies (feat/escalation). Steps are stored with a soft-delete
// flag, as escalation_step.deleted_at is; reads show live steps only.
interface PolicyRow { id: Id, hotelRef: Id, name: string, isDefault: boolean, isActive: boolean, createdAt: string, updatedAt: string }
interface StepRow extends EscalationStep { hotelRef: Id, policyId: Id, deletedAt: string | null, createdAt: string, updatedAt: string }

const escalationPolicies: PolicyRow[] = [
  { id: IDS.policy.smtpStandard, hotelRef: IDS.hotel.simatupang, name: 'Standard escalation', isDefault: true, isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.policy.smtpUrgent, hotelRef: IDS.hotel.simatupang, name: 'Urgent escalation', isDefault: false, isActive: true, createdAt: SEED, updatedAt: SEED },
]

const escalationSteps: StepRow[] = [
  // Standard: tell the leaders at the response deadline; halfway to resolution
  // bump the priority; at the resolution deadline bump again and tell admins.
  { id: IDS.step.stdResponse, hotelRef: IDS.hotel.simatupang, policyId: IDS.policy.smtpStandard, sort: 0, triggerKind: 'RESPONSE_OVERDUE', triggerValue: 0, actions: [], recipients: [{ kind: 'departmentLeaders' }], deletedAt: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.step.stdHalfway, hotelRef: IDS.hotel.simatupang, policyId: IDS.policy.smtpStandard, sort: 1, triggerKind: 'PERCENT_OF_RESOLUTION', triggerValue: 50, actions: [{ type: 'bumpPriority' }], recipients: [{ kind: 'departmentLeaders' }, { kind: 'assignee' }], deletedAt: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.step.stdOverdue, hotelRef: IDS.hotel.simatupang, policyId: IDS.policy.smtpStandard, sort: 2, triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 0, actions: [{ type: 'bumpPriority' }], recipients: [{ kind: 'admins' }, { kind: 'departmentLeaders' }], deletedAt: null, createdAt: SEED, updatedAt: SEED },
  // Urgent: unclaimed for 10 open minutes → hand it to Engineering On-Call;
  // 15 minutes past resolution → bump and tell the admins.
  { id: IDS.step.urgUnassigned, hotelRef: IDS.hotel.simatupang, policyId: IDS.policy.smtpUrgent, sort: 0, triggerKind: 'UNASSIGNED_FOR', triggerValue: 10, actions: [{ type: 'reassign', teamId: IDS.team.engineering }], recipients: [{ kind: 'team', teamId: IDS.team.engineering }], deletedAt: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.step.urgOverdue, hotelRef: IDS.hotel.simatupang, policyId: IDS.policy.smtpUrgent, sort: 1, triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 15, actions: [{ type: 'bumpPriority' }], recipients: [{ kind: 'admins' }, { kind: 'assignee' }], deletedAt: null, createdAt: SEED, updatedAt: SEED },
]

/** task_escalation rows: one per (task, step) ever applied — a step never fires twice. */
const taskEscalations: TaskEscalation[] = []

/**
 * The PMS seam: current visit by (hotel, location code). `found:false` rooms
 * are simply absent. Codes in ERROR_CODES throw, exercising the
 * "requester lookup failed: …" warning path without taking PMS down globally.
 */
const pmsVisits = new Map<string, { requesterRef: Id, requesterName: string, visitRef: string }>([
  [`${IDS.hotel.simatupang}|1204`, { requesterRef: IDS.guest.amelia, requesterName: 'Amelia Chen', visitRef: 'V-88121' }],
  [`${IDS.hotel.simatupang}|0908`, { requesterRef: IDS.guest.marcus, requesterName: 'Marcus Reid', visitRef: 'V-88104' }],
])
const PMS_ERROR_CODES = new Set(['PMS-DOWN'])

const routingRules: RoutingRule[] = [
  { id: IDS.rule.acFault, hotelRef: IDS.hotel.simatupang, itemRef: IDS.item.acFault, categoryId: null, locationTypeId: null, priority: null, specificity: 4, hotelDepartmentId: IDS.dept.smtpMaintenance, slaId: IDS.sla.smtpUrgent, remark: 'AC faults are urgent', escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.hk, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.hk, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpStandard, remark: null, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.mnt, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.mnt, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpMaintenance, slaId: IDS.sla.smtpStandard, remark: null, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.concierge, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.concierge, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpFrontOffice, slaId: IDS.sla.smtpStandard, remark: null, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.fnb, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.fnb, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpFnb, slaId: IDS.sla.smtpStandard, remark: null, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.publicArea, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: null, locationTypeId: IDS.locationType.publicArea, priority: null, specificity: 2, hotelDepartmentId: IDS.dept.smtpFrontOffice, slaId: IDS.sla.smtpStandard, remark: 'Public areas are Front Office ground', escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.urgent, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: null, locationTypeId: null, priority: 'URGENT', specificity: 1, hotelDepartmentId: IDS.dept.smtpMaintenance, slaId: IDS.sla.smtpUrgent, remark: 'Unrouted urgent work goes to Maintenance', escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.faveHk, hotelRef: IDS.hotel.fave, itemRef: null, categoryId: IDS.category.faveHk, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.faveHousekeeping, slaId: IDS.sla.faveStandard, remark: null, escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.faveCatchAll, hotelRef: IDS.hotel.fave, itemRef: null, categoryId: null, locationTypeId: null, priority: null, specificity: 0, hotelDepartmentId: IDS.dept.faveHousekeeping, slaId: IDS.sla.faveStandard, remark: 'Catch-all', escalationPolicyId: null, createdAt: SEED, updatedAt: SEED },
]

// Mutable stores the endpoints operate on.
const tasks: Task[] = []
const taskAssignments: TaskAssignment[] = []
const taskHistory: TaskHistory[] = []
const taskComments: TaskComment[] = []
const taskAttachments: TaskAttachment[] = []
const taskCollaborators: Collaborator[] = []
const taskOffers: TaskOffer[] = []
const taskContextEntries: TaskContextEntry[] = []
const checklistItems: ChecklistItem[] = []

// ── Projects, templates, tenant settings (feat/projects) ────────────────────

/** The stored project; the read model adds myLevel, late, needsManager, progress. */
interface ProjectRow {
  id: Id
  hotelRef: Id
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
  status: ProjectStatus
  completedAt: string | null
  createdBy: Id | null
  createdAt: string
  updatedAt: string
}
interface ProjectMemberRow { projectId: Id, staffId: Id, level: ProjectLevel, source: 'MANUAL' | 'AUTO', addedBy: Id | null, addedAt: string }
const projects: ProjectRow[] = []
const projectMembers: ProjectMemberRow[] = []

/** The stored template; nextRunAt/upcoming are computed from the recurrence and the hotel zone. */
interface TemplateRow {
  id: Id
  hotelRef: Id
  name: string
  isActive: boolean
  /** Storage-side only: the wire model has no scope; personal = ownerStaffId set. */
  scope: 'shared' | 'personal'
  content: TaskTemplateContent
  recurrence: TaskTemplateRecurrence | null
  nextRunAt: string | null
  lastRunAt: string | null
  lastOccurrenceAt: string | null
  lastTaskId: Id | null
  lastError: string | null
  createdBy: Id | null
  ownerStaffId: Id | null
  isArchived: boolean
  createdAt: string
  updatedAt: string
}
const taskTemplates: TemplateRow[] = []
/** task.event_seq — bumped per lifecycle event, snapshotted onto history rows. */
const eventSeq = new Map<Id, number>()

// ════════════════════════ Sessions, tokens, rate limiting ════════════════════════

interface Session { id: Id, staffId: Id, csrfToken: string, expiresAt: number }

const sessions = new Map<Id, Session>()
const staffBearerTokens = new Map<string, { staffId: Id, expiresAt: number }>()
const loginFailures = new Map<string, { count: number, windowStart: number }>()
const LOGIN_RATE_MAX = 5
const LOGIN_RATE_WINDOW_MS = 15 * 60_000
const SESSION_TTL_MS = 12 * 60 * 60_000

let idCounter = 1000
const newId = (): Id => uid('ff', idCounter++)

function randomToken(): string {
  // 32 random bytes, base64url no padding (43 chars) — like the real CSRF token.
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** One place mints the cookie session for all three sign-in paths (staff.SetSessionCookie). */
function startCookieSession(acct: SeedAccount): Session {
  const session: Session = { id: newId(), staffId: acct.id, csrfToken: randomToken(), expiresAt: Date.now() + SESSION_TTL_MS }
  sessions.set(session.id, session)
  return session
}

// ════════════════════════ Passwordless sign-in (48756a3) ════════════════════════
//
// Google Sign-In (backend authorization-code flow with PKCE) and the emailed
// magic link. Both authenticate a pre-existing ACTIVE staff row by lowercased
// email — no auto-provisioning — and converge on the same st_session cookie
// password login mints, so there is no new actor kind. Simulated here:
//
//   - CORS_ALLOWED_ORIGINS doubles as the post-sign-in redirect allow-list;
//     its FIRST entry is the fallback target. The mock's list is this app's
//     own origin (node: http://localhost:3000).
//   - The st_oauth_flow cookie is one slot, not a table — a cookie is per
//     browser — holding state + sealed returnTo, cleared on every terminal
//     outcome. "Google" is a consent URL the login screen recognises and
//     renders as an account chooser; the authorization code it hands back
//     names the chosen identity, and the callback "exchanges" it.
//   - The mail transport is the API's MAIL_DEV_CONSOLE one: the link is
//     printed to the console and kept in an outbox the login screen can open.
//   - Rate limits: the per-address magic-link budget (3 per 15 min, charged on
//     SUCCESS — every request costs an email). The per-IP budgets are not
//     simulated: a browser mock has exactly one client.

const ALLOWED_ORIGINS: string[] = [typeof location !== 'undefined' ? location.origin : 'http://localhost:3000']
/** This service's own public origin (API_BASE_URL): where an emailed link and the Google redirect_uri point. */
const API_BASE_URL = 'https://api.sentec-tasks.example'
const MOCK_GOOGLE_AUTH_ORIGIN = 'https://accounts.google.example'
const MOCK_GOOGLE_CLIENT_ID = '261178633818-mock.apps.googleusercontent.example'
const OAUTH_FLOW_TTL_MS = 10 * 60_000
const MAGIC_LINK_TTL_MS = 15 * 60_000
const MAGIC_LINK_RATE_MAX = 3
const MAGIC_LINK_RATE_WINDOW_MS = 15 * 60_000

interface MagicLinkToken { token: string, staffId: Id, expiresAt: number, consumedAt: number | null }
const magicLinkTokens: MagicLinkToken[] = []
const magicLinkRequests = new Map<string, { count: number, windowStart: number }>()
let oauthFlow: { state: string, returnTo: string, expiresAt: number } | null = null

/** What the dev-console mail transport printed: the login screen's "demo inbox". */
export interface DemoMail { to: string, subject: string, link: string, sentAt: string }
const mailOutbox: DemoMail[] = []

/**
 * Identities the mock's Google account chooser offers. The seeded staff, plus
 * two that exercise the callback's refusals: an address with no staff row
 * (→ no_account) and one Google reports as unverified (→ email_unverified).
 */
export interface DemoGoogleIdentity { email: string, name: string, emailVerified: boolean, hasAccount: boolean }
const OUTSIDER_IDENTITIES: DemoGoogleIdentity[] = [
  { email: 'someone.else@gmail.example', name: 'Someone without a staff account', emailVerified: true, hasAccount: false },
  { email: 'unverified@gmail.example', name: 'An unverified Google address', emailVerified: false, hasAccount: false },
]

/**
 * httpx.parseOrigin: scheme://host[:port], lowercased, default ports dropped;
 * refuses anything that is not http(s), carries credentials, or is opaque.
 */
function parseOrigin(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001F\u007F]/.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    return null
  }
  if (url.username || url.password) return null
  const scheme = url.protocol.slice(0, -1).toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') return null
  const host = url.hostname.toLowerCase()
  if (!host || host.endsWith('.')) return null
  return `${scheme}://${host}${url.port ? `:${url.port}` : ''}`
}

/** httpx.AllowedRedirect: the raw URL back when its ORIGIN is allow-listed — parsed, never a prefix match. */
function allowedRedirect(raw: string): string | null {
  if (!raw) return null
  const origin = parseOrigin(raw)
  if (!origin) return null
  return ALLOWED_ORIGINS.some(entry => parseOrigin(entry) === origin) ? raw : null
}

/** httpx.DefaultRedirect: the allow-list's first parseable entry, as a bare origin. */
function defaultRedirect(): string | null {
  for (const entry of ALLOWED_ORIGINS) {
    const origin = parseOrigin(entry)
    if (origin) return origin
  }
  return null
}

/** httpx.RedirectWithError: ?authError=<code> appended to the target. */
function withAuthError(target: string, code: AuthErrorCode): string {
  const url = new URL(target)
  url.searchParams.set('authError', code)
  return url.toString()
}

/**
 * magiclink.resolveTarget: an absent returnTo falls back silently; a present
 * but non-allow-listed one falls back too, carrying invalid_return_to, and
 * the rejected value is never echoed.
 */
function resolveRedirectTarget(raw: string | undefined): { target: string | null, code: AuthErrorCode | null } {
  if (raw) {
    const allowed = allowedRedirect(raw)
    if (allowed) return { target: allowed, code: null }
    return { target: defaultRedirect(), code: 'invalid_return_to' }
  }
  return { target: defaultRedirect(), code: null }
}

/** A 302 with its Location and, on success, the st_session Set-Cookie seam. */
const redirect = (location: string, sessionId?: Id): FakeResponse<never> => ({
  status: 302,
  body: null,
  headers: { location, ...(sessionId ? { 'set-cookie': `st_session=${sessionId}` } : {}) },
})

/** Deliberately shallow, like the Go: exactly one @, something on each side, no spaces. */
function looksLikeEmail(s: string): boolean {
  if (!s || s.length > 320 || /[ \t\r\n]/.test(s)) return false
  const at = s.indexOf('@')
  return at > 0 && at === s.lastIndexOf('@') && at < s.length - 1
}

/** Fixed-window budget charged on SUCCESS: true = allowed (and counted). */
function allowMagicLinkRequest(email: string): boolean {
  const now = Date.now()
  const bucket = magicLinkRequests.get(email)
  const window = bucket && now - bucket.windowStart < MAGIC_LINK_RATE_WINDOW_MS ? bucket : { count: 0, windowStart: now }
  if (window.count >= MAGIC_LINK_RATE_MAX) return false
  window.count += 1
  magicLinkRequests.set(email, window)
  return true
}

/** The mock's Google: the authorization code names the identity it was granted for. */
const googleCodeFor = (email: string) => `4/mock.${encodeURIComponent(email)}`

function exchangeGoogleCode(code: string | undefined): DemoGoogleIdentity | null {
  if (!code || !code.startsWith('4/mock.')) return null
  const email = decodeURIComponent(code.slice('4/mock.'.length)).toLowerCase()
  const outsider = OUTSIDER_IDENTITIES.find(i => i.email === email)
  if (outsider) return outsider
  const acct = staffAccounts.find(s => s.email === email)
  return acct ? { email: acct.email, name: acct.name, emailVerified: true, hasAccount: true } : { email, name: email, emailVerified: true, hasAccount: false }
}

// ════════════════════════ Actor resolution (EitherAuth) ════════════════════════

export interface Actor {
  isService: boolean
  actingUser: string
  staffId: Id | null
  /** At the request's hotel (X-Hotel-Id); `staff` with no membership there. */
  role: StaffRole
  deptId: Id | null
  createTask: boolean
  /** The reach claim: direct memberships ∪ every hotel of a granted group. */
  hotels: Id[]
  /** Every membership, for routes that name no single hotel ("admin at any property"). */
  memberships: HotelMembership[]
  partnerId: Id | null
  partnerName: string
  /** The partner row's capabilities, read on every request — a revoke applies from the next call. */
  partnerCapabilities: string[]
  isOperator: boolean
  sessionId: Id | null
  csrfToken: string
}

interface RequestOpts {
  method?: string
  body?: Record<string, unknown>
  headers?: Record<string, string | undefined>
  query?: Record<string, string | number | boolean | null | undefined>
}

interface Ctx {
  method: string
  path: string
  body: Record<string, unknown>
  headers: Record<string, string>
  query: Record<string, string>
  actor: Actor
}

const account = (id: Id | null | undefined) => staffAccounts.find(s => s.id === id) ?? null

/** The Hotels claim: direct staff_hotel rows ∪ every hotel in granted groups. */
function hotelsClaim(staffId: Id): Id[] {
  const direct = staffHotels.filter(r => r.staffId === staffId).map(r => r.hotelRef)
  const viaGroups = groupGrants
    .filter(g => g.staffId === staffId)
    .flatMap(g => tenants.filter(t => t.groupId === g.groupId).map(t => t.hotelRef))
  return [...new Set([...direct, ...viaGroups])]
}

/**
 * Roles are per property, so the actor's role/deptId/createTask are the
 * membership at the hotel the request names in X-Hotel-Id — the same way the
 * server resolves them after the hotel is known. With no header, or no
 * membership there, the actor is plain staff with nothing else; routes that
 * need an admin then say why (400 without a hotel, 403 without the role).
 */
function staffActor(acct: SeedAccount, session: Session | null, hotelHeader: string | undefined): Actor {
  const hotelRef = isUuid(hotelHeader) ? hotelHeader.toLowerCase() : null
  const membership = membershipAt(acct.id, hotelRef)
  return {
    isService: false,
    actingUser: '',
    staffId: acct.id,
    role: membership?.role ?? 'staff',
    deptId: membership?.hotelDepartmentId ?? null,
    createTask: membership?.createTask ?? false,
    hotels: hotelsClaim(acct.id),
    memberships: staffHotels.filter(r => r.staffId === acct.id).map(membershipModel),
    partnerId: null,
    partnerName: '',
    partnerCapabilities: [],
    isOperator: acct.isOperator,
    sessionId: session?.id ?? null,
    csrfToken: session?.csrfToken ?? '',
  }
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/**
 * EitherAuth, mock edition. Bearer wins: a present-but-malformed Authorization
 * header NEVER falls back to the cookie. Order: service → partner → staff.
 */
function resolveActor(headers: Record<string, string>): Actor {
  const authorization = headers.authorization
  if (authorization !== undefined) {
    const match = /^Bearer (.+)$/.exec(authorization)
    if (!match || !match[1]) throw unauthorized('missing bearer token')
    const token = match[1]
    if (token.startsWith('service:')) {
      return { isService: true, actingUser: headers['x-acting-user'] ?? '', staffId: null, role: 'admin', deptId: null, createTask: false, hotels: [], memberships: [], partnerId: null, partnerName: '', partnerCapabilities: [], isOperator: false, sessionId: null, csrfToken: '' }
    }
    if (token.startsWith('partner:')) {
      const partner = partners.find(p => p.id === token.slice('partner:'.length))
      // A deactivated partner fails verification instantly — no caching.
      if (!partner || !partner.isActive) throw unauthorized('invalid token')
      return { isService: true, actingUser: headers['x-acting-user'] ?? '', staffId: null, role: 'admin', deptId: null, createTask: false, hotels: [], memberships: [], partnerId: partner.id, partnerName: partner.name, partnerCapabilities: [...partner.capabilities], isOperator: false, sessionId: null, csrfToken: '' }
    }
    const bearer = staffBearerTokens.get(token)
    if (!bearer || bearer.expiresAt < Date.now()) throw unauthorized('invalid token')
    const acct = account(bearer.staffId)
    if (!acct || !acct.isActive) throw unauthorized('invalid token')
    return staffActor(acct, null, headers['x-hotel-id'])
  }

  const sessionId = parseCookie(headers.cookie, 'st_session')
  const session = sessionId ? sessions.get(sessionId) : undefined
  if (!session || session.expiresAt < Date.now()) throw unauthorized('invalid token')
  const acct = account(session.staffId)
  if (!acct || !acct.isActive) throw unauthorized('invalid token')
  return staffActor(acct, session, headers['x-hotel-id'])
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** CSRF applies to cookie actors only; Bearer/service/partner bypass it always. */
function checkCsrf(ctx: Ctx) {
  if (SAFE_METHODS.has(ctx.method)) return
  if (!ctx.actor.sessionId) return
  if (!ctx.actor.csrfToken || ctx.headers['x-csrf-token'] !== ctx.actor.csrfToken) {
    throw forbidden('invalid CSRF token')
  }
}

/**
 * auth.HotelFor: service actors resolve ?hotelRef= then X-Hotel-Id, any hotel;
 * humans resolve X-Hotel-Id ONLY and must be a member of it. An operator has
 * an empty Hotels claim, so hotel-scoped routes refuse them — platform-only.
 */
function hotelFor(ctx: Ctx): Id {
  if (ctx.actor.isService) {
    const ref = ctx.query.hotelRef || ctx.headers['x-hotel-id']
    if (!isUuid(ref)) throw badRequest('hotel context required')
    return ref.toLowerCase()
  }
  const header = ctx.headers['x-hotel-id']
  if (!isUuid(header)) throw badRequest('hotel context required')
  const id = header.toLowerCase()
  if (!ctx.actor.hotels.includes(id)) throw forbidden('no access to this hotel')
  return id
}

/** The staff package's divergent resolver: ?hotelId= → ?hotelRef= → X-Hotel-Id. */
function resolveHotelForActor(ctx: Ctx): Id {
  const raw = ctx.query.hotelId || ctx.query.hotelRef || ctx.headers['x-hotel-id']
  if (!raw) throw badRequest('hotelId, hotelRef, or X-Hotel-Id header is required')
  if (!isUuid(raw)) throw badRequest('hotelId, hotelRef, or X-Hotel-Id header must be a UUID')
  const id = raw.toLowerCase()
  if (ctx.actor.isService || ctx.actor.isOperator) return id
  if (!ctx.actor.hotels.includes(id)) throw forbidden('no access to this hotel')
  return id
}

/**
 * Admin at ONE hotel. Roles are per property (feat/projects), so the check
 * runs after the hotel is resolved: a human on a hotel-scoped admin route
 * without X-Hotel-Id now gets the 400 from hotelFor, where it used to be 403.
 * Service and operator actors pass — the operator reaches admin reads such as
 * GET /v1/staff?hotelId= for any hotel from the platform screens.
 */
function requireAdminAt(ctx: Ctx, hotelRef: Id) {
  if (ctx.actor.isService || ctx.actor.isOperator) return
  if (roleAt(ctx.actor.staffId, hotelRef) !== 'admin') throw forbidden('admin access required')
}

/** Hotel-scoped admin route: resolve the hotel (400 without one), then the role there. */
function requireAdmin(ctx: Ctx) {
  if (ctx.actor.isService || ctx.actor.isOperator) return
  requireAdminAt(ctx, hotelFor(ctx))
}

/**
 * Routes that name no single hotel (the master department list, a staff
 * PATCH touching only account-wide fields) admit an admin at ANY property
 * the caller belongs to.
 */
function requireAdminAnywhere(ctx: Ctx) {
  if (ctx.actor.isService || ctx.actor.isOperator) return
  if (!ctx.actor.memberships.some(m => m.role === 'admin')) throw forbidden('admin access required')
}

function requireOperator(ctx: Ctx) {
  if (!ctx.actor.isOperator) throw forbidden('operator access required')
}

/** department.platformAdmin: an operator, or a non-partner service token — the two "platform" callers. */
function requirePlatformAdmin(ctx: Ctx) {
  if (!(ctx.actor.isOperator || (ctx.actor.isService && ctx.actor.partnerId === null))) throw forbidden('platform admin access required')
}

/** department.RequireActive: an ACTIVE hotel department of this hotel, else the 422 routing already uses. */
function requireActiveDepartment(hotelRef: Id, hotelDepartmentId: Id) {
  if (!hotelDepartments.some(d => d.id === hotelDepartmentId && d.hotelRef === hotelRef && d.isActive)) throw unprocessable('invalid department reference')
}

/** apperr.RequiredText: trimmed, non-empty, at most `max` characters — or the caller's one message. */
function requiredText(value: unknown, max: number, message: string): string {
  const text = asTrimmed(value)
  if (!text || text.length > max) throw badRequest(message)
  return text
}

/**
 * jsonopt.Optional[uuid.UUID] for `escalationPolicyId` on SLA and routing
 * writes: the key ABSENT keeps `stored`, JSON null (or "") clears it, a value
 * must be an active policy of this hotel (422) — and must parse as a UUID at
 * all, which is a decode failure in the Go (400 invalid JSON body).
 */
function decodeEscalationPolicyLink(body: Record<string, unknown>, hotelRef: Id, stored: Id | null): Id | null {
  if (!('escalationPolicyId' in body) || body.escalationPolicyId === undefined) return stored
  const raw = body.escalationPolicyId
  if (raw === null || raw === '') return null
  if (!isUuid(raw)) throw badRequest('invalid JSON body')
  const id = raw.toLowerCase()
  if (!activePolicyInHotel(hotelRef, id)) throw unprocessable('escalationPolicyId is not an active escalation policy of this hotel')
  return id
}


/** One step as POST /v1/escalation-policies decodes it; a value Go's decoder would refuse is a 400 invalid JSON body. */
interface EscalationStepInput { id: Id | null, sort: number, triggerKind: string, triggerValue: number, actions: EscalationAction[], recipients: EscalationRecipient[] }

function decodeEscalationStep(raw: Record<string, unknown>): EscalationStepInput {
  const uuidOrNull = (value: unknown): Id | null => {
    if (value === undefined || value === null || value === '') return null
    if (!isUuid(value)) throw badRequest('invalid JSON body')
    return value.toLowerCase()
  }
  const int = (value: unknown): number => {
    if (value === undefined || value === null) return 0
    if (typeof value !== 'number' || !Number.isInteger(value)) throw badRequest('invalid JSON body')
    return value
  }
  const actions = (Array.isArray(raw.actions) ? raw.actions as Array<Record<string, unknown>> : []).map((a) => {
    const action: EscalationAction = { type: String(a.type ?? '') as EscalationActionType }
    const staffId = uuidOrNull(a.staffId)
    const teamId = uuidOrNull(a.teamId)
    const hotelDepartmentId = uuidOrNull(a.hotelDepartmentId)
    if (staffId) action.staffId = staffId
    if (teamId) action.teamId = teamId
    if (hotelDepartmentId) action.hotelDepartmentId = hotelDepartmentId
    return action
  })
  const recipients = (Array.isArray(raw.recipients) ? raw.recipients as Array<Record<string, unknown>> : []).map((r) => {
    const recipient: EscalationRecipient = { kind: String(r.kind ?? '') as EscalationRecipientKind }
    const teamId = uuidOrNull(r.teamId)
    const staffId = uuidOrNull(r.staffId)
    if (teamId) recipient.teamId = teamId
    if (staffId) recipient.staffId = staffId
    return recipient
  })
  return { id: uuidOrNull(raw.id), sort: int(raw.sort), triggerKind: String(raw.triggerKind ?? ''), triggerValue: int(raw.triggerValue), actions, recipients }
}

/** escalation.validateStep — the first problem, in the Go's words, or null. */
function validateEscalationStep(st: EscalationStepInput): string | null {
  if (st.sort < 0 || st.sort >= ESCALATION_MAX_STEPS) return `sort must be 0-${ESCALATION_MAX_STEPS - 1}`
  switch (st.triggerKind) {
    case 'PERCENT_OF_RESOLUTION':
      if (st.triggerValue < 1 || st.triggerValue > 100) return 'triggerValue must be a percent, 1-100'
      break
    case 'UNASSIGNED_FOR':
      if (st.triggerValue < 1) return 'triggerValue must be at least 1 minute'
      break
    case 'RESPONSE_OVERDUE':
    case 'RESOLUTION_OVERDUE':
      if (st.triggerValue < 0) return 'triggerValue must be 0 or more minutes'
      break
    default:
      return `unknown triggerKind "${st.triggerKind}"`
  }
  const seenAction = new Set<string>()
  for (const a of st.actions) {
    if (seenAction.has(a.type)) return `action "${a.type}" appears more than once`
    seenAction.add(a.type)
    switch (a.type) {
      case 'bumpPriority':
        if (a.staffId || a.teamId || a.hotelDepartmentId) return 'bumpPriority takes no target'
        break
      case 'reassign':
        if (Boolean(a.staffId) === Boolean(a.teamId) || a.hotelDepartmentId) return 'reassign needs exactly one of staffId or teamId'
        break
      case 'routeToDepartment':
        if (!a.hotelDepartmentId || a.staffId || a.teamId) return 'routeToDepartment needs hotelDepartmentId only'
        break
      default:
        return `unknown action type "${a.type}"`
    }
  }
  const seenKind = new Set<string>()
  const seenTeam = new Set<Id>()
  const seenStaff = new Set<Id>()
  for (const r of st.recipients) {
    switch (r.kind) {
      case 'departmentLeaders':
      case 'admins':
      case 'assignee':
        if (r.teamId || r.staffId) return `recipient "${r.kind}" takes no target`
        if (seenKind.has(r.kind)) return `recipient "${r.kind}" appears more than once`
        seenKind.add(r.kind)
        break
      case 'team':
        if (!r.teamId || r.staffId) return 'team recipient needs teamId only'
        if (seenTeam.has(r.teamId)) return `team ${r.teamId} appears more than once`
        seenTeam.add(r.teamId)
        break
      case 'staff':
        if (!r.staffId || r.teamId) return 'staff recipient needs staffId only'
        if (seenStaff.has(r.staffId)) return `staff ${r.staffId} appears more than once`
        seenStaff.add(r.staffId)
        break
      default:
        return `unknown recipient kind "${r.kind}"`
    }
  }
  return null
}

/** escalation.checkTargets: every named staff, team and department must be this hotel's (an active member, an active team, an active department). */
function escalationTargetProblem(hotelRef: Id, st: EscalationStepInput): string | null {
  const staffOk = (id: Id) => membershipAt(id, hotelRef) !== null && Boolean(account(id)?.isActive)
  const teamOk = (id: Id) => teams.some(team => team.id === id && team.hotelRef === hotelRef && team.isActive)
  const deptOk = (id: Id) => hotelDepartments.some(d => d.id === id && d.hotelRef === hotelRef && d.isActive)
  for (const a of st.actions) {
    if (a.staffId && !staffOk(a.staffId)) return `staff ${a.staffId} is not part of this hotel`
    if (a.teamId && !teamOk(a.teamId)) return `team ${a.teamId} is not part of this hotel`
    if (a.hotelDepartmentId && !deptOk(a.hotelDepartmentId)) return `department ${a.hotelDepartmentId} is not part of this hotel`
  }
  for (const r of st.recipients) {
    if (r.staffId && !staffOk(r.staffId)) return `staff ${r.staffId} is not part of this hotel`
    if (r.teamId && !teamOk(r.teamId)) return `team ${r.teamId} is not part of this hotel`
  }
  return null
}

/** department.normaliseCode: trimmed, upper-cased, 1-16 of A-Z 0-9 _; blank clears. */
function normaliseDepartmentCode(raw: unknown): string | null {
  const code = asTrimmed(raw).toUpperCase()
  if (!code) return null
  if (!/^[A-Z0-9_]{1,16}$/.test(code)) throw badRequest('code must be 1-16 characters of A-Z, 0-9 or _')
  return code
}

function normaliseDepartmentDescription(raw: unknown): string | null {
  const description = asTrimmed(raw)
  if (description.length > 500) throw badRequest('description must be at most 500 characters')
  return description || null
}

/** The two uniqueness rules on `department`, code first as the constraint order has it. */
function assertMasterUnique(name: string, code: string | null, exceptId: Id | null) {
  if (code && masterDepartments.some(d => d.id !== exceptId && d.code === code)) throw conflict('department code already exists')
  if (masterDepartments.some(d => d.id !== exceptId && d.name.toLowerCase() === name.toLowerCase())) throw conflict('department name already exists')
}

/** EMS department names match the hotel's ACTIVE departments (master active too) by name, ignoring case and spaces. */
function emsDepartmentFor(hotelRef: Id, departmentName: string | null): Id | null {
  const key = (departmentName ?? '').trim().toLowerCase()
  if (!key) return null
  return hotelDepartments.find(d => d.hotelRef === hotelRef && d.isActive && d.masterIsActive && d.departmentName.trim().toLowerCase() === key)?.id ?? null
}

/** partner.normalizeCapabilities: trimmed, de-duplicated, every value known. */
function normalizeCapabilities(raw: unknown): PartnerCapability[] {
  if (!Array.isArray(raw)) return []
  const out: PartnerCapability[] = []
  for (const value of raw) {
    const c = String(value ?? '').trim()
    if (!c) continue
    if (!(PARTNER_CAPABILITIES as string[]).includes(c)) throw badRequest(`unknown capability: ${c}`)
    if (!out.includes(c as PartnerCapability)) out.push(c as PartnerCapability)
  }
  return out
}

/** DB-truth department for (staff, hotel): the membership row there — never the token's deptId claim. */
function dbDept(staffId: Id | null, hotelRef: Id): Id | null {
  const membership = membershipAt(staffId, hotelRef)
  if (!membership?.hotelDepartmentId) return null
  const dept = hotelDepartments.find(d => d.id === membership.hotelDepartmentId)
  return dept && dept.hotelRef === hotelRef ? dept.id : null
}

/**
 * Manager of the task's project: passes every leader/admin check on that
 * project's tasks (assign, status, verify, review, edit, helpers,
 * attachments, checklist) — ADR 0001.
 */
function managesProject(actor: Actor, t: Pick<Task, 'projectId'>): boolean {
  return !!t.projectId && !!actor.staffId && projectMembers.some(m => m.projectId === t.projectId && m.staffId === actor.staffId && m.level === 'MANAGER')
}

/** Leader-of-the-task's-department, or the project manager, or an admin at the hotel. */
function hasLeaderRights(actor: Actor, hotelRef: Id, t: Task): boolean {
  if (actor.isService) return true
  if (roleAt(actor.staffId, hotelRef) === 'admin') return true
  if (managesProject(actor, t)) return true
  return roleAt(actor.staffId, hotelRef) === 'leader' && !!t.hotelDepartmentId && dbDept(actor.staffId, hotelRef) === t.hotelDepartmentId
}

/** Any leader counts as "dept leader" for a task with no department (checklist routes). */
function isDeptLeaderFor(actor: Actor, hotelRef: Id, t: Task): boolean {
  if (roleAt(actor.staffId, hotelRef) !== 'leader') return false
  return !t.hotelDepartmentId || dbDept(actor.staffId, hotelRef) === t.hotelDepartmentId
}

// ════════════════════════ SLA math (slamath) ════════════════════════

/** True for a name Intl knows — the check PATCH /v1/tenant applies before storing a timezone. */
function isValidTimezone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  }
  catch {
    return false
  }
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * The zone's UTC offset at an instant, from Intl rather than a fixed table,
 * so an admin may set any IANA name through PATCH /v1/tenant. Unknown names
 * read as UTC.
 */
function zoneOffsetMinutes(timezone: string, atMs: number): number {
  let formatter = offsetFormatters.get(timezone)
  if (!formatter) {
    if (!isValidTimezone(timezone)) return 0
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    offsetFormatters.set(timezone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(atMs)).map(part => [part.type, part.value]))
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return Math.round((asUtc - Math.floor(atMs / 1000) * 1000) / 60_000)
}

const hotelTimezone = (hotelRef: Id): string => tenants.find(t => t.hotelRef === hotelRef)?.timezone ?? 'UTC'

/** The hotel's offset now. Indonesia has no DST, so one offset serves the whole schedule walk. */
function hotelOffsetMinutes(hotelRef: Id): number {
  return zoneOffsetMinutes(hotelTimezone(hotelRef), Date.now())
}

function openWindowsOn(schedule: OperatingSchedule, localDate: string, weekday: number): Array<{ opens: number, closes: number }> {
  const exception = schedule.exceptions.find(e => e.date === localDate)
  if (exception) {
    // A closed exception — or one missing either minute — closes the day fully.
    if (exception.isClosed || exception.opensMinutes == null || exception.closesMinutes == null) return []
    return [{ opens: exception.opensMinutes, closes: exception.closesMinutes }]
  }
  return schedule.windows
    .filter(w => w.weekday === weekday)
    .map(w => ({ opens: w.opensMinutes, closes: w.closesMinutes }))
    .sort((a, b) => a.opens - b.opens)
}

/** ScheduleFor: department schedule → tenant default → synthetic always-open. */
function scheduleFor(hotelRef: Id, hotelDepartmentId: Id | null): OperatingSchedule | null {
  return (hotelDepartmentId ? operatingSchedules.find(s => s.hotelRef === hotelRef && s.hotelDepartmentId === hotelDepartmentId) : undefined)
    ?? operatingSchedules.find(s => s.hotelRef === hotelRef && s.isDefault && s.hotelDepartmentId === null)
    ?? null
}

/**
 * AdvanceAcrossSchedule: move `minutes` of OPEN time forward from `startIso`,
 * walking local calendar days. Nil schedule = always-open = plain addition.
 * Bounded at 3650 days, returning the cursor — the documented symptom of a
 * schedule with no open windows.
 */
function advanceAcrossSchedule(hotelRef: Id, schedule: OperatingSchedule | null, startIso: string, minutes: number): string {
  const startMs = Date.parse(startIso)
  if (!schedule || minutes <= 0) return new Date(startMs + minutes * 60_000).toISOString()
  const offsetMs = hotelOffsetMinutes(hotelRef) * 60_000
  const DAY = 1440 * 60_000
  let cursor = startMs + offsetMs
  let remaining = minutes * 60_000
  for (let day = 0; day < 3650; day++) {
    const dayStart = Math.floor(cursor / DAY) * DAY
    const local = new Date(dayStart)
    const windows = openWindowsOn(schedule, local.toISOString().slice(0, 10), local.getUTCDay())
    for (const window of windows) {
      const from = Math.max(cursor, dayStart + window.opens * 60_000)
      const to = dayStart + window.closes * 60_000
      if (from >= to) continue
      if (remaining <= to - from) return new Date(from + remaining - offsetMs).toISOString()
      remaining -= to - from
      cursor = to
    }
    cursor = dayStart + DAY
  }
  return new Date(cursor - offsetMs).toISOString()
}

/** Floors toward −∞ (Butler Math.floor parity). */
const elapsedMinutes = (fromIso: string, toIso: string) => Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000)

/**
 * ElapsedScheduleMinutes: the inverse of advanceAcrossSchedule — the OPEN
 * minutes between two instants, accumulated in milliseconds and floored ONCE
 * at the end (never per window). Nil schedule = always-open = plain
 * elapsedMinutes, and so is `to <= from` (same floored, possibly negative,
 * answer — Butler parity; no clamping of our own).
 * Property: elapsedScheduleMinutes(t, advanceAcrossSchedule(t, m)) === m.
 */
function elapsedScheduleMinutes(hotelRef: Id, schedule: OperatingSchedule | null, fromIso: string, toIso: string): number {
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  if (!schedule || toMs <= fromMs) return elapsedMinutes(fromIso, toIso)
  const offsetMs = hotelOffsetMinutes(hotelRef) * 60_000
  const DAY = 1440 * 60_000
  const end = toMs + offsetMs
  let cursor = fromMs + offsetMs
  let openMs = 0
  for (let day = 0; day < 3650 && cursor < end; day++) {
    const dayStart = Math.floor(cursor / DAY) * DAY
    const local = new Date(dayStart)
    for (const window of openWindowsOn(schedule, local.toISOString().slice(0, 10), local.getUTCDay())) {
      const from = Math.max(cursor, dayStart + window.opens * 60_000)
      const to = Math.min(end, dayStart + window.closes * 60_000)
      if (from < to) openMs += to - from
    }
    cursor = dayStart + DAY
  }
  return Math.floor(openMs / 60_000)
}

/** Inclusive at the boundary: exactly-on-time is ON_TIME. */
function computeSlaStatusAt(nowIso2: string, dueIso: string | null): SlaStatus {
  if (!dueIso) return 'EMPTY'
  return Date.parse(nowIso2) <= Date.parse(dueIso) ? 'ON_TIME' : 'BREACHED'
}

// ════════════════════════ Joins & read models ════════════════════════

const findHotelDept = (id: Id | null) => (id ? hotelDepartments.find(d => d.id === id) ?? null : null)

function activeAssignment(taskId: Id): TaskAssignment | null {
  return taskAssignments.find(a => a.taskId === taskId && a.isActive) ?? null
}

function assignmentRef(taskId: Id): AssignmentRef | null {
  const row = activeAssignment(taskId)
  if (!row) return null
  const dept = findHotelDept(row.hotelDepartmentId)
  return {
    id: row.id,
    kind: row.kind,
    staffId: row.staffId,
    staffName: account(row.staffId)?.name ?? null,
    teamId: row.teamId,
    teamName: row.teamId ? teams.find(t => t.id === row.teamId)?.name ?? null : null,
    departmentId: row.hotelDepartmentId,
    departmentName: dept?.departmentName ?? null,
    remark: row.remark,
  }
}

function taskListItem(t: Task): TaskListItem {
  const dept = findHotelDept(t.hotelDepartmentId)
  const column = t.columnId ? boardColumns.find(c => c.id === t.columnId) ?? null : null
  const sla = t.slaId ? slas.find(s => s.id === t.slaId) ?? null : null
  const project = t.projectId ? projects.find(p => p.id === t.projectId) ?? null : null
  return {
    ...t,
    department: dept ? { id: dept.id, name: dept.departmentName, isActive: dept.isActive } : null,
    column: column ? { id: column.id, name: column.name, columnSort: column.columnSort } : null,
    sla: sla ? { id: sla.id, name: sla.name } : null,
    assignment: assignmentRef(t.id),
    project: project ? { id: project.id, name: project.name } : null,
  }
}

/** The task's steps in sort order, each with its assignee's name resolved. */
const checklistModel = (item: ChecklistItem): ChecklistItem => ({ ...item, assignedStaffName: item.assignedStaffId ? account(item.assignedStaffId)?.name ?? null : null })
const checklistFor = (taskId: Id): ChecklistItem[] =>
  checklistItems.filter(c => c.taskId === taskId).sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)).map(checklistModel)

/** nil-vs-[] parity: these detail arrays serialize as null when empty. */
const nullIfEmpty = <T>(rows: T[]): T[] | null => (rows.length ? rows : null)

function taskDetail(t: Task): TaskDetail {
  const item = t.itemRef ? catalogItems.find(i => i.id === t.itemRef) ?? null : null
  const pending = taskOffers.find(o => o.taskId === t.id && o.state === 'PENDING') ?? null
  const slaFull = t.slaId ? slas.find(s => s.id === t.slaId) ?? null : null
  return {
    ...taskListItem(t),
    slaFull,
    history: nullIfEmpty(taskHistory.filter(h => h.taskId === t.id).sort((a, b) => a.seq - b.seq)),
    comments: nullIfEmpty(taskComments
      .filter(c => c.taskId === t.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(c => ({ ...c, staffName: account(c.staffId)?.name ?? null }))),
    // Non-removed only: a removed attachment disappears from the read model.
    attachments: nullIfEmpty(taskAttachments
      .filter(a => a.taskId === t.id && !a.isRemoved)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))),
    collaborators: nullIfEmpty(taskCollaborators
      .filter(c => c.taskId === t.id && c.isActive)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(c => ({ ...c, staffName: account(c.staffId)?.name ?? null }))),
    checklist: checklistFor(t.id),
    proofRequirements: {
      minProofPhotos: item?.minProofPhotos ?? 0,
      requiresCompletionNote: item?.requiresCompletionNote ?? false,
    },
    pendingOffer: pending
      ? { id: pending.id, toStaffId: pending.toStaff, toStaffName: account(pending.toStaff)?.name ?? null, note: pending.note, createdAt: pending.createdAt }
      : null,
  }
}

/** [DR-15]: scoped staff := human, non-partner, role "staff" at this hotel. */
const isScopedStaffActor = (actor: Actor) => !actor.isService && actor.partnerId === null && actor.role === 'staff'

const isProjectMember = (projectId: Id | null, staffId: Id | null) =>
  !!projectId && !!staffId && projectMembers.some(m => m.projectId === projectId && m.staffId === staffId)

const isStepAssignee = (taskId: Id, staffId: Id | null) =>
  !!staffId && checklistItems.some(c => c.taskId === taskId && c.assignedStaffId === staffId)

/**
 * One visibility predicate for List AND Detail — never two implementations.
 * What a plain staff member sees (feat/projects [DR-15]):
 *   (a) tasks they have claimed, and tasks they help on;
 *   (b) unclaimed tasks in their department — including those returned to the
 *       department's pool ("unclaimed" = no active STAFF assignment);
 *   (c) unclaimed tasks with NO department, across the whole property
 *       (dropped when the list is filtered by departmentId — `includeDeptless`);
 *   (d) tasks assigned or returned to a team they belong to;
 *   (e) tasks where a checklist step is assigned to them (read-only);
 *   (f) every task of a project they belong to.
 * A floater (member with no department) sees all unclaimed work plus their
 * team pools. A colleague's claimed task is never visible.
 */
function visibleTo(actor: Actor, hotelRef: Id, t: Task, includeDeptless = true): boolean {
  if (!isScopedStaffActor(actor)) return true
  const assignment = activeAssignment(t.id)
  if (assignment?.staffId === actor.staffId) return true
  if (taskCollaborators.some(c => c.taskId === t.id && c.staffId === actor.staffId && c.isActive)) return true
  if (isStepAssignee(t.id, actor.staffId)) return true
  if (isProjectMember(t.projectId, actor.staffId)) return true
  const unclaimed = assignment === null || assignment.kind !== 'STAFF'
  if (!unclaimed) return false
  if (assignment?.kind === 'TEAM' && isTeamMember(assignment.teamId, actor.staffId)) return true
  const dept = dbDept(actor.staffId, hotelRef)
  if (!dept) return true
  if (t.hotelDepartmentId === dept) return true
  return includeDeptless && t.hotelDepartmentId === null
}

// ════════════════════════ Routing resolution ════════════════════════

function specificityOf(rule: Pick<RoutingRule, 'itemRef' | 'categoryId' | 'locationTypeId' | 'priority'>): number {
  if (rule.itemRef) return 4
  if (rule.categoryId) return 3
  if (rule.locationTypeId) return 2
  if (rule.priority) return 1
  return 0
}

/** A NULL criterion always matches — that is what makes an all-NULL rule the catch-all. */
function findBestRoutingMatch(hotelRef: Id, itemRef: Id | null, categoryId: Id | null, locationTypeId: Id | null, priority: TaskPriority): RoutingRule | null {
  const candidates = routingRules.filter(r =>
    r.hotelRef === hotelRef
    && (r.itemRef === null || r.itemRef === itemRef)
    && (r.categoryId === null || r.categoryId === categoryId)
    && (r.locationTypeId === null || r.locationTypeId === locationTypeId)
    && (r.priority === null || r.priority === priority),
  )
  candidates.sort((a, b) => b.specificity - a.specificity || b.updatedAt.localeCompare(a.updatedAt))
  return candidates[0] ?? null
}

// ════════════════════════ Status change core ════════════════════════

function bumpEventSeq(taskId: Id): number {
  const next = (eventSeq.get(taskId) ?? 0) + 1
  eventSeq.set(taskId, next)
  return next
}

function pushHistory(t: Task, staffId: Id | null, status: string, description: string | null, at: string) {
  taskHistory.push({ id: newId(), hotelRef: t.hotelRef, taskId: t.id, staffId, status, description, seq: bumpEventSeq(t.id), createdAt: at })
}

/**
 * computeSlaUpdates — the [DR-4] rules as redefined by the API's 2026-09-02
 * SLA spec (c3f52ad). Both durations are SCHEDULE-AWARE elapsed minutes from
 * activation — open hours only, the exact inverse of the due-date arithmetic —
 * and each is written only together with its verdict, so the pair can never
 * disagree again:
 * (b) first entry into IN_PROGRESS stamps responseDuration + verdict, once;
 *     a claim or acknowledgement never stops the response clock, and a later
 *     return-to-pool or delegation never restarts it;
 * (c) every entry into IN_PROGRESS resets the resolution verdict to EMPTY.
 *     resolutionDuration is NOT nulled: between a review bounce and the next
 *     submission it still holds the superseded attempt, which readers treat
 *     as such whenever the verdict reads EMPTY;
 * (d) entering SUBMITTED (unconditionally), or FINISHED not-from-SUBMITTED
 *     while still EMPTY, stamps resolutionDuration + verdict at one instant.
 *     Rework re-stamps both, still measured from activation — the resolution
 *     that counts is the one that sticks; PENDING/parked time counts; review
 *     and pending detours after work stopped re-stamp nothing.
 * The old rule (a) — accumulating IN_PROGRESS time on the way out — is gone:
 * leaving IN_PROGRESS stamps nothing. The schedule is resolved lazily, only
 * when something actually stamps.
 */
function computeSlaUpdates(t: Task, oldStatus: TaskStatus, newStatus: TaskStatus, at: string) {
  const elapsedFromActivation = () => elapsedScheduleMinutes(t.hotelRef, scheduleFor(t.hotelRef, t.hotelDepartmentId), t.activationDate, at)
  if (newStatus === 'IN_PROGRESS' && oldStatus !== 'IN_PROGRESS') {
    if (t.responseSlaStatus === 'EMPTY') {
      t.responseDuration = elapsedFromActivation()
      t.responseSlaStatus = computeSlaStatusAt(at, t.responseDueAt)
    }
    t.resolutionSlaStatus = 'EMPTY'
  }
  if (newStatus === 'SUBMITTED' || (newStatus === 'FINISHED' && oldStatus !== 'SUBMITTED' && t.resolutionSlaStatus === 'EMPTY')) {
    t.resolutionSlaStatus = computeSlaStatusAt(at, t.resolutionDueAt)
    t.resolutionDuration = elapsedFromActivation()
  }
}

/** First non-removed column linked to a status, ordered column_sort, id. */
function columnForStatus(hotelRef: Id, status: TaskStatus): BoardColumn | null {
  const board = boards.find(b => b.hotelRef === hotelRef)
  if (!board) return null
  return boardColumns
    .filter(c => c.boardId === board.id && !c.isRemoved && c.status === status)
    .sort((a, b) => a.columnSort - b.columnSort || a.id.localeCompare(b.id))[0] ?? null
}

function changeStatusCore(t: Task, staffId: Id | null, newStatus: TaskStatus, columnId: Id | null, description: string | null, at: string) {
  const oldStatus = t.status
  computeSlaUpdates(t, oldStatus, newStatus, at)
  t.status = newStatus
  t.columnId = columnId
  t.updatedAt = at
  pushHistory(t, staffId, newStatus, description, at)
}

// ════════════════════════ Seed tasks ════════════════════════

interface SeedTaskConfig {
  id: Id
  hotelRef: Id
  status: TaskStatus
  title: string
  description?: string | null
  roomNumber?: string | null
  quantity?: number | null
  sourceProduct: string
  sourceChannel: string
  idempotencyKey?: Id | null
  itemRef?: Id | null
  requesterRef?: Id | null
  requesterName?: string | null
  projectId?: Id | null
  escalationPolicyId?: Id | null
  escalationLevel?: number
  escalatedAt?: string | null
  visitRef?: string | null
  priority?: TaskPriority
  locationId?: Id | null
  slaId: Id
  hotelDepartmentId?: Id | null
  columnStatus?: TaskStatus
  activationDate: string
  createdAt?: string
  completionNote?: string | null
  submittedBy?: Id | null
  submittedAt?: string | null
  responseDuration?: number | null
  resolutionDuration?: number | null
  responseSlaStatus?: SlaStatus
  resolutionSlaStatus?: SlaStatus
}

/** Budgets + chained due dates are COMPUTED so seeds can never drift from slamath. */
function seedTaskRow(config: SeedTaskConfig): Task {
  const sla = slas.find(s => s.id === config.slaId)!
  const dept = config.hotelDepartmentId ?? null
  const schedule = scheduleFor(config.hotelRef, dept)
  const responseDueAt = advanceAcrossSchedule(config.hotelRef, schedule, config.activationDate, sla.responseTime)
  const resolutionDueAt = advanceAcrossSchedule(config.hotelRef, schedule, responseDueAt, sla.resolutionTime)
  const item = config.itemRef ? catalogItems.find(i => i.id === config.itemRef) ?? null : null
  const location = config.locationId ? locations.find(l => l.id === config.locationId) ?? null : null
  const locationType = location ? locationTypes.find(t => t.id === location.locationTypeId) ?? null : null
  const category = item?.categoryId ? categories.find(c => c.id === item.categoryId) ?? null : null
  const createdAt = config.createdAt ?? config.activationDate
  const task: Task = {
    hotelRef: config.hotelRef,
    id: config.id,
    status: config.status,
    title: config.title,
    description: config.description ?? null,
    notes: null,
    roomNumber: config.roomNumber ?? location?.name ?? null,
    quantity: config.quantity ?? null,
    sourceProduct: config.sourceProduct,
    sourceChannel: config.sourceChannel,
    idempotencyKey: config.idempotencyKey ?? null,
    itemRef: config.itemRef ?? null,
    itemName: item?.name ?? config.title,
    categoryName: category?.name ?? null,
    requesterRef: config.requesterRef ?? null,
    requesterName: config.requesterName ?? null,
    visitRef: config.visitRef ?? null,
    priority: config.priority ?? item?.defaultPriority ?? 'NORMAL',
    locationId: config.locationId ?? null,
    locationTypeName: locationType?.name ?? null,
    slaId: config.slaId,
    hotelDepartmentId: dept,
    columnId: columnForStatus(config.hotelRef, config.columnStatus ?? config.status)?.id ?? null,
    activationDate: config.activationDate,
    dueAt: null,
    responseDueAt,
    resolutionDueAt,
    responseSlaMinutes: sla.responseTime,
    resolutionSlaMinutes: sla.resolutionTime,
    responseDuration: config.responseDuration ?? null,
    resolutionDuration: config.resolutionDuration ?? null,
    responseSlaStatus: config.responseSlaStatus ?? 'EMPTY',
    resolutionSlaStatus: config.resolutionSlaStatus ?? 'EMPTY',
    completionNote: config.completionNote ?? null,
    submittedBy: config.submittedBy ?? null,
    submittedAt: config.submittedAt ?? null,
    templateId: null,
    occurrenceKey: null,
    escalationPolicyId: config.escalationPolicyId ?? null,
    escalationLevel: config.escalationLevel ?? 0,
    escalatedAt: config.escalatedAt ?? null,
    projectId: config.projectId ?? null,
    createdAt,
    updatedAt: createdAt,
  }
  tasks.push(task)
  return task
}

function seedAssignmentRow(taskId: Id, kind: AssignmentKind, target: { staffId?: Id, teamId?: Id, hotelDepartmentId?: Id }, assignedBy: Id | null, remark: string | null, isActive: boolean, createdAt: string) {
  taskAssignments.push({
    id: newId(), taskId, kind,
    staffId: target.staffId ?? null,
    teamId: target.teamId ?? null,
    hotelDepartmentId: target.hotelDepartmentId ?? null,
    assignedBy, actingUser: null, remark, isActive, createdAt,
  })
}

function seedHistoryRow(taskId: Id, staffId: Id | null, status: string, description: string | null, createdAt: string) {
  const t = tasks.find(row => row.id === taskId)!
  pushHistory(t, staffId, status, description, createdAt)
}

function seedDemoData() {
  const H = IDS.hotel.simatupang

  // Dispatched by Butler moments ago; no history row (dispatches write none).
  seedTaskRow({
    id: IDS.task.towels1204, hotelRef: H, status: 'NEW', title: 'Extra towels', description: 'Two bath towels please',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', idempotencyKey: uid('c4', 1), itemRef: IDS.item.towels,
    requesterRef: IDS.guest.amelia, requesterName: 'Amelia Chen', visitRef: 'V-88121', quantity: 2,
    locationId: IDS.location.room1204, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T02:52:00.000Z',
  })
  taskContextEntries.push({ id: newId(), hotelRef: H, taskId: IDS.task.towels1204, sourceAppCode: 'sentec-butler', label: 'Butler request', value: 'BTLR-88412', url: null, sort: 0 })

  // Urgent AC fault against Engineering's operating hours (09:15 WIB, open).
  seedTaskRow({
    id: IDS.task.acFault0908, hotelRef: H, status: 'NEW', title: 'Air conditioner not cooling', description: 'Guest reports the room is very warm',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.acFault,
    requesterRef: IDS.guest.marcus, requesterName: 'Marcus Reid', visitRef: 'V-88104',
    locationId: IDS.location.room0908, slaId: IDS.sla.smtpUrgent, hotelDepartmentId: IDS.dept.smtpMaintenance,
    activationDate: '2026-08-25T02:15:00.000Z',
  })

  // Staff-created, claimed, in progress — response stamped, resolution running.
  seedTaskRow({
    id: IDS.task.cleaning1102, hotelRef: H, status: 'IN_PROGRESS', title: 'Room cleaning', description: 'Full clean after checkout',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.roomCleaning,
    locationId: IDS.location.room1102, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T02:30:00.000Z', responseDuration: 6, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.cleaning1102, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.sari, null, true, '2026-08-25T02:33:00.000Z')
  seedHistoryRow(IDS.task.cleaning1102, IDS.staff.sari, 'NEW', null, '2026-08-25T02:30:00.000Z')
  seedHistoryRow(IDS.task.cleaning1102, IDS.staff.budi, 'IN_PROGRESS', null, '2026-08-25T02:36:00.000Z')
  taskComments.push({ id: newId(), hotelRef: H, taskId: IDS.task.cleaning1102, staffId: IDS.staff.sari, comment: 'Guest asked for extra pillows too.', createdAt: '2026-08-25T02:38:00.000Z', staffName: null })
  catalogItems.find(i => i.id === IDS.item.roomCleaning)!.defaultChecklist.forEach((label, index) => {
    checklistItems.push({ id: newId(), hotelRef: H, taskId: IDS.task.cleaning1102, sort: index, label, isDone: false, doneBy: null, doneAt: null, assignedStaffId: null, assignedStaffName: null, assignedBy: null, assignedAt: null, note: null, createdAt: '2026-08-25T02:30:00.000Z', updatedAt: '2026-08-25T02:30:00.000Z' })
  })

  // Waiting in a TEAM pool — claimable by HK Morning Shift members only.
  seedTaskRow({
    id: IDS.task.turndownPool, hotelRef: H, status: 'NEW', title: 'Turndown service — floor 12', description: 'Evening turndown, rooms 1201-1210',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.turndown, roomNumber: 'Floor 12',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T01:00:00.000Z',
  })
  seedAssignmentRow(IDS.task.turndownPool, 'TEAM', { teamId: IDS.team.hkMorning }, IDS.staff.sari, null, true, '2026-08-25T01:00:00.000Z')
  seedHistoryRow(IDS.task.turndownPool, IDS.staff.sari, 'NEW', null, '2026-08-25T01:00:00.000Z')

  // Budi's own work with Made helping.
  seedTaskRow({
    id: IDS.task.towels0710, hotelRef: H, status: 'IN_PROGRESS', title: 'Extra towels', description: 'Four hand towels for the pool deck',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.towels, roomNumber: '0710', quantity: 4,
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T02:00:00.000Z', responseDuration: 9, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.towels0710, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.budi, null, true, '2026-08-25T02:00:00.000Z')
  seedHistoryRow(IDS.task.towels0710, IDS.staff.budi, 'NEW', null, '2026-08-25T02:00:00.000Z')
  seedHistoryRow(IDS.task.towels0710, IDS.staff.budi, 'IN_PROGRESS', null, '2026-08-25T02:09:00.000Z')
  taskCollaborators.push({ id: newId(), hotelRef: H, taskId: IDS.task.towels0710, staffId: IDS.staff.made, staffName: null, addedBy: IDS.staff.sari, isActive: true, createdAt: '2026-08-25T02:30:00.000Z' })

  // Parked after 30 minutes' work. The resolution clock is still running:
  // verdict EMPTY and no duration yet — parked time counts, and nothing is
  // stamped until the work actually stops (2026-09-02 SLA spec).
  seedTaskRow({
    id: IDS.task.transferHold, hotelRef: H, status: 'PENDING', title: 'Airport transfer', description: 'Guest to confirm flight time',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.transfer,
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpFrontOffice,
    activationDate: '2026-08-25T00:30:00.000Z', responseDuration: 11, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.transferHold, 'STAFF', { staffId: IDS.staff.sari }, IDS.staff.agus, 'Covering Front Office tonight', true, '2026-08-25T00:39:00.000Z')
  seedHistoryRow(IDS.task.transferHold, IDS.staff.sari, 'IN_PROGRESS', null, '2026-08-25T00:41:00.000Z')
  seedHistoryRow(IDS.task.transferHold, IDS.staff.sari, 'PENDING', 'Guest to confirm flight time', '2026-08-25T01:11:00.000Z')

  // Finished directly (no proof gates on this item), verdict ON_TIME. Both
  // durations run from activation: response 4 (→ IN_PROGRESS 23:04),
  // resolution 26 (→ FINISHED 23:26), stamped with their verdicts.
  seedTaskRow({
    id: IDS.task.towelsDone, hotelRef: H, status: 'FINISHED', title: 'Extra towels',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.towels, roomNumber: '1015', quantity: 1,
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-24T23:00:00.000Z', responseDuration: 4, resolutionDuration: 26,
    responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.towelsDone, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.budi, null, true, '2026-08-24T23:04:00.000Z')
  seedHistoryRow(IDS.task.towelsDone, IDS.staff.budi, 'IN_PROGRESS', null, '2026-08-24T23:04:00.000Z')
  seedHistoryRow(IDS.task.towelsDone, IDS.staff.budi, 'FINISHED', null, '2026-08-24T23:26:00.000Z')

  // PMS-dispatched Monday 09:00 WIB — inside Engineering Hours, so the
  // schedule-aware clocks read like wall-clock ones: response 8 (→ 09:08),
  // resolution 40 (→ FINISHED 09:40). Worked by Maintenance, verified later.
  seedTaskRow({
    id: IDS.task.plumbingVerified, hotelRef: H, status: 'VERIFIED', title: 'Plumbing / leak', description: 'Slow drain reported by the PMS housekeeping sweep',
    sourceProduct: 'sentec-pms', sourceChannel: 'admin', itemRef: IDS.item.plumbing, roomNumber: '0402',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpMaintenance,
    activationDate: '2026-08-24T02:00:00.000Z', responseDuration: 8, resolutionDuration: 40,
    responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.plumbingVerified, 'STAFF', { staffId: IDS.staff.joko }, null, null, true, '2026-08-24T02:05:00.000Z')
  seedHistoryRow(IDS.task.plumbingVerified, IDS.staff.joko, 'IN_PROGRESS', null, '2026-08-24T02:08:00.000Z')
  seedHistoryRow(IDS.task.plumbingVerified, IDS.staff.joko, 'FINISHED', null, '2026-08-24T02:40:00.000Z')
  seedHistoryRow(IDS.task.plumbingVerified, IDS.staff.sari, 'VERIFIED', null, '2026-08-24T04:14:00.000Z')
  taskAttachments.push({ id: newId(), hotelRef: H, taskId: IDS.task.plumbingVerified, staffId: null, filetype: 'PDF', filepath: 'https://cdn.sentec-pms.example/workorders/WO-2214.pdf', isRemoved: false, createdAt: '2026-08-24T02:03:00.000Z' })
  taskContextEntries.push(
    { id: newId(), hotelRef: H, taskId: IDS.task.plumbingVerified, sourceAppCode: 'sentec-pms', label: 'Work order', value: 'WO-2214', url: 'https://pms.sentec.example/wo/2214', sort: 0 },
    { id: newId(), hotelRef: H, taskId: IDS.task.plumbingVerified, sourceAppCode: 'sentec-pms', label: 'Loyalty tier', value: 'Platinum', url: null, sort: 1 },
  )

  seedTaskRow({
    id: IDS.task.checkoutCancelled, hotelRef: H, status: 'CANCELLED', title: 'Late checkout request', description: 'Guest checked out on time after all',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.lateCheckout, roomNumber: '0611',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpFrontOffice,
    activationDate: '2026-08-24T20:00:00.000Z',
  })
  seedHistoryRow(IDS.task.checkoutCancelled, IDS.staff.sari, 'CANCELLED', 'Guest checked out on time', '2026-08-24T20:22:00.000Z')

  // Returned to a DEPARTMENT pool with the reason on the assignment remark.
  seedTaskRow({
    id: IDS.task.bulbsDeptPool, hotelRef: H, status: 'NEW', title: 'Light bulb replacement', description: 'Corridor lights out on floor 7',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.lightBulb, quantity: 3,
    locationId: IDS.location.floor7, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpMaintenance,
    activationDate: '2026-08-25T02:45:00.000Z',
  })
  seedAssignmentRow(IDS.task.bulbsDeptPool, 'STAFF', { staffId: IDS.staff.agus }, IDS.staff.agus, null, false, '2026-08-25T02:45:00.000Z')
  seedAssignmentRow(IDS.task.bulbsDeptPool, 'DEPARTMENT', { hotelDepartmentId: IDS.dept.smtpMaintenance }, IDS.staff.agus, 'Need the ladder from storage — picking it up after lunch', true, '2026-08-25T02:52:00.000Z')
  seedHistoryRow(IDS.task.bulbsDeptPool, IDS.staff.agus, 'NEW', null, '2026-08-25T02:45:00.000Z')
  seedHistoryRow(IDS.task.bulbsDeptPool, IDS.staff.agus, 'NEW', 'Need the ladder from storage — picking it up after lunch', '2026-08-25T02:52:00.000Z')

  // Awaiting review: verdict stamped BREACHED at submission (02:20 > 02:15 due).
  seedTaskRow({
    id: IDS.task.cleaningSubmitted, hotelRef: H, status: 'SUBMITTED', title: 'Room cleaning', description: 'Post-checkout deep clean',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.roomCleaning,
    requesterRef: IDS.guest.marcus, requesterName: 'Marcus Reid', visitRef: 'V-88104',
    locationId: IDS.location.room0908, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T01:15:00.000Z', responseDuration: 8, resolutionDuration: 65,
    responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED',
    completionNote: 'Deep-cleaned and restocked. AC filter rinsed while I was in there.',
    submittedBy: IDS.staff.budi, submittedAt: '2026-08-25T02:20:00.000Z',
  })
  seedAssignmentRow(IDS.task.cleaningSubmitted, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.sari, null, true, '2026-08-25T01:20:00.000Z')
  seedHistoryRow(IDS.task.cleaningSubmitted, IDS.staff.sari, 'NEW', null, '2026-08-25T01:15:00.000Z')
  seedHistoryRow(IDS.task.cleaningSubmitted, IDS.staff.budi, 'IN_PROGRESS', null, '2026-08-25T01:23:00.000Z')
  seedHistoryRow(IDS.task.cleaningSubmitted, IDS.staff.budi, 'SUBMITTED', 'Deep-cleaned and restocked. AC filter rinsed while I was in there.', '2026-08-25T02:20:00.000Z')
  const photo1 = { id: newId(), hotelRef: H, taskId: IDS.task.cleaningSubmitted, staffId: IDS.staff.budi, filetype: 'PHOTO' as const, filepath: 'https://media.sentec-tasks.example/signed/proof-0908-1.jpg', isRemoved: false, createdAt: '2026-08-25T02:18:00.000Z' }
  const photo2 = { id: newId(), hotelRef: H, taskId: IDS.task.cleaningSubmitted, staffId: IDS.staff.budi, filetype: 'PHOTO' as const, filepath: 'https://media.sentec-tasks.example/signed/proof-0908-2.jpg', isRemoved: false, createdAt: '2026-08-25T02:19:00.000Z' }
  taskAttachments.push(photo1, photo2)
  attachmentStorageKeys.set(photo1.id, `hotels/${H}/uploads/${uid('c5', 1)}.jpg`)
  attachmentStorageKeys.set(photo2.id, `hotels/${H}/uploads/${uid('c5', 2)}.jpg`)

  // Budi's task with a pending delegation offer to Made.
  seedTaskRow({
    id: IDS.task.acFilterOffer, hotelRef: H, status: 'IN_PROGRESS', title: 'AC filter rattling in 1204',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff',
    requesterRef: IDS.guest.amelia, requesterName: 'Amelia Chen', visitRef: 'V-88121',
    locationId: IDS.location.room1204, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T02:40:00.000Z', responseDuration: 4, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.acFilterOffer, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.budi, null, true, '2026-08-25T02:40:00.000Z')
  seedHistoryRow(IDS.task.acFilterOffer, IDS.staff.budi, 'NEW', null, '2026-08-25T02:40:00.000Z')
  seedHistoryRow(IDS.task.acFilterOffer, IDS.staff.budi, 'IN_PROGRESS', null, '2026-08-25T02:44:00.000Z')
  taskOffers.push({
    id: IDS.offer.filterToMade, hotelRef: H, taskId: IDS.task.acFilterOffer,
    fromStaff: IDS.staff.budi, toStaff: IDS.staff.made,
    note: 'Handing over before my break — filter cover is already off.',
    state: 'PENDING', decidedAt: null, createdAt: '2026-08-25T02:50:00.000Z',
  })

  seedTaskRow({
    id: IDS.task.faveCleaning, hotelRef: IDS.hotel.fave, status: 'NEW', title: 'Room cleaning',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.faveCleaning,
    locationId: IDS.location.faveRoom0210, slaId: IDS.sla.faveStandard, hotelDepartmentId: IDS.dept.faveHousekeeping,
    activationDate: '2026-08-25T02:20:00.000Z',
  })

  // Kuningan has no routing rules: default SLA, department-less.
  seedTaskRow({
    id: IDS.task.kngnAircon, hotelRef: IDS.hotel.kuningan, status: 'NEW', title: 'Aircon service — unit 512', roomNumber: '0512',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff',
    slaId: IDS.sla.kngnStandard, hotelDepartmentId: null,
    activationDate: '2026-08-25T01:30:00.000Z',
  })
  seedHistoryRow(IDS.task.kngnAircon, IDS.staff.rina, 'NEW', null, '2026-08-25T01:30:00.000Z')

  // ── Projects. Sari manages the lobby refurbishment; Budi works in it, Made
  // may only look. Its tasks leave the hotel board and default list.
  projects.push({
    id: IDS.project.lobby, hotelRef: H, name: 'Lobby refurbishment', description: 'Repaint, relight and re-sign the lobby before the group inspection.',
    startDate: '2026-08-18', endDate: '2026-09-30', status: 'ACTIVE', completedAt: null, createdBy: IDS.staff.agus, createdAt: '2026-08-18T01:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z',
  })
  projectMembers.push(
    { projectId: IDS.project.lobby, staffId: IDS.staff.sari, level: 'MANAGER', source: 'MANUAL', addedBy: IDS.staff.agus, addedAt: '2026-08-18T01:00:00.000Z' },
    { projectId: IDS.project.lobby, staffId: IDS.staff.budi, level: 'MEMBER', source: 'MANUAL', addedBy: IDS.staff.sari, addedAt: '2026-08-18T01:05:00.000Z' },
    { projectId: IDS.project.lobby, staffId: IDS.staff.made, level: 'VIEWER', source: 'MANUAL', addedBy: IDS.staff.sari, addedAt: '2026-08-18T01:05:00.000Z' },
  )
  seedTaskRow({
    id: IDS.projectTask.lobbyPaint, hotelRef: H, status: 'IN_PROGRESS', title: 'Repaint the lobby feature wall', description: 'Two coats, colour LB-04',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', locationId: IDS.location.lobby,
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpMaintenance, projectId: IDS.project.lobby,
    activationDate: '2026-08-24T02:00:00.000Z', responseDuration: 30, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.projectTask.lobbyPaint, 'STAFF', { staffId: IDS.staff.joko }, IDS.staff.sari, null, true, '2026-08-24T02:20:00.000Z')
  seedHistoryRow(IDS.projectTask.lobbyPaint, IDS.staff.sari, 'NEW', null, '2026-08-24T02:00:00.000Z')
  seedHistoryRow(IDS.projectTask.lobbyPaint, IDS.staff.joko, 'IN_PROGRESS', null, '2026-08-24T02:30:00.000Z')
  // Joko was handed a project task by name: an AUTO member.
  projectMembers.push({ projectId: IDS.project.lobby, staffId: IDS.staff.joko, level: 'MEMBER', source: 'AUTO', addedBy: IDS.staff.sari, addedAt: '2026-08-24T02:20:00.000Z' })
  seedTaskRow({
    id: IDS.projectTask.lobbyLights, hotelRef: H, status: 'NEW', title: 'Replace lobby downlights with LED', quantity: 24,
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.lightBulb, locationId: IDS.location.lobby,
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpMaintenance, projectId: IDS.project.lobby,
    activationDate: '2026-08-25T01:00:00.000Z',
  })
  seedHistoryRow(IDS.projectTask.lobbyLights, IDS.staff.sari, 'NEW', null, '2026-08-25T01:00:00.000Z')
  ;['Remove old fittings', 'Fit LED downlights', 'Test dimmer scenes'].forEach((label, index) => {
    checklistItems.push({ id: newId(), hotelRef: H, taskId: IDS.projectTask.lobbyLights, sort: index, label, isDone: index === 0, doneBy: index === 0 ? IDS.staff.joko : null, doneAt: index === 0 ? '2026-08-25T02:10:00.000Z' : null, assignedStaffId: index === 1 ? IDS.staff.budi : null, assignedStaffName: null, assignedBy: index === 1 ? IDS.staff.sari : null, assignedAt: index === 1 ? '2026-08-25T01:05:00.000Z' : null, note: index === 0 ? 'Fittings bagged for recycling.' : null, createdAt: '2026-08-25T01:00:00.000Z', updatedAt: '2026-08-25T01:00:00.000Z' })
  })
  seedTaskRow({
    id: IDS.projectTask.lobbySignage, hotelRef: H, status: 'FINISHED', title: 'Install new wayfinding signage',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', locationId: IDS.location.lobby,
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpHousekeeping, projectId: IDS.project.lobby,
    activationDate: '2026-08-20T02:00:00.000Z', responseDuration: 15, resolutionDuration: 200,
    responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.projectTask.lobbySignage, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.sari, null, true, '2026-08-20T02:10:00.000Z')
  seedHistoryRow(IDS.projectTask.lobbySignage, IDS.staff.sari, 'NEW', null, '2026-08-20T02:00:00.000Z')
  seedHistoryRow(IDS.projectTask.lobbySignage, IDS.staff.budi, 'IN_PROGRESS', null, '2026-08-20T02:15:00.000Z')
  seedHistoryRow(IDS.projectTask.lobbySignage, IDS.staff.budi, 'FINISHED', null, '2026-08-20T05:20:00.000Z')
  // A completed project, for the status filter.
  projects.push({
    id: IDS.project.poolDeck, hotelRef: H, name: 'Pool deck resurfacing', description: null,
    startDate: '2026-07-01', endDate: '2026-07-31', status: 'COMPLETED', completedAt: '2026-07-29T08:00:00.000Z', createdBy: IDS.staff.agus, createdAt: '2026-06-28T01:00:00.000Z', updatedAt: '2026-07-29T08:00:00.000Z',
  })
  projectMembers.push({ projectId: IDS.project.poolDeck, staffId: IDS.staff.agus, level: 'MANAGER', source: 'MANUAL', addedBy: IDS.staff.agus, addedAt: '2026-06-28T01:00:00.000Z' })

  // ── Escalated yesterday by the Standard policy (feat/escalation). Created
  // 13:00 WIB Monday, Engineering hours; the three steps fired at 13:15
  // (response overdue), 13:30 (halfway to resolution → HIGH became URGENT)
  // and 14:00 (resolution overdue → bump skipped, already URGENT). Nobody
  // claimed it, so it still sits with Maintenance at level 3.
  seedTaskRow({
    id: IDS.task.leakEscalated, hotelRef: H, status: 'NEW', title: 'Plumbing / leak', description: 'Water pooling under the basin in 1102',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.plumbing, priority: 'URGENT',
    locationId: IDS.location.room1102, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpMaintenance,
    activationDate: '2026-08-24T06:00:00.000Z',
    escalationPolicyId: IDS.policy.smtpStandard, escalationLevel: 3, escalatedAt: '2026-08-24T07:00:00.000Z',
  })
  seedHistoryRow(IDS.task.leakEscalated, IDS.staff.sari, 'NEW', null, '2026-08-24T06:00:00.000Z')
  const leakEscalations: Array<Omit<TaskEscalation, 'hotelRef' | 'taskId'>> = [
    { appliedAt: '2026-08-24T06:15:00.000Z', policyId: IDS.policy.smtpStandard, stepId: IDS.step.stdResponse, level: 1, trigger: { kind: 'RESPONSE_OVERDUE', value: 0 }, applied: [], skipped: [], recipients: [] },
    { appliedAt: '2026-08-24T06:30:00.000Z', policyId: IDS.policy.smtpStandard, stepId: IDS.step.stdHalfway, level: 2, trigger: { kind: 'PERCENT_OF_RESOLUTION', value: 50 }, applied: [{ type: 'bumpPriority', before: 'HIGH', after: 'URGENT' }], skipped: [], recipients: [] },
    { appliedAt: '2026-08-24T07:00:00.000Z', policyId: IDS.policy.smtpStandard, stepId: IDS.step.stdOverdue, level: 3, trigger: { kind: 'RESOLUTION_OVERDUE', value: 0 }, applied: [], skipped: [{ type: 'bumpPriority', reason: 'no_change' }], recipients: [IDS.staff.agus] },
  ]
  for (const record of leakEscalations) {
    taskEscalations.push({ hotelRef: H, taskId: IDS.task.leakEscalated, ...record })
    seedHistoryRow(IDS.task.leakEscalated, null, 'NEW', escalationDescription(record), record.appliedAt)
  }

  // ── Live-clock tasks (2026-10-09). One task per condition the staff app can
  // show, staged relative to the moment the mock boots, so the demo always has
  // green, amber and red side by side — the dated seeds above are pinned by
  // tests and never move. Housekeeping, Front Office and F&B run on the 24/7
  // default schedule, so their deadlines are plain wall-clock sums of the SLA
  // budgets (Standard 15/45, Scheduled 120/480, as seedTaskRow chains them);
  // Maintenance (Engineering Hours) is used only where the work has stopped.
  // The escalation sweep runs before every request, so escalated seeds record
  // exactly the steps that are due at boot and nothing more.
  const LIVE_NOW = Date.now()
  const ago = (minutes: number) => new Date(LIVE_NOW - minutes * 60_000).toISOString()
  const ahead = (minutes: number) => new Date(LIVE_NOW + minutes * 60_000).toISOString()
  const L = IDS.liveTask
  const liveChecklist = (taskId: Id, labels: string[], doneBy: Id | null, doneCount: number, at: string) => {
    labels.forEach((label, index) => {
      const done = index < doneCount
      checklistItems.push({ id: newId(), hotelRef: H, taskId, sort: index, label, isDone: done, doneBy: done ? doneBy : null, doneAt: done ? at : null, assignedStaffId: null, assignedStaffName: null, assignedBy: null, assignedAt: null, note: null, createdAt: at, updatedAt: at })
    })
  }

  // Green: a Butler request with nearly two hours to pick up.
  seedTaskRow({
    id: L.greenNew, hotelRef: H, status: 'NEW', title: 'Extra towels', description: 'Two bath towels and a bath mat',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.towels, quantity: 2, roomNumber: '1510',
    requesterName: 'Hana Sato', visitRef: 'V-88140', slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(10),
  })
  taskContextEntries.push({ id: newId(), hotelRef: H, taskId: L.greenNew, sourceAppCode: 'sentec-butler', label: 'Butler request', value: 'BTLR-88470', url: null, sort: 0 })

  // Amber: eight minutes left on the pick-up clock.
  seedTaskRow({
    id: L.soonNew, hotelRef: H, status: 'NEW', title: 'Luggage to room', description: 'Three bags at the bell desk',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: '0804', requesterName: 'Daniel Okafor',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpFrontOffice,
    activationDate: ago(7),
  })
  seedHistoryRow(L.soonNew, IDS.staff.sari, 'NEW', null, ago(7))

  // Red: pick-up deadline missed 25 minutes ago, no policy watching it.
  seedTaskRow({
    id: L.lateNew, hotelRef: H, status: 'NEW', title: 'Extra pillows', description: 'Two firm pillows',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.towels, roomNumber: '1407', quantity: 2,
    requesterName: 'Priya Nair', visitRef: 'V-88151', slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(40),
  })

  // Amber by priority alone: a High-priority job in the HK Morning Shift pool with time to spare.
  seedTaskRow({
    id: L.highTeamPool, hotelRef: H, status: 'NEW', title: 'Deep clean — floor 9 corridor', description: 'Carpet spill outside 0912',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: 'Floor 9', priority: 'HIGH',
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(20),
  })
  seedAssignmentRow(L.highTeamPool, 'TEAM', { teamId: IDS.team.hkMorning }, IDS.staff.sari, null, true, ago(20))
  seedHistoryRow(L.highTeamPool, IDS.staff.sari, 'NEW', null, ago(20))

  // Red by priority alone: Urgent, sitting in the F&B department pool.
  seedTaskRow({
    id: L.urgentDeptPool, hotelRef: H, status: 'NEW', title: 'Allergy meal replacement', description: 'Nut allergy — the tray must not go up as served',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.inRoomDining, roomNumber: '1206', priority: 'URGENT',
    requesterRef: IDS.guest.marcus, requesterName: 'Marcus Reid', visitRef: 'V-88104',
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpFnb,
    activationDate: ago(15),
  })
  seedAssignmentRow(L.urgentDeptPool, 'DEPARTMENT', { hotelDepartmentId: IDS.dept.smtpFnb }, IDS.staff.sari, 'Kitchen to confirm the substitute first', true, ago(15))
  seedHistoryRow(L.urgentDeptPool, IDS.staff.sari, 'NEW', null, ago(15))

  // Green, Budi's: picked up on time, hours left, two of four steps done, Made helping.
  seedTaskRow({
    id: L.budiGreen, hotelRef: H, status: 'IN_PROGRESS', title: 'Carpet shampoo', description: 'Whole room after the long stay',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.roomCleaning, roomNumber: '1101',
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(60), responseDuration: 12, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(L.budiGreen, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.budi, null, true, ago(48))
  seedHistoryRow(L.budiGreen, IDS.staff.sari, 'NEW', null, ago(60))
  seedHistoryRow(L.budiGreen, IDS.staff.budi, 'IN_PROGRESS', null, ago(48))
  liveChecklist(L.budiGreen, ['Move the furniture', 'Pre-treat the stains', 'Shampoo and extract', 'Dry and reset the room'], IDS.staff.budi, 2, ago(48))
  taskCollaborators.push({ id: newId(), hotelRef: H, taskId: L.budiGreen, staffId: IDS.staff.made, staffName: null, addedBy: IDS.staff.budi, isActive: true, createdAt: ago(30) })
  taskComments.push({ id: newId(), hotelRef: H, taskId: L.budiGreen, staffId: IDS.staff.sari, comment: 'Guest is back at 18:00 — plenty of time, but leave the windows open.', createdAt: ago(40), staffName: null })

  // Red verdict on a running task: picked up 25 minutes after its pick-up deadline, ten minutes left to finish.
  seedTaskRow({
    id: L.budiPickedUpLate, hotelRef: H, status: 'IN_PROGRESS', title: 'Replace bathroom amenities', description: 'Full set — the guest complained twice',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', roomNumber: '0915', requesterName: 'Lena Fischer', visitRef: 'V-88133',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(50), responseDuration: 40, responseSlaStatus: 'BREACHED',
  })
  seedAssignmentRow(L.budiPickedUpLate, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.budi, null, true, ago(10))
  seedHistoryRow(L.budiPickedUpLate, IDS.staff.budi, 'IN_PROGRESS', null, ago(10))

  // Escalated once: unclaimed, pick-up deadline five minutes gone, the
  // Standard policy's first step fired; the halfway step is not due yet.
  seedTaskRow({
    id: L.escalatedLevel1, hotelRef: H, status: 'NEW', title: 'Taxi booking for 14:00', description: 'Guest in 0312 needs a car to the airport',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: '0312', requesterName: 'Tomás Herrera',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpFrontOffice,
    activationDate: ago(20), escalationPolicyId: IDS.policy.smtpStandard, escalationLevel: 1, escalatedAt: ago(5),
  })
  seedHistoryRow(L.escalatedLevel1, IDS.staff.agus, 'NEW', null, ago(20))
  {
    const record: TaskEscalation = { hotelRef: H, taskId: L.escalatedLevel1, appliedAt: ago(5), policyId: IDS.policy.smtpStandard, stepId: IDS.step.stdResponse, level: 1, trigger: { kind: 'RESPONSE_OVERDUE', value: 0 }, applied: [], skipped: [], recipients: [IDS.staff.sari] }
    taskEscalations.push(record)
    seedHistoryRow(L.escalatedLevel1, null, 'NEW', escalationDescription(record), record.appliedAt)
  }

  // Escalated twice: past the pick-up deadline and past halfway to the
  // finish deadline, so the priority was bumped HIGH → URGENT; 25 minutes
  // remain before the third step would fire.
  seedTaskRow({
    id: L.escalatedLevel2, hotelRef: H, status: 'NEW', title: 'Water leak from ceiling', description: 'Dripping over the bed in 1004 — bucket placed',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.plumbing, roomNumber: '1004', priority: 'URGENT',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(35), escalationPolicyId: IDS.policy.smtpStandard, escalationLevel: 2, escalatedAt: ago(5),
  })
  seedHistoryRow(L.escalatedLevel2, IDS.staff.sari, 'NEW', null, ago(35))
  for (const record of [
    { hotelRef: H, taskId: L.escalatedLevel2, appliedAt: ago(20), policyId: IDS.policy.smtpStandard, stepId: IDS.step.stdResponse, level: 1, trigger: { kind: 'RESPONSE_OVERDUE', value: 0 }, applied: [], skipped: [], recipients: [IDS.staff.sari] },
    { hotelRef: H, taskId: L.escalatedLevel2, appliedAt: ago(5), policyId: IDS.policy.smtpStandard, stepId: IDS.step.stdHalfway, level: 2, trigger: { kind: 'PERCENT_OF_RESOLUTION', value: 50 }, applied: [{ type: 'bumpPriority', before: 'HIGH', after: 'URGENT' }], skipped: [], recipients: [] },
  ] as TaskEscalation[]) {
    taskEscalations.push(record)
    seedHistoryRow(L.escalatedLevel2, null, 'NEW', escalationDescription(record), record.appliedAt)
  }

  // No clock at all: a Low-priority chore with no SLA, so the card has no edge and no chip but the flag.
  {
    const chore = seedTaskRow({
      id: L.lowNoClock, hotelRef: H, status: 'IN_PROGRESS', title: 'Polish the brass door handles', description: 'Lobby and lift lobby, both floors',
      sourceProduct: 'sentec-tasks', sourceChannel: 'staff', locationId: IDS.location.lobby, priority: 'LOW',
      slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpHousekeeping,
      activationDate: ago(180),
    })
    chore.slaId = null
    chore.responseDueAt = null
    chore.resolutionDueAt = null
    chore.responseSlaMinutes = null
    chore.resolutionSlaMinutes = null
    seedAssignmentRow(L.lowNoClock, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.sari, 'Whenever the floor is quiet', true, ago(170))
    seedHistoryRow(L.lowNoClock, IDS.staff.sari, 'NEW', null, ago(180))
    seedHistoryRow(L.lowNoClock, IDS.staff.budi, 'IN_PROGRESS', null, ago(150))
  }

  // Amber, on hold: parked by Sari with twenty minutes left on the finish clock.
  seedTaskRow({
    id: L.onHoldSoon, hotelRef: H, status: 'PENDING', title: 'Airport pickup — flight delayed', description: 'Driver on standby; new ETA pending',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.transfer, roomNumber: '0702', requesterName: 'Wei Zhang', visitRef: 'V-88128',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpFrontOffice,
    activationDate: ago(40), responseDuration: 10, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(L.onHoldSoon, 'STAFF', { staffId: IDS.staff.sari }, IDS.staff.agus, null, true, ago(30))
  seedHistoryRow(L.onHoldSoon, IDS.staff.agus, 'NEW', null, ago(40))
  seedHistoryRow(L.onHoldSoon, IDS.staff.sari, 'IN_PROGRESS', null, ago(30))
  seedHistoryRow(L.onHoldSoon, IDS.staff.sari, 'PENDING', 'Waiting for the new arrival time', ago(15))

  // Scheduled: created now, starts in three hours, waits in the HK Morning Shift pool.
  seedTaskRow({
    id: L.scheduledLater, hotelRef: H, status: 'NEW', title: 'Turndown — floor 15', description: 'Evening turndown, rooms 1501-1512',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.turndown, roomNumber: 'Floor 15',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ahead(180), createdAt: ago(10),
  })
  seedAssignmentRow(L.scheduledLater, 'TEAM', { teamId: IDS.team.hkMorning }, IDS.staff.sari, null, true, ago(10))
  seedHistoryRow(L.scheduledLater, IDS.staff.sari, 'NEW', null, ago(10))

  // A hard due date on top of the SLA, five hours out.
  {
    const cake = seedTaskRow({
      id: L.hardDue, hotelRef: H, status: 'NEW', title: 'Birthday cake to room', description: 'Candles and a card from the hotel — before the dinner reservation',
      sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.inRoomDining, roomNumber: '1808', quantity: 1,
      requesterRef: IDS.guest.amelia, requesterName: 'Amelia Chen', visitRef: 'V-88121',
      slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpFnb,
      activationDate: ago(30),
    })
    cake.dueAt = ahead(300)
    seedHistoryRow(L.hardDue, IDS.staff.sari, 'NEW', null, ago(30))
  }

  // A second active project with one task of Budi's, amber: fifteen minutes
  // left to finish. Its own project, because the lobby's three tasks and
  // their progress are pinned by tests/api-fidelity.spec.ts.
  projects.push({
    id: IDS.project.rooftop, hotelRef: H, name: 'Rooftop bar opening', description: 'Dress the rooftop bar before Friday\'s soft launch.',
    startDate: '2026-10-05', endDate: '2026-10-16', status: 'ACTIVE', completedAt: null, createdBy: IDS.staff.agus, createdAt: ago(4 * 1440), updatedAt: ago(4 * 1440),
  })
  projectMembers.push(
    { projectId: IDS.project.rooftop, staffId: IDS.staff.sari, level: 'MANAGER', source: 'MANUAL', addedBy: IDS.staff.agus, addedAt: ago(4 * 1440) },
    { projectId: IDS.project.rooftop, staffId: IDS.staff.budi, level: 'MEMBER', source: 'MANUAL', addedBy: IDS.staff.sari, addedAt: ago(4 * 1440) },
  )
  seedTaskRow({
    id: IDS.projectTask.rooftopArt, hotelRef: H, status: 'IN_PROGRESS', title: 'Hang the artwork in the rooftop bar', description: 'Three pieces, positions marked on the wall',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: 'Rooftop bar',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping, projectId: IDS.project.rooftop,
    activationDate: ago(45), responseDuration: 5, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.projectTask.rooftopArt, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.sari, null, true, ago(40))
  seedHistoryRow(IDS.projectTask.rooftopArt, IDS.staff.sari, 'NEW', null, ago(45))
  seedHistoryRow(IDS.projectTask.rooftopArt, IDS.staff.budi, 'IN_PROGRESS', null, ago(40))

  // In review, on time: submitted by Budi with two proof photos, waiting on Sari.
  seedTaskRow({
    id: L.submittedOnTime, hotelRef: H, status: 'SUBMITTED', title: 'Restock minibar', description: 'Standard set plus two sparkling waters',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', itemRef: IDS.item.minibar, roomNumber: '1312',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(90), responseDuration: 6, resolutionDuration: 36, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME',
    completionNote: 'Restocked and logged. One water was short in the pantry — noted for the morning order.',
    submittedBy: IDS.staff.budi, submittedAt: ago(54),
  })
  seedAssignmentRow(L.submittedOnTime, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.budi, null, true, ago(84))
  seedHistoryRow(L.submittedOnTime, IDS.staff.sari, 'NEW', null, ago(90))
  seedHistoryRow(L.submittedOnTime, IDS.staff.budi, 'IN_PROGRESS', null, ago(84))
  seedHistoryRow(L.submittedOnTime, IDS.staff.budi, 'SUBMITTED', 'Restocked and logged. One water was short in the pantry — noted for the morning order.', ago(54))
  for (const n of [1, 2]) {
    const photo = { id: newId(), hotelRef: H, taskId: L.submittedOnTime, staffId: IDS.staff.budi, filetype: 'PHOTO' as const, filepath: `https://media.sentec-tasks.example/signed/proof-1312-${n}.jpg`, isRemoved: false, createdAt: ago(56 - n) }
    taskAttachments.push(photo)
    attachmentStorageKeys.set(photo.id, `hotels/${H}/uploads/${uid('d5', n)}.jpg`)
  }

  // Finished late: Joko took most of yesterday on it.
  seedTaskRow({
    id: L.finishedLate, hotelRef: H, status: 'FINISHED', title: 'Fix the wobbly desk chair', description: 'Base cracked — replaced from stores',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: '0509',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(1440), responseDuration: 12, resolutionDuration: 95, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED',
  })
  seedAssignmentRow(L.finishedLate, 'STAFF', { staffId: IDS.staff.joko }, IDS.staff.joko, null, true, ago(1428))
  seedHistoryRow(L.finishedLate, IDS.staff.sari, 'NEW', null, ago(1440))
  seedHistoryRow(L.finishedLate, IDS.staff.joko, 'IN_PROGRESS', null, ago(1428))
  seedHistoryRow(L.finishedLate, IDS.staff.joko, 'FINISHED', 'Chair base replaced; old one to the workshop.', ago(1345))

  // Verified, but picked up late: the finish was on time once it started.
  seedTaskRow({
    id: L.verifiedPickedUpLate, hotelRef: H, status: 'VERIFIED', title: 'Replace shower curtain', description: 'Mould on the hem',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', roomNumber: '0611', requesterName: 'Sofia Rossi', visitRef: 'V-88119',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(600), responseDuration: 25, resolutionDuration: 55, responseSlaStatus: 'BREACHED', resolutionSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(L.verifiedPickedUpLate, 'STAFF', { staffId: IDS.staff.made }, IDS.staff.made, null, true, ago(575))
  seedHistoryRow(L.verifiedPickedUpLate, IDS.staff.made, 'IN_PROGRESS', null, ago(575))
  seedHistoryRow(L.verifiedPickedUpLate, IDS.staff.made, 'FINISHED', null, ago(545))
  seedHistoryRow(L.verifiedPickedUpLate, IDS.staff.sari, 'VERIFIED', null, ago(500))

  // Sari's task with a pending offer to Budi, so his inbox has something to answer.
  seedTaskRow({
    id: L.offerToBudi, hotelRef: H, status: 'IN_PROGRESS', title: 'Welcome amenity for VIP arrival', description: 'Fruit, flowers and the GM\'s card in 2001 before 15:00',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: '2001', requesterName: 'Mr and Mrs Lim',
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpFrontOffice,
    activationDate: ago(30), responseDuration: 3, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(L.offerToBudi, 'STAFF', { staffId: IDS.staff.sari }, IDS.staff.sari, null, true, ago(27))
  seedHistoryRow(L.offerToBudi, IDS.staff.sari, 'NEW', null, ago(30))
  seedHistoryRow(L.offerToBudi, IDS.staff.sari, 'IN_PROGRESS', null, ago(27))
  taskOffers.push({
    id: IDS.offer.vipToBudi, hotelRef: H, taskId: L.offerToBudi,
    fromStaff: IDS.staff.sari, toStaff: IDS.staff.budi,
    note: 'Can you take this one? I am on the desk until 15:00.',
    state: 'PENDING', decidedAt: null, createdAt: ago(12),
  })

  // Owned by a department the hotel has since deactivated: the badge says so.
  seedTaskRow({
    id: L.inactiveDept, hotelRef: H, status: 'NEW', title: 'Spa towel restock', description: 'Left over from the spa handover',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: 'Spa',
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpSpa,
    activationDate: ago(5),
  })
  seedHistoryRow(L.inactiveDept, IDS.staff.agus, 'NEW', null, ago(5))

  // Joko's task with Budi helping — Budi sees it under Helping, read-only otherwise.
  seedTaskRow({
    id: L.helpingBudi, hotelRef: H, status: 'IN_PROGRESS', title: 'Move furniture for carpet fitting', description: 'Clear 1203 before the fitters arrive',
    sourceProduct: 'sentec-tasks', sourceChannel: 'staff', roomNumber: '1203',
    slaId: IDS.sla.smtpScheduled, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: ago(40), responseDuration: 8, responseSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(L.helpingBudi, 'STAFF', { staffId: IDS.staff.joko }, IDS.staff.sari, null, true, ago(32))
  seedHistoryRow(L.helpingBudi, IDS.staff.sari, 'NEW', null, ago(40))
  seedHistoryRow(L.helpingBudi, IDS.staff.joko, 'IN_PROGRESS', null, ago(32))
  taskCollaborators.push({ id: newId(), hotelRef: H, taskId: L.helpingBudi, staffId: IDS.staff.budi, staffName: null, addedBy: IDS.staff.sari, isActive: true, createdAt: ago(25) })

  // ── Templates. Two shared (admin-made) schedules and Budi's own weekday
  // rounds; the mock worker fills nextRunAt at boot and creates tasks lazily.
  taskTemplates.push(
    {
      id: IDS.template.nightlyMinibar, hotelRef: H, name: 'Nightly minibar count', isActive: true, scope: 'shared',
      content: { title: 'Minibar count — floor 12', itemRef: IDS.item.minibar, roomNumber: 'Floor 12', checklistLabels: ['Count stock', 'Log variances'], assignee: { assigneeKind: 'TEAM', assigneeTeamId: IDS.team.hkMorning } },
      recurrence: { kind: 'DAILY', timeMinutes: 21 * 60, weekdays: null, dayOfMonth: null, startsOn: '2026-08-20', endsOn: null },
      nextRunAt: null, lastRunAt: null, lastOccurrenceAt: null, lastTaskId: null, lastError: null, createdBy: IDS.staff.agus, ownerStaffId: null, isArchived: false, createdAt: '2026-08-19T03:00:00.000Z', updatedAt: '2026-08-19T03:00:00.000Z',
    },
    {
      id: IDS.template.mondayFilters, hotelRef: H, name: 'Weekly AC filter check', isActive: false, scope: 'shared',
      content: { title: 'AC filter check — floors 7-9', itemRef: IDS.item.acFault, locationRef: IDS.location.floor7, checklistLabels: [], assignee: { assigneeKind: 'UNASSIGNED' } },
      recurrence: { kind: 'WEEKLY', timeMinutes: 8 * 60 + 30, weekdays: [1], dayOfMonth: null, startsOn: null, endsOn: null },
      nextRunAt: null, lastRunAt: '2026-08-24T01:30:00.000Z', lastOccurrenceAt: '2026-08-24T01:30:00.000Z', lastTaskId: null, lastError: 'occurrence 2026-08-24T01:30:00Z skipped: catalog item not available', createdBy: IDS.staff.agus, ownerStaffId: null, isArchived: false, createdAt: '2026-08-19T03:10:00.000Z', updatedAt: '2026-08-24T01:30:00.000Z',
    },
    {
      id: IDS.template.budiRounds, hotelRef: H, name: 'Corridor rounds', isActive: true, scope: 'personal',
      content: { title: 'Corridor rounds — floor 11', roomNumber: 'Floor 11', checklistLabels: ['Ice machine', 'Linen cupboard', 'Fire doors'], assignee: { assigneeKind: 'STAFF', assigneeStaffId: IDS.staff.budi } },
      recurrence: { kind: 'WEEKLY', timeMinutes: 7 * 60, weekdays: [1, 2, 3, 4, 5], dayOfMonth: null, startsOn: null, endsOn: null },
      nextRunAt: null, lastRunAt: null, lastOccurrenceAt: null, lastTaskId: null, lastError: null, createdBy: IDS.staff.budi, ownerStaffId: IDS.staff.budi, isArchived: false, createdAt: '2026-08-21T00:30:00.000Z', updatedAt: '2026-08-21T00:30:00.000Z',
    },
  )
  for (const template of taskTemplates) {
    // Seed schedules start from now: the demo must not backfill weeks of runs.
    template.nextRunAt = template.isActive && template.recurrence ? nextRunAfter(template.recurrence, hotelTimezone(template.hotelRef), Date.now()) : null
  }
}

/** StorageKey is json:"-" in the real model — held off to the side here. */
const attachmentStorageKeys = new Map<Id, string>()

seedDemoData()

// ════════════════════════ Task resolution pipeline (Resolve) ════════════════════════

interface ResolveInput {
  title: string
  description: string | null
  notes: string | null
  roomNumber: string | null
  quantity: number | null
  activationDate: string | null
  dueAt: string | null
  priority: string | null
  itemRef: Id | null
  itemName: string
  categoryName: string | null
  locationRef: Id | null
  requesterRef: Id | null
  requesterName: string | null
  visitRef: string | null
  itemQuantity: boolean
  checklistLabels: string[]
  sourceProduct: string
  sourceChannel: string
  idempotencyKey: Id | null
}

interface ResolvedTask { task: Task, checklistLabels: string[], warnings: string[] | null }

/**
 * Service.Resolve — one pipeline for dispatch, staff-create and preview, in
 * the Go's exact step order, so the three routes can never disagree.
 */
function resolveTask(hotelRef: Id, input: ResolveInput): ResolvedTask {
  let warnings: string[] | null = null
  const warn = (message: string) => { warnings = [...(warnings ?? []), message] }

  // 1. Classification from the catalog item.
  let item: CatalogItem | null = null
  if (input.itemRef) {
    const found = catalogItems.find(i => i.id === input.itemRef && i.hotelRef === hotelRef)
    if (found && !found.isActive) throw badRequest('catalog item not available')
    item = found ?? null
  }
  const itemName = item?.name ?? input.itemName
  const itemQuantity = item?.itemQuantity ?? input.itemQuantity
  const requiresLocation = item?.requiresLocation ?? false

  // 2. Title falls back to the item name; this is the only title validation.
  const title = (input.title || itemName || '').trim()
  if (!title || title.length > 255) throw badRequest('title is required (1-255 chars)')

  // 3-4. Category snapshot + priority precedence (explicit → item → NORMAL).
  const category = item?.categoryId ? categories.find(c => c.id === item.categoryId) ?? null : null
  const categoryName = category?.name ?? (input.categoryName || null)
  let priority: TaskPriority = 'NORMAL'
  const explicit = (input.priority ?? '').trim().toUpperCase()
  if (explicit) {
    if (!TASK_PRIORITY_VALUES.includes(explicit as TaskPriority)) throw badRequest('priority must be one of LOW, NORMAL, HIGH, URGENT')
    priority = explicit as TaskPriority
  }
  else if (item?.defaultPriority) {
    priority = item.defaultPriority
  }

  // 5. Quantity only exists for quantity-enabled items.
  let quantity: number | null = null
  if (itemQuantity) {
    quantity = input.quantity ?? 1
    if (quantity < 1) throw badRequest('quantity must be positive')
  }

  // 6. Location snapshot; roomNumber auto-fills from the location's name.
  let location: Location | null = null
  let locationTypeName: string | null = null
  let linksRequester = false
  if (input.locationRef) {
    location = locations.find(l => l.id === input.locationRef && l.hotelRef === hotelRef && l.isActive) ?? null
    if (!location) throw unprocessable('invalid location reference')
    const type = locationTypes.find(t => t.id === location!.locationTypeId)
    locationTypeName = type?.name ?? null
    linksRequester = type?.linksRequester ?? false
  }
  else if (requiresLocation && input.sourceChannel === 'staff') {
    throw badRequest('this item requires a location')
  }
  const roomNumber = input.roomNumber ?? location?.name ?? null

  // 7. Requester lookup (the PMS seam). Explicit values always win; a lookup
  //    failure is a warning, never an error; a vacant room is silent.
  let requesterRef = input.requesterRef
  let requesterName = input.requesterName
  let visitRef = input.visitRef
  if (!requesterRef && !requesterName && linksRequester && location) {
    if (PMS_ERROR_CODES.has(location.code)) {
      warn('requester lookup failed: pms: lookup timed out')
    }
    else {
      const visit = pmsVisits.get(`${hotelRef}|${location.code}`)
      if (visit) {
        requesterRef = visit.requesterRef
        requesterName = visit.requesterName
        visitRef = visit.visitRef
      }
    }
  }

  // 8-9. Routing → SLA; no match falls back to the default SLA, deptless.
  const rule = findBestRoutingMatch(hotelRef, input.itemRef, item?.categoryId ?? null, location?.locationTypeId ?? null, priority)
  const slaId = rule?.slaId ?? slas.find(s => s.hotelRef === hotelRef && s.isDefault)?.id ?? null
  if (!slaId) throw unprocessable('no SLA configuration found for this task; configure a routing rule or a default SLA')
  const sla = slas.find(s => s.id === slaId)
  if (!sla) throw badRequest('SLA not found')
  const hotelDepartmentId = rule?.hotelDepartmentId ?? null
  // 9b. Escalation policy (decision 1): the rule's → the SLA's → the hotel's
  //     active default → none. Resolved once; the steps are read live later.
  const escalationPolicyId = rule?.escalationPolicyId ?? sla.escalationPolicyId ?? defaultEscalationPolicy(hotelRef)?.id ?? null

  // 10. Clocks: schedule-aware, and resolution CHAINS off the response due.
  const now = nowIso()
  const activation = input.activationDate ?? now
  const schedule = scheduleFor(hotelRef, hotelDepartmentId)
  const responseDueAt = advanceAcrossSchedule(hotelRef, schedule, activation, sla.responseTime)
  const resolutionDueAt = advanceAcrossSchedule(hotelRef, schedule, responseDueAt, sla.resolutionTime)

  // 11. dueAt is explicit-only and must not precede activation.
  if (input.dueAt && Date.parse(input.dueAt) < Date.parse(activation)) throw badRequest('dueAt cannot be before activationDate')

  // 12. Column: first non-removed NEW column; nil is tolerated ([DR-9]).
  const column = columnForStatus(hotelRef, 'NEW')

  // 13. Checklist: item defaults first, then the request's own labels.
  const checklistLabels = [...(item?.defaultChecklist ?? []), ...input.checklistLabels]

  const task: Task = {
    hotelRef,
    id: newId(),
    status: 'NEW',
    title,
    description: input.description,
    notes: input.notes,
    roomNumber,
    quantity,
    sourceProduct: input.sourceProduct,
    sourceChannel: input.sourceChannel,
    idempotencyKey: input.idempotencyKey,
    itemRef: input.itemRef,
    itemName: itemName || title,
    categoryName,
    requesterRef: requesterRef ?? null,
    requesterName: requesterName ?? null,
    visitRef: visitRef ?? null,
    priority,
    locationId: location?.id ?? null,
    locationTypeName,
    slaId,
    hotelDepartmentId,
    columnId: column?.id ?? null,
    activationDate: activation,
    dueAt: input.dueAt,
    responseDueAt,
    resolutionDueAt,
    responseSlaMinutes: sla.responseTime,
    resolutionSlaMinutes: sla.resolutionTime,
    responseDuration: null,
    resolutionDuration: null,
    responseSlaStatus: 'EMPTY',
    resolutionSlaStatus: 'EMPTY',
    completionNote: null,
    submittedBy: null,
    submittedAt: null,
    templateId: null,
    occurrenceKey: null,
    escalationPolicyId,
    escalationLevel: 0,
    escalatedAt: null,
    projectId: null,
    createdAt: now,
    updatedAt: now,
  }
  return { task, checklistLabels, warnings }
}

// ════════════════════════ Assignment core ════════════════════════

const staffInHotel = (staffId: Id, hotelRef: Id) =>
  staffAccounts.some(s => s.id === staffId && s.isActive) && hotelsClaim(staffId).includes(hotelRef)

const isTeamMember = (teamId: Id | null, staffId: Id | null) =>
  !!teamId && !!staffId && teamMembers.some(m => m.teamId === teamId && m.staffId === staffId)

/**
 * [DR-7] departmentSync: no-dept assignee → no-op; deptless task adopts the
 * assignee's; match → no-op; mismatch is allowed for admins (task unchanged)
 * and refused for everyone else.
 */
function departmentSync(actor: Actor, t: Task, assigneeStaffId: Id) {
  const assigneeDept = dbDept(assigneeStaffId, t.hotelRef)
  if (!assigneeDept) return
  if (!t.hotelDepartmentId) {
    t.hotelDepartmentId = assigneeDept
    return
  }
  if (t.hotelDepartmentId === assigneeDept) return
  // The project manager assigning across departments MOVES the task to the
  // assignee's department (due times are not recalculated).
  if (managesProject(actor, t)) {
    t.hotelDepartmentId = assigneeDept
    return
  }
  if (actor.role === 'admin' && !isScopedStaffActor(actor)) return
  throw badRequest(ERR_CROSS_DEPARTMENT)
}

/**
 * Anyone given a project task BY NAME — assign, claim, accepted offer,
 * helper, checklist step — becomes a MEMBER with source AUTO. Team and
 * department pools add nobody.
 */
function ensureAutoMember(t: Pick<Task, 'projectId'>, staffId: Id | null, addedBy: Id | null, at: string) {
  if (!t.projectId || !staffId) return
  if (projectMembers.some(m => m.projectId === t.projectId && m.staffId === staffId)) return
  projectMembers.push({ projectId: t.projectId, staffId, level: 'MEMBER', source: 'AUTO', addedBy, addedAt: at })
}

function cancelPendingOffer(taskId: Id, at: string) {
  const pending = taskOffers.find(o => o.taskId === taskId && o.state === 'PENDING')
  if (pending) {
    pending.state = 'CANCELLED'
    pending.decidedAt = at
  }
}

/** Shared tail of Claim/Assign: sync, deactivate, cancel offer, drop helper row, insert. */
function assignStaffToTask(actor: Actor, t: Task, staffId: Id, remark: string | null, assignedBy: Id | null, at: string) {
  if (!staffInHotel(staffId, t.hotelRef)) throw notFound('staff')
  departmentSync(actor, t, staffId)
  taskAssignments.filter(a => a.taskId === t.id && a.isActive).forEach((a) => { a.isActive = false })
  cancelPendingOffer(t.id, at)
  // An assignee is never their own helper.
  taskCollaborators.filter(c => c.taskId === t.id && c.staffId === staffId && c.isActive).forEach((c) => { c.isActive = false })
  taskAssignments.push({
    id: newId(), taskId: t.id, kind: 'STAFF', staffId, teamId: null, hotelDepartmentId: null,
    assignedBy, actingUser: actor.isService && actor.actingUser ? actor.actingUser : null,
    remark, isActive: true, createdAt: at,
  })
  ensureAutoMember(t, staffId, assignedBy, at)
  t.updatedAt = at
}

interface AssigneeInput { assigneeKind?: string, assigneeStaffId?: unknown, assigneeTeamId?: unknown }

/** The creation-time assignment gate — runs BEFORE any write, identically in preview. */
function validateAssignAtCreation(actor: Actor, hotelRef: Id, assignee: AssigneeInput | null | undefined): { kind: 'STAFF', staffId: Id } | { kind: 'TEAM', teamId: Id } | null {
  const kind = assignee?.assigneeKind ?? ''
  if (!assignee || kind === '' || kind === 'UNASSIGNED') return null
  const unrestricted = actor.role === 'leader' || actor.role === 'admin' || actor.isService
  if (kind === 'STAFF') {
    const staffId = assignee.assigneeStaffId
    if (!isUuid(staffId)) throw badRequest('assigneeStaffId is required for assigneeKind=STAFF')
    if (!unrestricted && staffId !== actor.staffId) throw forbidden('staff may only self-assign at creation')
    if (!staffInHotel(staffId, hotelRef)) throw notFound('staff')
    return { kind: 'STAFF', staffId }
  }
  if (kind === 'TEAM') {
    const teamId = assignee.assigneeTeamId
    if (!isUuid(teamId)) throw badRequest('assigneeTeamId is required for assigneeKind=TEAM')
    const team = teams.find(t => t.id === teamId && t.hotelRef === hotelRef && t.isActive)
    if (!team) throw unprocessable('invalid team reference')
    if (!unrestricted && !isTeamMember(teamId, actor.staffId)) throw forbidden('staff may only assign to a team they belong to')
    return { kind: 'TEAM', teamId }
  }
  if (kind === 'DEPARTMENT') throw badRequest('assigneeKind=DEPARTMENT is not yet supported at creation — use hotelDepartmentId routing instead')
  throw badRequest('assigneeKind must be one of STAFF, TEAM, DEPARTMENT, UNASSIGNED')
}

// ════════════════════════ Request decode helpers ════════════════════════

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const asTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const asNullableTrimmed = (value: unknown): string | null => {
  const trimmed = asTrimmed(value)
  return trimmed === '' ? null : trimmed
}

function asIsoDate(value: unknown, field: string): string | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(parsed)) throw badRequest(`invalid ${field}`)
  return new Date(parsed).toISOString()
}

function decodeStaffCreateRequest(ctx: Ctx, sourceChannel: string): ResolveInput {
  const body = ctx.body
  const itemRef = body.itemRef == null || body.itemRef === '' ? null : String(body.itemRef)
  if (itemRef !== null && !isUuid(itemRef)) throw badRequest('invalid JSON body')
  const locationRef = body.locationRef == null || body.locationRef === '' ? null : String(body.locationRef)
  if (locationRef !== null && !isUuid(locationRef)) throw badRequest('invalid JSON body')
  return {
    title: asTrimmed(body.title),
    description: asNullableTrimmed(body.description),
    notes: asNullableTrimmed(body.notes),
    roomNumber: asNullableTrimmed(body.roomNumber),
    quantity: typeof body.quantity === 'number' ? body.quantity : null,
    activationDate: asIsoDate(body.activationDate, 'activationDate'),
    dueAt: asIsoDate(body.dueAt, 'dueAt'),
    priority: asString(body.priority),
    itemRef,
    itemName: asTrimmed(body.itemName),
    categoryName: asNullableTrimmed(body.categoryName),
    locationRef,
    requesterRef: isUuid(body.requesterRef) ? body.requesterRef : null,
    requesterName: asNullableTrimmed(body.requesterName),
    visitRef: asNullableTrimmed(body.visitRef),
    itemQuantity: Boolean(body.itemQuantity),
    checklistLabels: Array.isArray(body.checklistLabels) ? body.checklistLabels.map(label => String(label ?? '').trim()).filter(Boolean) : [],
    sourceProduct: 'sentec-tasks',
    sourceChannel,
    idempotencyKey: null,
  }
}

// ════════════════════════ List machinery ════════════════════════

interface ListParams {
  status: TaskStatus | null
  responseSlaStatus: SlaStatus | null
  resolutionSlaStatus: SlaStatus | null
  columnId: Id | null
  departmentId: Id | null
  itemRef: Id | null
  assignedStaffId: Id | null
  roomNumber: string | null
  createdFrom: string | null
  createdTo: string | null
  sort: string
  ascending: boolean
  limit: number
  cursor: string | null
}

const LIST_SORT_FIELDS = new Set(['createdAt', 'status', 'id', 'responseDueAt', 'resolutionDueAt'])
const SLA_STATUS_VALUES = new Set<SlaStatus>(['EMPTY', 'ON_TIME', 'BREACHED'])

function parseListParams(query: Record<string, string>): ListParams {
  const uuidParam = (key: string): Id | null => {
    const raw = query[key]
    if (!raw) return null
    if (!isUuid(raw)) throw badRequest(`invalid ${key}`)
    return raw.toLowerCase()
  }
  const status = query.status || null
  if (status && !TASK_STATUSES.includes(status as TaskStatus)) throw badRequest('invalid status filter')
  const responseSla = query.responseSlaStatus || null
  if (responseSla && !SLA_STATUS_VALUES.has(responseSla as SlaStatus)) throw badRequest('invalid responseSlaStatus filter')
  const resolutionSla = query.resolutionSlaStatus || null
  if (resolutionSla && !SLA_STATUS_VALUES.has(resolutionSla as SlaStatus)) throw badRequest('invalid resolutionSlaStatus filter')
  const dateParam = (key: string): string | null => {
    const raw = query[key]
    if (!raw) return null
    const parsed = Date.parse(raw)
    if (!Number.isFinite(parsed)) throw badRequest(`invalid ${key}`)
    return new Date(parsed).toISOString()
  }
  const sort = query.sort || 'createdAt'
  if (!LIST_SORT_FIELDS.has(sort)) throw badRequest('invalid sort field')
  // Anything but a case-insensitive "asc" — absent included — sorts descending.
  const ascending = (query.order ?? '').toLowerCase() === 'asc'
  let limit = 20
  const rawLimit = Number.parseInt(query.limit ?? '', 10)
  if (Number.isFinite(rawLimit)) limit = rawLimit <= 0 ? 20 : Math.min(rawLimit, 100)
  return {
    status: (status as TaskStatus | null),
    responseSlaStatus: responseSla as SlaStatus | null,
    resolutionSlaStatus: resolutionSla as SlaStatus | null,
    columnId: uuidParam('columnId'),
    departmentId: uuidParam('departmentId'),
    itemRef: uuidParam('itemRef'),
    assignedStaffId: uuidParam('assignedStaffId'),
    roomNumber: query.roomNumber?.trim() || null,
    createdFrom: dateParam('createdFrom'),
    createdTo: dateParam('createdTo'),
    sort,
    ascending,
    limit,
    cursor: query.cursor || null,
  }
}

const base64UrlEncode = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
}

function sortValue(t: Task, field: string): string | null {
  switch (field) {
    case 'status': return t.status
    case 'id': return t.id
    case 'responseDueAt': return t.responseDueAt
    case 'resolutionDueAt': return t.resolutionDueAt
    default: return t.createdAt
  }
}

/** Cursor payload {v, id} (+h cross-tenant), base64url without padding. */
function encodeCursor(t: Task, field: string, withHotel: boolean): string {
  const payload: Record<string, string> = { v: sortValue(t, field) ?? '', id: t.id }
  if (withHotel) payload.h = t.hotelRef
  return base64UrlEncode(JSON.stringify(payload))
}

function decodeCursor(cursor: string, field: string): { v: string, id: string, h: string | null } {
  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlDecode(cursor))
  }
  catch {
    throw badRequest('invalid cursor token')
  }
  const record = parsed as { v?: unknown, id?: unknown, h?: unknown }
  if (typeof record.v !== 'string' || !isUuid(record.id)) throw badRequest('invalid cursor token')
  if (field === 'status' && !TASK_STATUSES.includes(record.v as TaskStatus)) throw badRequest('invalid cursor token')
  return { v: record.v, id: record.id as string, h: isUuid(record.h) ? (record.h as string) : null }
}

/**
 * Keyset ordering with the Go's NULL placement: NULLS FIRST under DESC,
 * NULLS LAST under ASC; ties broken on (hotelRef,) id in the same direction.
 */
function compareTasks(a: Task, b: Task, field: string, ascending: boolean, withHotel: boolean): number {
  const av = sortValue(a, field)
  const bv = sortValue(b, field)
  let cmp: number
  if (av === null && bv === null) cmp = 0
  else if (av === null) cmp = ascending ? 1 : -1
  else if (bv === null) cmp = ascending ? -1 : 1
  else cmp = ascending ? av.localeCompare(bv) : bv.localeCompare(av)
  if (cmp !== 0) return cmp
  if (withHotel) {
    const hotelCmp = ascending ? a.hotelRef.localeCompare(b.hotelRef) : b.hotelRef.localeCompare(a.hotelRef)
    if (hotelCmp !== 0) return hotelCmp
  }
  return ascending ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)
}

function runTaskList(rows: Task[], params: ListParams, withHotel: boolean): { page: TaskListItem[], total: number, nextCursor: string | null } {
  let filtered = rows
  if (params.status) filtered = filtered.filter(t => t.status === params.status)
  if (params.responseSlaStatus) filtered = filtered.filter(t => t.responseSlaStatus === params.responseSlaStatus)
  if (params.resolutionSlaStatus) filtered = filtered.filter(t => t.resolutionSlaStatus === params.resolutionSlaStatus)
  if (params.columnId) filtered = filtered.filter(t => t.columnId === params.columnId)
  if (params.departmentId) filtered = filtered.filter(t => t.hotelDepartmentId === params.departmentId)
  if (params.itemRef) filtered = filtered.filter(t => t.itemRef === params.itemRef)
  if (params.roomNumber) filtered = filtered.filter(t => t.roomNumber === params.roomNumber)
  if (params.createdFrom) filtered = filtered.filter(t => t.createdAt >= params.createdFrom!)
  if (params.createdTo) filtered = filtered.filter(t => t.createdAt <= params.createdTo!)

  const total = filtered.length
  const sorted = [...filtered].sort((a, b) => compareTasks(a, b, params.sort, params.ascending, withHotel))

  let startIndex = 0
  if (params.cursor) {
    const anchor = decodeCursor(params.cursor, params.sort)
    const anchorTask: Task = {
      ...(sorted[0] ?? tasks[0]!),
      id: anchor.id,
      hotelRef: anchor.h ?? sorted[0]?.hotelRef ?? '',
    }
    const anchorValue = anchor.v === '' ? null : anchor.v
    const probe = { ...anchorTask } as Task & Record<string, unknown>
    if (params.sort === 'status') probe.status = anchorValue as TaskStatus
    else if (params.sort === 'responseDueAt') probe.responseDueAt = anchorValue
    else if (params.sort === 'resolutionDueAt') probe.resolutionDueAt = anchorValue
    else if (params.sort === 'createdAt') probe.createdAt = anchorValue ?? ''
    startIndex = sorted.findIndex(t => compareTasks(t, probe, params.sort, params.ascending, withHotel) > 0)
    if (startIndex === -1) startIndex = sorted.length
  }

  const page = sorted.slice(startIndex, startIndex + params.limit)
  const hasMore = startIndex + params.limit < sorted.length
  const last = page[page.length - 1]
  return {
    page: page.map(taskListItem),
    total,
    nextCursor: hasMore && last ? encodeCursor(last, params.sort, withHotel) : null,
  }
}

/** [DR-15] applied to the list query for a scoped staff actor. */
function applyStaffVisibility(actor: Actor, hotelRef: Id, params: ListParams, rows: Task[]): Task[] {
  if (!isScopedStaffActor(actor)) {
    if (params.assignedStaffId) {
      return rows.filter(t => activeAssignment(t.id)?.staffId === params.assignedStaffId)
    }
    return rows
  }
  // Clamped, never honored: an explicit assignedStaffId becomes the caller's own.
  if (params.assignedStaffId) {
    return rows.filter(t => activeAssignment(t.id)?.staffId === actor.staffId)
  }
  // Filtering by departmentId drops arm (c), so a filtered list can be
  // smaller than the unfiltered one; this is intended.
  return rows.filter(t => visibleTo(actor, hotelRef, t, !params.departmentId))
}

// ════════════════════════ Response helpers ════════════════════════

const ok = <T>(data: T, status = 200, meta?: Record<string, unknown> | null): FakeResponse<T> => ({
  status,
  body: meta === undefined ? { version: 'v1', data } : { version: 'v1', data, meta },
})

const noContent = (): FakeResponse<never> => ({ status: 204, body: null })

/** Every property the person can reach, sorted by name (name falls back to the ref). */
function propertiesOf(staffId: Id): Property[] {
  return hotelsClaim(staffId)
    .map(hotelRef => ({ hotelRef, name: tenants.find(t => t.hotelRef === hotelRef)?.name ?? hotelRef }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const membershipModel = (r: MembershipRow): HotelMembership => ({
  hotelRef: r.hotelRef,
  role: r.role,
  hotelDepartmentId: r.hotelDepartmentId,
  createTask: r.createTask,
  syncIssue: r.syncIssue ? { type: 'unknown_department', emsDepartmentName: r.syncIssue } : null,
})

/**
 * The Staff read model: identity + reach + per-property standing. `onlyHotel`
 * is GET /v1/staff's narrowing — each person's memberships hold only the
 * listed hotel there.
 */
const staffReadModel = (acct: SeedAccount, onlyHotel?: Id): Staff => ({
  id: acct.id,
  email: acct.email,
  name: acct.name,
  isActive: acct.isActive,
  isOperator: acct.isOperator,
  emsEmployeeId: acct.emsEmployeeId ?? null,
  properties: propertiesOf(acct.id),
  memberships: staffHotels.filter(r => r.staffId === acct.id && (!onlyHotel || r.hotelRef === onlyHotel)).map(membershipModel),
  groupGrants: groupGrants.filter(g => g.staffId === acct.id).map(g => g.groupId),
})

/** Session-shaped Staff (login, /v1/auth/session, /v1/staff/me): the full model, every membership. */
const sessionStaffModel = (acct: SeedAccount): Staff => staffReadModel(acct)

// ════════════════════════ Auth + staff routes ════════════════════════

function handleAuthAndStaff(ctx: Ctx): FakeResponse | null {
  const { method, path, body } = ctx

  if (method === 'POST' && path === '/v1/auth/staff/login') {
    const email = asTrimmed(body.email).toLowerCase()
    const password = String(body.password ?? '')
    const bucket = loginFailures.get(email)
    const now = Date.now()
    if (bucket && now - bucket.windowStart < LOGIN_RATE_WINDOW_MS && bucket.count >= LOGIN_RATE_MAX) {
      throw new ApiError('RATE_LIMITED', 'too many login attempts')
    }
    const acct = staffAccounts.find(s => s.email === email && s.isActive)
    // An imported account has NO password (it signs in by magic link or
    // Google): the empty string must never match.
    if (!acct || !acct.password || acct.password !== password) {
      // Only a FAILED attempt consumes budget.
      const window = bucket && now - bucket.windowStart < LOGIN_RATE_WINDOW_MS ? bucket : { count: 0, windowStart: now }
      window.count += 1
      loginFailures.set(email, window)
      throw unauthorized('invalid email or password')
    }
    if (ctx.query.delivery === 'cookie') {
      const session = startCookieSession(acct)
      // The Set-Cookie seam: a browser mock cannot mint an HttpOnly cookie, so
      // the session id rides in data._sessionCookie for the client to replay
      // as `Cookie: st_session=…`. The REAL response carries no such field.
      return ok({ csrfToken: session.csrfToken, staff: sessionStaffModel(acct), _sessionCookie: session.id })
    }
    const token = randomToken()
    staffBearerTokens.set(token, { staffId: acct.id, expiresAt: now + SESSION_TTL_MS })
    return ok({ token, staff: sessionStaffModel(acct) })
  }

  // ── Google Sign-In: JSON leg. Returns the URL rather than 302ing so the app
  // can render a 400/429/503 itself instead of stranding the user on the API.
  if (method === 'GET' && path === '/v1/auth/google/url') {
    let returnTo: string
    if (ctx.query.returnTo) {
      const allowed = allowedRedirect(ctx.query.returnTo)
      if (!allowed) throw badRequest('returnTo is not an allowed origin')
      returnTo = allowed
    }
    else {
      const fallback = defaultRedirect()
      if (!fallback) throw badRequest('no allowed redirect origin is configured')
      returnTo = fallback
    }
    const state = randomToken()
    // The flow cookie: PKCE verifier + nonce stay server-side, returnTo is
    // sealed in rather than sent to Google.
    oauthFlow = { state, returnTo, expiresAt: Date.now() + OAUTH_FLOW_TTL_MS }
    const url = new URL('/o/oauth2/v2/auth', MOCK_GOOGLE_AUTH_ORIGIN)
    url.searchParams.set('client_id', MOCK_GOOGLE_CLIENT_ID)
    url.searchParams.set('redirect_uri', `${API_BASE_URL}/v1/auth/google/callback`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge_method', 'S256')
    return ok({ url: url.toString() })
  }

  // ── Google Sign-In: browser leg. Redirects on success AND failure; the flow
  // cookie is cleared on every terminal outcome so a verifier is never reused.
  if (method === 'GET' && path === '/v1/auth/google/callback') {
    const fallback = defaultRedirect()
    if (!fallback) throw badRequest('no allowed redirect origin is configured')
    const flow = oauthFlow
    oauthFlow = null
    if (ctx.query.error) {
      // Google reports cancellation and its own failures here, not by omitting the code.
      return redirect(withAuthError(fallback, ctx.query.error === 'access_denied' ? 'google_denied' : 'exchange_failed'))
    }
    if (!flow || flow.expiresAt < Date.now()) return redirect(withAuthError(fallback, 'expired_flow'))
    // Re-validated rather than trusted because it came out of our own cookie:
    // the allow-list may have been tightened since the flow started.
    const target = allowedRedirect(flow.returnTo) ?? fallback
    if (ctx.query.state !== flow.state) return redirect(withAuthError(target, 'invalid_state'))
    const identity = exchangeGoogleCode(ctx.query.code)
    if (!identity) return redirect(withAuthError(target, 'exchange_failed'))
    if (!identity.emailVerified) return redirect(withAuthError(target, 'email_unverified'))
    // No auto-provisioning: unknown and deactivated are the same no_account.
    const acct = staffAccounts.find(s => s.email === identity.email && s.isActive)
    if (!acct) return redirect(withAuthError(target, 'no_account'))
    if (!allowedRedirect(flow.returnTo)) return redirect(withAuthError(fallback, 'invalid_return_to'))
    return redirect(target, startCookieSession(acct).id)
  }

  // ── Magic link: XHR leg. ALWAYS 202 with an identical body for an unknown,
  // deactivated or live address alike — anything else is an existence oracle.
  if (method === 'POST' && path === '/v1/auth/magic-link/request') {
    const email = asTrimmed(body.email).toLowerCase()
    if (!looksLikeEmail(email)) throw badRequest('a valid email is required')
    const returnTo = typeof body.returnTo === 'string' ? body.returnTo : ''
    if (returnTo && !allowedRedirect(returnTo)) throw badRequest('returnTo is not an allowed origin')
    if (!allowMagicLinkRequest(email)) throw new ApiError('RATE_LIMITED', 'too many sign-in link requests')
    // The token is generated in every case; only persist-and-send branches.
    const token = randomToken()
    const acct = staffAccounts.find(s => s.email === email && s.isActive)
    if (acct) {
      // A new link supersedes the previous unconsumed one: only the newest email works.
      for (const row of magicLinkTokens) {
        if (row.staffId === acct.id && row.consumedAt === null) row.consumedAt = Date.now()
      }
      magicLinkTokens.push({ token, staffId: acct.id, expiresAt: Date.now() + MAGIC_LINK_TTL_MS, consumedAt: null })
      const link = new URL('/v1/auth/magic-link/verify', API_BASE_URL)
      link.searchParams.set('token', token)
      if (returnTo) link.searchParams.set('returnTo', returnTo)
      const mail: DemoMail = { to: email, subject: 'Your Sentec Tasks sign-in link', link: link.toString(), sentAt: nowIso() }
      mailOutbox.unshift(mail)
      // MAIL_DEV_CONSOLE parity: the link is printed, not emailed.
      if (typeof window !== 'undefined') console.info(`[mail dev console] To: ${mail.to}\nSubject: ${mail.subject}\n${mail.link}`)
    }
    return ok({ status: 'sent' }, 202)
  }

  // ── Magic link: browser leg (what the mail client opens). One code —
  // link_invalid — for malformed, unknown, expired, consumed and deactivated.
  if (method === 'GET' && path === '/v1/auth/magic-link/verify') {
    const { target, code } = resolveRedirectTarget(ctx.query.returnTo)
    if (!target) throw badRequest('no allowed redirect origin is configured')
    if (code) return redirect(withAuthError(target, code))
    const row = magicLinkTokens.find(t => t.token === ctx.query.token)
    if (!row || row.consumedAt !== null || row.expiresAt < Date.now()) return redirect(withAuthError(target, 'link_invalid'))
    // Single use, burned CLOSED before anything else can fail.
    row.consumedAt = Date.now()
    const acct = account(row.staffId)
    if (!acct || !acct.isActive) return redirect(withAuthError(target, 'link_invalid'))
    return redirect(target, startCookieSession(acct).id)
  }

  // Everything below requires an actor.
  const actor = ctx.actor

  if (method === 'GET' && path === '/v1/auth/session') {
    if (!actor.sessionId) throw unauthorized('this endpoint requires an active cookie session')
    const acct = account(actor.staffId)!
    return ok({ csrfToken: actor.csrfToken, staff: sessionStaffModel(acct) })
  }

  if (method === 'POST' && path === '/v1/auth/logout') {
    if (!actor.sessionId) throw badRequest('logout applies to cookie sessions')
    sessions.delete(actor.sessionId)
    return ok({ status: 'ok' })
  }

  if (method === 'GET' && path === '/v1/staff/me') {
    const acct = account(actor.staffId)
    if (actor.isService || !acct) throw unauthorized('missing staff identity')
    return ok(sessionStaffModel(acct))
  }

  if (method === 'GET' && path === '/v1/staff/assignable') {
    const hotelRef = resolveHotelForActor(ctx)
    // taskId / projectId do not filter: they widen who may call — the task's
    // current assignee, and the manager of the task's project or of projectId.
    let widened = false
    if (ctx.query.taskId) {
      if (!isUuid(ctx.query.taskId)) throw badRequest('taskId must be a UUID')
      const t = tasks.find(row => row.id === ctx.query.taskId!.toLowerCase() && row.hotelRef === hotelRef)
      if (t && (activeAssignment(t.id)?.staffId === actor.staffId || managesProject(actor, t))) widened = true
    }
    if (ctx.query.projectId) {
      if (!isUuid(ctx.query.projectId)) throw badRequest('projectId must be a UUID')
      if (managesProject(actor, { projectId: ctx.query.projectId.toLowerCase() })) widened = true
    }
    const role = roleAt(actor.staffId, hotelRef)
    if (!actor.isService && !actor.isOperator && role !== 'leader' && role !== 'admin' && !widened) throw forbidden('leader or admin access required')
    let deptFilter: Id | null = null
    if (ctx.query.departmentId) {
      if (!isUuid(ctx.query.departmentId)) throw badRequest('departmentId must be a UUID')
      deptFilter = ctx.query.departmentId.toLowerCase()
    }
    const rows: AssignableStaff[] = staffHotels
      .filter(r => r.hotelRef === hotelRef && account(r.staffId)?.isActive)
      .filter(r => !deptFilter || r.hotelDepartmentId === deptFilter)
      .map(r => ({ id: r.staffId, name: account(r.staffId)!.name, role: r.role, hotelDepartmentId: r.hotelDepartmentId }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return ok(rows)
  }

  if (method === 'GET' && path === '/v1/staff') {
    const hotelRef = resolveHotelForActor(ctx)
    requireAdminAt(ctx, hotelRef)
    // Each person's memberships hold only the listed hotel.
    let rows = staffAccounts
      .filter(s => s.isActive && staffHotels.some(r => r.staffId === s.id && r.hotelRef === hotelRef))
      .map(s => staffReadModel(s, hotelRef))
      .sort((a, b) => a.name.localeCompare(b.name))
    // ?needsAttention=true: the admin's to-do list — members whose membership
    // here carries an EMS sync issue (feat/ems-staff-sync decision #24).
    if (ctx.query.needsAttention === 'true') rows = rows.filter(s => s.memberships.some(m => m.syncIssue !== null))
    return ok(rows)
  }

  // ── Roster import (744f907). Admin at the header hotel; the hotel never
  // comes from the file. Always 200 once the file parses, even if every row
  // fails. The mock takes the multipart `file` part as body.file {name,
  // content} (no multipart in a function call) and reads .csv only.
  if (method === 'POST' && path === '/v1/staff/import') {
    const hotelRef = hotelFor(ctx)
    requireAdminAt(ctx, hotelRef)
    return importRoster(ctx, hotelRef)
  }

  if (method === 'GET' && path === '/v1/staff/import/template') {
    const hotelRef = hotelFor(ctx)
    requireAdminAt(ctx, hotelRef)
    const format = ctx.query.format ?? 'csv'
    if (format !== 'csv' && format !== 'xlsx') throw badRequest('format must be csv or xlsx')
    // MOCK LIMIT: the real .xlsx carries a department drop-down; a browser
    // mock has no workbook writer, so it says so instead of handing back a
    // wrong file.
    if (format === 'xlsx') throw unprocessable('the xlsx template is not produced by the in-browser mock; download the csv')
    const departments = hotelDepartments.filter(d => d.hotelRef === hotelRef && d.isActive).map(d => d.departmentName)
    const content = ['email,name,role,department,createTask', `# role: staff|leader (optional) · department: one of ${departments.join(' | ')} (optional) · createTask: true|false (optional)`, 'ayu@example.com,Ayu Lestari,staff,Housekeeping,true'].join('\n')
    return { status: 200, body: null, raw: { filename: 'staff-import-template.csv', contentType: 'text/csv; charset=utf-8', content } }
  }

  if (method === 'POST' && path === '/v1/staff') {
    // The body is unchanged. 201 for a new account; 200 when the email already
    // exists, in which case the account is attached to the listed hotels and
    // name/password are ignored. The caller must be admin at EVERY listed
    // hotel (the role check needs a hotel, so it runs per hotel below).
    if (!actor.isService && !actor.isOperator && !actor.memberships.some(m => m.role === 'admin')) throw forbidden('admin access required')
    // An empty hotels list would pass the per-hotel loop vacuously: refused as
    // "not an admin" rather than as a body problem.
    if (!actor.isService && !actor.isOperator && (!Array.isArray(body.hotels) || body.hotels.length === 0)) throw forbidden('admin access required')
    const email = asTrimmed(body.email).toLowerCase()
    if (!email.includes('@')) throw badRequest('valid email is required')
    const name = asTrimmed(body.name)
    if (!name) throw badRequest('name is required')
    const password = String(body.password ?? '')
    if (password.length < 10) throw badRequest('password must be at least 10 characters')
    if (password.length > 72) throw badRequest('password must be at most 72 bytes')
    const role = String(body.role ?? '')
    // Admin is granted by promotion (PATCH), never at creation.
    if (role !== 'staff' && role !== 'leader') throw badRequest('role must be staff or leader')
    const hotelsRaw = Array.isArray(body.hotels) ? body.hotels : []
    if (hotelsRaw.length === 0) throw badRequest('at least one hotel is required')
    const hotelIds: Id[] = []
    for (const raw of hotelsRaw) {
      if (!isUuid(raw)) throw badRequest('hotels must not contain a nil hotelId')
      const id = raw.toLowerCase()
      if (!hotelIds.includes(id)) hotelIds.push(id)
    }
    if (!actor.isService && !actor.isOperator) {
      for (const id of hotelIds) {
        if (roleAt(actor.staffId, id) !== 'admin') throw forbidden('cannot grant access to hotels you do not manage')
      }
    }
    const hotelDepartmentId = isUuid(body.hotelDepartmentId) ? body.hotelDepartmentId : null
    if (hotelDepartmentId) {
      const dept = hotelDepartments.find(d => d.id === hotelDepartmentId)
      if (!dept || !hotelIds.includes(dept.hotelRef)) throw badRequest('hotelDepartmentId does not belong to any of the staff member\'s hotels')
      // New use of an inactive department is refused (dept-crud §6.3).
      if (!dept.isActive) throw unprocessable('invalid department reference')
    }
    for (const id of hotelIds) {
      if (!tenants.some(t => t.hotelRef === id)) throw unprocessable('hotel or hotel department does not exist')
    }
    const createTask = Boolean(body.createTask)
    const existing = staffAccounts.find(s => s.email === email)
    if (existing) {
      if (!existing.isActive) throw conflict('that email belongs to a deactivated account')
      if (existing.isOperator) throw conflict('that email belongs to a platform operator')
      if (hotelIds.some(id => membershipAt(existing.id, id))) throw conflict('that staff member already has access to this hotel')
      hotelIds.forEach(hotelRef => staffHotels.push({
        staffId: existing.id, hotelRef, role: role as StaffRole,
        hotelDepartmentId: hotelDepartments.find(d => d.id === hotelDepartmentId)?.hotelRef === hotelRef ? hotelDepartmentId : null,
        createTask,
      }))
      // Memberships only at the properties this request granted: on an
      // attach the person may work elsewhere too, and what they are there is
      // not this admin's to see.
      return ok({ ...staffReadModel(existing), memberships: staffReadModel(existing).memberships.filter(m => hotelIds.includes(m.hotelRef)) }, 200)
    }
    const acct: SeedAccount = { id: newId(), email, name, isActive: true, isOperator: false, password }
    staffAccounts.push(acct)
    hotelIds.forEach(hotelRef => staffHotels.push({
      staffId: acct.id, hotelRef, role: role as StaffRole,
      hotelDepartmentId: hotelDepartments.find(d => d.id === hotelDepartmentId)?.hotelRef === hotelRef ? hotelDepartmentId : null,
      createTask,
    }))
    return ok(staffReadModel(acct), 201)
  }

  const staffPatch = /^\/v1\/staff\/([^/]+)$/.exec(path)
  if (method === 'PATCH' && staffPatch) {
    const id = staffPatch[1]!
    if (!isUuid(id)) throw badRequest('id must be a valid UUID')
    if (body.role !== undefined && !['staff', 'leader', 'admin'].includes(String(body.role))) {
      throw unprocessable('role must be staff, leader, or admin')
    }
    // name and isActive stay account-wide: admin at ANY property the caller
    // belongs to. role / hotelDepartmentId / createTask need a hotel (400
    // without one), an admin THERE (403), and change only that membership.
    requireAdminAnywhere(ctx)
    const touchesMembership = body.role !== undefined || body.hotelDepartmentId !== undefined || body.createTask !== undefined
    // A hotel named on a name/isActive-only patch is still resolved, but only
    // to decide which membership the response shows.
    const namesAHotel = Boolean(ctx.query.hotelId || ctx.query.hotelRef || ctx.headers['x-hotel-id'])
    let hotelRef: Id | null = null
    if (touchesMembership || namesAHotel) {
      if (!namesAHotel) throw badRequest('hotel context required to change role, hotelDepartmentId or createTask')
      hotelRef = resolveHotelForActor(ctx)
    }
    if (touchesMembership && !actor.isService && !actor.isOperator && roleAt(actor.staffId, hotelRef) !== 'admin') {
      throw forbidden('admin access required at this hotel')
    }
    const target = staffAccounts.find(s => s.id === id.toLowerCase())
    const bypassHotelCheck = actor.isService || actor.isOperator
    const shares = target && staffHotels.some(r => r.staffId === target.id && actor.hotels.includes(r.hotelRef))
    // A non-sharing target and a nonexistent one collapse to the same 404.
    if (!target || (!bypassHotelCheck && !shares)) throw notFound('staff')
    if (hotelRef && touchesMembership) {
      const membership = membershipAt(target.id, hotelRef)
      if (!membership) throw unprocessable('staff member has no membership at this hotel')
      if (body.hotelDepartmentId !== undefined && body.hotelDepartmentId !== null && body.hotelDepartmentId !== '') {
        if (!isUuid(body.hotelDepartmentId)) throw badRequest('hotelDepartmentId must be a UUID')
        const dept = hotelDepartments.find(d => d.id === body.hotelDepartmentId)
        if (!dept || dept.hotelRef !== hotelRef) throw unprocessable('hotelDepartmentId does not belong to this hotel')
        // An inactive department is refused only when the value CHANGES; the
        // edit form re-sending the stored one is not a change (dept-crud §6.3).
        if (!dept.isActive && membership.hotelDepartmentId !== dept.id) throw unprocessable('invalid department reference')
      }
      if (body.role !== undefined) membership.role = body.role as StaffRole
      if (body.hotelDepartmentId !== undefined) {
        membership.hotelDepartmentId = isUuid(body.hotelDepartmentId) ? body.hotelDepartmentId : null
        // A department set by hand clears the EMS sync issue until the next push (ems §6.3).
        if (membership.hotelDepartmentId) membership.syncIssue = null
      }
      if (body.createTask !== undefined) membership.createTask = Boolean(body.createTask)
    }
    if (typeof body.name === 'string' && body.name.trim()) target.name = body.name.trim()
    if (body.isActive !== undefined) target.isActive = Boolean(body.isActive)
    // Every isActive:false patch offboards (ems §7.3): sessions revoked, open
    // work released at every property; the memberships themselves are kept.
    if (body.isActive === false) afterDeactivation(target.id, actor.staffId, nowIso())
    // The membership at the property this request named, and no other; no
    // property named means no memberships in the response, not all of them.
    return ok(staffReadModel(target, hotelRef ?? undefined) && { ...staffReadModel(target), memberships: hotelRef ? staffReadModel(target, hotelRef).memberships : [] })
  }

  // ── DELETE /v1/staff/{id}/membership (feat/ems-staff-sync §8.3): remove a
  // person from THIS property — their open work here goes back to its pool.
  // Admin at the hotel; never yourself; never an EMS-managed member of an
  // EMS-mapped property (EMS would quietly add them back).
  const membershipPath = /^\/v1\/staff\/([^/]+)\/membership$/.exec(path)
  if (method === 'DELETE' && membershipPath) {
    const hotelRef = resolveHotelForActor(ctx)
    if (!actor.isService && !actor.isOperator && roleAt(actor.staffId, hotelRef) !== 'admin') throw forbidden('admin access required at this hotel')
    if (!isUuid(membershipPath[1])) throw badRequest('id must be a valid UUID')
    const id = membershipPath[1]!.toLowerCase()
    if (!actor.isService && id === actor.staffId) throw conflict('you cannot remove yourself from this property')
    if (managedByEms(hotelRef, id)) throw conflict('this person is managed by EMS; remove them from this property in EMS')
    if (!removeFromHotel(hotelRef, id, actor.staffId, 'Removed from this property by an admin', nowIso())) throw notFound('staff')
    return noContent()
  }

  // ── EMS employees (feat/ems-staff-sync §8.1-8.2): browse the property's
  // people in EMS and add them in bulk. Admin at the hotel. The directory is
  // the mock's stand-in for GET {EMS_BASE_URL}/employees.
  if (path === '/v1/ems/employees' && (method === 'GET' || method === 'POST')) {
    const hotelRef = hotelFor(ctx)
    requireAdminAt(ctx, hotelRef)
    const link = tenantSyncLinks.find(l => l.hotelRef === hotelRef && l.partnerId === EMS_PARTNER_ID)
    if (!link) throw unprocessable('this property is not linked to EMS')
    const directory = emsDirectory.get(link.syncId)
    // MOCK LIMIT: an EMS hotel id the directory does not know stands in for EMS failing or timing out.
    if (!directory) throw new ApiError('UNAVAILABLE', 'EMS is not reachable')
    const annotate = (row: EmsDirectoryRow): EmsEmployee => {
      const hotelDepartmentId = emsDepartmentFor(hotelRef, row.departmentName)
      const linked = staffAccounts.find(s => s.emsEmployeeId === row.id)
      const state: EmsEmployeeState = linked && membershipAt(linked.id, hotelRef) ? 'added' : !row.email ? 'no_email' : !row.active ? 'inactive' : 'addable'
      return { emsEmployeeId: row.id, name: row.name, email: row.email, active: row.active, departmentName: row.departmentName, hotelDepartmentId, state }
    }
    if (method === 'GET') {
      const q = asTrimmed(ctx.query.q).toLowerCase()
      let page = Number.parseInt(ctx.query.page ?? '', 10)
      let pageSize = Number.parseInt(ctx.query.pageSize ?? '', 10)
      if (!Number.isInteger(page) || page <= 0) page = 1
      if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 100) pageSize = 50
      const matches = directory.filter(row => !q || row.name.toLowerCase().includes(q) || (row.email ?? '').toLowerCase().includes(q) || row.id.toLowerCase().includes(q))
      const slice = matches.slice((page - 1) * pageSize, page * pageSize)
      return ok(slice.map(annotate), 200, { page, pageSize, total: matches.length })
    }
    const ids = [...new Set((Array.isArray(body.emsEmployeeIds) ? body.emsEmployeeIds : []).map(v => String(v ?? '').trim()).filter(Boolean))]
    if (ids.length < 1 || ids.length > 100) throw badRequest('emsEmployeeIds must list 1-100 employees')
    const role = String(body.role ?? '')
    if (role !== 'staff' && role !== 'leader' && role !== 'admin') throw unprocessable('role must be staff, leader, or admin')
    const createTask = Boolean(body.createTask)
    const at = nowIso()
    const results: EmsAddResult[] = ids.map((id) => {
      // Re-read from EMS: an admin can only add people EMS says work here.
      const row = directory.find(r => r.id === id)
      if (!row) return { emsEmployeeId: id, outcome: 'failed', reason: 'not_found_at_this_property' }
      if (!row.active) return { emsEmployeeId: id, outcome: 'failed', reason: 'inactive' }
      if (!row.email) return { emsEmployeeId: id, outcome: 'failed', reason: 'no_email' }
      const email = row.email.trim().toLowerCase()
      if (!looksLikeEmail(email)) return { emsEmployeeId: id, outcome: 'failed', reason: 'invalid_email' }
      const linked = staffAccounts.find(s => s.emsEmployeeId === id) ?? null
      const byEmail = staffAccounts.find(s => s.email === email) ?? null
      if (linked && byEmail && byEmail.id !== linked.id) return { emsEmployeeId: id, outcome: 'failed', reason: 'email_taken' }
      if (!linked && byEmail?.emsEmployeeId) return { emsEmployeeId: id, outcome: 'failed', reason: 'email_linked_to_other_employee' }
      let acct: SeedAccount
      let outcome: EmsAddOutcome | '' = ''
      if (!linked && !byEmail) {
        // No password: they sign in by magic link or Google, as the roster import's accounts do.
        acct = { id: newId(), email, name: row.name, isActive: true, isOperator: false, password: '', emsEmployeeId: id }
        staffAccounts.push(acct)
        outcome = 'created'
      }
      else if (linked) {
        acct = linked
      }
      else {
        acct = byEmail!
        acct.emsEmployeeId = id
        outcome = 'linked'
      }
      // EMS owns name and email (§6.3); a linked account comes back active.
      acct.name = row.name
      acct.email = email
      acct.isActive = true
      if (membershipAt(acct.id, hotelRef)) {
        if (outcome === '') outcome = 'skipped'
      }
      else {
        const hotelDepartmentId = emsDepartmentFor(hotelRef, row.departmentName)
        staffHotels.push({ staffId: acct.id, hotelRef, role: role as StaffRole, hotelDepartmentId, createTask, syncIssue: hotelDepartmentId || !row.departmentName ? null : row.departmentName, emsUpdatedAt: null })
        if (outcome === '') outcome = 'granted'
      }
      return { emsEmployeeId: id, outcome, staffId: acct.id }
    })
    void at
    return ok(results)
  }

  // ── PUT /v1/ems/hotels/{syncId}/employees/{emsEmployeeId} (§6): EMS tells
  // Tasks one employee's current state at one hotel. Interface surface,
  // partner token with the staff_sync capability. One request per employee
  // per hotel, carrying the FULL state; `updatedAt` must never go backwards.
  const emsPush = /^\/v1\/ems\/hotels\/([^/]+)\/employees\/([^/]+)$/.exec(path)
  if (method === 'PUT' && emsPush) {
    if (!actor.partnerCapabilities.includes('staff_sync')) throw forbidden('this partner may not sync staff')
    if (body.active !== undefined && typeof body.active !== 'boolean') throw badRequest('invalid JSON body')
    if (body.updatedAt !== undefined && body.updatedAt !== null && (typeof body.updatedAt !== 'string' || Number.isNaN(Date.parse(body.updatedAt)))) throw badRequest('invalid JSON body')
    if (body.active === undefined) throw badRequest('active is required')
    const syncId = decodeURIComponent(emsPush[1]!).trim()
    const employeeId = decodeURIComponent(emsPush[2]!).trim()
    const name = asTrimmed(body.name)
    const email = asTrimmed(body.email).toLowerCase()
    const departmentName = asTrimmed(body.departmentName)
    if (!syncId || syncId.length > 100) throw badRequest('hotel id is required')
    if (!employeeId || employeeId.length > 100) throw badRequest('employee id is required (1-100 characters)')
    if (!name || name.length > 200) throw badRequest('name is required (1-200 characters)')
    if (!looksLikeEmail(email)) throw badRequest('email must be a valid address')
    if (departmentName.length > 100) throw badRequest('departmentName is at most 100 characters')
    if (!body.updatedAt) throw badRequest('updatedAt is required')
    const updatedAt = new Date(body.updatedAt as string).toISOString()
    const active = body.active as boolean
    const link = tenantSyncLinks.find(l => l.partnerId === actor.partnerId && l.syncId === syncId)
    if (!link) return ok({ status: 'ignored', reason: 'unmapped_hotel' })
    const hotelRef = link.hotelRef
    const acct = staffAccounts.find(s => s.emsEmployeeId === employeeId)
    if (!acct) return ok({ status: 'ignored', reason: 'not_linked' })
    let membership = membershipAt(acct.id, hotelRef)
    // Stale: per membership, so a retried push for hotel B is not dropped by a
    // newer push for hotel A; an auto-add is checked against the person's newest.
    if (membership?.emsUpdatedAt && updatedAt < membership.emsUpdatedAt) return ok({ status: 'stale' })
    if (!membership && acct.emsUpdatedAt && updatedAt < acct.emsUpdatedAt) return ok({ status: 'stale' })
    const at = nowIso()
    // Identity, only when this push is at least as new as the newest applied anywhere.
    if (!acct.emsUpdatedAt || updatedAt >= acct.emsUpdatedAt) {
      if (staffAccounts.some(s => s.id !== acct.id && s.email === email)) throw conflict('email is already used by another staff member')
      acct.name = name
      acct.email = email
      acct.emsUpdatedAt = updatedAt
    }
    const hotelDepartmentId = emsDepartmentFor(hotelRef, departmentName || null)
    if (active && membership) {
      if (!departmentName) membership.syncIssue = null
      else if (hotelDepartmentId) {
        membership.hotelDepartmentId = hotelDepartmentId
        membership.syncIssue = null
      }
      else {
        membership.syncIssue = departmentName // keep the current department (decision #7)
      }
    }
    else if (active && !membership) {
      // Auto-add (decision #18): plain staff, no create-task, department from EMS; the account comes back if needed.
      membership = { staffId: acct.id, hotelRef, role: 'staff', hotelDepartmentId, createTask: false, syncIssue: hotelDepartmentId || !departmentName ? null : departmentName, emsUpdatedAt: null }
      staffHotels.push(membership)
      acct.isActive = true
    }
    else if (!active && membership) {
      // Offboard from this hotel (§7.1), then the left-company check (§7.2).
      removeFromHotel(hotelRef, acct.id, null, 'Left the property (EMS)', at)
      deactivateIfNoAccess(acct.id)
      membership = null
    }
    if (membership) membership.emsUpdatedAt = updatedAt
    return ok({ status: 'applied' })
  }


  const grantMatch = /^\/v1\/staff\/([^/]+)\/group-grants\/([^/]+)$/.exec(path)
  if (grantMatch && (method === 'PUT' || method === 'DELETE')) {
    requireOperator(ctx)
    const [, staffId, groupId] = grantMatch
    if (!isUuid(staffId)) throw badRequest('id must be a valid UUID')
    if (!isUuid(groupId)) throw badRequest('groupId must be a valid UUID')
    if (method === 'PUT') {
      if (!staffAccounts.some(s => s.id === staffId) || !tenantGroups.some(g => g.id === groupId)) {
        throw unprocessable('invalid staff or group reference')
      }
      if (!groupGrants.some(g => g.staffId === staffId && g.groupId === groupId)) {
        groupGrants.push({ staffId: staffId!, groupId: groupId! })
      }
      return ok({ status: 'ok' })
    }
    const index = groupGrants.findIndex(g => g.staffId === staffId && g.groupId === groupId)
    if (index === -1) throw notFound('group grant')
    groupGrants.splice(index, 1)
    return ok({ status: 'ok' })
  }

  return null
}

// ════════════════════════ Platform routes (operator) ════════════════════════

/** Shared by POST /v1/tenants (service) and /v1/platform/tenants (operator). */
function provisionTenant(body: Record<string, unknown>): FakeResponse {
  const hotelRef = body.hotelRef
  if (!isUuid(hotelRef)) throw badRequest('hotelRef must be a valid UUID')
  const name = asTrimmed(body.name)
  if (!name) throw badRequest('name is required')
  const id = hotelRef.toLowerCase()
  const existing = tenants.find(t => t.hotelRef === id)
  if (existing) return ok(existing, 200)
  const created: Tenant = { hotelRef: id, name, timezone: 'Asia/Jakarta', groupId: null, isActive: true, createdAt: nowIso() }
  tenants.push(created)
  // Seed the master-template board (six standard columns) + default SLA.
  const board: Board = { id: newId(), hotelRef: id, name: 'Operations Board', createdAt: created.createdAt, updatedAt: created.createdAt }
  boards.push(board)
  const template: Array<[string, TaskStatus]> = [['New', 'NEW'], ['In Progress', 'IN_PROGRESS'], ['Awaiting Review', 'SUBMITTED'], ['Finished', 'FINISHED'], ['Verified', 'VERIFIED'], ['Cancelled', 'CANCELLED']]
  template.forEach(([columnName, status], index) => boardColumns.push(seedColumn(newId(), board.id, columnName, index + 1, status)))
  slas.push({ id: newId(), hotelRef: id, name: 'Standard', responseTime: 30, resolutionTime: 90, isDefault: true, escalationPolicyId: null, createdAt: created.createdAt, updatedAt: created.createdAt })
  return ok(created, 201)
}

function handlePlatform(ctx: Ctx): FakeResponse | null {
  const { method, path, body } = ctx
  if (!path.startsWith('/v1/platform/')) return null
  requireOperator(ctx)

  if (path === '/v1/platform/tenants') {
    if (method === 'POST') return provisionTenant(body)
    if (method === 'GET') return ok([...tenants].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const firstAdmin = /^\/v1\/platform\/tenants\/([^/]+)\/first-admin$/.exec(path)
  if (method === 'POST' && firstAdmin) {
    const hotelRef = firstAdmin[1]!
    if (!isUuid(hotelRef)) throw badRequest('hotelRef must be a valid UUID')
    const email = asTrimmed(body.email).toLowerCase()
    if (!email.includes('@')) throw badRequest('valid email is required')
    const name = asTrimmed(body.name)
    if (!name) throw badRequest('name is required')
    const id = hotelRef.toLowerCase()
    if (!tenants.some(t => t.hotelRef === id)) throw notFound('tenant not found')
    const hasAdmin = staffHotels.some(r => r.hotelRef === id && r.role === 'admin' && account(r.staffId)?.isOperator === false)
    if (hasAdmin) throw conflict('tenant already has an admin')
    if (staffAccounts.some(s => s.email === email)) throw conflict('email already registered')
    const temporaryPassword = randomToken().slice(0, 32)
    const acct: SeedAccount = { id: newId(), email, name, isActive: true, isOperator: false, password: temporaryPassword }
    staffAccounts.push(acct)
    staffHotels.push({ staffId: acct.id, hotelRef: id, role: 'admin', hotelDepartmentId: null, createTask: true })
    // The ONLY response that ever carries the plaintext temporary password.
    return ok({ ...staffReadModel(acct), temporaryPassword }, 201)
  }

  if (path === '/v1/platform/tenant-groups') {
    if (method === 'POST') {
      const name = asTrimmed(body.name)
      if (!name || name.length > 100) throw badRequest('name must be between 1 and 100 characters')
      const created: TenantGroup = { id: newId(), name, createdAt: nowIso(), updatedAt: nowIso() }
      tenantGroups.push(created)
      return ok(created, 201)
    }
    if (method === 'GET') {
      const rows = [...tenantGroups]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(g => ({
          ...g,
          tenants: tenants.filter(t => t.groupId === g.id).map(t => ({ hotelRef: t.hotelRef, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)),
        }))
      return ok(rows)
    }
  }

  const groupPatch = /^\/v1\/platform\/tenant-groups\/([^/]+)$/.exec(path)
  if (method === 'PATCH' && groupPatch) {
    const id = groupPatch[1]!
    if (!isUuid(id)) throw badRequest('id must be a valid UUID')
    const name = asTrimmed(body.name)
    if (!name || name.length > 100) throw badRequest('name must be between 1 and 100 characters')
    const group = tenantGroups.find(g => g.id === id.toLowerCase())
    if (!group) throw notFound('tenant group not found')
    group.name = name
    group.updatedAt = nowIso()
    return ok(group)
  }

  const membership = /^\/v1\/platform\/tenant-groups\/([^/]+)\/tenants\/([^/]+)$/.exec(path)
  if (membership && (method === 'PUT' || method === 'DELETE')) {
    const [, groupId, hotelRef] = membership
    if (!isUuid(groupId) || !isUuid(hotelRef)) throw badRequest('id or hotelRef must be a valid UUID')
    const tenant = tenants.find(t => t.hotelRef === hotelRef.toLowerCase())
    if (method === 'PUT') {
      if (!tenantGroups.some(g => g.id === groupId.toLowerCase())) throw unprocessable('tenant group does not exist')
      if (!tenant) throw notFound('tenant not found')
      tenant.groupId = groupId.toLowerCase()
      return ok({ status: 'ok' })
    }
    // Membership-verified removal: the wrong group leaves membership untouched.
    if (!tenant || tenant.groupId !== groupId.toLowerCase()) throw notFound('group membership')
    tenant.groupId = null
    return ok({ status: 'ok' })
  }

  if (path === '/v1/platform/partners') {
    if (method === 'POST') {
      const name = asTrimmed(body.name)
      if (!name) throw badRequest('name is required')
      // feat/ems-staff-sync: capabilities are trimmed, de-duplicated and closed (400 on an unknown one).
      const capabilities = normalizeCapabilities(body.capabilities)
      if (partners.some(p => p.name.toLowerCase() === name.toLowerCase())) throw conflict('partner name already exists')
      const created: Partner = { id: newId(), name, isActive: true, capabilities, createdAt: nowIso(), updatedAt: nowIso() }
      partners.push(created)
      // The ONLY response that ever carries the plaintext secret (43 chars).
      return ok({ ...created, secret: randomToken() }, 201)
    }
    if (method === 'GET') return ok([...partners].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const partnerPatch = /^\/v1\/platform\/partners\/([^/]+)$/.exec(path)
  if (method === 'PATCH' && partnerPatch) {
    const id = partnerPatch[1]!
    if (!isUuid(id)) throw badRequest('id must be a valid UUID')
    // Before capabilities existed the body was {isActive} alone; an empty patch is refused, not applied as "deactivate".
    if (body.isActive === undefined && body.capabilities === undefined) throw badRequest('isActive or capabilities is required')
    const capabilities = body.capabilities === undefined ? undefined : normalizeCapabilities(body.capabilities)
    const partner = partners.find(p => p.id === id.toLowerCase())
    if (!partner) throw notFound('partner')
    if (body.isActive !== undefined) partner.isActive = Boolean(body.isActive)
    if (capabilities) partner.capabilities = capabilities
    partner.updatedAt = nowIso()
    return ok(partner)
  }

  // ── Tenant sync ids (feat/ems-staff-sync §8.4): a partner's own id for a property.
  const syncList = /^\/v1\/platform\/tenants\/([^/]+)\/sync$/.exec(path)
  if (method === 'GET' && syncList) {
    if (!isUuid(syncList[1])) throw badRequest('hotelRef must be a valid UUID')
    const hotelRef = syncList[1]!.toLowerCase()
    return ok(tenantSyncLinks.filter(l => l.hotelRef === hotelRef).sort((a, b) => a.partnerName.localeCompare(b.partnerName)))
  }

  const syncLink = /^\/v1\/platform\/tenants\/([^/]+)\/sync\/([^/]+)$/.exec(path)
  if (syncLink && (method === 'PUT' || method === 'DELETE')) {
    if (!isUuid(syncLink[1])) throw badRequest('hotelRef must be a valid UUID')
    if (!isUuid(syncLink[2])) throw badRequest('partnerId must be a valid UUID')
    const hotelRef = syncLink[1]!.toLowerCase()
    const partnerId = syncLink[2]!.toLowerCase()
    if (method === 'PUT') {
      const syncId = asTrimmed(body.syncId)
      if (!syncId || syncId.length > 100) throw badRequest('syncId is required (1-100 characters)')
      const partner = partners.find(p => p.id === partnerId)
      if (!partner || !tenants.some(t => t.hotelRef === hotelRef)) throw notFound('tenant or partner')
      if (tenantSyncLinks.some(l => l.partnerId === partnerId && l.syncId === syncId && l.hotelRef !== hotelRef)) throw conflict('another property already uses this id for this partner')
      const at = nowIso()
      const existing = tenantSyncLinks.find(l => l.hotelRef === hotelRef && l.partnerId === partnerId)
      if (existing) {
        Object.assign(existing, { syncId, partnerName: partner.name, updatedAt: at })
        return ok(existing)
      }
      const created: TenantSyncLink = { id: newId(), hotelRef, partnerId, partnerName: partner.name, syncId, createdAt: at, updatedAt: at }
      tenantSyncLinks.push(created)
      return ok(created)
    }
    // DELETE keeps existing memberships; future pushes for the hotel are `ignored`.
    const index = tenantSyncLinks.findIndex(l => l.hotelRef === hotelRef && l.partnerId === partnerId)
    if (index === -1) throw notFound('partner id for this property')
    tenantSyncLinks.splice(index, 1)
    return noContent()
  }

  if (path === '/v1/platform/source-apps') {
    if (method === 'GET') return ok([...sourceApps].sort((a, b) => a.name.localeCompare(b.name)))
    if (method === 'POST') {
      const code = asTrimmed(body.code)
      const name = asTrimmed(body.name)
      if (!code || !name) throw badRequest('code and name are required')
      const existing = sourceApps.find(a => a.code === code)
      const next: SourceApp = {
        code,
        name,
        shortName: asTrimmed(body.shortName) || name,
        icon: asNullableTrimmed(body.icon),
        color: asNullableTrimmed(body.color),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      }
      if (existing) Object.assign(existing, next)
      else sourceApps.push(next)
      return ok(existing ?? next)
    }
  }

  return null
}

// ════════════════════════ Config surfaces ════════════════════════

function handleConfig(ctx: Ctx): FakeResponse | null {
  const { method, path, body, actor } = ctx

  if (method === 'GET' && path === '/v1/kanban-board') {
    const hotelRef = hotelFor(ctx)
    const board = boards.find(b => b.hotelRef === hotelRef)
    if (!board) throw notFound('kanban board')
    const columns = boardColumns
      .filter(c => c.boardId === board.id && !c.isRemoved)
      .sort((a, b) => a.columnSort - b.columnSort || a.id.localeCompare(b.id))
    return ok({ ...board, columns: nullIfEmpty(columns) })
  }

  if (method === 'PATCH' && path === '/v1/kanban-board') {
    requireAdmin(ctx)
    const hotelRef = hotelFor(ctx)
    const board = boards.find(b => b.hotelRef === hotelRef)
    if (!board) throw notFound('kanban board')
    const entries = Array.isArray(body.columns) ? body.columns as Array<Record<string, unknown>> : []
    // All-or-nothing: validate every entry before applying any.
    for (const entry of entries) {
      const isRemove = entry.isRemoved === true && entry.id != null
      if (isRemove) continue
      if (entry.id != null) {
        if (entry.status !== undefined && entry.status !== null) throw badRequest('column status cannot be changed after creation')
        if (entry.name !== undefined) {
          const name = asTrimmed(entry.name)
          if (!name || name.length > 100) throw badRequest('name must be 1-100 chars')
        }
        if (entry.columnSort !== undefined && entry.columnSort !== null && Number(entry.columnSort) <= 0) throw badRequest('columnSort must be a positive integer')
      }
      else {
        if (entry.isRemoved === true) throw badRequest('cannot set isRemoved on a new column')
        const name = asTrimmed(entry.name)
        if (!name || name.length > 100) throw badRequest('name is required (1-100 chars)')
        if (entry.columnSort == null) throw badRequest('columnSort is required')
        if (Number(entry.columnSort) <= 0) throw badRequest('columnSort must be a positive integer')
        if (entry.status != null && !TASK_STATUSES.includes(entry.status as TaskStatus)) {
          throw badRequest(`status must be one of ${TASK_STATUSES.join(', ')}`)
        }
      }
    }
    for (const entry of entries) {
      if (entry.id != null) {
        const column = boardColumns.find(c => c.id === entry.id && c.boardId === board.id)
        if (!column) throw notFound('column')
        if (entry.isRemoved === true) {
          // Skipped (with a warning) when the column still has an active task.
          const hasActive = tasks.some(t => t.columnId === column.id && !['FINISHED', 'VERIFIED', 'CANCELLED'].includes(t.status))
          if (!hasActive) column.isRemoved = true
          continue
        }
        if (entry.name !== undefined) column.name = asTrimmed(entry.name)
        // Three-state description: absent key = unchanged; null clears; string sets.
        if ('description' in entry) column.description = entry.description == null ? null : String(entry.description)
        if (entry.columnSort != null) column.columnSort = Number(entry.columnSort)
      }
      else {
        boardColumns.push({
          id: newId(),
          boardId: board.id,
          name: asTrimmed(entry.name),
          description: entry.description == null ? null : String(entry.description),
          columnSort: Number(entry.columnSort),
          isActive: true,
          isRemoved: false,
          status: entry.status == null ? null : entry.status as TaskStatus,
        })
      }
    }
    board.updatedAt = nowIso()
    const warnings: string[] = []
    for (const entry of entries) {
      if (entry.id != null && entry.isRemoved === true) {
        const column = boardColumns.find(c => c.id === entry.id && c.boardId === board.id)
        if (column && !column.isRemoved) warnings.push(`column "${column.name}" still has an active task and was not removed`)
      }
    }
    const active = boardColumns.filter(c => c.boardId === board.id && !c.isRemoved)
    if (!active.some(c => c.status === 'NEW')) warnings.push(WARN_NO_NEW_COLUMN)
    const columns = active.sort((a, b) => a.columnSort - b.columnSort || a.id.localeCompare(b.id))
    return ok({ ...board, columns: nullIfEmpty(columns) }, 200, { warnings })
  }

  // ── Escalation policies (feat/escalation §8). Reads: any actor of the
  // hotel; the upsert: admin at the hotel. One POST writes the policy AND its
  // steps; literals and their order follow internal/escalation/service.go.
  const policyById = /^\/v1\/escalation-policies\/([^/]+)$/.exec(path)
  if (method === 'GET' && path === '/v1/escalation-policies') {
    const hotelRef = hotelFor(ctx)
    return ok(escalationPolicies
      .filter(p => p.hotelRef === hotelRef)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map(policyModel))
  }
  if (method === 'GET' && policyById) {
    const hotelRef = hotelFor(ctx)
    if (!isUuid(policyById[1])) throw badRequest('id must be a uuid')
    const policy = escalationPolicies.find(p => p.id === policyById[1]!.toLowerCase() && p.hotelRef === hotelRef)
    if (!policy) throw notFound('escalation policy')
    return ok(policyModel(policy))
  }
  if (method === 'POST' && path === '/v1/escalation-policies') {
    const hotelRef = hotelFor(ctx)
    if (!actor.isService && !actor.isOperator && actor.role !== 'admin') throw forbidden('admin access required')
    const name = asTrimmed(body.name)
    if (!name || name.length > 120) throw badRequest('name is required (1-120 chars)')
    const stepsIn = Array.isArray(body.steps) ? body.steps as Array<Record<string, unknown>> : []
    if (stepsIn.length > ESCALATION_MAX_STEPS) throw badRequest(`a policy has at most ${ESCALATION_MAX_STEPS} steps`)
    const seenSort = new Set<number>()
    const decoded = stepsIn.map((raw, i) => {
      const step = decodeEscalationStep(raw)
      const problem = validateEscalationStep(step)
      if (problem) throw badRequest(`steps[${i}]: ${problem}`)
      if (seenSort.has(step.sort)) throw badRequest(`steps[${i}]: duplicate sort ${step.sort}`)
      seenSort.add(step.sort)
      const foreign = escalationTargetProblem(hotelRef, step)
      if (foreign) throw unprocessable(`steps[${i}]: ${foreign}`)
      return step
    })
    const at = nowIso()
    let policy: PolicyRow
    if (isUuid(body.id)) {
      const wantedId = body.id.toLowerCase()
      const existing = escalationPolicies.find(p => p.id === wantedId && p.hotelRef === hotelRef)
      if (!existing) throw notFound('escalation policy')
      policy = existing
    }
    else {
      policy = { id: newId(), hotelRef, name, isDefault: false, isActive: true, createdAt: at, updatedAt: at }
    }
    if (escalationPolicies.some(p => p.hotelRef === hotelRef && p.id !== policy.id && p.name.toLowerCase() === name.toLowerCase())) {
      throw conflict('an escalation policy with this name already exists')
    }
    // Steps with an id must be live steps of THIS policy; checked before anything is written.
    const live = liveSteps(policy.id)
    for (const step of decoded) {
      if (step.id && !live.some(st => st.id === step.id)) throw unprocessable(`unknown step id ${step.id} for this policy`)
    }
    const isDefault = Boolean(body.isDefault)
    // A new default demotes the old one (as sla.Upsert does).
    if (isDefault) escalationPolicies.filter(p => p.hotelRef === hotelRef && p.id !== policy.id && p.isDefault).forEach((p) => { p.isDefault = false })
    policy.name = name
    policy.isDefault = isDefault
    // isActive omitted: true on create, unchanged on update.
    if (typeof body.isActive === 'boolean') policy.isActive = body.isActive
    policy.updatedAt = at
    if (!escalationPolicies.includes(policy)) escalationPolicies.push(policy)
    const keep = new Set<Id>()
    for (const step of decoded) {
      const row = step.id ? live.find(st => st.id === step.id)! : null
      const triggerKind = step.triggerKind as EscalationTriggerKind // validated above
      if (row) {
        Object.assign(row, { sort: step.sort, triggerKind, triggerValue: step.triggerValue, actions: step.actions, recipients: step.recipients, updatedAt: at })
        keep.add(row.id)
      }
      else {
        const created: StepRow = { id: newId(), hotelRef, policyId: policy.id, sort: step.sort, triggerKind, triggerValue: step.triggerValue, actions: step.actions, recipients: step.recipients, deletedAt: null, createdAt: at, updatedAt: at }
        escalationSteps.push(created)
        keep.add(created.id)
      }
    }
    // A live step missing from the request is soft-deleted (decision 20).
    for (const row of live) if (!keep.has(row.id)) row.deletedAt = at
    return ok(policyModel(policy))
  }


  if (path === '/v1/slas') {
    const hotelRef = hotelFor(ctx)
    if (method === 'GET') {
      return ok(slas.filter(s => s.hotelRef === hotelRef).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)))
    }
    if (method === 'POST') {
      requireAdmin(ctx)
      const name = asTrimmed(body.name)
      if (!name || name.length > 100) throw badRequest('name is required (1-100 chars)')
      const responseTime = Number(body.responseTime)
      const resolutionTime = Number(body.resolutionTime)
      if (!Number.isInteger(responseTime) || responseTime <= 0 || !Number.isInteger(resolutionTime) || resolutionTime <= 0) {
        throw badRequest('responseTime and resolutionTime must be positive minutes')
      }
      const isDefault = Boolean(body.isDefault)
      const at = nowIso()
      const applyDefault = (id: Id) => {
        if (isDefault) slas.filter(s => s.hotelRef === hotelRef && s.id !== id).forEach((s) => { s.isDefault = false })
      }
      const existing = isUuid(body.id) ? slas.find(s => s.id === body.id && s.hotelRef === hotelRef) : undefined
      if (isUuid(body.id) && !existing) throw notFound('sla')
      // feat/escalation: the key ABSENT keeps the stored link, null clears it,
      // a value must be an active policy of this hotel. Only a newly supplied
      // value is checked, so an SLA linked to a since-deactivated policy can
      // still have its times edited.
      const escalationPolicyId = decodeEscalationPolicyLink(body, hotelRef, existing?.escalationPolicyId ?? null)
      if (existing) {
        applyDefault(existing.id)
        Object.assign(existing, { name, responseTime, resolutionTime, isDefault, escalationPolicyId, updatedAt: at })
        return ok(existing)
      }
      const created: Sla = { id: newId(), hotelRef, name, responseTime, resolutionTime, isDefault, escalationPolicyId, createdAt: at, updatedAt: at }
      applyDefault(created.id)
      slas.push(created)
      return ok(created)
    }
  }

  if (path === '/v1/routing-rules' && method === 'GET') {
    const hotelRef = hotelFor(ctx)
    return ok(routingRules
      .filter(r => r.hotelRef === hotelRef)
      .sort((a, b) => b.specificity - a.specificity || b.createdAt.localeCompare(a.createdAt)))
  }

  if (path === '/v1/routing-rules' && method === 'PUT') {
    requireAdmin(ctx)
    const hotelRef = hotelFor(ctx)
    let priority: TaskPriority | null = null
    const rawPriority = asTrimmed(body.priority).toUpperCase()
    if (rawPriority) {
      if (!TASK_PRIORITY_VALUES.includes(rawPriority as TaskPriority)) throw badRequest('priority must be one of LOW, NORMAL, HIGH, URGENT')
      priority = rawPriority as TaskPriority
    }
    const itemRef = isUuid(body.itemRef) ? body.itemRef.toLowerCase() : null
    const categoryId = isUuid(body.categoryId) ? body.categoryId.toLowerCase() : null
    const locationTypeId = isUuid(body.locationTypeId) ? body.locationTypeId.toLowerCase() : null
    const criteria = [itemRef, categoryId, locationTypeId, priority].filter(Boolean).length
    if (criteria > 1) throw badRequest('a routing rule may set at most one of itemRef, categoryId, locationTypeId or priority')
    if (categoryId && !categories.some(c => c.id === categoryId && c.hotelRef === hotelRef && c.isActive)) throw unprocessable('invalid category reference')
    if (locationTypeId && !locationTypes.some(t => t.id === locationTypeId && t.hotelRef === hotelRef && t.isActive)) throw unprocessable('invalid location type reference')
    const departmentId = isUuid(body.departmentId) ? body.departmentId.toLowerCase() : null
    if (!departmentId || !hotelDepartments.some(d => d.id === departmentId && d.hotelRef === hotelRef && d.isActive)) throw unprocessable('invalid department reference')
    const slaId = isUuid(body.slaId) ? body.slaId.toLowerCase() : null
    if (!slaId || !slas.some(s => s.id === slaId && s.hotelRef === hotelRef)) throw unprocessable('invalid SLA reference')
    const at = nowIso()
    // Natural-key upsert: repeat PUTs update the same rule in place, per tier.
    const existing = routingRules.find(r => r.hotelRef === hotelRef && (
      itemRef ? r.itemRef === itemRef : r.itemRef === null && r.categoryId === categoryId && r.locationTypeId === locationTypeId && r.priority === priority
    ))
    // feat/escalation: absent keeps an existing rule's link, null clears, a value must be an active policy here.
    const escalationPolicyId = decodeEscalationPolicyLink(body, hotelRef, existing?.escalationPolicyId ?? null)
    if (existing) {
      Object.assign(existing, { hotelDepartmentId: departmentId, slaId, remark: asNullableTrimmed(body.remark), escalationPolicyId, updatedAt: at })
      return ok(existing)
    }
    const created: RoutingRule = {
      id: newId(), hotelRef, itemRef, categoryId, locationTypeId, priority,
      specificity: specificityOf({ itemRef, categoryId, locationTypeId, priority }),
      hotelDepartmentId: departmentId, slaId, remark: asNullableTrimmed(body.remark), escalationPolicyId, createdAt: at, updatedAt: at,
    }
    routingRules.push(created)
    return ok(created)
  }

  const ruleById = /^\/v1\/routing-rules\/id\/([^/]+)$/.exec(path)
  if (method === 'DELETE' && ruleById) {
    requireAdmin(ctx)
    const hotelRef = hotelFor(ctx)
    if (!isUuid(ruleById[1])) throw badRequest('id must be a valid UUID')
    const index = routingRules.findIndex(r => r.id === ruleById[1]!.toLowerCase() && r.hotelRef === hotelRef)
    if (index === -1) throw notFound('routing rule')
    routingRules.splice(index, 1)
    return noContent()
  }

  // DELETE /v1/routing-rules/{itemRef} is GONE (refactor/ponytail-audit):
  // rules are deleted by id only, through /v1/routing-rules/id/{id} above.

  if (path === '/v1/catalog-items') {
    const hotelRef = hotelFor(ctx)
    if (method === 'GET') {
      const includeInactive = ctx.query.includeInactive === 'true'
      return ok(catalogItems
        .filter(i => i.hotelRef === hotelRef && (includeInactive || i.isActive))
        .sort((a, b) => a.name.localeCompare(b.name)))
    }
    if (method === 'POST') {
      requireAdmin(ctx)
      const name = asTrimmed(body.name)
      if (!name || [...name].length > 100) throw badRequest('name is required (1-100 runes)')
      const defaultPriority = (asTrimmed(body.defaultPriority).toUpperCase() || 'NORMAL') as TaskPriority
      if (!TASK_PRIORITY_VALUES.includes(defaultPriority)) throw badRequest('defaultPriority must be one of LOW, NORMAL, HIGH, URGENT')
      const minProofPhotos = Number(body.minProofPhotos ?? 0)
      if (!Number.isInteger(minProofPhotos) || minProofPhotos < 0 || minProofPhotos > 10) throw badRequest('minProofPhotos must be between 0 and 10')
      const categoryId = isUuid(body.categoryId) ? body.categoryId.toLowerCase() : null
      if (categoryId && !categories.some(c => c.id === categoryId && c.hotelRef === hotelRef && c.isActive)) throw unprocessable('invalid category reference')
      if (catalogItems.some(i => i.hotelRef === hotelRef && i.name.toLowerCase() === name.toLowerCase() && i.id !== body.id)) throw conflict('catalog item name already exists')
      const at = nowIso()
      const fields = {
        name,
        description: asNullableTrimmed(body.description),
        itemQuantity: Boolean(body.itemQuantity),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
        categoryId,
        defaultPriority,
        requiresLocation: Boolean(body.requiresLocation),
        defaultChecklist: Array.isArray(body.defaultChecklist) ? body.defaultChecklist.map(String) : [],
        defaultDurationMinutes: body.defaultDurationMinutes == null ? null : Number(body.defaultDurationMinutes),
        minProofPhotos,
        requiresCompletionNote: Boolean(body.requiresCompletionNote),
        updatedAt: at,
      }
      if (isUuid(body.id)) {
        const item = catalogItems.find(i => i.id === body.id && i.hotelRef === hotelRef)
        if (!item) throw notFound('catalog item')
        Object.assign(item, fields) // full replace, not a patch
        return ok(item)
      }
      const created: CatalogItem = { id: newId(), hotelRef, createdAt: at, ...fields }
      catalogItems.push(created)
      return ok(created)
    }
  }

  if (path === '/v1/categories') {
    const hotelRef = hotelFor(ctx)
    if (method === 'GET') {
      return ok(categories.filter(c => c.hotelRef === hotelRef && c.isActive).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)))
    }
    if (method === 'POST') {
      requireAdmin(ctx)
      const name = asTrimmed(body.name)
      if (!name || name.length > 100) throw badRequest('name is required (1-100 chars)')
      const code = asTrimmed(body.code)
      if (!code || code.length > 50) throw badRequest('code is required (1-50 chars)')
      if (categories.some(c => c.hotelRef === hotelRef && c.code === code && c.id !== body.id)) throw conflict('category code already exists')
      const at = nowIso()
      const fields = { name, code, sort: Number(body.sort ?? 0), isActive: body.isActive === undefined ? true : Boolean(body.isActive), icon: asNullableTrimmed(body.icon), updatedAt: at }
      if (isUuid(body.id)) {
        const row = categories.find(c => c.id === body.id && c.hotelRef === hotelRef)
        if (!row) throw notFound('category')
        Object.assign(row, fields)
        return ok(row)
      }
      const created: Category = { id: newId(), hotelRef, createdAt: at, ...fields }
      categories.push(created)
      return ok(created)
    }
  }

  if (path === '/v1/location-types') {
    const hotelRef = hotelFor(ctx)
    if (method === 'GET') {
      return ok(locationTypes.filter(t => t.hotelRef === hotelRef && t.isActive).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)))
    }
    if (method === 'POST') {
      requireAdmin(ctx)
      const name = asTrimmed(body.name)
      if (!name || name.length > 100) throw badRequest('name is required (1-100 chars)')
      const code = asTrimmed(body.code)
      if (!code || code.length > 50) throw badRequest('code is required (1-50 chars)')
      if (locationTypes.some(t => t.hotelRef === hotelRef && t.code === code && t.id !== body.id)) throw conflict('code already exists')
      const at = nowIso()
      const fields = { name, code, linksRequester: Boolean(body.linksRequester), sort: Number(body.sort ?? 0), isActive: body.isActive === undefined ? true : Boolean(body.isActive), updatedAt: at }
      if (isUuid(body.id)) {
        const row = locationTypes.find(t => t.id === body.id && t.hotelRef === hotelRef)
        if (!row) throw notFound('location type')
        Object.assign(row, fields)
        return ok(row)
      }
      const created: LocationType = { id: newId(), hotelRef, createdAt: at, ...fields }
      locationTypes.push(created)
      return ok(created)
    }
  }

  if (path === '/v1/locations') {
    const hotelRef = hotelFor(ctx)
    if (method === 'GET') {
      // An unparseable locationTypeId filter is silently ignored, per the Go.
      const filter = isUuid(ctx.query.locationTypeId) ? ctx.query.locationTypeId.toLowerCase() : null
      return ok(locations
        .filter(l => l.hotelRef === hotelRef && l.isActive && (!filter || l.locationTypeId === filter))
        .sort((a, b) => a.name.localeCompare(b.name)))
    }
    if (method === 'POST') {
      requireAdmin(ctx)
      const name = asTrimmed(body.name)
      if (!name || name.length > 100) throw badRequest('name is required (1-100 chars)')
      const code = asTrimmed(body.code)
      if (!code || code.length > 50) throw badRequest('code is required (1-50 chars)')
      const locationTypeId = isUuid(body.locationTypeId) ? body.locationTypeId.toLowerCase() : null
      if (!locationTypeId) throw badRequest('locationTypeId is required')
      if (!locationTypes.some(t => t.id === locationTypeId && t.hotelRef === hotelRef)) throw unprocessable('invalid location type reference')
      const parentId = isUuid(body.parentId) ? body.parentId.toLowerCase() : null
      if (parentId) {
        if (parentId === body.id) throw unprocessable('a location cannot be its own parent')
        if (!locations.some(l => l.id === parentId && l.hotelRef === hotelRef && l.isActive)) throw unprocessable('invalid parent location reference')
      }
      if (locations.some(l => l.hotelRef === hotelRef && l.code === code && l.id !== body.id)) throw conflict('code already exists')
      const at = nowIso()
      const fields = { locationTypeId, name, code, parentId, isActive: body.isActive === undefined ? true : Boolean(body.isActive), updatedAt: at }
      if (isUuid(body.id)) {
        const row = locations.find(l => l.id === body.id && l.hotelRef === hotelRef)
        if (!row) throw notFound('location')
        Object.assign(row, fields)
        return ok(row)
      }
      const created: Location = { id: newId(), hotelRef, createdAt: at, ...fields }
      locations.push(created)
      return ok(created)
    }
  }

  if (path === '/v1/teams') {
    const hotelRef = hotelFor(ctx)
    if (method === 'GET') {
      return ok(teams.filter(t => t.hotelRef === hotelRef && t.isActive).sort((a, b) => a.name.localeCompare(b.name)))
    }
    if (method === 'POST') {
      requireAdmin(ctx)
      const name = asTrimmed(body.name)
      if (!name || name.length > 100) throw badRequest('name is required (1-100 chars)')
      const hotelDepartmentId = isUuid(body.hotelDepartmentId) ? body.hotelDepartmentId.toLowerCase() : null
      // An inactive department is refused only when the value CHANGES: a team
      // already in a now-inactive department can still be renamed (dept-crud §6.3).
      const sameAsStored = isUuid(body.id) && teams.find(t => t.id === body.id && t.hotelRef === hotelRef)?.hotelDepartmentId === hotelDepartmentId
      if (hotelDepartmentId && !sameAsStored) requireActiveDepartment(hotelRef, hotelDepartmentId)
      if (teams.some(t => t.hotelRef === hotelRef && t.name.toLowerCase() === name.toLowerCase() && t.id !== body.id)) throw conflict('team name already exists')
      const at = nowIso()
      const fields = { name, description: asNullableTrimmed(body.description), hotelDepartmentId, isActive: body.isActive === undefined ? true : Boolean(body.isActive), updatedAt: at }
      if (isUuid(body.id)) {
        const row = teams.find(t => t.id === body.id && t.hotelRef === hotelRef)
        if (!row) throw notFound('team')
        Object.assign(row, fields)
        return ok(row)
      }
      const created: Team = { id: newId(), hotelRef, createdAt: at, ...fields }
      teams.push(created)
      return ok(created)
    }
  }

  const teamMembersPath = /^\/v1\/teams\/([^/]+)\/members$/.exec(path)
  if (method === 'GET' && teamMembersPath) {
    const hotelRef = hotelFor(ctx)
    if (!isUuid(teamMembersPath[1])) throw badRequest('invalid id')
    const team = teams.find(t => t.id === teamMembersPath[1]!.toLowerCase() && t.hotelRef === hotelRef)
    if (!team) throw notFound('team')
    return ok(teamMembers.filter(m => m.teamId === team.id).map(m => m.staffId))
  }

  const teamMemberPath = /^\/v1\/teams\/([^/]+)\/members\/([^/]+)$/.exec(path)
  if (teamMemberPath && (method === 'PUT' || method === 'DELETE')) {
    requireAdmin(ctx)
    const hotelRef = hotelFor(ctx)
    const [, teamId, staffId] = teamMemberPath
    if (!isUuid(teamId) || !isUuid(staffId)) throw badRequest('invalid id')
    const team = teams.find(t => t.id === teamId!.toLowerCase() && t.hotelRef === hotelRef)
    if (!team) throw notFound('team')
    if (method === 'PUT') {
      if (!staffInHotel(staffId!.toLowerCase(), hotelRef)) throw unprocessable('invalid staff reference')
      if (!teamMembers.some(m => m.teamId === team.id && m.staffId === staffId!.toLowerCase())) {
        teamMembers.push({ teamId: team.id, staffId: staffId!.toLowerCase(), createdAt: nowIso() })
      }
      return ok({ ok: true })
    }
    const index = teamMembers.findIndex(m => m.teamId === team.id && m.staffId === staffId!.toLowerCase())
    if (index !== -1) teamMembers.splice(index, 1)
    return ok({ ok: true }) // 200 {"ok":true}, not 204 — current real behavior
  }

  if (path === '/v1/operating-schedules') {
    const hotelRef = hotelFor(ctx)
    if (method === 'GET') {
      return ok(operatingSchedules
        .filter(s => s.hotelRef === hotelRef)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)))
    }
    if (method === 'POST') {
      requireAdmin(ctx)
      const name = asTrimmed(body.name)
      if (!name || name.length > 100) throw badRequest('name is required (1-100 chars)')
      const windowsRaw = Array.isArray(body.windows) ? body.windows as Array<Record<string, unknown>> : []
      const seenWeekdays = new Set<number>()
      const windows: OperatingWindow[] = windowsRaw.map((w) => {
        const weekday = Number(w.weekday)
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest('window weekday must be 0-6 (Sunday-Saturday)')
        if (seenWeekdays.has(weekday)) throw unprocessable('at most one window per weekday')
        seenWeekdays.add(weekday)
        const opens = Number(w.opensMinutes)
        const closes = Number(w.closesMinutes)
        if (![opens, closes].every(v => Number.isInteger(v) && v >= 0 && v <= 1440)) throw badRequest('window opensMinutes/closesMinutes must be 0-1440')
        if (closes <= opens) throw unprocessable('window closesMinutes must be greater than opensMinutes')
        return { weekday, opensMinutes: opens, closesMinutes: closes }
      })
      const exceptionsRaw = Array.isArray(body.exceptions) ? body.exceptions as Array<Record<string, unknown>> : []
      const seenDates = new Set<string>()
      const exceptions: OperatingException[] = exceptionsRaw.map((e) => {
        const date = asTrimmed(e.date)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('exception date must be YYYY-MM-DD')
        if (seenDates.has(date)) throw unprocessable('at most one exception per date')
        seenDates.add(date)
        const isClosed = Boolean(e.isClosed)
        if (isClosed) return { date, isClosed: true, opensMinutes: null, closesMinutes: null }
        if (e.opensMinutes == null || e.closesMinutes == null) throw badRequest('a non-closed exception requires opensMinutes and closesMinutes')
        const opens = Number(e.opensMinutes)
        const closes = Number(e.closesMinutes)
        if (closes <= opens) throw unprocessable('exception closesMinutes must be greater than opensMinutes')
        return { date, isClosed: false, opensMinutes: opens, closesMinutes: closes }
      })
      const hotelDepartmentId = isUuid(body.hotelDepartmentId) ? body.hotelDepartmentId.toLowerCase() : null
      const isDefault = Boolean(body.isDefault)
      const id = isUuid(body.id) ? body.id.toLowerCase() : null
      // Same "only when the value changes" rule as teams (dept-crud §6.3).
      const sameDeptAsStored = id !== null && operatingSchedules.find(s => s.id === id && s.hotelRef === hotelRef)?.hotelDepartmentId === hotelDepartmentId
      if (hotelDepartmentId && !sameDeptAsStored) requireActiveDepartment(hotelRef, hotelDepartmentId)
      // One default per hotel, one schedule per department.
      if (isDefault && operatingSchedules.some(s => s.hotelRef === hotelRef && s.isDefault && s.id !== id)) throw conflict('another schedule already claims this default/department slot')
      if (hotelDepartmentId && operatingSchedules.some(s => s.hotelRef === hotelRef && s.hotelDepartmentId === hotelDepartmentId && s.id !== id)) throw conflict('another schedule already claims this default/department slot')
      const at = nowIso()
      const fields = { name, isDefault, hotelDepartmentId, windows, exceptions, updatedAt: at }
      if (id) {
        const row = operatingSchedules.find(s => s.id === id && s.hotelRef === hotelRef)
        if (!row) throw notFound('operating schedule')
        Object.assign(row, fields) // full replace of windows + exceptions
        return ok(row)
      }
      const created: OperatingSchedule = { id: newId(), hotelRef, createdAt: at, ...fields }
      operatingSchedules.push(created)
      return ok(created)
    }
  }

  if (path === '/v1/terminology') {
    const hotelRef = hotelFor(ctx)
    const merged = () => ({
      ...TERMINOLOGY_DEFAULT_PROFILE,
      ...Object.fromEntries(terminologyOverrides.filter(o => o.hotelRef === hotelRef).map(o => [o.key, o.value])),
    })
    if (method === 'GET') return ok(merged())
    if (method === 'PATCH') {
      requireAdmin(ctx)
      const key = asTrimmed(body.key)
      if (!key) throw badRequest('key is required')
      const value = asTrimmed(body.value)
      if (!value) throw badRequest('value is required')
      const existing = terminologyOverrides.find(o => o.hotelRef === hotelRef && o.key === key)
      if (existing) existing.value = value
      else terminologyOverrides.push({ hotelRef, key, value })
      return ok(merged())
    }
  }

  if (method === 'GET' && path === '/v1/source-apps') {
    return ok([...sourceApps].sort((a, b) => a.name.localeCompare(b.name)))
  }

  // ── Departments (feat/department-crud). The master list: reads for an admin
  // anywhere, writes for a platform admin; the hotel's rows: admin at the
  // hotel, with PATCH {isActive} as the soft delete. Literals follow
  // internal/department/{handler,service,repo}.go.
  const masterById = /^\/v1\/departments\/([^/]+)$/.exec(path)
  const masterId = (): Id => {
    if (!isUuid(masterById![1])) throw badRequest('invalid id')
    return masterById![1]!.toLowerCase()
  }
  if (method === 'GET' && path === '/v1/departments') {
    // Names no single hotel: admin at any property the caller belongs to.
    requireAdminAnywhere(ctx)
    return ok([...masterDepartments].sort((a, b) => a.name.localeCompare(b.name)))
  }
  if (method === 'GET' && masterById) {
    requireAdminAnywhere(ctx)
    const found = masterDepartments.find(d => d.id === masterId())
    if (!found) throw notFound('department')
    return ok(found)
  }
  if (method === 'POST' && path === '/v1/departments') {
    requirePlatformAdmin(ctx)
    const name = requiredText(body.name, 100, 'name is required (1-100 chars)')
    const code = normaliseDepartmentCode(body.code)
    const description = normaliseDepartmentDescription(body.description)
    assertMasterUnique(name, code, null)
    const created: MasterDepartment = { id: newId(), name, code, description, isActive: true, updatedAt: nowIso() }
    masterDepartments.push(created)
    return ok(created, 201)
  }
  if (method === 'PATCH' && masterById) {
    requirePlatformAdmin(ctx)
    const id = masterId()
    const name = body.name === undefined || body.name === null ? undefined : requiredText(body.name, 100, 'name is required (1-100 chars)')
    // A *string in the Go: JSON null reads as absent; "" clears the field.
    const code = typeof body.code === 'string' ? normaliseDepartmentCode(body.code) : undefined
    const description = typeof body.description === 'string' ? normaliseDepartmentDescription(body.description) : undefined
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined
    const found = masterDepartments.find(d => d.id === id)
    if (!found) throw notFound('department')
    if (name === undefined && code === undefined && description === undefined && isActive === undefined) return ok(found)
    assertMasterUnique(name ?? found.name, code === undefined ? found.code : code, found.id)
    if (name !== undefined) found.name = name
    if (code !== undefined) found.code = code
    if (description !== undefined) found.description = description
    if (isActive !== undefined) found.isActive = isActive
    found.updatedAt = nowIso()
    // The hotel rows are a join onto the master: they follow its name, code, description and retirement.
    hotelDepartments.filter(d => d.departmentId === found.id).forEach((d) => {
      Object.assign(d, { departmentName: found.name, code: found.code, description: found.description, masterIsActive: found.isActive })
    })
    return ok(found)
  }
  if (method === 'DELETE' && masterById) {
    requirePlatformAdmin(ctx)
    const id = masterId()
    const index = masterDepartments.findIndex(d => d.id === id)
    if (index === -1) throw notFound('department')
    // Hard delete only while no hotel has EVER used it (active or not).
    const usedByHotels = hotelDepartments.filter(d => d.departmentId === id).length
    if (usedByHotels > 0) throw conflict(`department is used by ${usedByHotels} hotel(s); deactivate it instead`)
    masterDepartments.splice(index, 1)
    return noContent()
  }

  const hotelDeptById = /^\/v1\/hotel-departments\/([^/]+)$/.exec(path)
  if (path === '/v1/hotel-departments' || hotelDeptById) {
    const deptId = (): Id => {
      if (!isUuid(hotelDeptById![1])) throw badRequest('invalid id')
      return hotelDeptById![1]!.toLowerCase()
    }
    if (method === 'GET' && !hotelDeptById) {
      requireAdmin(ctx)
      const hotelRef = hotelFor(ctx)
      return ok(hotelDepartments.filter(d => d.hotelRef === hotelRef).sort((a, b) => a.departmentName.localeCompare(b.departmentName)))
    }
    if (method === 'GET' && hotelDeptById) {
      requireAdmin(ctx)
      const hotelRef = hotelFor(ctx)
      const found = hotelDepartments.find(d => d.id === deptId() && d.hotelRef === hotelRef)
      if (!found) throw notFound('hotel department')
      return ok(found)
    }
    if (method === 'POST' && !hotelDeptById) {
      requireAdmin(ctx)
      // The one deliberate body-hotel exception: a service actor's hotelRef may
      // come from the body; a human admin resolves the header and must manage it.
      let hotelRef: Id
      if (actor.isService) {
        const fromScope = ctx.query.hotelRef || ctx.headers['x-hotel-id']
        const raw = isUuid(fromScope) ? fromScope : body.hotelRef
        if (!isUuid(raw)) throw badRequest('hotel context required')
        hotelRef = raw.toLowerCase()
      }
      else {
        const header = ctx.headers['x-hotel-id']
        if (!isUuid(header)) throw badRequest('hotel context required')
        hotelRef = header.toLowerCase()
        if (!staffHotels.some(r => r.staffId === actor.staffId && r.hotelRef === hotelRef) && !actor.isOperator) {
          throw forbidden('cannot manage departments for hotels you do not manage')
        }
      }
      const departmentId = isUuid(body.departmentId) ? body.departmentId.toLowerCase() : null
      if (!departmentId) throw badRequest('departmentId is required')
      const master = masterDepartments.find(d => d.id === departmentId)
      if (!master || !tenants.some(t => t.hotelRef === hotelRef)) throw unprocessable('hotel or department does not exist')
      // Idempotent: the existing row comes back 200 whatever its state; reactivation is PATCH's job.
      const existing = hotelDepartments.find(d => d.hotelRef === hotelRef && d.departmentId === departmentId)
      if (existing) return ok(existing, 200)
      // A retired master cannot be newly enabled anywhere (decision #6).
      if (!master.isActive) throw unprocessable('department is not available')
      const created = seedHotelDept(newId(), hotelRef, departmentId, true, nowIso())
      hotelDepartments.push(created)
      return ok(created, 201)
    }
    if (method === 'PATCH' && hotelDeptById) {
      requireAdmin(ctx)
      const hotelRef = hotelFor(ctx)
      if (!actor.isService && !actor.isOperator && !staffHotels.some(r => r.staffId === actor.staffId && r.hotelRef === hotelRef)) {
        throw forbidden('cannot manage departments for hotels you do not manage')
      }
      const id = deptId()
      if (typeof body.isActive !== 'boolean') throw badRequest('isActive is required')
      const found = hotelDepartments.find(d => d.id === id && d.hotelRef === hotelRef)
      if (!found) throw notFound('hotel department')
      if (found.isActive === body.isActive) return ok(found) // no-op 200
      if (!body.isActive) {
        // Decisions #3/#4: nothing that routes NEW work may still point here.
        const rules = routingRules.filter(r => r.hotelRef === hotelRef && r.hotelDepartmentId === id).length
        const steps = escalationSteps.filter(st => st.hotelRef === hotelRef && !st.deletedAt && st.actions.some(a => a.type === 'routeToDepartment' && a.hotelDepartmentId === id)).length
        if (rules > 0 || steps > 0) throw conflict(`department is used by ${rules} routing rule(s) and ${steps} escalation policy step(s); repoint them first`)
      }
      else if (!found.masterIsActive) {
        throw unprocessable('department is not available')
      }
      found.isActive = body.isActive
      found.updatedAt = nowIso()
      return ok(found)
    }
  }

  const groupStats = /^\/v1\/groups\/([^/]+)\/stats$/.exec(path)
  const groupTasks = /^\/v1\/groups\/([^/]+)\/tasks$/.exec(path)
  if (method === 'GET' && (groupStats || groupTasks)) {
    const rawId = (groupStats ?? groupTasks)![1]!
    if (!isUuid(rawId)) throw badRequest('id must be a valid UUID')
    // Authorization BEFORE the group lookup — no existence oracle.
    if (actor.isService) throw forbidden('forbidden')
    // Names no single hotel: admin at ANY property (per-hotel roles), or the operator.
    if (!actor.isOperator && !actor.memberships.some(m => m.role === 'admin')) throw forbidden('forbidden')
    if (!actor.isOperator && !groupGrants.some(g => g.staffId === actor.staffId && g.groupId === rawId.toLowerCase())) throw forbidden('forbidden')
    const groupId = rawId.toLowerCase()
    const memberHotels = tenants.filter(t => t.groupId === groupId)
    if (groupStats) {
      const zeroStatus = () => Object.fromEntries(TASK_STATUSES.map(s => [s, 0])) as Record<TaskStatus, number>
      const totals = { byStatus: zeroStatus(), responseBreached: 0, resolutionBreached: 0, openTotal: 0 }
      const tenantRows = memberHotels.map((tenant) => {
        const rows = tasks.filter(t => t.hotelRef === tenant.hotelRef)
        const byStatus = zeroStatus()
        let responseBreached = 0
        let resolutionBreached = 0
        for (const t of rows) {
          byStatus[t.status] += 1
          if (t.responseSlaStatus === 'BREACHED') responseBreached += 1
          if (t.resolutionSlaStatus === 'BREACHED') resolutionBreached += 1
        }
        const openTotal = rows.filter(t => !['FINISHED', 'VERIFIED', 'CANCELLED'].includes(t.status)).length
        TASK_STATUSES.forEach((s) => { totals.byStatus[s] += byStatus[s] })
        totals.responseBreached += responseBreached
        totals.resolutionBreached += resolutionBreached
        totals.openTotal += openTotal
        return { hotelRef: tenant.hotelRef, name: tenant.name, byStatus, responseBreached, resolutionBreached, openTotal }
      })
      return ok({ groupId, tenants: tenantRows, totals })
    }
    const params = parseListParams(ctx.query)
    const scoped = tasks.filter(t => memberHotels.some(h => h.hotelRef === t.hotelRef))
    const withAssignee = params.assignedStaffId
      ? scoped.filter(t => activeAssignment(t.id)?.staffId === params.assignedStaffId)
      : scoped
    const { page, total, nextCursor } = runTaskList(withAssignee, params, true)
    const meta: Record<string, unknown> = { total }
    if (nextCursor) meta.nextCursor = nextCursor
    return ok(nullIfEmpty(page), 200, meta)
  }

  return null
}

// ════════════════════════ Uploads ════════════════════════

export const UPLOAD_MAX_BYTES: Record<string, number> = {
  'image/jpeg': 10 << 20,
  'image/png': 10 << 20,
  'image/webp': 10 << 20,
  'image/heic': 10 << 20,
  'application/pdf': 20 << 20,
}

const UPLOAD_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
}

// ════════════════════════ Task routes ════════════════════════

function findHotelTask(hotelRef: Id, taskId: unknown): Task {
  const t = isUuid(taskId) ? tasks.find(row => row.id === taskId.toLowerCase() && row.hotelRef === hotelRef) : undefined
  if (!t) throw notFound('task')
  return t
}

function handleTasks(ctx: Ctx): FakeResponse | null {
  const { method, path, body, actor } = ctx

  // Dispatch (service only). Idempotent on idempotencyKey.
  if (method === 'POST' && path === '/v1/tasks') {
    if (!actor.isService) throw forbidden('forbidden')
    const hotelRef = hotelFor(ctx)
    if (!tenants.some(t => t.hotelRef === hotelRef)) throw unprocessable('tenant not provisioned')
    const source = (body.source ?? {}) as Record<string, unknown>
    const item = (body.item ?? {}) as Record<string, unknown>
    const requester = (body.requester ?? {}) as Record<string, unknown>
    const idempotencyKey = isUuid(body.idempotencyKey) ? body.idempotencyKey.toLowerCase() : null
    if (idempotencyKey) {
      const existing = tasks.find(t => t.hotelRef === hotelRef && t.idempotencyKey === idempotencyKey)
      if (existing) return ok(taskListItem(existing), 200, { warnings: null })
    }
    const sourceChannel = asTrimmed(source.channel)
    const activationDate = asIsoDate(body.activationDate, 'activationDate')
    if (sourceChannel === 'guest' && activationDate && Date.parse(activationDate) < Date.now()) {
      throw badRequest('activationDate cannot be in the past')
    }
    const resolved = resolveTask(hotelRef, {
      title: asTrimmed(body.title),
      description: asNullableTrimmed(body.note),
      notes: null,
      roomNumber: asNullableTrimmed(requester.roomNumber),
      quantity: typeof body.quantity === 'number' ? body.quantity : null,
      activationDate,
      dueAt: null,
      priority: null,
      itemRef: isUuid(body.itemRef) ? body.itemRef.toLowerCase() : null,
      itemName: asTrimmed(item.name),
      categoryName: asNullableTrimmed(item.categoryName),
      locationRef: null,
      requesterRef: isUuid(requester.guestRef) ? requester.guestRef : null,
      requesterName: asNullableTrimmed(requester.name),
      visitRef: null,
      itemQuantity: Boolean(item.itemQuantity),
      checklistLabels: [],
      sourceProduct: asTrimmed(source.product) || (actor.partnerId ? actor.partnerName : 'sentec-butler'),
      sourceChannel: sourceChannel || 'guest',
      idempotencyKey,
    })
    tasks.push(resolved.task)
    // A dispatch writes NO initial history row; event_seq stays 0.
    return ok(taskListItem(resolved.task), 201, { warnings: resolved.warnings })
  }

  if (method === 'POST' && (path === '/v1/tasks/staff-create' || path === '/v1/tasks/preview')) {
    const isPreview = path === '/v1/tasks/preview'
    if (!isPreview && actor.isService) throw forbidden('forbidden')
    if (actor.role === 'staff' && !actor.createTask) throw forbidden('forbidden')
    const hotelRef = hotelFor(ctx)
    if (!tenants.some(t => t.hotelRef === hotelRef)) throw unprocessable('tenant not provisioned')
    // The assignment gate runs BEFORE any write — and identically in preview.
    const assignee = validateAssignAtCreation(actor, hotelRef, body.assignee as AssigneeInput | null | undefined)
    const resolved = resolveTask(hotelRef, decodeStaffCreateRequest(ctx, 'staff'))
    if (isPreview) {
      // Preview alone names the resolved policy (omitempty: absent when there is none).
      const policyName = resolved.task.escalationPolicyId ? escalationPolicies.find(p => p.id === resolved.task.escalationPolicyId)?.name : undefined
      const task = policyName ? { ...resolved.task, escalationPolicyName: policyName } : resolved.task
      return ok({ task, checklistLabels: resolved.checklistLabels }, 200, { warnings: resolved.warnings })
    }
    const t = resolved.task
    tasks.push(t)
    resolved.checklistLabels.forEach((label, index) => {
      checklistItems.push({ id: newId(), hotelRef, taskId: t.id, sort: index, label, isDone: false, doneBy: null, doneAt: null, assignedStaffId: null, assignedStaffName: null, assignedBy: null, assignedAt: null, note: null, createdAt: t.createdAt, updatedAt: t.createdAt })
    })
    pushHistory(t, actor.staffId, 'NEW', null, t.createdAt)
    if (assignee?.kind === 'STAFF') {
      assignStaffToTask(actor, t, assignee.staffId, null, actor.staffId, t.createdAt)
    }
    else if (assignee?.kind === 'TEAM') {
      taskAssignments.push({ id: newId(), taskId: t.id, kind: 'TEAM', staffId: null, teamId: assignee.teamId, hotelDepartmentId: null, assignedBy: actor.staffId, actingUser: null, remark: null, isActive: true, createdAt: t.createdAt })
    }
    return ok(taskListItem(t), 201, { warnings: resolved.warnings })
  }

  if (method === 'GET' && path === '/v1/tasks') {
    const hotelRef = hotelFor(ctx)
    const params = parseListParams(ctx.query)
    let rows = tasks.filter(t => t.hotelRef === hotelRef)
    // projectId: admin or project member only — anyone else gets the same
    // 404 a missing project gets. Project tasks stay OUT of the default list
    // and the hotel board unless the request sends projectId, assignedStaffId
    // (Mine) or helping=1; they still appear in offers and detail.
    let projectId: Id | null = null
    if (ctx.query.projectId) {
      if (!isUuid(ctx.query.projectId)) throw badRequest('invalid projectId')
      projectId = ctx.query.projectId.toLowerCase()
      const project = projects.find(p => p.id === projectId && p.hotelRef === hotelRef)
      if (!project || (!actor.isService && roleAt(actor.staffId, hotelRef) !== 'admin' && !isProjectMember(projectId, actor.staffId))) throw notFound('project not found')
      rows = rows.filter(t => t.projectId === projectId)
    }
    else if (!params.assignedStaffId && ctx.query.helping !== '1') {
      rows = rows.filter(t => t.projectId === null)
    }
    if (ctx.query.helping === '1' && !actor.isService) {
      // helping=1 IS the scope: always the caller's own helper rows, which is
      // strictly narrower than anything the staff auto-scope could allow.
      rows = rows.filter(t => taskCollaborators.some(c => c.taskId === t.id && c.staffId === actor.staffId && c.isActive))
    }
    else {
      rows = applyStaffVisibility(actor, hotelRef, params, rows)
    }
    const { page, total, nextCursor } = runTaskList(rows, params, false)
    const meta: Record<string, unknown> = { total }
    if (nextCursor) meta.nextCursor = nextCursor
    return ok(nullIfEmpty(page), 200, meta)
  }

  if (method === 'POST' && path === '/v1/tasks/assign') {
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    // Leader or admin — or the manager of the task's project (ADR 0001).
    if (actor.role !== 'leader' && actor.role !== 'admin' && !managesProject(actor, t)) throw forbidden('forbidden')
    if (!isUuid(body.staffId)) throw notFound('staff')
    // Reassignment is deliberate: the existing holder is replaced, no refusal.
    assignStaffToTask(actor, t, body.staffId.toLowerCase(), asNullableTrimmed(body.remark), actor.isService ? null : actor.staffId, nowIso())
    return ok(taskDetail(t))
  }

  if (method === 'POST' && path === '/v1/tasks/claim') {
    if (actor.isService || (actor.role !== 'staff' && actor.role !== 'leader')) throw forbidden('forbidden')
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    const existing = activeAssignment(t.id)
    if (existing) {
      if (existing.kind === 'STAFF') {
        // Idempotent double tap; never a steal.
        if (existing.staffId === actor.staffId) return ok(taskDetail(t))
        throw conflict(ERR_ALREADY_CLAIMED)
      }
      else if (existing.kind === 'TEAM') {
        if (!isTeamMember(existing.teamId, actor.staffId)) throw forbidden('task is held by a team you are not a member of')
      }
      else if (existing.kind === 'DEPARTMENT') {
        if (dbDept(actor.staffId, hotelRef) !== existing.hotelDepartmentId) throw forbidden('task is held by a different department')
      }
      else {
        throw forbidden('task is held by an unrecognized assignee kind')
      }
    }
    assignStaffToTask(actor, t, actor.staffId!, null, actor.staffId, nowIso())
    return ok(taskDetail(t))
  }

  if (method === 'PATCH' && path === '/v1/tasks/status') {
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    const columnId = isUuid(body.columnId) ? body.columnId.toLowerCase() : null
    const column = columnId
      ? boardColumns.find(c => c.id === columnId && !c.isRemoved && c.status !== null
        && boards.some(b => b.id === c.boardId && b.hotelRef === hotelRef))
      : undefined
    if (!column || !column.status) throw badRequest('column not found or has no linked status')
    const target = column.status
    // A plain staff member here is one WITHOUT leader rights on this task —
    // the project manager passes every leader/admin check on project tasks.
    const plainStaff = !actor.isService && actor.role === 'staff' && !managesProject(actor, t)
    if (target === 'VERIFIED' && plainStaff) throw forbidden('only leaders or admins can set status to VERIFIED')
    if (target === 'NEW') throw badRequest('cannot change status back to NEW')
    if (target === 'SUBMITTED') throw badRequest('use the submit action to move a task to SUBMITTED')
    if (t.status === 'SUBMITTED') {
      // Frozen while awaiting review — except a leader/admin park or cancel.
      if (plainStaff) throw forbidden('task is awaiting review')
      if (target === 'FINISHED' || target === 'IN_PROGRESS') throw badRequest('use the review action to decide a submitted task')
      if (target === 'VERIFIED') throw badRequest('a submitted task is reviewed to FINISHED before it can be VERIFIED')
    }
    if (plainStaff && activeAssignment(t.id)?.staffId !== actor.staffId) {
      throw forbidden('not assigned to this task')
    }
    changeStatusCore(t, actor.staffId, target, column.id, asNullableTrimmed(body.description), nowIso())
    return ok(taskDetail(t))
  }

  if (method === 'POST' && path === '/v1/tasks/submit') {
    if (actor.isService) throw forbidden('forbidden')
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    const note = asNullableTrimmed(body.completionNote)
    if (note && note.length > 2000) throw badRequest('completionNote must be at most 2000 characters')
    if (t.status !== 'IN_PROGRESS') throw conflict('task is not in progress')
    const isAssignee = activeAssignment(t.id)?.staffId === actor.staffId
    const isHelper = taskCollaborators.some(c => c.taskId === t.id && c.staffId === actor.staffId && c.isActive)
    if (!isAssignee && !isHelper) throw forbidden('only the assignee or a helper can submit this task')
    // Proof gates, resolved from the catalog item (no item ⇒ no gates).
    const item = t.itemRef ? catalogItems.find(i => i.id === t.itemRef) ?? null : null
    if (item) {
      if (item.minProofPhotos > 0) {
        const count = taskAttachments.filter(a => a.taskId === t.id && a.filetype === 'PHOTO' && !a.isRemoved).length
        if (count < item.minProofPhotos) {
          throw badRequest(`this task type requires at least ${item.minProofPhotos} photo proofs (${count} attached)`)
        }
      }
      if (item.requiresCompletionNote && note === null) throw badRequest('this task type requires a completion note')
    }
    const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds : []
    for (const id of attachmentIds) {
      if (!taskAttachments.some(a => a.id === id && a.taskId === t.id)) throw badRequest('attachment does not belong to this task')
    }
    const column = columnForStatus(hotelRef, 'SUBMITTED')
    if (!column) throw notFound('column for status')
    const at = nowIso()
    t.completionNote = note
    t.submittedBy = actor.staffId
    t.submittedAt = at
    changeStatusCore(t, actor.staffId, 'SUBMITTED', column.id, note, at)
    return ok(taskDetail(t))
  }

  if (method === 'POST' && path === '/v1/tasks/review') {
    if (actor.isService) throw forbidden('only leaders or admins may review a submitted task')
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    const manager = managesProject(actor, t)
    if (actor.role !== 'leader' && actor.role !== 'admin' && !manager) {
      throw forbidden('only leaders or admins may review a submitted task')
    }
    const decision = String(body.decision ?? '')
    if (decision !== 'APPROVE' && decision !== 'REQUEST_CHANGES') throw badRequest('decision must be one of APPROVE, REQUEST_CHANGES')
    const note = asNullableTrimmed(body.note)
    if (note && note.length > 1000) throw badRequest('note must be at most 1000 characters')
    if (decision === 'REQUEST_CHANGES' && note === null) throw badRequest('a note is required when requesting changes')
    if (t.status !== 'SUBMITTED') throw conflict('task is not awaiting review')
    if (actor.role === 'leader' && !manager) {
      const leaderDept = dbDept(actor.staffId, hotelRef)
      if (!t.hotelDepartmentId || leaderDept !== t.hotelDepartmentId) throw forbidden('not authorized to review this task')
    }
    const target: TaskStatus = decision === 'APPROVE' ? 'FINISHED' : 'IN_PROGRESS'
    const column = columnForStatus(hotelRef, target)
    if (!column) throw notFound('column for status')
    changeStatusCore(t, actor.staffId, target, column.id, note, nowIso())
    return ok(taskDetail(t))
  }

  if (method === 'POST' && path === '/v1/tasks/return') {
    if (actor.isService) throw forbidden('forbidden')
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    const reason = asTrimmed(body.reason)
    if (!reason || reason.length > 500) throw badRequest('reason is required (1-500 chars)')
    if (t.status === 'SUBMITTED') throw conflict('task is awaiting review')
    if (t.status !== 'NEW' && t.status !== 'IN_PROGRESS') throw conflict('task is closed')
    const holding = activeAssignment(t.id)
    if (holding?.kind !== 'STAFF' || holding.staffId !== actor.staffId) throw forbidden('only the active assignee can return this task')
    returnToPoolCore(t, actor.staffId!, actor.staffId, reason, nowIso())
    return ok(taskDetail(t))
  }

  if (method === 'PATCH' && path === '/v1/tasks/update') {
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    const hasTitle = body.title != null
    const hasDescription = 'description' in body && body.description !== undefined
    const hasRoom = 'roomNumber' in body && body.roomNumber !== undefined
    if (!hasTitle && !hasDescription && !hasRoom) throw badRequest('at least one field (title, description, roomNumber) is required')
    let title: string | null = null
    if (hasTitle) {
      title = asTrimmed(body.title)
      if (!title || title.length > 255) throw badRequest('title is required (1-255 chars)')
    }
    // Leader-of-the-task's-department only, among humans — admins included
    // out. The project manager passes on the project's tasks.
    if (!actor.isService && !managesProject(actor, t)) {
      const leaderDept = actor.role === 'leader' ? dbDept(actor.staffId, hotelRef) : null
      if (actor.role !== 'leader' || !t.hotelDepartmentId || leaderDept !== t.hotelDepartmentId) throw forbidden('forbidden')
    }
    if (t.status === 'VERIFIED' || t.status === 'CANCELLED') throw badRequest(`cannot update task in ${t.status} status`)
    if (title !== null) t.title = title
    if (hasDescription) t.description = body.description == null ? null : String(body.description)
    if (hasRoom) t.roomNumber = body.roomNumber == null ? null : String(body.roomNumber)
    t.updatedAt = nowIso()
    // Context writes are a separate, service-only step AFTER the field patch —
    // and the field patch is deliberately NOT rolled back on a context 403.
    const context = Array.isArray(body.context) ? body.context as Array<Record<string, unknown>> : []
    if (context.length > 0) {
      if (!actor.isService) throw forbidden('only service or partner actors may write task context')
      for (const entry of context) {
        const sourceAppCode = asTrimmed(entry.sourceAppCode)
        const label = asTrimmed(entry.label)
        if (!sourceAppCode || !label) throw badRequest('sourceAppCode and label are required on every entry')
        const existing = taskContextEntries.find(e => e.taskId === t.id && e.sourceAppCode === sourceAppCode && e.label === label)
        if (existing) {
          existing.value = String(entry.value ?? '')
          existing.url = asNullableTrimmed(entry.url)
          existing.sort = Number(entry.sort ?? 0)
        }
        else {
          taskContextEntries.push({ id: newId(), hotelRef, taskId: t.id, sourceAppCode, label, value: String(entry.value ?? ''), url: asNullableTrimmed(entry.url), sort: Number(entry.sort ?? 0) })
        }
      }
    }
    return ok(taskListItem(t))
  }

  // GET /v1/tasks/{id}/escalations (feat/escalation §8): the applied steps,
  // oldest first — anyone who can open the task may ask; [] when none.
  const escalationsPath = /^\/v1\/tasks\/([^/]+)\/escalations$/.exec(path)
  if (method === 'GET' && escalationsPath) {
    const hotelRef = hotelFor(ctx)
    if (!isUuid(escalationsPath[1])) throw badRequest('id must be a valid UUID')
    const t = tasks.find(row => row.id === escalationsPath[1]!.toLowerCase() && row.hotelRef === hotelRef)
    if (!t || !visibleTo(actor, hotelRef, t)) throw notFound('task')
    return ok(taskEscalations
      .filter(r => r.taskId === t.id)
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.level - b.level))
  }

  const contextPath = /^\/v1\/tasks\/([^/]+)\/context$/.exec(path)
  if (method === 'GET' && contextPath) {
    const hotelRef = hotelFor(ctx)
    if (!isUuid(contextPath[1])) throw badRequest('invalid id')
    const rows = taskContextEntries
      .filter(e => e.taskId === contextPath[1]!.toLowerCase() && e.hotelRef === hotelRef)
      .sort((a, b) => a.sourceAppCode.localeCompare(b.sourceAppCode) || a.sort - b.sort)
    return ok(rows)
  }

  if (method === 'POST' && path === '/v1/tasks/comments') {
    // Length is checked BEFORE the service gate — no trimming, bytes 1-500.
    const comment = String(ctx.body.comment ?? '')
    if (comment.length < 1 || comment.length > 500) throw badRequest('comment is required (1-500 chars)')
    if (actor.isService) throw forbidden('comments require a staff identity')
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    // A deptless task denies everyone, leaders and admins included — except
    // on a project task, where managers and members may comment and viewers
    // may not.
    const level = t.projectId ? projectMembers.find(m => m.projectId === t.projectId && m.staffId === actor.staffId)?.level ?? null : null
    const callerDept = dbDept(actor.staffId, hotelRef)
    const sameDept = !!t.hotelDepartmentId && callerDept === t.hotelDepartmentId
    if (level === 'VIEWER' || (!sameDept && level === null)) throw forbidden('not authorized to comment on this task')
    const created: TaskComment = { id: newId(), hotelRef, taskId: t.id, staffId: actor.staffId!, comment, createdAt: nowIso(), staffName: null }
    taskComments.push(created)
    return ok(created, 201)
  }

  if (method === 'POST' && (path === '/v1/tasks/attachments' || path === '/v1/tasks/guest-attachments')) {
    const isGuestRoute = path === '/v1/tasks/guest-attachments'
    if (isGuestRoute && !actor.isService) throw forbidden('forbidden')
    const hotelRef = hotelFor(ctx)
    if (isGuestRoute && asTrimmed(body.storageKey)) throw badRequest('guest attachments are URL-only')
    const filetype = String(body.filetype ?? '')
    if (filetype !== 'PHOTO' && filetype !== 'PDF') throw badRequest('filetype must be PHOTO or PDF')
    const t = findHotelTask(hotelRef, body.taskId)
    if (isGuestRoute) {
      if (!t.requesterRef || !isUuid(body.guestRef) || body.guestRef.toLowerCase() !== t.requesterRef) throw forbidden('not authorized for this task')
    }
    else {
      const isPermitted = hasLeaderRights(actor, hotelRef, t)
        || activeAssignment(t.id)?.staffId === actor.staffId
        || taskCollaborators.some(c => c.taskId === t.id && c.staffId === actor.staffId && c.isActive)
      if (!isPermitted) throw forbidden('not authorized to manage attachments on this task')
    }
    const id = isUuid(body.id) ? body.id.toLowerCase() : null
    if (id) {
      const existing = taskAttachments.find(a => a.id === id && a.taskId === t.id)
      if (!existing) throw notFound('attachment')
      if (isGuestRoute && existing.staffId !== null) throw forbidden('guest can only modify own attachments')
      // Only isRemoved changes on update; its absence means false (un-remove).
      existing.isRemoved = Boolean(body.isRemoved)
      return ok(existing, 200)
    }
    const url = asTrimmed(body.url)
    const storageKey = asTrimmed(body.storageKey)
    if ((url !== '') === (storageKey !== '')) throw badRequest('provide either url or storageKey, not both')
    if (storageKey && (!storageKey.startsWith(`hotels/${hotelRef}/uploads/`) || storageKey.length > 512)) {
      throw badRequest('storageKey does not belong to this hotel')
    }
    if (url && url.length > 2048) throw badRequest('url is required (1-2048 chars)')
    const activeCount = taskAttachments.filter(a => a.taskId === t.id && !a.isRemoved).length
    if (activeCount >= 30) throw conflict('attachment limit reached (30)')
    const created: TaskAttachment = {
      id: newId(),
      hotelRef,
      taskId: t.id,
      staffId: isGuestRoute || actor.isService ? null : actor.staffId,
      filetype,
      // Storage-backed rows carry a fresh signed GET on every read; the mock's
      // signer is a stable placeholder URL keyed by attachment id.
      filepath: url || '',
      isRemoved: false,
      createdAt: nowIso(),
    }
    if (storageKey) {
      attachmentStorageKeys.set(created.id, storageKey)
      created.filepath = `https://media.sentec-tasks.example/signed/${created.id}`
    }
    taskAttachments.push(created)
    return ok(created, 201)
  }

  if (method === 'POST' && path === '/v1/tasks/collaborators') {
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    if (['FINISHED', 'VERIFIED', 'CANCELLED'].includes(t.status)) throw conflict('task is closed')
    if (actor.isService) throw forbidden('helpers are human-only')
    const permitted = hasLeaderRights(actor, hotelRef, t)
      || activeAssignment(t.id)?.staffId === actor.staffId
    if (!permitted) throw forbidden('not authorized to manage collaborators on this task')
    if (!isUuid(body.staffId) || !staffInHotel(body.staffId.toLowerCase(), hotelRef)) throw notFound('staff')
    const staffId = body.staffId.toLowerCase()
    if (activeAssignment(t.id)?.staffId === staffId) throw badRequest('assignee cannot be a helper')
    const existing = taskCollaborators.find(c => c.taskId === t.id && c.staffId === staffId && c.isActive)
    if (existing) return ok({ ...existing, staffName: account(existing.staffId)?.name ?? null })
    const created: Collaborator = { id: newId(), hotelRef, taskId: t.id, staffId, staffName: null, addedBy: actor.staffId, isActive: true, createdAt: nowIso() }
    taskCollaborators.push(created)
    ensureAutoMember(t, staffId, actor.staffId, created.createdAt)
    return ok({ ...created, staffName: account(staffId)?.name ?? null })
  }

  if (method === 'POST' && path === '/v1/tasks/collaborators/remove') {
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    if (['FINISHED', 'VERIFIED', 'CANCELLED'].includes(t.status)) throw conflict('task is closed')
    if (actor.isService) throw forbidden('helpers are human-only')
    const staffId = isUuid(body.staffId) ? body.staffId.toLowerCase() : ''
    const permitted = hasLeaderRights(actor, hotelRef, t)
      || activeAssignment(t.id)?.staffId === actor.staffId
      || staffId === actor.staffId // leaving is always allowed
    if (!permitted) throw forbidden('not authorized to manage collaborators on this task')
    taskCollaborators.filter(c => c.taskId === t.id && c.staffId === staffId && c.isActive).forEach((c) => { c.isActive = false })
    return noContent()
  }

  if (method === 'POST' && path === '/v1/tasks/offers') {
    const hotelRef = hotelFor(ctx)
    if (isUuid(body.toStaffId) && body.toStaffId.toLowerCase() === actor.staffId) throw badRequest('cannot offer a task to yourself')
    const note = asNullableTrimmed(body.note)
    if (note && note.length > 500) throw badRequest('note must be at most 500 characters')
    const t = findHotelTask(hotelRef, body.taskId)
    const holding = activeAssignment(t.id)
    if (holding?.kind !== 'STAFF' || holding.staffId !== actor.staffId) throw forbidden('only the active assignee can offer this task')
    if (t.status !== 'NEW' && t.status !== 'IN_PROGRESS') throw conflict('task is not open')
    if (!isUuid(body.toStaffId) || !staffInHotel(body.toStaffId.toLowerCase(), hotelRef)) throw notFound('staff')
    const toStaff = body.toStaffId.toLowerCase()
    // Department compatibility: nil on either side passes; no admin bypass here.
    const targetDept = dbDept(toStaff, hotelRef)
    if (targetDept && t.hotelDepartmentId && targetDept !== t.hotelDepartmentId) throw badRequest(ERR_CROSS_DEPARTMENT)
    if (taskOffers.some(o => o.taskId === t.id && o.state === 'PENDING')) throw conflict('an offer is already pending for this task')
    const created: TaskOffer = { id: newId(), hotelRef, taskId: t.id, fromStaff: actor.staffId!, toStaff, note, state: 'PENDING', decidedAt: null, createdAt: nowIso() }
    taskOffers.push(created)
    return ok(created)
  }

  if (method === 'GET' && path === '/v1/offers') {
    const hotelRef = hotelFor(ctx)
    const rows: InboxOffer[] = taskOffers
      .filter(o => o.hotelRef === hotelRef && o.toStaff === actor.staffId && o.state === 'PENDING')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(o => ({
        ...o,
        fromStaffName: account(o.fromStaff)?.name ?? null,
        taskTitle: tasks.find(t => t.id === o.taskId)?.title ?? '',
      }))
    return ok(nullIfEmpty(rows))
  }

  if (method === 'POST' && (path === '/v1/offers/accept' || path === '/v1/offers/decline' || path === '/v1/offers/cancel')) {
    const hotelRef = hotelFor(ctx)
    const offerId = isUuid(body.offerId) ? body.offerId.toLowerCase() : null
    const offer = offerId ? taskOffers.find(o => o.id === offerId && o.hotelRef === hotelRef) : undefined
    if (!offer) throw notFound('offer')
    const at = nowIso()
    if (path === '/v1/offers/accept') {
      // Gate order: exists → pending → target → staleness.
      if (offer.state !== 'PENDING') throw conflict('offer is not pending')
      if (offer.toStaff !== actor.staffId) throw forbidden("only the offer's target can accept it")
      const t = tasks.find(row => row.id === offer.taskId)!
      const holding = activeAssignment(t.id)
      if (holding?.kind !== 'STAFF' || holding.staffId !== offer.fromStaff) {
        offer.state = 'CANCELLED'
        offer.decidedAt = at
        throw conflict('offer is stale')
      }
      // departmentSync may refuse — the offer then stays PENDING, nothing moves.
      departmentSync(actor, t, actor.staffId!)
      taskAssignments.filter(a => a.taskId === t.id && a.isActive).forEach((a) => { a.isActive = false })
      taskCollaborators.filter(c => c.taskId === t.id && c.staffId === actor.staffId && c.isActive).forEach((c) => { c.isActive = false })
      taskAssignments.push({ id: newId(), taskId: t.id, kind: 'STAFF', staffId: actor.staffId, teamId: null, hotelDepartmentId: null, assignedBy: offer.fromStaff, actingUser: null, remark: null, isActive: true, createdAt: at })
      ensureAutoMember(t, actor.staffId, offer.fromStaff, at)
      offer.state = 'ACCEPTED'
      offer.decidedAt = at
      t.updatedAt = at
      return ok(taskDetail(t))
    }
    // Decline/cancel check permission BEFORE state — the reverse of accept.
    if (path === '/v1/offers/decline') {
      if (offer.toStaff !== actor.staffId) throw forbidden("only the offer's target can decline it")
      if (offer.state !== 'PENDING') throw conflict('offer is not pending')
      offer.state = 'DECLINED'
    }
    else {
      if (offer.fromStaff !== actor.staffId) throw forbidden("only the offer's sender can cancel it")
      if (offer.state !== 'PENDING') throw conflict('offer is not pending')
      offer.state = 'CANCELLED'
    }
    offer.decidedAt = at
    return ok(offer)
  }

  if (method === 'POST' && path === '/v1/uploads') {
    // Human-only, checked before anything else is looked at.
    if (actor.isService) throw forbidden('uploads require a staff identity')
    const hotelRef = hotelFor(ctx)
    const filename = asTrimmed(body.filename)
    if (!filename) throw badRequest('filename is required')
    const sizeBytes = Number(body.sizeBytes)
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw badRequest('sizeBytes must be positive')
    const contentType = String(body.contentType ?? '')
    const max = UPLOAD_MAX_BYTES[contentType]
    if (!max) throw badRequest(`contentType must be one of ${Object.keys(UPLOAD_MAX_BYTES).join(', ')}`)
    if (sizeBytes > max) throw badRequest(`sizeBytes exceeds the ${max} byte limit for ${contentType}`)
    // Extension derives from contentType, never the filename.
    const storageKey = `hotels/${hotelRef}/uploads/${newId()}${UPLOAD_EXT[contentType]}`
    return ok({
      uploadUrl: `https://media.sentec-tasks.example/put/${encodeURIComponent(storageKey)}`,
      storageKey,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
  }

  const detailPath = /^\/v1\/tasks\/([^/]+)$/.exec(path)
  if (method === 'GET' && detailPath) {
    const hotelRef = hotelFor(ctx)
    if (!isUuid(detailPath[1])) throw badRequest('id must be a valid UUID')
    const t = tasks.find(row => row.id === detailPath[1]!.toLowerCase() && row.hotelRef === hotelRef)
    // Out-of-scope and nonexistent are deliberately the same 404.
    if (!t || !visibleTo(actor, hotelRef, t)) throw notFound('task')
    return ok(taskDetail(t))
  }

  return null
}

// ════════════════════════ feat/projects: tenant, projects, checklist, templates, import ════════════════════════
//
// Routes, bodies, status codes, permissions AND error literals follow the
// branch's Go (internal/project, internal/task/{checklist,project,attribution,
// generate}.go, internal/tasktemplate, internal/tenant, internal/staff/import*)
// at fe5e99d. "MOCK LIMIT" marks the few things a browser mock cannot do.

const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED']
const LEVEL_ORDER: Record<ProjectLevel, number> = { MANAGER: 0, MEMBER: 1, VIEWER: 2 }

/** Names are unique among ACTIVE projects only (a completed one may be reused). */
const activeProjectNameTaken = (hotelRef: Id, name: string, exceptId?: Id) =>
  projects.some(p => p.hotelRef === hotelRef && p.id !== exceptId && p.status === 'ACTIVE' && p.name.toLowerCase() === name.toLowerCase())
const CLOSED_TASK_STATUSES = new Set<TaskStatus>(['FINISHED', 'VERIFIED', 'CANCELLED'])

/** Hotel-local calendar date (YYYY-MM-DD) of an instant. */
function localDateAt(hotelRef: Id, atMs: number): string {
  return new Date(atMs + hotelOffsetMinutes(hotelRef) * 60_000).toISOString().slice(0, 10)
}

function projectProgress(projectId: Id): ProjectProgress {
  const rows = tasks.filter(t => t.projectId === projectId)
  const byStatus = Object.fromEntries(TASK_STATUSES.map(status => [status, 0])) as Record<TaskStatus, number>
  for (const t of rows) byStatus[t.status] += 1
  const done = byStatus.FINISHED + byStatus.VERIFIED
  const total = rows.length - byStatus.CANCELLED
  const now = Date.now()
  const overdue = rows.filter(t => !CLOSED_TASK_STATUSES.has(t.status) && ((t.dueAt && Date.parse(t.dueAt) < now) || (t.resolutionDueAt && Date.parse(t.resolutionDueAt) < now))).length
  const unassigned = rows.filter(t => !CLOSED_TASK_STATUSES.has(t.status) && activeAssignment(t.id)?.kind !== 'STAFF').length
  return { byStatus, done, total, percent: total ? Math.floor((done / total) * 100) : 0, overdue, unassigned }
}

function projectModel(p: ProjectRow, actor: Actor, hotelRef: Id, extra: Partial<Pick<Project, 'openTasks'>> = {}): Project {
  const manager = projectMembers.find(m => m.projectId === p.id && m.level === 'MANAGER') ?? null
  const mine = actor.staffId ? projectMembers.find(m => m.projectId === p.id && m.staffId === actor.staffId) ?? null : null
  const isAdmin = actor.isService || roleAt(actor.staffId, hotelRef) === 'admin'
  const model: Project = {
    id: p.id,
    hotelRef: p.hotelRef,
    name: p.name,
    description: p.description,
    startDate: p.startDate,
    endDate: p.endDate,
    status: p.status,
    completedAt: p.completedAt,
    createdBy: p.createdBy,
    managerStaffId: manager?.staffId ?? null,
    myLevel: mine?.level ?? null,
    late: p.status === 'ACTIVE' && !!p.endDate && p.endDate < localDateAt(hotelRef, Date.now()),
    progress: projectProgress(p.id),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...extra,
  }
  // Admins only: the manager no longer holds an active membership here.
  if (isAdmin) model.needsManager = manager === null || !account(manager.staffId)?.isActive || !membershipAt(manager.staffId, hotelRef)
  return model
}

const projectMemberModel = (m: ProjectMemberRow): ProjectMember =>
  ({ staffId: m.staffId, name: account(m.staffId)?.name ?? m.staffId, level: m.level, source: m.source, addedBy: m.addedBy, addedAt: m.addedAt })

/** People who cannot see a project get 404, not 403. Admins see every project at the hotel. */
function findVisibleProject(actor: Actor, hotelRef: Id, rawId: string | undefined): ProjectRow {
  const id = isUuid(rawId) ? rawId.toLowerCase() : null
  const project = id ? projects.find(p => p.id === id && p.hotelRef === hotelRef) : undefined
  if (!project) throw notFound('project not found')
  if (actor.isService || roleAt(actor.staffId, hotelRef) === 'admin') return project
  if (!isProjectMember(project.id, actor.staffId)) throw notFound('project not found')
  return project
}

function requireProjectManagerOrAdmin(actor: Actor, hotelRef: Id, project: ProjectRow) {
  if (actor.isService || roleAt(actor.staffId, hotelRef) === 'admin') return
  if (projectMembers.some(m => m.projectId === project.id && m.staffId === actor.staffId && m.level === 'MANAGER')) return
  throw forbidden('only the project manager or an admin can do this')
}

const asLocalDate = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw badRequest(`${field} must be a date (YYYY-MM-DD)`)
  return value
}

// ── Recurrence arithmetic ──────────────────────────────────────────────────

/**
 * The first run STRICTLY after `afterMs`, as a UTC instant, walking hotel-
 * local calendar days: DAILY every day, WEEKLY on the listed weekdays
 * (0 = Sunday), MONTHLY on dayOfMonth (1–28, so every month has it), each at
 * timeMinutes after local midnight, inside [startsOn, endsOn]. Null when the
 * schedule has run out.
 */
function nextRunAfter(recurrence: TaskTemplateRecurrence, timezone: string, afterMs: number): string | null {
  // Local, not module-level: the seed calls this while the module is still
  // initialising, before any later `const` exists.
  const DAY_MS = 1440 * 60_000
  const offsetMs = zoneOffsetMinutes(timezone, afterMs) * 60_000
  let dayStart = Math.floor((afterMs + offsetMs) / DAY_MS) * DAY_MS
  if (recurrence.startsOn) dayStart = Math.max(dayStart, Date.parse(`${recurrence.startsOn}T00:00:00.000Z`))
  const endMs = recurrence.endsOn ? Date.parse(`${recurrence.endsOn}T00:00:00.000Z`) : Number.POSITIVE_INFINITY
  for (let step = 0; step < 800 && dayStart <= endMs; step++, dayStart += DAY_MS) {
    const local = new Date(dayStart)
    const matches = recurrence.kind === 'DAILY'
      || (recurrence.kind === 'WEEKLY' && (recurrence.weekdays ?? []).includes(local.getUTCDay()))
      || (recurrence.kind === 'MONTHLY' && local.getUTCDate() === recurrence.dayOfMonth)
    if (!matches) continue
    const utcMs = dayStart + recurrence.timeMinutes * 60_000 - offsetMs
    if (utcMs > afterMs) return new Date(utcMs).toISOString()
  }
  return null
}

function upcomingRuns(recurrence: TaskTemplateRecurrence | null, timezone: string, fromIso: string | null): string[] {
  if (!recurrence || !fromIso) return []
  const runs: string[] = []
  let cursor: string | null = fromIso
  while (cursor && runs.length < 5) {
    runs.push(cursor)
    cursor = nextRunAfter(recurrence, timezone, Date.parse(cursor))
  }
  return runs
}

function templateModel(row: TemplateRow): TaskTemplate {
  const timezone = hotelTimezone(row.hotelRef)
  return {
    id: row.id,
    hotelRef: row.hotelRef,
    name: row.name,
    isActive: row.isActive,
    content: row.content,
    recurrence: row.recurrence,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastOccurrenceAt: row.lastOccurrenceAt,
    lastTaskId: row.lastTaskId,
    lastError: row.lastError,
    createdBy: row.createdBy,
    ownerStaffId: row.ownerStaffId,
    ownerName: row.ownerStaffId ? account(row.ownerStaffId)?.name ?? null : null,
    timezone,
    upcoming: row.isActive ? upcomingRuns(row.recurrence, timezone, row.nextRunAt) : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function decodeTemplateContent(raw: unknown): TaskTemplateContent {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // The title may be blank when itemRef is set: the item name is used.
  const title = asTrimmed(body.title)
  const itemRef = body.itemRef == null || body.itemRef === '' ? null : String(body.itemRef)
  if (itemRef !== null && !isUuid(itemRef)) throw badRequest('content.itemRef must be a UUID')
  const locationRef = body.locationRef == null || body.locationRef === '' ? null : String(body.locationRef)
  if (locationRef !== null && !isUuid(locationRef)) throw badRequest('content.locationRef must be a UUID')
  const priority = asString(body.priority)?.toUpperCase() ?? null
  if (priority && !TASK_PRIORITY_VALUES.includes(priority as TaskPriority)) throw badRequest('content.priority must be one of LOW, NORMAL, HIGH, URGENT')
  // UNASSIGNED (or no kind) normalises to no assignee at all.
  let assignee: TaskTemplateAssignee | null = null
  if (body.assignee && typeof body.assignee === 'object') {
    const a = body.assignee as Record<string, unknown>
    const kind = String(a.assigneeKind ?? '')
    if (kind && kind !== 'UNASSIGNED') {
      if (kind !== 'STAFF' && kind !== 'TEAM') throw badRequest('a template\'s assigneeKind must be STAFF, TEAM or UNASSIGNED')
      assignee = {
        assigneeKind: kind,
        assigneeStaffId: isUuid(a.assigneeStaffId) ? a.assigneeStaffId.toLowerCase() : null,
        assigneeTeamId: isUuid(a.assigneeTeamId) ? a.assigneeTeamId.toLowerCase() : null,
      }
    }
  }
  return {
    title,
    description: asNullableTrimmed(body.description),
    itemRef,
    locationRef,
    roomNumber: asNullableTrimmed(body.roomNumber),
    priority: priority as TaskPriority | null,
    quantity: typeof body.quantity === 'number' ? body.quantity : null,
    checklistLabels: Array.isArray(body.checklistLabels) ? body.checklistLabels.map(label => String(label ?? '').trim()).filter(Boolean) : [],
    assignee,
  }
}

function decodeRecurrence(raw: unknown): TaskTemplateRecurrence {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // Rule.Validate, in its order and with its words.
  const kind = String(body.kind ?? '')
  const timeMinutes = Number(body.timeMinutes)
  if (!Number.isInteger(timeMinutes) || timeMinutes < 0 || timeMinutes > 1439) throw badRequest('recurrence.timeMinutes must be between 0 and 1439')
  const weekdays = Array.isArray(body.weekdays) ? [...new Set(body.weekdays.map(Number))].sort((a, b) => a - b) : []
  const dayOfMonth = body.dayOfMonth == null ? null : Number(body.dayOfMonth)
  switch (kind) {
    case 'DAILY':
      if (weekdays.length > 0 || dayOfMonth !== null) throw badRequest('a DAILY recurrence takes neither weekdays nor dayOfMonth')
      break
    case 'WEEKLY':
      if (weekdays.length === 0) throw badRequest('a WEEKLY recurrence needs at least one weekday')
      if (weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw badRequest('recurrence.weekdays must be 0 (Sunday) to 6 (Saturday)')
      if (dayOfMonth !== null) throw badRequest('a WEEKLY recurrence takes no dayOfMonth')
      break
    case 'MONTHLY':
      if (dayOfMonth === null || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) throw badRequest('a MONTHLY recurrence needs dayOfMonth between 1 and 28')
      if (weekdays.length > 0) throw badRequest('a MONTHLY recurrence takes no weekdays')
      break
    default:
      throw badRequest('recurrence.kind must be one of DAILY, WEEKLY, MONTHLY')
  }
  const startsOn = asLocalDate(body.startsOn, 'recurrence.startsOn')
  const endsOn = asLocalDate(body.endsOn, 'recurrence.endsOn')
  if (startsOn && endsOn && endsOn < startsOn) throw badRequest('recurrence.endsOn cannot be before startsOn')
  return { kind: kind as RecurrenceKind, timeMinutes, weekdays: kind === 'WEEKLY' ? weekdays : null, dayOfMonth: kind === 'MONTHLY' ? dayOfMonth : null, startsOn, endsOn }
}

/** Template content → the creation pipeline's input (no due/activation/requester). */
function templateResolveInput(content: TaskTemplateContent): ResolveInput {
  return {
    title: content.title,
    description: content.description ?? null,
    notes: null,
    roomNumber: content.roomNumber ?? null,
    quantity: content.quantity ?? null,
    activationDate: null,
    dueAt: null,
    priority: content.priority ?? null,
    itemRef: content.itemRef ?? null,
    itemName: '',
    categoryName: null,
    locationRef: content.locationRef ?? null,
    requesterRef: null,
    requesterName: null,
    visitRef: null,
    itemQuantity: false,
    checklistLabels: content.checklistLabels,
    sourceProduct: 'sentec-tasks',
    sourceChannel: 'staff',
    idempotencyKey: null,
  }
}

/**
 * Previewer: the template's content through the same pipeline
 * POST /v1/tasks/preview uses, as `actor` (the owner for a personal template).
 * The pipeline's own error — a 400 for a missing title, a 422 for a bad
 * location — is what comes back; the resolved title names a personal template.
 */
function previewTemplateContent(actor: Actor, hotelRef: Id, content: TaskTemplateContent): string {
  validateAssignAtCreation(actor, hotelRef, content.assignee ?? null)
  return resolveTask(hotelRef, templateResolveInput(content)).task.title
}

/** The actor a template runs as: its owner for a personal one, a service actor for a shared one. */
function templateActor(row: TemplateRow): Actor | null {
  if (row.scope === 'personal') {
    const owner = account(row.ownerStaffId)
    if (!owner || !owner.isActive) return null
    if (!hotelsClaim(owner.id).includes(row.hotelRef)) return null
    const actor = staffActor(owner, null, row.hotelRef)
    if (actor.role === 'staff' && !actor.createTask) return null
    return actor
  }
  return { isService: true, actingUser: 'recurring-worker', staffId: null, role: 'admin', deptId: null, createTask: true, hotels: [], memberships: [], partnerId: null, partnerName: '', partnerCapabilities: [], isOperator: false, sessionId: null, csrfToken: '' }
}

/** Create one task from a template through the same pipeline staff-create uses. */
function createTaskFromTemplate(row: TemplateRow, actor: Actor, occurrenceKey: string | null, at: string): Task {
  const assignee = validateAssignAtCreation(actor, row.hotelRef, row.content.assignee ?? null)
  const resolved = resolveTask(row.hotelRef, templateResolveInput(row.content))
  const t = resolved.task
  t.templateId = row.id
  t.occurrenceKey = occurrenceKey
  t.createdAt = at
  t.updatedAt = at
  tasks.push(t)
  resolved.checklistLabels.forEach((label, index) => {
    checklistItems.push({ id: newId(), hotelRef: row.hotelRef, taskId: t.id, sort: index, label, isDone: false, doneBy: null, doneAt: null, assignedStaffId: null, assignedStaffName: null, assignedBy: null, assignedAt: null, note: null, createdAt: at, updatedAt: at })
  })
  // Like Dispatch, a generated task by the worker has no acting staff and so
  // no NEW history row; the owner's own recurring task records them.
  if (actor.staffId) pushHistory(t, actor.staffId, 'NEW', null, at)
  if (assignee?.kind === 'STAFF') assignStaffToTask(actor, t, assignee.staffId, null, actor.staffId, at)
  else if (assignee?.kind === 'TEAM') taskAssignments.push({ id: newId(), taskId: t.id, kind: 'TEAM', staffId: null, teamId: assignee.teamId, hotelDepartmentId: null, assignedBy: actor.staffId, actingUser: null, remark: null, isActive: true, createdAt: at })
  return t
}

/** The occurrence key: the scheduled instant, RFC 3339 in UTC, unique per template. */
const occurrenceKeyOf = (runAtIso: string) => new Date(runAtIso).toISOString().replace('.000Z', 'Z')

/**
 * The worker (go run ./cmd/worker): every active template whose nextRunAt has
 * passed makes its task, idempotently per occurrence, then advances. A
 * template whose owner lost access or the create-task permission is paused
 * with lastError filled in — the screens show it.
 */
function runDueTemplates() {
  const now = Date.now()
  for (const row of taskTemplates) {
    if (row.isArchived || !row.isActive || !row.recurrence) continue
    for (let guard = 0; guard < 50 && row.nextRunAt && Date.parse(row.nextRunAt) <= now; guard++) {
      const key = occurrenceKeyOf(row.nextRunAt)
      const actor = templateActor(row)
      if (!actor) {
        // The sweeper's words: a personal template whose owner lost access is paused.
        row.isActive = false
        row.lastError = 'paused: the owner can no longer create tasks at this hotel (forbidden)'
        row.lastRunAt = nowIso()
        row.updatedAt = nowIso()
        break
      }
      try {
        if (!tasks.some(t => t.templateId === row.id && t.occurrenceKey === key)) {
          const t = createTaskFromTemplate(row, actor, key, row.nextRunAt)
          row.lastTaskId = t.id
        }
        row.lastRunAt = nowIso()
        row.lastOccurrenceAt = row.nextRunAt
        row.lastError = null
        row.nextRunAt = nextRunAfter(row.recurrence, hotelTimezone(row.hotelRef), Date.parse(row.nextRunAt))
      }
      catch (e) {
        // Content that cannot become a task right now: the occurrence is
        // skipped, the template goes on to the next one.
        row.lastRunAt = nowIso()
        row.lastError = `occurrence ${key} skipped: ${(e as Error).message}`
        row.nextRunAt = nextRunAfter(row.recurrence!, hotelTimezone(row.hotelRef), Date.parse(row.nextRunAt!))
        row.updatedAt = nowIso()
      }
    }
  }
}

/** PATCH /v1/tenant moved the zone: every active template's next run follows it. */
function rescheduleTemplates(hotelRef: Id) {
  const timezone = hotelTimezone(hotelRef)
  for (const row of taskTemplates) {
    if (row.hotelRef !== hotelRef || row.isArchived || !row.isActive || !row.recurrence) continue
    row.nextRunAt = nextRunAfter(row.recurrence, timezone, Date.now())
  }
}

// ════════════════════════ Return-to-pool + offboarding (feat/ems-staff-sync §7) ════════════════════════

/** NEW, IN_PROGRESS and PENDING: the statuses offboarding releases. SUBMITTED is the reviewer's wait, not the assignee's. */
const RELEASABLE_STATUSES = new Set<TaskStatus>(['NEW', 'IN_PROGRESS', 'PENDING'])

/**
 * Return's write half (task.returnToPoolTx), shared with the offboarding
 * release. `holder` is whose assignment ends and picks the team in rule (b);
 * `actorStaffId` is who the history row and the new pool assignment are
 * attributed to — null for EMS, which has no staff id.
 *
 * Pool selection, first match wins: (a) most recent TEAM/DEPARTMENT
 * assignment verbatim; (b) the holder's latest active team; (c) the task's
 * own department; (d) fully unassigned. An IN_PROGRESS task goes back to NEW;
 * any other status keeps it, with the reason still landing in history.
 */
function returnToPoolCore(t: Task, holder: Id, actorStaffId: Id | null, reason: string, at: string) {
  taskAssignments.filter(a => a.taskId === t.id && a.isActive).forEach((a) => { a.isActive = false })
  cancelPendingOffer(t.id, at)
  const lastPool = [...taskAssignments].reverse().find(a => a.taskId === t.id && a.kind !== 'STAFF')
  const latestTeam = [...teamMembers]
    .filter(m => m.staffId === holder && teams.some(team => team.id === m.teamId && team.isActive && team.hotelRef === t.hotelRef))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.teamId.localeCompare(a.teamId))[0]
  let next: Pick<TaskAssignment, 'kind' | 'teamId' | 'hotelDepartmentId'> | null = null
  if (lastPool) next = { kind: lastPool.kind, teamId: lastPool.teamId, hotelDepartmentId: lastPool.hotelDepartmentId }
  else if (latestTeam) next = { kind: 'TEAM', teamId: latestTeam.teamId, hotelDepartmentId: null }
  else if (t.hotelDepartmentId) next = { kind: 'DEPARTMENT', teamId: null, hotelDepartmentId: t.hotelDepartmentId }
  if (next) {
    taskAssignments.push({ id: newId(), taskId: t.id, kind: next.kind, staffId: null, teamId: next.teamId, hotelDepartmentId: next.hotelDepartmentId, assignedBy: actorStaffId, actingUser: null, remark: reason, isActive: true, createdAt: at })
  }
  if (t.status === 'IN_PROGRESS') {
    changeStatusCore(t, actorStaffId, 'NEW', columnForStatus(t.hotelRef, 'NEW')?.id ?? null, reason, at)
  }
  else {
    pushHistory(t, actorStaffId, t.status, reason, at)
    t.updatedAt = at
  }
}

/**
 * task.Service.ReleaseStaff — the person's open work at ONE hotel goes back:
 * every NEW/IN_PROGRESS/PENDING task they personally hold returns to its
 * pool; their helper rows, pending offers and checklist-step assignments on
 * open tasks are cleared; their team rows at the hotel are deleted. Safe to
 * run again, and offboarding relies on that.
 */
function releaseStaffAt(hotelRef: Id, staffId: Id, actorStaffId: Id | null, reason: string, at: string) {
  for (const t of tasks) {
    if (t.hotelRef !== hotelRef || !RELEASABLE_STATUSES.has(t.status)) continue
    const active = activeAssignment(t.id)
    if (active?.kind !== 'STAFF' || active.staffId !== staffId) continue
    returnToPoolCore(t, staffId, actorStaffId, reason, at)
  }
  const open = new Set(tasks.filter(t => t.hotelRef === hotelRef && RELEASABLE_STATUSES.has(t.status)).map(t => t.id))
  taskCollaborators.filter(c => open.has(c.taskId) && c.staffId === staffId && c.isActive).forEach((c) => { c.isActive = false })
  taskOffers.filter(o => open.has(o.taskId) && o.state === 'PENDING' && (o.toStaff === staffId || o.fromStaff === staffId)).forEach((o) => {
    o.state = 'CANCELLED'
    o.decidedAt = at
  })
  checklistItems.filter(c => open.has(c.taskId) && c.assignedStaffId === staffId).forEach((c) => {
    c.assignedStaffId = null
    c.assignedBy = null
    c.assignedAt = null
    c.updatedAt = at
  })
  for (let i = teamMembers.length - 1; i >= 0; i--) {
    const m = teamMembers[i]!
    if (m.staffId === staffId && teams.some(team => team.id === m.teamId && team.hotelRef === hotelRef)) teamMembers.splice(i, 1)
  }
}

/** offboard.RemoveFromHotel: drop the membership first (no new work can reach them), then release. False when there was no membership — the release still runs. */
function removeFromHotel(hotelRef: Id, staffId: Id, actorStaffId: Id | null, reason: string, at: string): boolean {
  const index = staffHotels.findIndex(r => r.staffId === staffId && r.hotelRef === hotelRef)
  const removed = index !== -1
  if (removed) staffHotels.splice(index, 1)
  releaseStaffAt(hotelRef, staffId, actorStaffId, reason, at)
  return removed
}

/** Every session and bearer token of one person — web_session rows deleted. */
function revokeSessions(staffId: Id) {
  for (const [key, session] of sessions) if (session.staffId === staffId) sessions.delete(key)
  for (const [key, bearer] of staffBearerTokens) if (bearer.staffId === staffId) staffBearerTokens.delete(key)
}

/** offboard.AfterDeactivation (§7.3): sessions revoked and open work released at EVERY hotel; memberships are kept so reactivation restores access. */
function afterDeactivation(staffId: Id, actorStaffId: Id | null, at: string) {
  revokeSessions(staffId)
  for (const hotelRef of new Set(staffHotels.filter(r => r.staffId === staffId).map(r => r.hotelRef))) {
    releaseStaffAt(hotelRef, staffId, actorStaffId, 'Account deactivated', at)
  }
}

/** offboard.DeactivateIfNoAccess (§7.2, EMS only): no membership and no group grant left → the account goes inactive. */
function deactivateIfNoAccess(staffId: Id): boolean {
  const acct = account(staffId)
  if (!acct || !acct.isActive) return false
  if (staffHotels.some(r => r.staffId === staffId) || groupGrants.some(g => g.staffId === staffId)) return false
  acct.isActive = false
  revokeSessions(staffId)
  return true
}

/** Decision #26: only EMS may remove an EMS-linked member from a property that is mapped to EMS. */
function managedByEms(hotelRef: Id, staffId: Id): boolean {
  const acct = account(staffId)
  return Boolean(acct?.emsEmployeeId) && membershipAt(staffId, hotelRef) !== null
    && tenantSyncLinks.some(l => l.hotelRef === hotelRef && l.partnerId === EMS_PARTNER_ID)
}

// ════════════════════════ Escalation sweep (feat/escalation §5-6) ════════════════════════

const ESCALATABLE_STATUSES = new Set<TaskStatus>(['NEW', 'IN_PROGRESS', 'PENDING'])

const defaultEscalationPolicy = (hotelRef: Id) => escalationPolicies.find(p => p.hotelRef === hotelRef && p.isDefault && p.isActive) ?? null

const activePolicyInHotel = (hotelRef: Id, id: Id) => escalationPolicies.some(p => p.id === id && p.hotelRef === hotelRef && p.isActive)

/** The policy's live steps, by sort. */
const liveSteps = (policyId: Id): StepRow[] =>
  escalationSteps.filter(st => st.policyId === policyId && !st.deletedAt).sort((a, b) => a.sort - b.sort)

const stepModel = (st: StepRow): EscalationStep => ({ id: st.id, sort: st.sort, triggerKind: st.triggerKind, triggerValue: st.triggerValue, actions: st.actions, recipients: st.recipients })

const policyModel = (p: PolicyRow): EscalationPolicy => ({ ...p, steps: liveSteps(p.id).map(stepModel) })

/** Working minutes between two instants on the task's schedule; 0 when `to` is not after `from`. */
function workingMinutesBetween(hotelRef: Id, schedule: OperatingSchedule | null, fromIso: string, toIso: string): number {
  if (Date.parse(toIso) <= Date.parse(fromIso)) return 0
  return elapsedScheduleMinutes(hotelRef, schedule, fromIso, toIso)
}

/** Working minutes past a deadline, or -1 before it (so a 0-minute trigger fires AT the deadline, never before). */
function minutesPastDeadline(hotelRef: Id, schedule: OperatingSchedule | null, deadline: string | null, atIso: string): number {
  if (!deadline || Date.parse(atIso) < Date.parse(deadline)) return -1
  return workingMinutesBetween(hotelRef, schedule, deadline, atIso)
}

/** escalation.triggerDue — evaluated against the task's CURRENT state (§5). */
function escalationStepDue(step: StepRow, t: Task, hasStaffAssignee: boolean, schedule: OperatingSchedule | null, atIso: string): boolean {
  const effectiveDueAt = t.dueAt ?? t.resolutionDueAt
  switch (step.triggerKind) {
    case 'RESPONSE_OVERDUE':
      return t.responseSlaStatus === 'EMPTY' && minutesPastDeadline(t.hotelRef, schedule, t.responseDueAt, atIso) >= step.triggerValue
    case 'RESOLUTION_OVERDUE':
      return minutesPastDeadline(t.hotelRef, schedule, effectiveDueAt, atIso) >= step.triggerValue
    case 'UNASSIGNED_FOR':
      return !hasStaffAssignee && workingMinutesBetween(t.hotelRef, schedule, t.activationDate, atIso) >= step.triggerValue
    case 'PERCENT_OF_RESOLUTION': {
      if (!effectiveDueAt) return false
      const window = workingMinutesBetween(t.hotelRef, schedule, t.activationDate, effectiveDueAt)
      if (window <= 0) return true
      return workingMinutesBetween(t.hotelRef, schedule, t.activationDate, atIso) * 100 >= window * step.triggerValue
    }
  }
  return false
}

const refOf = (kind: string, id: Id | null | undefined) => (id ? `${kind}:${id}` : '')

function assignmentRefString(a: TaskAssignment | null): string {
  if (!a) return ''
  if (a.kind === 'STAFF') return refOf('staff', a.staffId)
  if (a.kind === 'TEAM') return refOf('team', a.teamId)
  return refOf('department', a.hotelDepartmentId)
}

/** The task as the steps applied so far have left it (decision 6: actions act on current values). */
interface EscalationState { priority: TaskPriority, deptId: Id | null, assignment: TaskAssignment | null }

/** Escalation acts as a system actor: assigned_by NULL, acting_user 'escalation', the human gates bypassed. */
function replaceAssignmentByEscalation(t: Task, st: EscalationState, next: Pick<TaskAssignment, 'kind' | 'staffId' | 'teamId' | 'hotelDepartmentId'>, at: string) {
  taskAssignments.filter(a => a.taskId === t.id && a.isActive).forEach((a) => { a.isActive = false })
  cancelPendingOffer(t.id, at)
  const row: TaskAssignment = { id: newId(), taskId: t.id, ...next, assignedBy: null, actingUser: 'escalation', remark: null, isActive: true, createdAt: at }
  taskAssignments.push(row)
  st.assignment = row
}

type EscalationDetail = Omit<TaskEscalation, 'hotelRef' | 'taskId' | 'appliedAt'>

/** §6.3: actions in the fixed order bumpPriority, routeToDepartment, reassign; each applies or is recorded as skipped with its reason. */
function applyEscalationStep(t: Task, st: EscalationState, step: StepRow, level: number, at: string): EscalationDetail {
  const detail: EscalationDetail = {
    policyId: t.escalationPolicyId!, stepId: step.id, level,
    trigger: { kind: step.triggerKind, value: step.triggerValue },
    applied: [], skipped: [], recipients: [],
  }
  const priorAssignee = st.assignment?.kind === 'STAFF' ? st.assignment.staffId : null
  const bump = step.actions.find(a => a.type === 'bumpPriority')
  const route = step.actions.find(a => a.type === 'routeToDepartment')
  const reassign = step.actions.find(a => a.type === 'reassign')

  if (bump) {
    const index = TASK_PRIORITY_VALUES.indexOf(st.priority)
    if (index >= 0 && index < TASK_PRIORITY_VALUES.length - 1) {
      const next = TASK_PRIORITY_VALUES[index + 1]!
      detail.applied.push({ type: 'bumpPriority', before: st.priority, after: next })
      st.priority = next
    }
    else {
      detail.skipped.push({ type: 'bumpPriority', reason: 'no_change' })
    }
  }

  let routed = false
  if (route?.hotelDepartmentId) {
    const target = route.hotelDepartmentId
    if (st.deptId === target) detail.skipped.push({ type: 'routeToDepartment', reason: 'no_change' })
    else if (!hotelDepartments.some(d => d.id === target && d.hotelRef === t.hotelRef && d.isActive)) detail.skipped.push({ type: 'routeToDepartment', reason: 'target_invalid' })
    else {
      const from = st.deptId
      t.hotelDepartmentId = target
      st.deptId = target
      routed = true
      detail.applied.push({ type: 'routeToDepartment', before: refOf('department', from), after: refOf('department', target) })
    }
  }

  let reassigned = false
  if (reassign) {
    const before = assignmentRefString(st.assignment)
    if (reassign.staffId) {
      const staffId = reassign.staffId
      if (st.assignment?.kind === 'STAFF' && st.assignment.staffId === staffId) detail.skipped.push({ type: 'reassign', reason: 'no_change' })
      else if (!membershipAt(staffId, t.hotelRef) || !account(staffId)?.isActive) detail.skipped.push({ type: 'reassign', reason: 'target_invalid' })
      else {
        taskCollaborators.filter(c => c.taskId === t.id && c.staffId === staffId && c.isActive).forEach((c) => { c.isActive = false })
        replaceAssignmentByEscalation(t, st, { kind: 'STAFF', staffId, teamId: null, hotelDepartmentId: null }, at)
        ensureAutoMember(t, staffId, null, at)
        reassigned = true
        detail.applied.push({ type: 'reassign', before, after: refOf('staff', staffId) })
      }
    }
    else if (reassign.teamId) {
      const teamId = reassign.teamId
      if (st.assignment?.kind === 'TEAM' && st.assignment.teamId === teamId) detail.skipped.push({ type: 'reassign', reason: 'no_change' })
      else if (!teams.some(team => team.id === teamId && team.hotelRef === t.hotelRef && team.isActive)) detail.skipped.push({ type: 'reassign', reason: 'target_invalid' })
      else {
        replaceAssignmentByEscalation(t, st, { kind: 'TEAM', staffId: null, teamId, hotelDepartmentId: null }, at)
        reassigned = true
        detail.applied.push({ type: 'reassign', before, after: refOf('team', teamId) })
      }
    }
  }

  // Decision 12: a route clears the assignee into the new department's pool
  // unless the same step also reassigned (reassign wins).
  if (routed && !reassigned) replaceAssignmentByEscalation(t, st, { kind: 'DEPARTMENT', staffId: null, teamId: null, hotelDepartmentId: st.deptId }, at)

  detail.recipients = resolveEscalationRecipients(t.hotelRef, st, step.recipients, priorAssignee)
  return detail
}

/** §6.3 recipients, resolved AFTER the actions except `assignee` (the assignee before this step). Duplicates removed, order kept. */
function resolveEscalationRecipients(hotelRef: Id, st: EscalationState, recipients: EscalationRecipient[], priorAssignee: Id | null): Id[] {
  const out: Id[] = []
  const add = (...ids: Id[]) => ids.forEach((id) => { if (!out.includes(id)) out.push(id) })
  const byRole = (role: StaffRole, deptId: Id | null) => staffHotels
    .filter(r => r.hotelRef === hotelRef && r.role === role && account(r.staffId)?.isActive && (deptId === null || r.hotelDepartmentId === deptId))
    .map(r => r.staffId)
  for (const r of recipients) {
    switch (r.kind) {
      case 'assignee':
        if (priorAssignee) add(priorAssignee)
        break
      case 'staff':
        if (r.staffId && membershipAt(r.staffId, hotelRef)) add(r.staffId)
        break
      // A task with no department → every leader of the hotel (no leader is closer to it than another).
      case 'departmentLeaders':
        add(...byRole('leader', st.deptId))
        break
      case 'admins':
        add(...byRole('admin', null))
        break
      case 'team':
        if (r.teamId) add(...teamMembers.filter(m => m.teamId === r.teamId).map(m => m.staffId))
        break
    }
  }
  return out
}

/** The task_history description the worker writes, word for word (task/escalate.go escalationDescription). */
export function escalationDescription(d: Pick<TaskEscalation, 'level' | 'trigger' | 'applied' | 'skipped'>): string {
  // Function-local on purpose: seeding calls this before module-level consts below the seed exist (TDZ).
  const labels: Record<EscalationTriggerKind, (value: number) => string> = {
    RESPONSE_OVERDUE: value => `response overdue ${value} min`,
    PERCENT_OF_RESOLUTION: value => `${value}% of resolution time`,
    RESOLUTION_OVERDUE: value => `resolution overdue ${value} min`,
    UNASSIGNED_FOR: value => `unassigned for ${value} min`,
  }
  const label = labels[d.trigger.kind]?.(d.trigger.value) ?? `${d.trigger.kind} ${d.trigger.value}`
  let out = `Escalated (level ${d.level}, ${label})`
  const parts = d.applied.map(a => (a.type === 'bumpPriority' ? `priority ${a.before} → ${a.after}` : a.type === 'reassign' ? 'reassigned' : 'moved to another department'))
  if (parts.length) out += `: ${parts.join('; ')}`
  out += '.'
  if (d.skipped.length) out += ` Skipped: ${d.skipped.map(x => `${x.type} (${x.reason})`).join(', ')}.`
  return out
}

/**
 * The escalation sweep (escalation.Sweeper + task.Service.Escalate), run
 * lazily before every authenticated request like the template worker. Every
 * due, not-yet-applied step of a task's policy is applied in sort order and
 * fully recorded; a step never fires twice; the level never goes down.
 */
function runDueEscalations() {
  const at = nowIso()
  for (const t of tasks) {
    if (!t.escalationPolicyId || !ESCALATABLE_STATUSES.has(t.status)) continue
    const policy = escalationPolicies.find(p => p.id === t.escalationPolicyId && p.hotelRef === t.hotelRef)
    if (!policy?.isActive) continue // decision 20: an inactive policy stops escalating
    const steps = liveSteps(policy.id)
    if (!steps.length) continue
    const applied = new Set(taskEscalations.filter(r => r.taskId === t.id).map(r => r.stepId))
    const schedule = scheduleFor(t.hotelRef, t.hotelDepartmentId)
    const assignment = activeAssignment(t.id)
    const due = steps.filter(st => !applied.has(st.id) && escalationStepDue(st, t, assignment?.kind === 'STAFF', schedule, at))
    if (!due.length) continue
    const state: EscalationState = { priority: t.priority, deptId: t.hotelDepartmentId, assignment }
    let level = t.escalationLevel
    for (const step of due) {
      const detail = applyEscalationStep(t, state, step, step.sort + 1, at)
      taskEscalations.push({ hotelRef: t.hotelRef, taskId: t.id, appliedAt: at, ...detail })
      pushHistory(t, null, t.status, escalationDescription(detail), at)
      level = Math.max(level, step.sort + 1)
    }
    t.priority = state.priority
    t.escalationLevel = level
    t.escalatedAt = at
    t.updatedAt = at
  }
}

// ════════════════════════ Surfaces (feat/interface-lambda) ════════════════════════
//
// The real API is TWO deployments of one code base: the main Lambda (staff
// cookies, service tokens) and the interface Lambda (partner tokens only).
// Every route is tagged with the surfaces that mount it; the gate below sits
// between EitherAuth and CSRF exactly as server.surfaceGate does.

const INTERFACE_PATTERNS = new Set([
  'GET /healthz', 'POST /v1/tasks', 'POST /v1/tasks/preview', 'POST /v1/tasks/assign', 'PATCH /v1/tasks/status', 'PATCH /v1/tasks/update',
  'POST /v1/tasks/attachments', 'POST /v1/tasks/guest-attachments', 'GET /v1/tasks', 'GET /v1/tasks/{id}', 'GET /v1/tasks/{id}/context',
  'GET /v1/tasks/{id}/escalations', 'PUT /v1/ems/hotels/{syncId}/employees/{emsEmployeeId}',
])
/** Mounted on the interface Lambda ONLY: the main deployment does not serve these at all. */
const INTERFACE_ONLY_PATTERNS = new Set(['POST /v1/tasks', 'POST /v1/tasks/guest-attachments', 'PUT /v1/ems/hotels/{syncId}/employees/{emsEmployeeId}'])

function routePattern(method: string, path: string): string {
  const normalised = path
    .replace(/^\/v1\/tasks\/[0-9a-f-]{36}(\/(context|escalations))?$/i, (_m, tail: string | undefined) => `/v1/tasks/{id}${tail ?? ''}`)
    .replace(/^\/v1\/ems\/hotels\/[^/]+\/employees\/[^/]+$/, '/v1/ems/hotels/{syncId}/employees/{emsEmployeeId}')
  return `${method} ${normalised}`
}

/** A partner token is only ever accepted by the interface API; nobody else reaches its exclusive routes. */
function surfaceGate(ctx: Ctx) {
  const pattern = routePattern(ctx.method, ctx.path)
  if (ctx.actor.partnerId !== null) {
    if (!INTERFACE_PATTERNS.has(pattern)) throw forbidden('partner tokens must use the interface API')
  }
  else if (INTERFACE_ONLY_PATTERNS.has(pattern)) {
    throw forbidden('the interface API accepts partner tokens only')
  }
}

// ── Roster import ─────────────────────────────────────────────────────────────

/** A small RFC 4180 reader: quotes, doubled quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    }
    else cell += ch
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

function importRoster(ctx: Ctx, hotelRef: Id): FakeResponse {
  const file = (ctx.body.file && typeof ctx.body.file === 'object' ? ctx.body.file : null) as { name?: string, content?: string } | null
  if (!file) throw badRequest('attach the roster as a multipart form field named file')
  const content = typeof file.content === 'string' ? file.content : ''
  const name = String(file.name ?? '')
  if (content.length > 1_048_576) throw badRequest('the file is too large (1 MB limit)')
  if (!content.length) throw badRequest('the uploaded file is empty')
  if (/\.xls$/i.test(name)) throw badRequest('the legacy .xls format is not supported; re-save the file as .xlsx or .csv')
  if (!/\.(csv|xlsx)$/i.test(name)) throw badRequest('unsupported file type: upload a .csv or .xlsx file')
  // MOCK LIMIT: no workbook reader in the browser; the real API parses .xlsx.
  if (/\.xlsx$/i.test(name)) throw badRequest('could not read the Excel file: the in-browser mock reads .csv only')
  const table = parseCsv(content).filter(r => !r[0]?.trimStart().startsWith('#'))
  if (table.length === 0) throw badRequest('the file is empty')
  const header = table[0]!.map(h => h.trim().toLowerCase())
  if (header.every(h => h === '')) throw badRequest('the first row must be a header row naming each column')
  if (header.length > 32) throw unprocessable('the file has too many columns')
  for (const h of header) {
    if (h && header.indexOf(h) !== header.lastIndexOf(h)) throw badRequest(`the header row names the same column twice: ${h}`)
  }
  const colIndex = (...names: string[]) => names.map(n => header.indexOf(n)).find(i => i >= 0) ?? -1
  const idx = { email: colIndex('email'), name: colIndex('name'), role: colIndex('role'), department: colIndex('department'), createTask: colIndex('createtask', 'cancreatetask') }
  if (idx.email < 0) throw badRequest('the file needs an email column')
  if (idx.name < 0) throw badRequest('the file needs a name column')
  const dataRows = table.slice(1)
  if (dataRows.length > 1000) throw unprocessable('the file has too many rows; split it into batches of at most 1000')
  if (dataRows.length === 0) throw badRequest('the file has a header row but no staff rows')
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')
  const departments = hotelDepartments.filter(d => d.hotelRef === hotelRef)
  const results: StaffImportRowResult[] = []
  const meta = { total: dataRows.length, created: 0, updated: 0, granted: 0, failed: 0 }
  const seen = new Map<string, number>()
  dataRows.forEach((row, index) => {
    const line = index + 2
    const email = cell(row, idx.email).toLowerCase()
    const fail = (err: ApiError) => { meta.failed++; results.push({ line, email, outcome: 'failed', error: { code: err.code, message: err.message } }) }
    const first = seen.get(email)
    if (first !== undefined && email !== '') return fail(badRequest(`duplicate email in file (first seen on row ${first})`))
    if (!looksLikeEmail(email)) return fail(badRequest('valid email is required'))
    const fullName = cell(row, idx.name)
    if (!fullName) return fail(badRequest('name is required'))
    const role = (cell(row, idx.role).toLowerCase() || 'staff') as StaffRole
    if (role !== 'staff' && role !== 'leader') return fail(badRequest('role must be staff or leader'))
    const departmentName = cell(row, idx.department)
    let departmentId: Id | null = null
    if (departmentName) {
      const department = departments.find(d => d.departmentName.toLowerCase() === departmentName.toLowerCase())
      if (!department) return fail(unprocessable(`no department named ${departmentName} is enabled for this hotel`))
      if (!department.isActive) return fail(unprocessable(`the department ${departmentName} is disabled for this hotel`))
      departmentId = department.id
    }
    seen.set(email, line)
    // Blank and anything unrecognised read as false: createTask is a minor
    // permission, not worth failing a row over.
    const createTask = ['true', 'yes', 'y', '1'].includes(cell(row, idx.createTask).toLowerCase())
    const existing = staffAccounts.find(s => s.email === email)
    if (!existing) {
      // No password: they sign in by magic link or Google; nothing is emailed.
      const acct: SeedAccount = { id: newId(), email, name: fullName, isActive: true, isOperator: false, password: '' }
      staffAccounts.push(acct)
      staffHotels.push({ staffId: acct.id, hotelRef, role, hotelDepartmentId: departmentId, createTask })
      meta.created++
      results.push({ line, email, outcome: 'created', staffId: acct.id })
      return
    }
    if (!existing.isActive) return fail(conflict('that email belongs to a deactivated account'))
    if (existing.isOperator) return fail(conflict('that email belongs to a platform operator'))
    const membership = membershipAt(existing.id, hotelRef)
    if (membership) {
      // The file's role, department (only when named) and createTask are
      // applied; an admin is never demoted by a spreadsheet.
      if (membership.role !== 'admin') membership.role = role
      if (departmentId) membership.hotelDepartmentId = departmentId
      membership.createTask = createTask
      meta.updated++
      results.push({ line, email, outcome: 'updated', staffId: existing.id })
      return
    }
    staffHotels.push({ staffId: existing.id, hotelRef, role, hotelDepartmentId: departmentId, createTask })
    meta.granted++
    results.push({ line, email, outcome: 'granted', staffId: existing.id })
  })
  return ok(results, 200, meta)
}

// ── Time attribution ─────────────────────────────────────────────────────────

function attributionFor(hotelRef: Id, t: Task): TaskTimeAttribution {
  const schedule = scheduleFor(hotelRef, t.hotelDepartmentId)
  const minutesBetween = (from: string, to: string) => Math.max(0, elapsedScheduleMinutes(hotelRef, schedule, from, to))
  const submittedRow = [...taskHistory].reverse().find(h => h.taskId === t.id && h.status === 'SUBMITTED')
  const cutoffAt = t.submittedAt ?? submittedRow?.createdAt ?? nowIso()
  const cutoffReason: TaskTimeAttribution['cutoffReason'] = t.submittedAt || submittedRow ? 'submitted' : 'open'
  const rows = taskAssignments.filter(a => a.taskId === t.id && a.createdAt <= cutoffAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const holders = new Map<Id, { staffId: Id, staffName: string | null, minutes: number, holds: number }>()
  let pooledMinutes = 0
  let accounted = 0
  rows.forEach((row, index) => {
    const from = row.createdAt < t.activationDate ? t.activationDate : row.createdAt
    const to = rows[index + 1]?.createdAt ?? (row.isActive ? cutoffAt : (rows[index + 1]?.createdAt ?? cutoffAt))
    const minutes = minutesBetween(from, to)
    accounted += minutes
    if (row.kind === 'STAFF' && row.staffId) {
      const entry = holders.get(row.staffId) ?? { staffId: row.staffId, staffName: account(row.staffId)?.name ?? null, minutes: 0, holds: 0 }
      entry.minutes += minutes
      entry.holds += 1
      holders.set(row.staffId, entry)
    }
    else {
      pooledMinutes += minutes
    }
  })
  const totalMinutes = minutesBetween(t.activationDate, cutoffAt)
  const unclaimedMinutes = Math.max(0, totalMinutes - accounted)
  const split = unclaimedMinutes + pooledMinutes + [...holders.values()].reduce((sum, h) => sum + h.minutes, 0)
  return {
    taskId: t.id,
    activationDate: t.activationDate,
    cutoffAt,
    cutoffReason,
    totalMinutes,
    unclaimedMinutes,
    pooledMinutes,
    holders: [...holders.values()].sort((a, b) => b.minutes - a.minutes || a.staffId.localeCompare(b.staffId)),
    reconciles: split === totalMinutes,
  }
}

// ── The handler ──────────────────────────────────────────────────────────────

function handleProjects(ctx: Ctx): FakeResponse | null {
  const { method, path, body, actor } = ctx

  // ── Hotel timezone (9f066f8)
  if (path === '/v1/tenant') {
    const hotelRef = hotelFor(ctx)
    const tenant = tenants.find(t => t.hotelRef === hotelRef)
    if (!tenant) throw notFound('tenant not found')
    const model = () => ({ hotelRef: tenant.hotelRef, name: tenant.name, timezone: tenant.timezone, isActive: tenant.isActive, createdAt: tenant.createdAt })
    if (method === 'GET') return ok(model())
    if (method === 'PATCH') {
      requireAdminAt(ctx, hotelRef)
      if (body.timezone === undefined || body.timezone === null) throw badRequest('timezone is required')
      const timezone = asTrimmed(body.timezone)
      if (!timezone || timezone === 'Local') throw badRequest('timezone must be an IANA zone name, e.g. Asia/Jakarta')
      if (!isValidTimezone(timezone)) throw badRequest(`unknown timezone ${timezone}; use an IANA zone name, e.g. Asia/Jakarta`)
      tenant.timezone = timezone
      // Operating schedules and every active template's next run move to the
      // new zone; existing tasks keep their due dates.
      rescheduleTemplates(hotelRef)
      return ok(model())
    }
  }

  // ── Time attribution
  const attribution = /^\/v1\/tasks\/([^/]+)\/attribution$/.exec(path)
  if (method === 'GET' && attribution) {
    const hotelRef = hotelFor(ctx)
    if (!isUuid(attribution[1])) throw badRequest('id must be a valid UUID')
    const t = tasks.find(row => row.id === attribution[1]!.toLowerCase() && row.hotelRef === hotelRef)
    if (!t || !visibleTo(actor, hotelRef, t)) throw notFound('task')
    return ok(attributionFor(hotelRef, t))
  }

  // ── Checklist (2967e6d–b517e63). Staff only; 409 once the task is closed.
  if (method === 'POST' && path.startsWith('/v1/tasks/checklist')) {
    if (actor.isService) {
      throw forbidden(path === '/v1/tasks/checklist/done' ? 'ticking a step requires a staff identity' : path === '/v1/tasks/checklist/assign' ? 'assigning a step is human-only' : 'editing a checklist is human-only')
    }
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    if (!visibleTo(actor, hotelRef, t)) throw notFound('task')
    if (CLOSED_TASK_STATUSES.has(t.status)) throw conflict('task is closed')
    const isAssignee = activeAssignment(t.id)?.staffId === actor.staffId
    const isHelper = taskCollaborators.some(c => c.taskId === t.id && c.staffId === actor.staffId && c.isActive)
    const canEdit = roleAt(actor.staffId, hotelRef) === 'admin' || isDeptLeaderFor(actor, hotelRef, t) || isAssignee || managesProject(actor, t)
    const at = nowIso()
    const findItem = () => {
      const itemId = isUuid(body.itemId) ? body.itemId.toLowerCase() : null
      const item = itemId ? checklistItems.find(c => c.id === itemId && c.taskId === t.id) : undefined
      if (!item) throw notFound('checklist item')
      return item
    }
    if (path === '/v1/tasks/checklist/done') {
      const item = findItem()
      // Step assignee, task assignee, helpers, dept leader, admin, project manager.
      if (!(canEdit || isHelper || item.assignedStaffId === actor.staffId)) throw forbidden('not authorized to tick this checklist item')
      if (typeof body.isDone !== 'boolean') throw badRequest('invalid JSON body')
      if (body.note !== undefined && body.note !== null) {
        if (typeof body.note !== 'string' || body.note.length > 2000) throw badRequest('note must be at most 2000 characters')
      }
      item.isDone = body.isDone
      item.doneBy = body.isDone ? actor.staffId : null
      item.doneAt = body.isDone ? at : null
      // Absent keeps the note, null clears it; unticking keeps it.
      if (body.note !== undefined) item.note = body.note === null ? null : String(body.note).trim() || null
      item.updatedAt = at
      t.updatedAt = at
      return ok(checklistModel(item))
    }
    if (path === '/v1/tasks/checklist') {
      // Blank rows are dropped, not refused; the limits are counted after that.
      const labels = (Array.isArray(body.labels) ? body.labels.map(label => String(label ?? '').trim()) : [])
      if (labels.some(label => label.length > 200)) throw badRequest('checklist label must be at most 200 characters')
      const cleaned = labels.filter(Boolean)
      if (cleaned.length === 0) throw badRequest('at least one checklist label is required')
      if (cleaned.length > 50) throw badRequest('at most 50 checklist items can be added at once')
      if (!canEdit) throw forbidden('not authorized to edit this task\'s checklist')
      labels.length = 0
      labels.push(...cleaned)
      const last = checklistItems.filter(c => c.taskId === t.id).reduce((max, c) => Math.max(max, c.sort), -1)
      const created = labels.map((label, index) => {
        const item: ChecklistItem = { id: newId(), hotelRef, taskId: t.id, sort: last + 1 + index, label, isDone: false, doneBy: null, doneAt: null, assignedStaffId: null, assignedStaffName: null, assignedBy: null, assignedAt: null, note: null, createdAt: at, updatedAt: at }
        checklistItems.push(item)
        return checklistModel(item)
      })
      t.updatedAt = at
      return ok(created, 201)
    }
    if (path === '/v1/tasks/checklist/remove') {
      if (!canEdit) throw forbidden('not authorized to edit this task\'s checklist')
      const item = findItem()
      checklistItems.splice(checklistItems.indexOf(item), 1)
      t.updatedAt = at
      return ok({ removed: true })
    }
    if (path === '/v1/tasks/checklist/assign') {
      // Order: closed (above) → claimed → allowed → item → target.
      if (activeAssignment(t.id)?.kind !== 'STAFF') throw conflict('task is not claimed')
      if (!canEdit) throw forbidden('not authorized to assign steps on this task')
      const item = findItem()
      if (body.staffId === undefined || body.staffId === null || body.staffId === '') {
        item.assignedStaffId = null
        item.assignedBy = null
        item.assignedAt = null
      }
      else {
        if (!isUuid(body.staffId) || !staffInHotel(body.staffId.toLowerCase(), hotelRef)) throw notFound('staff')
        const staffId = body.staffId.toLowerCase()
        // Target must be in the task's department (any member if it has none).
        if (t.hotelDepartmentId && dbDept(staffId, hotelRef) !== t.hotelDepartmentId) throw badRequest('assignee must be in the task\'s department')
        item.assignedStaffId = staffId
        item.assignedBy = actor.staffId
        item.assignedAt = at
        ensureAutoMember(t, staffId, actor.staffId, at)
      }
      item.updatedAt = at
      t.updatedAt = at
      return ok(checklistModel(item))
    }
    throw new ApiError('NOT_FOUND', '404 page not found', true)
  }

  // ── Task templates (shared, admin-managed) and recurring tasks (personal)
  if (path === '/v1/task-templates' || path.startsWith('/v1/task-templates/')) {
    const hotelRef = hotelFor(ctx)
    const isAdmin = actor.isService || roleAt(actor.staffId, hotelRef) === 'admin'
    if (method === 'GET' && path === '/v1/task-templates') {
      const scope = ctx.query.scope ?? 'shared'
      if (!['shared', 'personal', 'all'].includes(scope)) throw badRequest('scope must be one of shared, personal, all')
      if (scope !== 'shared' && !isAdmin) throw forbidden('admin access required')
      const activeOnly = ctx.query.active === 'true'
      const rows = taskTemplates
        .filter(r => r.hotelRef === hotelRef && !r.isArchived)
        .filter(r => scope === 'all' || r.scope === scope)
        .filter(r => !activeOnly || r.isActive)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(templateModel)
      return ok(rows)
    }
    if (method === 'POST' && path === '/v1/task-templates') {
      if (!isAdmin) throw forbidden('admin access required')
      const name = asTrimmed(body.name)
      if (!name) throw badRequest('name is required')
      if (name.length > 120) throw badRequest('name must be at most 120 characters')
      const content = decodeTemplateContent(body.content)
      const recurrence = body.recurrence == null ? null : decodeRecurrence(body.recurrence)
      const isActive = body.isActive === undefined ? true : Boolean(body.isActive)
      if (isActive) previewTemplateContent(actor, hotelRef, content)
      if (taskTemplates.some(r => r.hotelRef === hotelRef && !r.isArchived && r.name.toLowerCase() === name.toLowerCase())) throw conflict('a task template with this name already exists')
      const at = nowIso()
      const row: TemplateRow = { id: newId(), hotelRef, name, isActive, scope: 'shared', content, recurrence, nextRunAt: isActive && recurrence ? nextRunAfter(recurrence, hotelTimezone(hotelRef), Date.now()) : null, lastRunAt: null, lastOccurrenceAt: null, lastTaskId: null, lastError: null, createdBy: actor.staffId, ownerStaffId: null, isArchived: false, createdAt: at, updatedAt: at }
      taskTemplates.push(row)
      return ok(templateModel(row), 201)
    }
    const match = /^\/v1\/task-templates\/([^/]+)$/.exec(path)
    if (!match) throw new ApiError('NOT_FOUND', '404 page not found', true)
    const row = isUuid(match[1]) ? taskTemplates.find(r => r.id === match[1]!.toLowerCase() && r.hotelRef === hotelRef && !r.isArchived) : undefined
    if (!row) throw notFound('task template')
    if (method === 'GET') return ok(templateModel(row))
    if (!isAdmin) throw forbidden('admin access required')
    if (method === 'PUT') {
      // Full replace; an admin may edit personal ones too. A personal
      // template is validated AS its owner and keeps its owner and its
      // task-derived name.
      const content = decodeTemplateContent(body.content)
      const recurrence = body.recurrence == null ? null : decodeRecurrence(body.recurrence)
      const isActive = body.isActive === undefined ? row.isActive : Boolean(body.isActive)
      let name = row.name
      if (row.ownerStaffId) {
        const owner = account(row.ownerStaffId)
        const ownerActor = owner ? staffActor(owner, null, hotelRef) : actor
        if (isActive) name = previewTemplateContent(ownerActor, hotelRef, content) || name
      }
      else {
        name = asTrimmed(body.name)
        if (!name) throw badRequest('name is required')
        if (name.length > 120) throw badRequest('name must be at most 120 characters')
        if (isActive) previewTemplateContent(actor, hotelRef, content)
        if (taskTemplates.some(r => r.id !== row.id && r.hotelRef === hotelRef && !r.isArchived && r.name.toLowerCase() === name.toLowerCase())) throw conflict('a task template with this name already exists')
      }
      Object.assign(row, { name, content, recurrence, isActive, updatedAt: nowIso() })
      if (isActive) row.lastError = null
      row.nextRunAt = isActive && recurrence ? nextRunAfter(recurrence, hotelTimezone(hotelRef), Date.now()) : null
      return ok(templateModel(row))
    }
    if (method === 'DELETE') {
      row.isArchived = true
      row.isActive = false
      row.updatedAt = nowIso()
      return noContent()
    }
  }

  if (path === '/v1/recurring-tasks' || path.startsWith('/v1/recurring-tasks/')) {
    const hotelRef = hotelFor(ctx)
    if (actor.isService || !actor.staffId) throw forbidden('recurring tasks belong to a staff member')
    const mine = (r: TemplateRow) => r.hotelRef === hotelRef && !r.isArchived && r.scope === 'personal' && r.ownerStaffId === actor.staffId
    if (method === 'GET' && path === '/v1/recurring-tasks') {
      return ok(taskTemplates.filter(mine).sort((a, b) => a.name.localeCompare(b.name)).map(templateModel))
    }
    if (method === 'POST' && path === '/v1/recurring-tasks') {
      if (actor.role === 'staff' && !actor.createTask) throw forbidden('forbidden')
      if (body.recurrence == null) throw badRequest('recurrence is required for a recurring task')
      const content = decodeTemplateContent(body.content)
      const recurrence = decodeRecurrence(body.recurrence)
      const isActive = body.isActive === undefined ? true : Boolean(body.isActive)
      // Validated AS the owner (plain staff may assign only themselves or
      // their own team); a personal template is named after its task.
      const name = (isActive ? previewTemplateContent(actor, hotelRef, content) : content.title) || 'Recurring task'
      const at = nowIso()
      const row: TemplateRow = { id: newId(), hotelRef, name: name.slice(0, 120), isActive, scope: 'personal', content, recurrence, nextRunAt: null, lastRunAt: null, lastOccurrenceAt: null, lastTaskId: null, lastError: null, createdBy: actor.staffId, ownerStaffId: actor.staffId, isArchived: false, createdAt: at, updatedAt: at }
      // The first task is made NOW; the schedule continues from here.
      const first = createTaskFromTemplate(row, actor, null, at)
      row.lastTaskId = first.id
      row.nextRunAt = isActive ? nextRunAfter(recurrence, hotelTimezone(hotelRef), Date.now()) : null
      taskTemplates.push(row)
      return ok({ template: templateModel(row), taskId: first.id }, 201)
    }
    const match = /^\/v1\/recurring-tasks\/([^/]+)$/.exec(path)
    if (!match) throw new ApiError('NOT_FOUND', '404 page not found', true)
    // Someone else's id gives 404.
    const row = isUuid(match[1]) ? taskTemplates.find(r => r.id === match[1]!.toLowerCase() && mine(r)) : undefined
    if (!row) throw notFound('recurring task')
    if (method === 'GET') return ok(templateModel(row))
    if (method === 'PUT') {
      if (body.recurrence == null) throw badRequest('recurrence is required for a recurring task')
      const content = decodeTemplateContent(body.content)
      const recurrence = decodeRecurrence(body.recurrence)
      const isActive = body.isActive === undefined ? row.isActive : Boolean(body.isActive)
      const name = isActive ? previewTemplateContent(actor, hotelRef, content) || row.name : row.name
      Object.assign(row, { name: name.slice(0, 120), content, recurrence, isActive, updatedAt: nowIso() })
      if (isActive) row.lastError = null
      row.nextRunAt = isActive ? nextRunAfter(recurrence, hotelTimezone(hotelRef), Date.now()) : null
      return ok(templateModel(row))
    }
    if (method === 'DELETE') {
      row.isArchived = true
      row.isActive = false
      row.updatedAt = nowIso()
      return noContent()
    }
  }

  // ── Projects (30e5aa1–fe5e99d). Staff only.
  if (path === '/v1/projects' || path.startsWith('/v1/projects/')) {
    const hotelRef = hotelFor(ctx)
    if (actor.isService || !actor.staffId) throw forbidden('projects require a staff identity')
    const role = roleAt(actor.staffId, hotelRef)
    const isAdmin = role === 'admin'
    const at = nowIso()

    if (method === 'GET' && path === '/v1/projects') {
      const status = (ctx.query.status || 'ACTIVE').toUpperCase()
      if (!PROJECT_STATUSES.includes(status as ProjectStatus)) throw badRequest('status must be ACTIVE, COMPLETED or CANCELLED')
      const rows = projects
        .filter(p => p.hotelRef === hotelRef && p.status === status)
        .filter(p => isAdmin || isProjectMember(p.id, actor.staffId))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => projectModel(p, actor, hotelRef))
      return ok(rows)
    }
    if (method === 'POST' && path === '/v1/projects') {
      if (!isAdmin && role !== 'leader') throw forbidden('only admins and leaders can create projects')
      const name = asTrimmed(body.name)
      if (!name || name.length > 120) throw badRequest('name is required (1-120 characters)')
      const startDate = asLocalDate(body.startDate, 'startDate')
      const endDate = asLocalDate(body.endDate, 'endDate')
      if (startDate && endDate && endDate < startDate) throw badRequest('endDate must not be before startDate')
      const members = Array.isArray(body.members) ? body.members as Array<Record<string, unknown>> : []
      const seen = new Set<Id>([actor.staffId!])
      for (const m of members) {
        if (m.level !== 'MEMBER' && m.level !== 'VIEWER') throw badRequest('member level must be MEMBER or VIEWER')
        const staffId = isUuid(m.staffId) ? m.staffId.toLowerCase() : ''
        if (!staffId || seen.has(staffId)) throw badRequest('members must be distinct and must not include the creator')
        seen.add(staffId)
        if (!staffInHotel(staffId, hotelRef)) throw unprocessable('staff member is not an active member of this property')
      }
      // Only ACTIVE projects hold a name; a completed one may be reused.
      if (activeProjectNameTaken(hotelRef, name)) throw conflict('an active project with this name already exists')
      const project: ProjectRow = { id: newId(), hotelRef, name, description: asNullableTrimmed(body.description), startDate, endDate, status: 'ACTIVE', completedAt: null, createdBy: actor.staffId, createdAt: at, updatedAt: at }
      projects.push(project)
      // The creator becomes the manager.
      projectMembers.push({ projectId: project.id, staffId: actor.staffId!, level: 'MANAGER', source: 'MANUAL', addedBy: actor.staffId, addedAt: at })
      for (const m of members) {
        projectMembers.push({ projectId: project.id, staffId: String(m.staffId).toLowerCase(), level: m.level as ProjectLevel, source: 'MANUAL', addedBy: actor.staffId, addedAt: at })
      }
      return ok(projectModel(project, actor, hotelRef), 201)
    }

    const match = /^\/v1\/projects\/([^/]+)(?:\/(board|members|manager|tasks|complete|cancel|reopen)(?:\/([^/]+))?)?$/.exec(path)
    if (!match) throw new ApiError('NOT_FOUND', '404 page not found', true)
    if (!isUuid(match[1])) throw badRequest('invalid id')
    const project = findVisibleProject(actor, hotelRef, match[1])
    const sub = match[2]
    const subId = match[3]
    const touch = () => { project.updatedAt = at }

    if (!sub) {
      if (method === 'GET') return ok(projectModel(project, actor, hotelRef))
      if (method === 'PATCH') {
        // Absent keeps, null clears (not name). Works on closed projects.
        requireProjectManagerOrAdmin(actor, hotelRef, project)
        if (body.name !== undefined) {
          if (body.name === null) throw badRequest('name cannot be cleared')
          const name = asTrimmed(body.name)
          if (!name || name.length > 120) throw badRequest('name is required (1-120 characters)')
          if (project.status === 'ACTIVE' && activeProjectNameTaken(hotelRef, name, project.id)) throw conflict('an active project with this name already exists')
          project.name = name
        }
        if (body.description !== undefined) project.description = body.description === null ? null : asNullableTrimmed(body.description)
        if (body.startDate !== undefined) project.startDate = body.startDate === null ? null : asLocalDate(body.startDate, 'startDate')
        if (body.endDate !== undefined) project.endDate = body.endDate === null ? null : asLocalDate(body.endDate, 'endDate')
        if (project.startDate && project.endDate && project.endDate < project.startDate) throw badRequest('endDate must not be before startDate')
        touch()
        return ok(projectModel(project, actor, hotelRef))
      }
    }

    if (method === 'POST' && (sub === 'complete' || sub === 'cancel' || sub === 'reopen') && !subId) {
      requireProjectManagerOrAdmin(actor, hotelRef, project)
      if (sub === 'complete') {
        if (project.status !== 'ACTIVE') throw conflict('only an active project can be completed or cancelled')
        // Allowed with open tasks; the response says how many so the screen can warn.
        const openTasks = tasks.filter(t => t.projectId === project.id && !CLOSED_TASK_STATUSES.has(t.status)).length
        project.status = 'COMPLETED'
        project.completedAt = at
        touch()
        return ok(projectModel(project, actor, hotelRef, { openTasks }))
      }
      if (sub === 'cancel') {
        if (project.status !== 'ACTIVE') throw conflict('only an active project can be completed or cancelled')
        project.status = 'CANCELLED'
        touch()
        return ok(projectModel(project, actor, hotelRef))
      }
      if (project.status === 'ACTIVE') throw conflict('project is already active')
      if (activeProjectNameTaken(hotelRef, project.name, project.id)) throw conflict('an active project with this name already exists')
      project.status = 'ACTIVE'
      project.completedAt = null
      touch()
      return ok(projectModel(project, actor, hotelRef))
    }

    if (method === 'GET' && sub === 'board' && !subId) {
      // Same Board shape as /v1/kanban-board; cards come from GET /v1/tasks?projectId=.
      const board = boards.find(b => b.hotelRef === hotelRef)
      if (!board) throw notFound('kanban board')
      const columns = boardColumns.filter(c => c.boardId === board.id && !c.isRemoved).sort((a, b) => a.columnSort - b.columnSort || a.id.localeCompare(b.id))
      return ok({ ...board, columns: nullIfEmpty(columns) })
    }

    if (sub === 'members') {
      const rows = () => projectMembers
        .filter(m => m.projectId === project.id)
        .map(projectMemberModel)
        .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId))
      if (method === 'GET' && !subId) return ok(rows())
      if ((method === 'PUT' || method === 'DELETE') && subId) {
        requireProjectManagerOrAdmin(actor, hotelRef, project)
        if (!isUuid(subId)) throw badRequest('invalid staffId')
        const staffId = subId.toLowerCase()
        if (project.status !== 'ACTIVE') throw unprocessable('project is closed; reopen it first')
        const existing = projectMembers.find(m => m.projectId === project.id && m.staffId === staffId)
        if (existing?.level === 'MANAGER') throw conflict(method === 'PUT' ? 'the project manager is changed by handing the project over' : 'the project manager cannot be removed; hand the project over first')
        if (method === 'PUT') {
          if (body.level !== 'MEMBER' && body.level !== 'VIEWER') throw badRequest('level must be MEMBER or VIEWER')
          if (!staffInHotel(staffId, hotelRef)) throw unprocessable('staff member is not an active member of this property')
          if (existing) {
            existing.level = body.level
            existing.source = 'MANUAL'
          }
          else {
            projectMembers.push({ projectId: project.id, staffId, level: body.level, source: 'MANUAL', addedBy: actor.staffId, addedAt: at })
          }
          touch()
          return ok(rows())
        }
        if (!existing) throw notFound('project member')
        projectMembers.splice(projectMembers.indexOf(existing), 1)
        touch()
        return ok(rows())
      }
    }

    if (method === 'POST' && sub === 'manager' && !subId) {
      requireProjectManagerOrAdmin(actor, hotelRef, project)
      if (!isUuid(body.staffId)) throw badRequest('staffId is required')
      const targetId = body.staffId.toLowerCase()
      const target = projectMembers.find(m => m.projectId === project.id && m.staffId === targetId)
      if (!target) throw unprocessable('the new project manager must already be a project member')
      // The old manager becomes a MEMBER.
      for (const m of projectMembers) if (m.projectId === project.id && m.level === 'MANAGER') m.level = 'MEMBER'
      target.level = 'MANAGER'
      touch()
      return ok(projectModel(project, actor, hotelRef))
    }

    if (sub === 'tasks') {
      const isManager = projectMembers.some(m => m.projectId === project.id && m.staffId === actor.staffId && m.level === 'MANAGER')
      if (method === 'POST' && !subId) {
        // Manager, admin, or a member with create-task; the ordinary pipeline.
        const level = projectMembers.find(m => m.projectId === project.id && m.staffId === actor.staffId)?.level ?? null
        if (level === 'VIEWER' && !isAdmin) throw forbidden('viewers cannot add tasks to a project')
        const mayCreate = isAdmin || isManager || (level === 'MEMBER' && (actor.role !== 'staff' || actor.createTask))
        if (!mayCreate) throw forbidden('forbidden')
        if (project.status !== 'ACTIVE') throw unprocessable('project is closed; reopen it first')
        const assignee = validateAssignAtCreation(actor, hotelRef, body.assignee as AssigneeInput | null | undefined)
        const resolved = resolveTask(hotelRef, decodeStaffCreateRequest(ctx, 'staff'))
        const t = resolved.task
        t.projectId = project.id
        tasks.push(t)
        resolved.checklistLabels.forEach((label, index) => {
          checklistItems.push({ id: newId(), hotelRef, taskId: t.id, sort: index, label, isDone: false, doneBy: null, doneAt: null, assignedStaffId: null, assignedStaffName: null, assignedBy: null, assignedAt: null, note: null, createdAt: t.createdAt, updatedAt: t.createdAt })
        })
        pushHistory(t, actor.staffId, 'NEW', null, t.createdAt)
        if (assignee?.kind === 'STAFF') assignStaffToTask(actor, t, assignee.staffId, null, actor.staffId, t.createdAt)
        else if (assignee?.kind === 'TEAM') taskAssignments.push({ id: newId(), taskId: t.id, kind: 'TEAM', staffId: null, teamId: assignee.teamId, hotelDepartmentId: null, assignedBy: actor.staffId, actingUser: null, remark: null, isActive: true, createdAt: t.createdAt })
        touch()
        return ok(taskListItem(t), 201, { warnings: resolved.warnings })
      }
      if ((method === 'PUT' || method === 'DELETE') && subId) {
        if (!isUuid(subId)) throw badRequest('invalid taskId')
        const canManage = isAdmin || isManager
        if (method === 'PUT') {
          if (!canManage) throw forbidden('only the project manager or an admin can add existing tasks')
          if (project.status !== 'ACTIVE') throw unprocessable('project is closed; reopen it first')
          const t = findHotelTask(hotelRef, subId)
          if (t.sourceChannel !== 'staff') throw unprocessable('only staff-created tasks can join a project; guest requests stay on the hotel board')
          if (t.projectId === project.id) return ok(taskListItem(t))
          if (t.projectId) throw conflict(`task is already in project "${projects.find(p => p.id === t.projectId)?.name ?? ''}"; remove it there first`)
          t.projectId = project.id
          t.updatedAt = at
          const holder = activeAssignment(t.id)
          if (holder?.kind === 'STAFF' && holder.staffId) ensureAutoMember(t, holder.staffId, actor.staffId, at)
          touch()
          return ok(taskListItem(t))
        }
        if (!canManage) throw forbidden('only the project manager or an admin can remove tasks')
        const t = tasks.find(row => row.id === subId.toLowerCase() && row.hotelRef === hotelRef)
        if (!t || t.projectId !== project.id) throw notFound('task is not in this project')
        // Back to the hotel board.
        t.projectId = null
        t.updatedAt = at
        touch()
        return ok(taskListItem(t))
      }
    }
    throw new ApiError('NOT_FOUND', '404 page not found', true)
  }

  return null
}

// ════════════════════════ The mux ════════════════════════

const RAW_ROUTES = new Set([
  'POST /v1/auth/staff/login',
  'GET /v1/auth/google/url',
  'GET /v1/auth/google/callback',
  'POST /v1/auth/magic-link/request',
  'GET /v1/auth/magic-link/verify',
])

/**
 * Handle one request against the mock API. Success returns {status, body};
 * failures throw ApiError (whose .plain flag marks the mux-level text 404/405
 * that bypass the envelope in the real server).
 */
export function handleFakeApiRequest(path: string, opts: RequestOpts = {}): FakeResponse {
  const method = (opts.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(opts.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value
  }
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') query[key] = String(value)
  }
  const body = opts.body ?? {}

  if (method === 'GET' && path === '/healthz') {
    return ok({ status: 'ok' })
  }

  // The one serviceAuth-only mount left: no Actor, a different 401 message.
  // (POST /v1/departments moved onto the EitherAuth mux with department CRUD.)
  if (method === 'POST' && path === '/v1/tenants') {
    const authorization = headers.authorization
    const match = authorization ? /^Bearer (.+)$/.exec(authorization) : null
    if (!match || !match[1]) throw unauthorized('missing bearer token')
    if (!match[1].startsWith('service:')) throw unauthorized('invalid service token')
    return provisionTenant(body)
  }

  // The sign-in routes mount RAW — no EitherAuth, no CSRF — since a request
  // that has no credential yet is their entire point.
  const needsActor = !RAW_ROUTES.has(`${method} ${path}`)
  const actor: Actor = needsActor
    ? resolveActor(headers)
    : { isService: false, actingUser: '', staffId: null, role: 'staff', deptId: null, createTask: false, hotels: [], memberships: [], partnerId: null, partnerName: '', partnerCapabilities: [], isOperator: false, sessionId: null, csrfToken: '' }

  const ctx: Ctx = { method, path, body, headers, query, actor }
  if (needsActor) surfaceGate(ctx)
  if (needsActor) checkCsrf(ctx)

  // The workers, run lazily: due templates create their tasks and due
  // escalation steps apply before any read that could show them (the
  // combined runner in cmd/worker, in effect).
  if (needsActor) {
    runDueTemplates()
    runDueEscalations()
  }

  const response = handleAuthAndStaff(ctx)
    ?? handlePlatform(ctx)
    ?? handleConfig(ctx)
    ?? handleProjects(ctx)
    ?? handleTasks(ctx)
  if (response) return response

  // Unknown path / method: the real mux answers in plain text, no envelope.
  throw new ApiError('NOT_FOUND', '404 page not found', true)
}

// ════════════════════════ Demo helpers (mock-only) ════════════════════════

export interface DemoLogin {
  email: string
  password: string
  name: string
  role: StaffRole
  isOperator: boolean
}

/** The login screen's demo account list — a mock convenience, not an endpoint. */
export function demoLogins(): DemoLogin[] {
  return staffAccounts
    .filter(s => s.isActive && ['staff@aston.example', 'leader@aston.example', 'admin@aston.example', 'operator@sentineltech.example', 'regional@aston.example'].includes(s.email))
    .map(s => ({ email: s.email, password: s.password, name: s.name, role: staffHotels.find(r => r.staffId === s.id)?.role ?? (s.isOperator ? 'admin' : 'staff'), isOperator: s.isOperator }))
}

/** Hotel names for pickers — resolved locally, since /v1/platform/tenants is operator-only. */
export function demoHotelName(hotelRef: Id): string {
  return tenants.find(t => t.hotelRef === hotelRef)?.name ?? hotelRef
}

/**
 * Test seam for the schedule arithmetic, resolved the way the service does
 * (department schedule → tenant default → always-open). Lets the specs pin
 * the round-trip property between the due-date walk and its inverse without
 * waiting for a real clock.
 */
export function demoSlamath(hotelRef: Id, hotelDepartmentId: Id | null) {
  const schedule = scheduleFor(hotelRef, hotelDepartmentId)
  return {
    advance: (startIso: string, minutes: number) => advanceAcrossSchedule(hotelRef, schedule, startIso, minutes),
    elapsed: (fromIso: string, toIso: string) => elapsedScheduleMinutes(hotelRef, schedule, fromIso, toIso),
  }
}

/** The mock's CORS_ALLOWED_ORIGINS — what a returnTo must sit on. */
export function demoAllowedOrigins(): string[] {
  return [...ALLOWED_ORIGINS]
}

/**
 * Recognise the mock's Google consent URL (from GET /v1/auth/google/url) and
 * hand back what the login screen needs to play Google: the state to echo and
 * the identities to offer. Null for any other URL — a real one is navigated to.
 */
export function demoGoogleConsent(url: string): { state: string, redirectUri: string, identities: DemoGoogleIdentity[] } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return null
  }
  if (parsed.origin !== MOCK_GOOGLE_AUTH_ORIGIN) return null
  const state = parsed.searchParams.get('state') ?? ''
  const redirectUri = parsed.searchParams.get('redirect_uri') ?? `${API_BASE_URL}/v1/auth/google/callback`
  const identities = [
    ...demoLogins().map(d => ({ email: d.email, name: d.name, emailVerified: true, hasAccount: true })),
    ...OUTSIDER_IDENTITIES,
  ]
  return { state, redirectUri, identities }
}

/**
 * What the mock's Google does when an account is picked (or the consent
 * screen is cancelled): the callback URL it would send the browser to.
 */
export function demoGoogleCallbackUrl(consent: { state: string, redirectUri: string }, choice: { email: string } | 'cancel'): string {
  const url = new URL(consent.redirectUri)
  url.searchParams.set('state', consent.state)
  if (choice === 'cancel') url.searchParams.set('error', 'access_denied')
  else url.searchParams.set('code', googleCodeFor(choice.email))
  return url.toString()
}

/** The dev-console outbox, newest first — optionally for one address. */
export function demoOutbox(to?: string): DemoMail[] {
  const email = to?.trim().toLowerCase()
  return mailOutbox.filter(m => !email || m.to === email)
}

/**
 * Follow a link into the API as a browser would (the emailed sign-in link, or
 * the mock Google's callback): the 302's Location, plus the session id its
 * Set-Cookie carried on success. The client adopts that id where the cookie
 * seam already lives and then recovers identity + CSRF from
 * GET /v1/auth/session — exactly what the real app does after the redirect.
 */
export function demoFollowApiLink(url: string): { location: string, sessionCookie: string | null } {
  const parsed = new URL(url)
  const query = Object.fromEntries(parsed.searchParams.entries())
  const res = handleFakeApiRequest(parsed.pathname, { query })
  if (res.status !== 302 || !res.headers) throw new Error(`expected a redirect from ${parsed.pathname}, got ${res.status}`)
  const cookie = res.headers['set-cookie']
  return { location: res.headers.location, sessionCookie: cookie ? parseCookie(cookie, 'st_session') : null }
}
