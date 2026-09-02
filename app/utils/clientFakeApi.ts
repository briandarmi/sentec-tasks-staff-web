/**
 * In-browser mock of the REAL Sentec Tasks API (sentec-tasks-api @ 0c8e1bd).
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

/** Master (Sentinel-curated) department vocabulary — global, not hotel-scoped. */
export interface MasterDepartment {
  id: Id
  name: string
  isActive: boolean
}

/** A master department enabled for one hotel. Tasks reference THESE ids. */
export interface HotelDepartment {
  id: Id
  hotelRef: Id
  departmentId: Id
  departmentName: string
  isActive: boolean
}

export interface StaffAccount {
  id: Id
  email: string
  /** One display-name field — the real staff table has no first/last split. */
  name: string
  role: StaffRole
  isActive: boolean
  hotelDepartmentId: Id | null
  createTask: boolean
  isOperator: boolean
}

/** The Staff read model every staff-surface response uses (never a hash). */
export interface Staff extends StaffAccount {
  hotels: Id[]
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

export interface Partner {
  id: Id
  name: string
  isActive: boolean
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
  guestRef: Id | null
  guestName: string | null
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
  createdAt: string
  updatedAt: string
}

export interface TaskListItem extends Task {
  department: { id: Id, name: string, isActive: boolean } | null
  column: { id: Id, name: string, columnSort: number } | null
  sla: { id: Id, name: string } | null
  assignment: AssignmentRef | null
}

export interface TaskDetail extends TaskListItem {
  slaFull: Sla | null
  history: TaskHistory[] | null
  comments: TaskComment[] | null
  attachments: TaskAttachment[] | null
  collaborators: Collaborator[] | null
  proofRequirements: { minProofPhotos: number, requiresCompletionNote: boolean }
  pendingOffer: { id: Id, toStaffId: Id, toStaffName: string | null, note: string | null, createdAt: string } | null
}

export interface ApiErrorBody { code: string, message: string }

export interface Envelope<T = unknown> {
  version: 'v1'
  data: T
  meta?: Record<string, unknown> | null
  errors?: ApiErrorBody[]
}

/** Transport result: status + enveloped body (null only for 204). */
export interface FakeResponse<T = unknown> {
  status: number
  body: Envelope<T> | null
}

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
  masterDept: { housekeeping: uid('a3', 1), maintenance: uid('a3', 2), frontOffice: uid('a3', 3), fnb: uid('a3', 4) },
  dept: {
    smtpHousekeeping: uid('a4', 1),
    smtpMaintenance: uid('a4', 2),
    smtpFrontOffice: uid('a4', 3),
    smtpFnb: uid('a4', 4),
    kngnHousekeeping: uid('a4', 5),
    kngnMaintenance: uid('a4', 6),
    faveHousekeeping: uid('a4', 7),
    faveFrontOffice: uid('a4', 8),
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
  },
  guest: { amelia: uid('c2', 1), marcus: uid('c2', 2) },
  offer: { filterToMade: uid('c3', 1) },
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
  { id: IDS.masterDept.housekeeping, name: 'Housekeeping', isActive: true },
  { id: IDS.masterDept.maintenance, name: 'Maintenance', isActive: true },
  { id: IDS.masterDept.frontOffice, name: 'Front Office', isActive: true },
  { id: IDS.masterDept.fnb, name: 'Food & Beverage', isActive: true },
]

const hotelDepartments: HotelDepartment[] = [
  { id: IDS.dept.smtpHousekeeping, hotelRef: IDS.hotel.simatupang, departmentId: IDS.masterDept.housekeeping, departmentName: 'Housekeeping', isActive: true },
  { id: IDS.dept.smtpMaintenance, hotelRef: IDS.hotel.simatupang, departmentId: IDS.masterDept.maintenance, departmentName: 'Maintenance', isActive: true },
  { id: IDS.dept.smtpFrontOffice, hotelRef: IDS.hotel.simatupang, departmentId: IDS.masterDept.frontOffice, departmentName: 'Front Office', isActive: true },
  { id: IDS.dept.smtpFnb, hotelRef: IDS.hotel.simatupang, departmentId: IDS.masterDept.fnb, departmentName: 'Food & Beverage', isActive: true },
  { id: IDS.dept.kngnHousekeeping, hotelRef: IDS.hotel.kuningan, departmentId: IDS.masterDept.housekeeping, departmentName: 'Housekeeping', isActive: true },
  { id: IDS.dept.kngnMaintenance, hotelRef: IDS.hotel.kuningan, departmentId: IDS.masterDept.maintenance, departmentName: 'Maintenance', isActive: true },
  { id: IDS.dept.faveHousekeeping, hotelRef: IDS.hotel.fave, departmentId: IDS.masterDept.housekeeping, departmentName: 'Housekeeping', isActive: true },
  { id: IDS.dept.faveFrontOffice, hotelRef: IDS.hotel.fave, departmentId: IDS.masterDept.frontOffice, departmentName: 'Front Office', isActive: true },
]

interface SeedAccount extends StaffAccount { password: string }

const staffAccounts: SeedAccount[] = [
  { id: IDS.staff.budi, email: 'staff@aston.example', name: 'Budi Santoso', role: 'staff', isActive: true, hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: true, isOperator: false, password: 'staff123' },
  { id: IDS.staff.sari, email: 'leader@aston.example', name: 'Sari Dewi', role: 'leader', isActive: true, hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: true, isOperator: false, password: 'leader123' },
  { id: IDS.staff.agus, email: 'admin@aston.example', name: 'Agus Wijaya', role: 'admin', isActive: true, hotelDepartmentId: null, createTask: true, isOperator: false, password: 'admin123' },
  // A platform operator has ZERO staff_hotel rows: hotel-scoped routes refuse
  // them (auth.HotelFor requires membership for humans) — platform-only actor.
  { id: IDS.staff.operator, email: 'operator@sentineltech.example', name: 'Platform Operator', role: 'admin', isActive: true, hotelDepartmentId: null, createTask: false, isOperator: true, password: 'operator123' },
  { id: IDS.staff.rina, email: 'regional@aston.example', name: 'Rina Hartono', role: 'admin', isActive: true, hotelDepartmentId: null, createTask: true, isOperator: false, password: 'regional123' },
  { id: IDS.staff.made, email: 'made@aston.example', name: 'Made Putra', role: 'staff', isActive: true, hotelDepartmentId: IDS.dept.smtpHousekeeping, createTask: false, isOperator: false, password: 'made12345' },
  { id: IDS.staff.joko, email: 'joko@aston.example', name: 'Joko Susilo', role: 'staff', isActive: true, hotelDepartmentId: IDS.dept.smtpMaintenance, createTask: true, isOperator: false, password: 'joko12345' },
  { id: IDS.staff.nur, email: 'nur@fave.example', name: 'Nur Aini', role: 'staff', isActive: true, hotelDepartmentId: IDS.dept.faveHousekeeping, createTask: true, isOperator: false, password: 'nur1234567' },
]

/** staff_hotel rows: direct hotel access (group grants expand on top). */
const staffHotels: Array<{ staffId: Id, hotelRef: Id }> = [
  { staffId: IDS.staff.budi, hotelRef: IDS.hotel.simatupang },
  { staffId: IDS.staff.budi, hotelRef: IDS.hotel.kuningan },
  { staffId: IDS.staff.sari, hotelRef: IDS.hotel.simatupang },
  { staffId: IDS.staff.agus, hotelRef: IDS.hotel.simatupang },
  { staffId: IDS.staff.rina, hotelRef: IDS.hotel.kuningan },
  { staffId: IDS.staff.made, hotelRef: IDS.hotel.simatupang },
  { staffId: IDS.staff.joko, hotelRef: IDS.hotel.simatupang },
  { staffId: IDS.staff.nur, hotelRef: IDS.hotel.fave },
]

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
  { id: IDS.sla.smtpStandard, hotelRef: IDS.hotel.simatupang, name: 'Standard', responseTime: 15, resolutionTime: 45, isDefault: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.sla.smtpUrgent, hotelRef: IDS.hotel.simatupang, name: 'Urgent', responseTime: 5, resolutionTime: 20, isDefault: false, createdAt: SEED, updatedAt: SEED },
  { id: IDS.sla.smtpScheduled, hotelRef: IDS.hotel.simatupang, name: 'Scheduled', responseTime: 120, resolutionTime: 480, isDefault: false, createdAt: SEED, updatedAt: SEED },
  { id: IDS.sla.kngnStandard, hotelRef: IDS.hotel.kuningan, name: 'Standard', responseTime: 20, resolutionTime: 60, isDefault: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.sla.faveStandard, hotelRef: IDS.hotel.fave, name: 'Standard', responseTime: 30, resolutionTime: 90, isDefault: true, createdAt: SEED, updatedAt: SEED },
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

const TERMINOLOGY_DEFAULT_PROFILE: Record<string, string> = {
  requester: 'Requester',
  visit: 'Visit',
  location: 'Location',
  department: 'Department',
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
  { id: IDS.partner.butler, name: 'Sentec Butler', isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.partner.pms, name: 'Sentec PMS', isActive: true, createdAt: SEED, updatedAt: SEED },
  { id: IDS.partner.ems, name: 'Sentec EMS', isActive: false, createdAt: SEED, updatedAt: SEED },
]

/**
 * The PMS seam: current visit by (hotel, location code). `found:false` rooms
 * are simply absent. Codes in ERROR_CODES throw, exercising the
 * "requester lookup failed: …" warning path without taking PMS down globally.
 */
const pmsVisits = new Map<string, { guestRef: Id, guestName: string, visitRef: string }>([
  [`${IDS.hotel.simatupang}|1204`, { guestRef: IDS.guest.amelia, guestName: 'Amelia Chen', visitRef: 'V-88121' }],
  [`${IDS.hotel.simatupang}|0908`, { guestRef: IDS.guest.marcus, guestName: 'Marcus Reid', visitRef: 'V-88104' }],
])
const PMS_ERROR_CODES = new Set(['PMS-DOWN'])

const routingRules: RoutingRule[] = [
  { id: IDS.rule.acFault, hotelRef: IDS.hotel.simatupang, itemRef: IDS.item.acFault, categoryId: null, locationTypeId: null, priority: null, specificity: 4, hotelDepartmentId: IDS.dept.smtpMaintenance, slaId: IDS.sla.smtpUrgent, remark: 'AC faults are urgent', createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.hk, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.hk, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpHousekeeping, slaId: IDS.sla.smtpStandard, remark: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.mnt, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.mnt, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpMaintenance, slaId: IDS.sla.smtpStandard, remark: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.concierge, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.concierge, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpFrontOffice, slaId: IDS.sla.smtpStandard, remark: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.fnb, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: IDS.category.fnb, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.smtpFnb, slaId: IDS.sla.smtpStandard, remark: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.publicArea, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: null, locationTypeId: IDS.locationType.publicArea, priority: null, specificity: 2, hotelDepartmentId: IDS.dept.smtpFrontOffice, slaId: IDS.sla.smtpStandard, remark: 'Public areas are Front Office ground', createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.urgent, hotelRef: IDS.hotel.simatupang, itemRef: null, categoryId: null, locationTypeId: null, priority: 'URGENT', specificity: 1, hotelDepartmentId: IDS.dept.smtpMaintenance, slaId: IDS.sla.smtpUrgent, remark: 'Unrouted urgent work goes to Maintenance', createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.faveHk, hotelRef: IDS.hotel.fave, itemRef: null, categoryId: IDS.category.faveHk, locationTypeId: null, priority: null, specificity: 3, hotelDepartmentId: IDS.dept.faveHousekeeping, slaId: IDS.sla.faveStandard, remark: null, createdAt: SEED, updatedAt: SEED },
  { id: IDS.rule.faveCatchAll, hotelRef: IDS.hotel.fave, itemRef: null, categoryId: null, locationTypeId: null, priority: null, specificity: 0, hotelDepartmentId: IDS.dept.faveHousekeeping, slaId: IDS.sla.faveStandard, remark: 'Catch-all', createdAt: SEED, updatedAt: SEED },
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

// ════════════════════════ Actor resolution (EitherAuth) ════════════════════════

export interface Actor {
  isService: boolean
  actingUser: string
  staffId: Id | null
  role: StaffRole
  deptId: Id | null
  createTask: boolean
  hotels: Id[]
  partnerId: Id | null
  partnerName: string
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

function staffActor(acct: SeedAccount, session: Session | null): Actor {
  return {
    isService: false,
    actingUser: '',
    staffId: acct.id,
    role: acct.role,
    deptId: acct.hotelDepartmentId,
    createTask: acct.createTask,
    hotels: hotelsClaim(acct.id),
    partnerId: null,
    partnerName: '',
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
      return { isService: true, actingUser: headers['x-acting-user'] ?? '', staffId: null, role: 'admin', deptId: null, createTask: false, hotels: [], partnerId: null, partnerName: '', isOperator: false, sessionId: null, csrfToken: '' }
    }
    if (token.startsWith('partner:')) {
      const partner = partners.find(p => p.id === token.slice('partner:'.length))
      // A deactivated partner fails verification instantly — no caching.
      if (!partner || !partner.isActive) throw unauthorized('invalid token')
      return { isService: true, actingUser: headers['x-acting-user'] ?? '', staffId: null, role: 'admin', deptId: null, createTask: false, hotels: [], partnerId: partner.id, partnerName: partner.name, isOperator: false, sessionId: null, csrfToken: '' }
    }
    const bearer = staffBearerTokens.get(token)
    if (!bearer || bearer.expiresAt < Date.now()) throw unauthorized('invalid token')
    const acct = account(bearer.staffId)
    if (!acct || !acct.isActive) throw unauthorized('invalid token')
    return staffActor(acct, null)
  }

  const sessionId = parseCookie(headers.cookie, 'st_session')
  const session = sessionId ? sessions.get(sessionId) : undefined
  if (!session || session.expiresAt < Date.now()) throw unauthorized('invalid token')
  const acct = account(session.staffId)
  if (!acct || !acct.isActive) throw unauthorized('invalid token')
  return staffActor(acct, session)
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

function requireAdmin(ctx: Ctx) {
  if (ctx.actor.role !== 'admin') throw forbidden('admin access required')
}

function requireOperator(ctx: Ctx) {
  if (!ctx.actor.isOperator) throw forbidden('operator access required')
}

/** DB-truth department for (staff, hotel) — never the token's deptId claim. */
function dbDept(staffId: Id | null, hotelRef: Id): Id | null {
  const acct = account(staffId)
  if (!acct?.hotelDepartmentId) return null
  const dept = hotelDepartments.find(d => d.id === acct.hotelDepartmentId)
  return dept && dept.hotelRef === hotelRef ? dept.id : null
}

// ════════════════════════ SLA math (slamath) ════════════════════════

/** Fixed offsets for the demo timezones; unknown zones fall back to UTC. */
const TIMEZONE_OFFSET_MINUTES: Record<string, number> = {
  'Asia/Jakarta': 420,
  'Asia/Makassar': 480,
}

function hotelOffsetMinutes(hotelRef: Id): number {
  const timezone = tenants.find(t => t.hotelRef === hotelRef)?.timezone ?? ''
  return TIMEZONE_OFFSET_MINUTES[timezone] ?? 0
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
  return {
    ...t,
    department: dept ? { id: dept.id, name: dept.departmentName, isActive: dept.isActive } : null,
    column: column ? { id: column.id, name: column.name, columnSort: column.columnSort } : null,
    sla: sla ? { id: sla.id, name: sla.name } : null,
    assignment: assignmentRef(t.id),
  }
}

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
    proofRequirements: {
      minProofPhotos: item?.minProofPhotos ?? 0,
      requiresCompletionNote: item?.requiresCompletionNote ?? false,
    },
    pendingOffer: pending
      ? { id: pending.id, toStaffId: pending.toStaff, toStaffName: account(pending.toStaff)?.name ?? null, note: pending.note, createdAt: pending.createdAt }
      : null,
  }
}

/** [DR-15]: scoped staff := human, non-partner, role "staff". */
const isScopedStaffActor = (actor: Actor) => !actor.isService && actor.partnerId === null && actor.role === 'staff'

/**
 * One visibility predicate for List AND Detail — never two implementations.
 * An ACTIVE helper row admits the helper too: Task 6 gives helpers working
 * permissions (attachments, submit), which presumes they can open the task.
 */
function visibleTo(actor: Actor, hotelRef: Id, t: Task): boolean {
  if (!isScopedStaffActor(actor)) return true
  const assignment = activeAssignment(t.id)
  if (assignment?.staffId === actor.staffId) return true
  if (taskCollaborators.some(c => c.taskId === t.id && c.staffId === actor.staffId && c.isActive)) return true
  const dept = dbDept(actor.staffId, hotelRef)
  // "Unclaimed" means no active STAFF assignment — a TEAM/DEPARTMENT pool row
  // still counts as unclaimed, or members could never see the pool they claim from.
  if (dept) return (assignment === null || assignment.kind !== 'STAFF') && t.hotelDepartmentId === dept
  return false
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
 * computeSlaUpdates — the four [DR-4] rules, applied on EVERY transition:
 * (a) leaving IN_PROGRESS accumulates resolutionDuration from the latest
 *     IN_PROGRESS history row; (b) first entry into IN_PROGRESS stamps
 *     responseDuration + verdict, once; (c) every entry into IN_PROGRESS
 *     resets the resolution verdict; (d) the resolution verdict stamps on
 *     entering SUBMITTED unconditionally, or on entering FINISHED not-from-
 *     SUBMITTED while still EMPTY — review latency is never billed to staff.
 */
function computeSlaUpdates(t: Task, oldStatus: TaskStatus, newStatus: TaskStatus, at: string) {
  if (oldStatus === 'IN_PROGRESS' && newStatus !== 'IN_PROGRESS') {
    const latest = [...taskHistory]
      .filter(h => h.taskId === t.id && h.status === 'IN_PROGRESS')
      .sort((a, b) => b.seq - a.seq)[0]
    if (latest) t.resolutionDuration = (t.resolutionDuration ?? 0) + elapsedMinutes(latest.createdAt, at)
  }
  if (newStatus === 'IN_PROGRESS' && oldStatus !== 'IN_PROGRESS') {
    if (t.responseSlaStatus === 'EMPTY') {
      t.responseDuration = elapsedMinutes(t.activationDate, at)
      t.responseSlaStatus = computeSlaStatusAt(at, t.responseDueAt)
    }
    t.resolutionSlaStatus = 'EMPTY'
  }
  if (newStatus === 'SUBMITTED') {
    t.resolutionSlaStatus = computeSlaStatusAt(at, t.resolutionDueAt)
  }
  else if (newStatus === 'FINISHED' && oldStatus !== 'SUBMITTED' && t.resolutionSlaStatus === 'EMPTY') {
    t.resolutionSlaStatus = computeSlaStatusAt(at, t.resolutionDueAt)
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
  guestRef?: Id | null
  guestName?: string | null
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
    guestRef: config.guestRef ?? null,
    guestName: config.guestName ?? null,
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
    guestRef: IDS.guest.amelia, guestName: 'Amelia Chen', visitRef: 'V-88121', quantity: 2,
    locationId: IDS.location.room1204, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T02:52:00.000Z',
  })
  taskContextEntries.push({ id: newId(), hotelRef: H, taskId: IDS.task.towels1204, sourceAppCode: 'sentec-butler', label: 'Butler request', value: 'BTLR-88412', url: null, sort: 0 })

  // Urgent AC fault against Engineering's operating hours (09:15 WIB, open).
  seedTaskRow({
    id: IDS.task.acFault0908, hotelRef: H, status: 'NEW', title: 'Air conditioner not cooling', description: 'Guest reports the room is very warm',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.acFault,
    guestRef: IDS.guest.marcus, guestName: 'Marcus Reid', visitRef: 'V-88104',
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
    checklistItems.push({ id: newId(), hotelRef: H, taskId: IDS.task.cleaning1102, sort: index, label, isDone: false, doneBy: null, doneAt: null, createdAt: '2026-08-25T02:30:00.000Z', updatedAt: '2026-08-25T02:30:00.000Z' })
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

  // Parked: accumulated 30 IN_PROGRESS minutes, verdict still EMPTY.
  seedTaskRow({
    id: IDS.task.transferHold, hotelRef: H, status: 'PENDING', title: 'Airport transfer', description: 'Guest to confirm flight time',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.transfer,
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpFrontOffice,
    activationDate: '2026-08-25T00:30:00.000Z', responseDuration: 11, responseSlaStatus: 'ON_TIME', resolutionDuration: 30,
  })
  seedAssignmentRow(IDS.task.transferHold, 'STAFF', { staffId: IDS.staff.sari }, IDS.staff.agus, 'Covering Front Office tonight', true, '2026-08-25T00:39:00.000Z')
  seedHistoryRow(IDS.task.transferHold, IDS.staff.sari, 'IN_PROGRESS', null, '2026-08-25T00:41:00.000Z')
  seedHistoryRow(IDS.task.transferHold, IDS.staff.sari, 'PENDING', 'Guest to confirm flight time', '2026-08-25T01:11:00.000Z')

  // Finished directly (no proof gates on this item), verdict ON_TIME.
  seedTaskRow({
    id: IDS.task.towelsDone, hotelRef: H, status: 'FINISHED', title: 'Extra towels',
    sourceProduct: 'sentec-butler', sourceChannel: 'guest', itemRef: IDS.item.towels, roomNumber: '1015', quantity: 1,
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-24T23:00:00.000Z', responseDuration: 4, resolutionDuration: 22,
    responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.towelsDone, 'STAFF', { staffId: IDS.staff.budi }, IDS.staff.budi, null, true, '2026-08-24T23:04:00.000Z')
  seedHistoryRow(IDS.task.towelsDone, IDS.staff.budi, 'IN_PROGRESS', null, '2026-08-24T23:04:00.000Z')
  seedHistoryRow(IDS.task.towelsDone, IDS.staff.budi, 'FINISHED', null, '2026-08-24T23:26:00.000Z')

  // PMS-dispatched, worked by Maintenance, verified by a leader.
  seedTaskRow({
    id: IDS.task.plumbingVerified, hotelRef: H, status: 'VERIFIED', title: 'Plumbing / leak', description: 'Slow drain reported by the PMS housekeeping sweep',
    sourceProduct: 'sentec-pms', sourceChannel: 'admin', itemRef: IDS.item.plumbing, roomNumber: '0402',
    slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpMaintenance,
    activationDate: '2026-08-24T18:00:00.000Z', responseDuration: 38, resolutionDuration: 58,
    responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME',
  })
  seedAssignmentRow(IDS.task.plumbingVerified, 'STAFF', { staffId: IDS.staff.joko }, null, null, true, '2026-08-24T18:30:00.000Z')
  seedHistoryRow(IDS.task.plumbingVerified, IDS.staff.joko, 'IN_PROGRESS', null, '2026-08-24T18:38:00.000Z')
  seedHistoryRow(IDS.task.plumbingVerified, IDS.staff.joko, 'FINISHED', null, '2026-08-24T19:36:00.000Z')
  seedHistoryRow(IDS.task.plumbingVerified, IDS.staff.sari, 'VERIFIED', null, '2026-08-24T21:14:00.000Z')
  taskAttachments.push({ id: newId(), hotelRef: H, taskId: IDS.task.plumbingVerified, staffId: null, filetype: 'PDF', filepath: 'https://cdn.sentec-pms.example/workorders/WO-2214.pdf', isRemoved: false, createdAt: '2026-08-24T18:05:00.000Z' })
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
    guestRef: IDS.guest.marcus, guestName: 'Marcus Reid', visitRef: 'V-88104',
    locationId: IDS.location.room0908, slaId: IDS.sla.smtpStandard, hotelDepartmentId: IDS.dept.smtpHousekeeping,
    activationDate: '2026-08-25T01:15:00.000Z', responseDuration: 8, resolutionDuration: 57,
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
    guestRef: IDS.guest.amelia, guestName: 'Amelia Chen', visitRef: 'V-88121',
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
  let guestRef = input.requesterRef
  let guestName = input.requesterName
  let visitRef = input.visitRef
  if (!guestRef && !guestName && linksRequester && location) {
    if (PMS_ERROR_CODES.has(location.code)) {
      warn('requester lookup failed: pms: lookup timed out')
    }
    else {
      const visit = pmsVisits.get(`${hotelRef}|${location.code}`)
      if (visit) {
        guestRef = visit.guestRef
        guestName = visit.guestName
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
    guestRef: guestRef ?? null,
    guestName: guestName ?? null,
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
  if (actor.role === 'admin' && !isScopedStaffActor(actor)) return
  throw badRequest(ERR_CROSS_DEPARTMENT)
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
  const dept = dbDept(actor.staffId, hotelRef)
  if (dept) {
    return rows.filter((t) => {
      const assignment = activeAssignment(t.id)
      return assignment?.staffId === actor.staffId
        || ((assignment === null || assignment.kind !== 'STAFF') && t.hotelDepartmentId === dept)
    })
  }
  return rows.filter(t => activeAssignment(t.id)?.staffId === actor.staffId)
}

// ════════════════════════ Response helpers ════════════════════════

const ok = <T>(data: T, status = 200, meta?: Record<string, unknown> | null): FakeResponse<T> => ({
  status,
  body: meta === undefined ? { version: 'v1', data } : { version: 'v1', data, meta },
})

const noContent = (): FakeResponse<never> => ({ status: 204, body: null })

const staffReadModel = (acct: SeedAccount): Staff => ({
  id: acct.id,
  email: acct.email,
  name: acct.name,
  role: acct.role,
  isActive: acct.isActive,
  hotelDepartmentId: acct.hotelDepartmentId,
  createTask: acct.createTask,
  isOperator: acct.isOperator,
  hotels: staffHotels.filter(r => r.staffId === acct.id).map(r => r.hotelRef),
  groupGrants: groupGrants.filter(g => g.staffId === acct.id).map(g => g.groupId),
})

/** Session-shaped Staff: hotels is the CLAIM (direct ∪ group grants), like a JWT. */
const sessionStaffModel = (acct: SeedAccount): Staff => ({ ...staffReadModel(acct), hotels: hotelsClaim(acct.id) })

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
    if (!acct || acct.password !== password) {
      // Only a FAILED attempt consumes budget.
      const window = bucket && now - bucket.windowStart < LOGIN_RATE_WINDOW_MS ? bucket : { count: 0, windowStart: now }
      window.count += 1
      loginFailures.set(email, window)
      throw unauthorized('invalid email or password')
    }
    if (ctx.query.delivery === 'cookie') {
      const session: Session = { id: newId(), staffId: acct.id, csrfToken: randomToken(), expiresAt: now + SESSION_TTL_MS }
      sessions.set(session.id, session)
      // The Set-Cookie seam: a browser mock cannot mint an HttpOnly cookie, so
      // the session id rides in data._sessionCookie for the client to replay
      // as `Cookie: st_session=…`. The REAL response carries no such field.
      return ok({ csrfToken: session.csrfToken, staff: sessionStaffModel(acct), _sessionCookie: session.id })
    }
    const token = randomToken()
    staffBearerTokens.set(token, { staffId: acct.id, expiresAt: now + SESSION_TTL_MS })
    return ok({ token, staff: sessionStaffModel(acct) })
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
    if (actor.role !== 'leader' && actor.role !== 'admin') throw forbidden('leader or admin access required')
    const hotelRef = resolveHotelForActor(ctx)
    let deptFilter: Id | null = null
    if (ctx.query.departmentId) {
      if (!isUuid(ctx.query.departmentId)) throw badRequest('departmentId must be a UUID')
      deptFilter = ctx.query.departmentId.toLowerCase()
    }
    const rows: AssignableStaff[] = staffAccounts
      .filter(s => s.isActive && staffHotels.some(r => r.staffId === s.id && r.hotelRef === hotelRef))
      .filter(s => !deptFilter || s.hotelDepartmentId === deptFilter)
      .map(s => ({ id: s.id, name: s.name, role: s.role, hotelDepartmentId: s.hotelDepartmentId }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return ok(rows)
  }

  if (method === 'GET' && path === '/v1/staff') {
    requireAdmin(ctx)
    const hotelRef = resolveHotelForActor(ctx)
    const rows = staffAccounts
      .filter(s => s.isActive && staffHotels.some(r => r.staffId === s.id && r.hotelRef === hotelRef))
      .map(staffReadModel)
      .sort((a, b) => a.name.localeCompare(b.name))
    return ok(rows)
  }

  if (method === 'POST' && path === '/v1/staff') {
    requireAdmin(ctx)
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
        if (!actor.hotels.includes(id)) throw forbidden('cannot grant access to hotels you do not manage')
      }
    }
    const hotelDepartmentId = isUuid(body.hotelDepartmentId) ? body.hotelDepartmentId : null
    if (hotelDepartmentId) {
      const dept = hotelDepartments.find(d => d.id === hotelDepartmentId)
      if (!dept || !hotelIds.includes(dept.hotelRef)) throw badRequest('hotelDepartmentId does not belong to any of the staff member\'s hotels')
    }
    if (staffAccounts.some(s => s.email === email)) throw conflict('email already registered')
    for (const id of hotelIds) {
      if (!tenants.some(t => t.hotelRef === id)) throw unprocessable('hotel or hotel department does not exist')
    }
    const acct: SeedAccount = { id: newId(), email, name, role, isActive: true, hotelDepartmentId, createTask: Boolean(body.createTask), isOperator: false, password }
    staffAccounts.push(acct)
    hotelIds.forEach(hotelRef => staffHotels.push({ staffId: acct.id, hotelRef }))
    return ok(staffReadModel(acct), 201)
  }

  const staffPatch = /^\/v1\/staff\/([^/]+)$/.exec(path)
  if (method === 'PATCH' && staffPatch) {
    requireAdmin(ctx)
    const id = staffPatch[1]!
    if (!isUuid(id)) throw badRequest('id must be a valid UUID')
    if (body.role !== undefined && !['staff', 'leader', 'admin'].includes(String(body.role))) {
      throw unprocessable('role must be staff, leader, or admin')
    }
    const target = staffAccounts.find(s => s.id === id.toLowerCase())
    const bypassHotelCheck = actor.isService || actor.isOperator
    const shares = target && staffHotels.some(r => r.staffId === target.id && actor.hotels.includes(r.hotelRef))
    // A non-sharing target and a nonexistent one collapse to the same 404.
    if (!target || (!bypassHotelCheck && !shares)) throw notFound('staff')
    if (typeof body.name === 'string' && body.name.trim()) target.name = body.name.trim()
    if (body.role !== undefined) target.role = body.role as StaffRole
    if (body.hotelDepartmentId !== undefined) target.hotelDepartmentId = isUuid(body.hotelDepartmentId) ? body.hotelDepartmentId : null
    if (body.createTask !== undefined) target.createTask = Boolean(body.createTask)
    if (body.isActive !== undefined) target.isActive = Boolean(body.isActive)
    return ok(staffReadModel(target))
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
  slas.push({ id: newId(), hotelRef: id, name: 'Standard', responseTime: 30, resolutionTime: 90, isDefault: true, createdAt: created.createdAt, updatedAt: created.createdAt })
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
    const hasAdmin = staffAccounts.some(s => s.role === 'admin' && !s.isOperator && staffHotels.some(r => r.staffId === s.id && r.hotelRef === id))
    if (hasAdmin) throw conflict('tenant already has an admin')
    if (staffAccounts.some(s => s.email === email)) throw conflict('email already registered')
    const temporaryPassword = randomToken().slice(0, 32)
    const acct: SeedAccount = { id: newId(), email, name, role: 'admin', isActive: true, hotelDepartmentId: null, createTask: true, isOperator: false, password: temporaryPassword }
    staffAccounts.push(acct)
    staffHotels.push({ staffId: acct.id, hotelRef: id })
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
      if (partners.some(p => p.name.toLowerCase() === name.toLowerCase())) throw conflict('partner name already exists')
      const created: Partner = { id: newId(), name, isActive: true, createdAt: nowIso(), updatedAt: nowIso() }
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
    const partner = partners.find(p => p.id === id.toLowerCase())
    if (!partner) throw notFound('partner')
    partner.isActive = Boolean(body.isActive)
    partner.updatedAt = nowIso()
    return ok(partner)
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
      if (isUuid(body.id)) {
        const sla = slas.find(s => s.id === body.id && s.hotelRef === hotelRef)
        if (!sla) throw notFound('sla')
        applyDefault(sla.id)
        Object.assign(sla, { name, responseTime, resolutionTime, isDefault, updatedAt: at })
        return ok(sla)
      }
      const created: Sla = { id: newId(), hotelRef, name, responseTime, resolutionTime, isDefault, createdAt: at, updatedAt: at }
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
    if (existing) {
      Object.assign(existing, { hotelDepartmentId: departmentId, slaId, remark: asNullableTrimmed(body.remark), updatedAt: at })
      return ok(existing)
    }
    const created: RoutingRule = {
      id: newId(), hotelRef, itemRef, categoryId, locationTypeId, priority,
      specificity: specificityOf({ itemRef, categoryId, locationTypeId, priority }),
      hotelDepartmentId: departmentId, slaId, remark: asNullableTrimmed(body.remark), createdAt: at, updatedAt: at,
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

  const ruleByItem = /^\/v1\/routing-rules\/([^/]+)$/.exec(path)
  if (method === 'DELETE' && ruleByItem && !path.startsWith('/v1/routing-rules/id/')) {
    requireAdmin(ctx)
    const hotelRef = hotelFor(ctx)
    if (!isUuid(ruleByItem[1])) throw badRequest('itemRef must be a valid UUID')
    const index = routingRules.findIndex(r => r.itemRef === ruleByItem[1]!.toLowerCase() && r.hotelRef === hotelRef)
    if (index === -1) throw notFound('routing rule')
    routingRules.splice(index, 1)
    return noContent()
  }

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
      if (hotelDepartmentId && !hotelDepartments.some(d => d.id === hotelDepartmentId && d.hotelRef === hotelRef && d.isActive)) throw unprocessable('invalid department reference')
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
      if (hotelDepartmentId && !hotelDepartments.some(d => d.id === hotelDepartmentId && d.hotelRef === hotelRef && d.isActive)) throw unprocessable('invalid department reference')
      const isDefault = Boolean(body.isDefault)
      const id = isUuid(body.id) ? body.id.toLowerCase() : null
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

  if (method === 'GET' && path === '/v1/departments') {
    requireAdmin(ctx)
    return ok([...masterDepartments].sort((a, b) => a.name.localeCompare(b.name)))
  }

  if (path === '/v1/hotel-departments') {
    if (method === 'GET') {
      requireAdmin(ctx)
      const hotelRef = hotelFor(ctx)
      return ok(hotelDepartments.filter(d => d.hotelRef === hotelRef).sort((a, b) => a.departmentName.localeCompare(b.departmentName)))
    }
    if (method === 'POST') {
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
      const existing = hotelDepartments.find(d => d.hotelRef === hotelRef && d.departmentId === departmentId)
      if (existing) return ok(existing, 200)
      const created: HotelDepartment = { id: newId(), hotelRef, departmentId, departmentName: master.name, isActive: true }
      hotelDepartments.push(created)
      return ok(created, 201)
    }
  }

  const groupStats = /^\/v1\/groups\/([^/]+)\/stats$/.exec(path)
  const groupTasks = /^\/v1\/groups\/([^/]+)\/tasks$/.exec(path)
  if (method === 'GET' && (groupStats || groupTasks)) {
    const rawId = (groupStats ?? groupTasks)![1]!
    if (!isUuid(rawId)) throw badRequest('id must be a valid UUID')
    // Authorization BEFORE the group lookup — no existence oracle.
    if (actor.isService) throw forbidden('forbidden')
    if (actor.role !== 'admin') throw forbidden('forbidden')
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
      return ok({ task: resolved.task, checklistLabels: resolved.checklistLabels }, 200, { warnings: resolved.warnings })
    }
    const t = resolved.task
    tasks.push(t)
    resolved.checklistLabels.forEach((label, index) => {
      checklistItems.push({ id: newId(), hotelRef, taskId: t.id, sort: index, label, isDone: false, doneBy: null, doneAt: null, createdAt: t.createdAt, updatedAt: t.createdAt })
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
    if (actor.role !== 'leader' && actor.role !== 'admin') throw forbidden('forbidden')
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
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
    if (target === 'VERIFIED' && !actor.isService && actor.role === 'staff') throw forbidden('only leaders or admins can set status to VERIFIED')
    if (target === 'NEW') throw badRequest('cannot change status back to NEW')
    if (target === 'SUBMITTED') throw badRequest('use the submit action to move a task to SUBMITTED')
    if (t.status === 'SUBMITTED') {
      // Frozen while awaiting review — except a leader/admin park or cancel.
      if (!actor.isService && actor.role === 'staff') throw forbidden('task is awaiting review')
      if (target === 'FINISHED' || target === 'IN_PROGRESS') throw badRequest('use the review action to decide a submitted task')
      if (target === 'VERIFIED') throw badRequest('a submitted task is reviewed to FINISHED before it can be VERIFIED')
    }
    if (!actor.isService && actor.role === 'staff' && activeAssignment(t.id)?.staffId !== actor.staffId) {
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
    if (actor.isService || (actor.role !== 'leader' && actor.role !== 'admin')) {
      throw forbidden('only leaders or admins may review a submitted task')
    }
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    const decision = String(body.decision ?? '')
    if (decision !== 'APPROVE' && decision !== 'REQUEST_CHANGES') throw badRequest('decision must be one of APPROVE, REQUEST_CHANGES')
    const note = asNullableTrimmed(body.note)
    if (note && note.length > 1000) throw badRequest('note must be at most 1000 characters')
    if (decision === 'REQUEST_CHANGES' && note === null) throw badRequest('a note is required when requesting changes')
    if (t.status !== 'SUBMITTED') throw conflict('task is not awaiting review')
    if (actor.role === 'leader') {
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
    const at = nowIso()
    taskAssignments.filter(a => a.taskId === t.id && a.isActive).forEach((a) => { a.isActive = false })
    cancelPendingOffer(t.id, at)
    // Pool selection, first match wins: (a) most recent TEAM/DEPARTMENT
    // assignment verbatim; (b) the returner's latest active team; (c) the
    // task's own department; (d) fully unassigned.
    const lastPool = [...taskAssignments].reverse().find(a => a.taskId === t.id && a.kind !== 'STAFF')
    const latestTeam = [...teamMembers]
      .filter(m => m.staffId === actor.staffId && teams.some(team => team.id === m.teamId && team.isActive && team.hotelRef === hotelRef))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.teamId.localeCompare(a.teamId))[0]
    let next: Pick<TaskAssignment, 'kind' | 'teamId' | 'hotelDepartmentId'> | null = null
    if (lastPool) next = { kind: lastPool.kind, teamId: lastPool.teamId, hotelDepartmentId: lastPool.hotelDepartmentId }
    else if (latestTeam) next = { kind: 'TEAM', teamId: latestTeam.teamId, hotelDepartmentId: null }
    else if (t.hotelDepartmentId) next = { kind: 'DEPARTMENT', teamId: null, hotelDepartmentId: t.hotelDepartmentId }
    if (next) {
      taskAssignments.push({ id: newId(), taskId: t.id, kind: next.kind, staffId: null, teamId: next.teamId, hotelDepartmentId: next.hotelDepartmentId, assignedBy: actor.staffId, actingUser: null, remark: reason, isActive: true, createdAt: at })
    }
    if (t.status === 'IN_PROGRESS') {
      changeStatusCore(t, actor.staffId, 'NEW', columnForStatus(hotelRef, 'NEW')?.id ?? null, reason, at)
    }
    else {
      // Already NEW: no status write, but the reason still lands in history.
      pushHistory(t, actor.staffId, 'NEW', reason, at)
      t.updatedAt = at
    }
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
    // Leader-of-the-task's-department only, among humans — admins included out.
    if (!actor.isService) {
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
    // A deptless task denies everyone, leaders and admins included.
    const callerDept = dbDept(actor.staffId, hotelRef)
    if (!t.hotelDepartmentId || callerDept !== t.hotelDepartmentId) throw forbidden('not authorized to comment on this task')
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
      if (!t.guestRef || !isUuid(body.guestRef) || body.guestRef.toLowerCase() !== t.guestRef) throw forbidden('not authorized for this task')
    }
    else {
      const isPermitted = actor.isService || actor.role === 'admin'
        || (actor.role === 'leader' && !!t.hotelDepartmentId && dbDept(actor.staffId, hotelRef) === t.hotelDepartmentId)
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
    const permitted = actor.role === 'admin'
      || (actor.role === 'leader' && !!t.hotelDepartmentId && dbDept(actor.staffId, hotelRef) === t.hotelDepartmentId)
      || activeAssignment(t.id)?.staffId === actor.staffId
    if (!permitted) throw forbidden('not authorized to manage collaborators on this task')
    if (!isUuid(body.staffId) || !staffInHotel(body.staffId.toLowerCase(), hotelRef)) throw notFound('staff')
    const staffId = body.staffId.toLowerCase()
    if (activeAssignment(t.id)?.staffId === staffId) throw badRequest('assignee cannot be a helper')
    const existing = taskCollaborators.find(c => c.taskId === t.id && c.staffId === staffId && c.isActive)
    if (existing) return ok({ ...existing, staffName: account(existing.staffId)?.name ?? null })
    const created: Collaborator = { id: newId(), hotelRef, taskId: t.id, staffId, staffName: null, addedBy: actor.staffId, isActive: true, createdAt: nowIso() }
    taskCollaborators.push(created)
    return ok({ ...created, staffName: account(staffId)?.name ?? null })
  }

  if (method === 'POST' && path === '/v1/tasks/collaborators/remove') {
    const hotelRef = hotelFor(ctx)
    const t = findHotelTask(hotelRef, body.taskId)
    if (['FINISHED', 'VERIFIED', 'CANCELLED'].includes(t.status)) throw conflict('task is closed')
    if (actor.isService) throw forbidden('helpers are human-only')
    const staffId = isUuid(body.staffId) ? body.staffId.toLowerCase() : ''
    const permitted = actor.role === 'admin'
      || (actor.role === 'leader' && !!t.hotelDepartmentId && dbDept(actor.staffId, hotelRef) === t.hotelDepartmentId)
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

// ════════════════════════ The mux ════════════════════════

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

  // serviceAuth-only mounts: no Actor, a different 401 message.
  if ((method === 'POST' && path === '/v1/tenants') || (method === 'POST' && path === '/v1/departments')) {
    const authorization = headers.authorization
    const match = authorization ? /^Bearer (.+)$/.exec(authorization) : null
    if (!match || !match[1]) throw unauthorized('missing bearer token')
    if (!match[1].startsWith('service:')) throw unauthorized('invalid service token')
    if (path === '/v1/tenants') return provisionTenant(body)
    const name = asTrimmed(body.name)
    if (!name) throw badRequest('name is required')
    if (masterDepartments.some(d => d.name.toLowerCase() === name.toLowerCase())) throw conflict('department name already exists')
    const created: MasterDepartment = { id: newId(), name, isActive: true }
    masterDepartments.push(created)
    return ok(created, 201)
  }

  // Login is the one unauthenticated route besides /healthz.
  const needsActor = !(method === 'POST' && path === '/v1/auth/staff/login')
  const actor: Actor = needsActor
    ? resolveActor(headers)
    : { isService: false, actingUser: '', staffId: null, role: 'staff', deptId: null, createTask: false, hotels: [], partnerId: null, partnerName: '', isOperator: false, sessionId: null, csrfToken: '' }

  const ctx: Ctx = { method, path, body, headers, query, actor }
  if (needsActor) checkCsrf(ctx)

  const response = handleAuthAndStaff(ctx)
    ?? handlePlatform(ctx)
    ?? handleConfig(ctx)
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
    .map(s => ({ email: s.email, password: s.password, name: s.name, role: s.role, isOperator: s.isOperator }))
}

/** Hotel names for pickers — resolved locally, since /v1/platform/tenants is operator-only. */
export function demoHotelName(hotelRef: Id): string {
  return tenants.find(t => t.hotelRef === hotelRef)?.name ?? hotelRef
}
