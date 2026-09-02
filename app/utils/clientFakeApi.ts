// Client-side mock API for the Sentec Tasks web app.
//
// Sentec Tasks is a STANDALONE, app-agnostic task/ticketing product. It is not a
// Butler module: Butler, PMS and EMS are all just *integration partners* that
// dispatch tasks into it, and Tasks stays fully usable with no partner at all
// (staff and admins raise tasks directly from its own native catalog).
//
// Contract sources:
//   - docs/Sentec-Tasks-Struktur-Aplikasi.md   (architecture, roles, flow)
//   - docs/sentec-tasks.md                     (staff workspace behaviour + the
//                                               three review findings encoded below)
//
// Scope key
// ─────────
// Everything hotel-scoped in the old Butler world is `tenantId` here — a tenant
// IS a property. The product term is "tenant/property" because a tenant need not
// be a hotel; in PostgreSQL this is the `hotel_id` LIST partition key that every
// main table is partitioned by, so every query below filters on it explicitly
// (an unfiltered query would scan every partition).
//
// Behaviour deliberately encoded here (from the final-review findings)
// ───────────────────────────────────────────────────────────────────
//  1. There is NO `CLAIMED` status. Claiming creates an *assignment*; it never
//     moves the task's status. Claiming a task already held by someone else is
//     rejected with 409 — reassignment must go through Assign. Claiming a task
//     you already hold is idempotent (double-tap on flaky wifi is safe).
//  2. Task detail is authorization-checked per requester. Knowing an id is not
//     enough: you must be the assignee, be in the task's department, or be a
//     leader/admin of the tenant (operators see everything).
//  3. Session teardown clears every cached row this module hands out, so a
//     shared shift device never shows the previous user's work.
//
// The app runs as a fully static SPA against this in-memory store; mutations
// persist for the browser session only and reset on reload.

type Id = string

// ── platform / tenancy ────────────────────────────────────────────────────────

/** A brand or portfolio grouping properties, e.g. Aston, Favehotels, Neo. */
export interface TenantGroup {
  id: Id
  name: string
  createDate: string
}

/** A tenant IS a property. `hotel_id` partition key in the real schema. */
export interface Tenant {
  id: Id
  tenantGroupId: Id | null
  name: string
  code: string
  timezone: string
  isActive: boolean
  createDate: string
}

/**
 * An application registered to dispatch tasks into Tasks (Butler, PMS, EMS, …).
 * The JWT secret is AES-256-GCM encrypted at rest and shown exactly once, at
 * creation — `secretPreview` is only ever populated on the create response.
 */
/**
 * Platform-wide source-app registry, curated by operators. Every authenticated
 * user may read it — it is what lets any client badge a task with the app it
 * came from — but only an operator can change it.
 */
export interface SourceApp {
  /** Stable registry code, e.g. "sentec-butler". */
  code: string
  name: string
  /** Badge colour as a hex literal — data, not a theme token. */
  badgeColor: string
  isActive: boolean
  createDate: string
  updateDate: string
}

export interface Partner {
  id: Id
  name: string
  /** Free-form label for what the partner is, e.g. "Guest services". */
  kind: string
  /** Which registry entry this partner dispatches as; null = not yet mapped. */
  sourceAppCode: string | null
  isActive: boolean
  createDate: string
  lastDispatchAt: string | null
  /** Populated ONLY in the response that creates or rotates the secret. */
  secretPreview?: string
}

/**
 * Cross-property read+write grant over every tenant in a group. High blast
 * radius, so only an operator may grant or revoke one, and every change is
 * written to the audit trail. A tenant admin cannot grant one — not even to
 * themselves.
 */
export interface GroupGrant {
  id: Id
  tenantGroupId: Id
  userId: Id
  grantedBy: Id
  grantedAt: string
  revokedAt: string | null
  revokedBy: Id | null
}

// ── tenant configuration ──────────────────────────────────────────────────────

export interface Department {
  id: Id
  tenantId: Id
  name: string
  isActive: boolean
  createDate: string
  updateDate: string
}

export interface Sla {
  id: Id
  tenantId: Id
  name: string
  /** Open-hours minutes from activation until the task must be picked up. */
  responseTime: number
  /** Open-hours minutes from activation until the work must be submitted. */
  resolutionTime: number
  isDefault: boolean
  createDate: string
  updateDate: string
}

/** Default urgency a catalog item stamps on the tasks raised from it. */
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export const TASK_PRIORITY_VALUES: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

/**
 * Native catalog — Tasks owns this, so it works with no partner connected.
 * Categories are per tenant: each property names and orders its own, so one
 * property's rename can never leak into another partition.
 */
export interface CatalogCategory {
  id: Id
  tenantId: Id
  name: string
  code: string
  icon: string | null
  sort: number
  isActive: boolean
  createDate: string
  updateDate: string
}

export interface CatalogItem {
  id: Id
  tenantId: Id
  categoryId: Id
  name: string
  description: string | null
  /** Whether the item takes a quantity (e.g. "2 extra towels"). */
  quantityEnabled: boolean
  defaultPriority: TaskPriority
  /** Whether raising this item requires saying where the work is. */
  requiresLocation: boolean
  /** Steps seeded onto every task raised from this item. */
  defaultChecklist: string[]
  /**
   * Expected minutes of work, written by other producers (task templates, the
   * API). The admin screen carries no control for it, so its upsert must echo
   * the stored value back — the upsert is a full replace, and omitting the
   * field clears it.
   */
  defaultDurationMinutes: number | null
  /** Proof gate: photos required before the task can be finished. 0 = no gate. */
  minProofPhotos: number
  /** Proof gate: whether finishing requires a written completion note. */
  requiresCompletionNote: boolean
  isActive: boolean
  createDate: string
  updateDate: string
}

// ── locations ─────────────────────────────────────────────────────────────────

/** A kind of place work happens in: guest room, floor, public area, … */
export interface LocationType {
  id: Id
  tenantId: Id
  name: string
  code: string
  /** Whether tasks at locations of this type carry a requester (e.g. rooms do). */
  linksRequester: boolean
  sort: number
  isActive: boolean
  createDate: string
  updateDate: string
}

/**
 * A concrete place at the property. `parentId` is reserved for a future
 * building/floor hierarchy and is not used yet.
 */
export interface PropertyLocation {
  id: Id
  tenantId: Id
  locationTypeId: Id
  name: string
  code: string
  parentId: Id | null
  /**
   * The demo stand-in for the PMS guest lookup: who is at this location right
   * now, for location types that link a requester. The real system resolves
   * this server-side from the PMS; the client never supplies it.
   */
  currentGuest: string | null
  isActive: boolean
  createDate: string
  updateDate: string
}

// ── teams ─────────────────────────────────────────────────────────────────────

/** A working group inside (or across) a department, e.g. a shift crew. */
export interface Team {
  id: Id
  tenantId: Id
  name: string
  description: string | null
  departmentId: Id | null
  isActive: boolean
  createDate: string
  updateDate: string
}

// ── operating schedules ───────────────────────────────────────────────────────

/**
 * One weekly opening window. Membership in `windows` IS the open flag: a
 * weekday with no window at all is fully closed — there is no zero-width or
 * explicit-closed representation, and `closesMinutes` must exceed
 * `opensMinutes` (1440 means open until midnight).
 */
export interface OperatingWindow {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** Minutes since local midnight. */
  opensMinutes: number
  /** Minutes since local midnight; 1440 = until midnight. */
  closesMinutes: number
}

/** A dated override: fully closed, or open with its own hours. */
export interface OperatingException {
  /** YYYY-MM-DD. */
  date: string
  isClosed: boolean
  opensMinutes: number | null
  closesMinutes: number | null
}

export interface OperatingSchedule {
  id: Id
  tenantId: Id
  name: string
  /** At most one default per tenant — the server refuses a second with 409. */
  isDefault: boolean
  /** At most one schedule per department; null = tenant-wide. */
  departmentId: Id | null
  windows: OperatingWindow[]
  exceptions: OperatingException[]
  createDate: string
  updateDate: string
}

// ── terminology ───────────────────────────────────────────────────────────────

/** The four product terms a property may rename (e.g. "Requester" → "Guest"). */
export type TerminologyKey = 'requester' | 'visit' | 'location' | 'department'

export const TERMINOLOGY_KEYS: TerminologyKey[] = ['requester', 'visit', 'location', 'department']

export const TERMINOLOGY_DEFAULTS: Record<TerminologyKey, string> = {
  requester: 'Requester',
  visit: 'Visit',
  location: 'Location',
  department: 'Department',
}

/**
 * Routing rule: decides which department a task lands in, and which SLA gets
 * stamped on it. Rules are specificity-tiered rather than hand-ordered:
 * exact item > category > location type > priority > catch-all. A rule carries
 * exactly one matcher (none = catch-all), so its tier is never ambiguous;
 * within a tier the oldest rule wins.
 */
export interface RoutingRule {
  id: Id
  tenantId: Id
  matchItemId: Id | null
  matchCategoryId: Id | null
  matchLocationTypeId: Id | null
  matchPriority: TaskPriority | null
  departmentId: Id
  slaId: Id
  remark: string | null
  isActive: boolean
  createDate: string
  updateDate: string
}

export type RoutingTier = 'ITEM' | 'CATEGORY' | 'LOCATION_TYPE' | 'PRIORITY' | 'CATCH_ALL'

/** The tiers, most specific first — the order `resolveRouting` walks them. */
export const ROUTING_TIERS: RoutingTier[] = ['ITEM', 'CATEGORY', 'LOCATION_TYPE', 'PRIORITY', 'CATCH_ALL']

/** Which specificity tier a rule sits in, derived from its one matcher. */
export function routingTier(rule: Pick<RoutingRule, 'matchItemId' | 'matchCategoryId' | 'matchLocationTypeId' | 'matchPriority'>): RoutingTier {
  if (rule.matchItemId) return 'ITEM'
  if (rule.matchCategoryId) return 'CATEGORY'
  if (rule.matchLocationTypeId) return 'LOCATION_TYPE'
  if (rule.matchPriority) return 'PRIORITY'
  return 'CATCH_ALL'
}

/**
 * SUBMITTED sits between IN_PROGRESS and FINISHED: the assignee (or a helper)
 * submits work for review, and a leader either approves it to FINISHED or
 * sends it back to IN_PROGRESS. NEW is unreachable via the status route —
 * going back to the start is a return-to-pool, which carries a reason.
 */
export type TaskStatus = 'NEW' | 'IN_PROGRESS' | 'SUBMITTED' | 'PENDING' | 'FINISHED' | 'VERIFIED' | 'CANCELLED'
export type SlaStatus = 'EMPTY' | 'ON_TIME' | 'BREACHED'

export interface Board {
  id: Id
  tenantId: Id
  name: string
  createDate: string
}

export interface BoardColumn {
  id: Id
  boardId: Id
  name: string
  description: string | null
  columnSort: number
  /** The task status entering this column sets. */
  status: TaskStatus
  isActive: boolean
  /**
   * Soft delete. Absent means not removed (the seeds predate the field).
   * Removal is refused — skipped with a warning, not errored — while the
   * column still holds open work, so tasks never point at a removed column.
   */
  isRemoved?: boolean
  createDate: string
  updateDate: string
}

// ── staff identity ────────────────────────────────────────────────────────────

/** Per-tenant role. `operator` is a platform-level flag on the user, not here. */
export type TenantRole = 'staff' | 'leader' | 'admin'

/** Effective role for a request, after the operator flag is folded in. */
export type ResolvedRole = 'operator' | 'admin' | 'leader' | 'staff' | null

export interface StaffUser {
  id: Id
  firstName: string
  lastName: string
  email: string
  picture: string | null
  /** Sentinel Tech platform operator — cross-tenant provisioning rights. */
  isOperator: boolean
  isActive: boolean
  lastLogin: string | null
  createDate: string
  updateDate: string
}

/** A user's membership of one tenant: their role and department there. */
export interface StaffProfile {
  id: Id
  tenantId: Id
  userId: Id
  departmentId: Id | null
  position: string | null
  role: TenantRole
  /** Whether this membership may raise tasks itself. */
  canCreateTask: boolean
  isActive: boolean
  createDate: string
  updateDate: string
}

// ── tasks ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: Id
  tenantId: Id
  /** Dispatching partner, or null when raised inside Tasks itself. */
  partnerId: Id | null
  /** The partner's own reference, echoed back on status events. */
  externalRef: string | null
  itemId: Id | null
  status: TaskStatus
  departmentId: Id | null
  columnId: Id | null
  slaId: Id | null
  title: string
  description: string | null
  /**
   * Where the work is. Deliberately not `roomNumber`: Tasks is not
   * hotel-specific, so this is any location label the caller supplies.
   */
  location: string | null
  /** Registry location, when the work is at a place the property has defined. */
  locationId: Id | null
  quantity: number | null
  /** Free-text requester label from the partner (e.g. a guest name). */
  requestedFor: string | null
  priority: TaskPriority
  /** Checklist step labels: the item's own defaults plus what the creator added. */
  checklist: string[]
  /** Written at submit-for-review; overwritten by a re-submission. */
  completionNote: string | null
  submittedBy: Id | null
  submittedAt: string | null
  activationDate: string
  responseDueAt: string | null
  resolutionDueAt: string | null
  /** Minutes actually taken; null until the transition happens. */
  responseDuration: number | null
  resolutionDuration: number | null
  responseSlaStatus: SlaStatus
  resolutionSlaStatus: SlaStatus
  createDate: string
  updateDate: string
}

/**
 * Who holds a task. STAFF is one person; TEAM and DEPARTMENT are pools — the
 * task is assigned (nobody else's Claim steals it silently) but no individual
 * owns it, and a member claims it into a personal STAFF assignment. The KIND is
 * the only signal for "is there an assignment": a pool row has a null userId.
 */
export type AssignmentKind = 'STAFF' | 'TEAM' | 'DEPARTMENT'

export interface TaskAssignment {
  id: Id
  taskId: Id
  kind: AssignmentKind
  /** The person, for STAFF; null for pools. */
  userId: Id | null
  /** The pool, for TEAM / DEPARTMENT; null otherwise. */
  teamId: Id | null
  departmentId: Id | null
  assignedBy: Id | null
  remark: string | null
  isActive: boolean
  createDate: string
  updateDate: string
}

/**
 * A delegation offer: the current assignee proposes handing the task to a
 * colleague, who accepts or declines. At most one PENDING offer per task; no
 * expiry — an offer ends by decision, cancellation, or staleness (the sender
 * no longer holds the task when the target accepts).
 */
export interface TaskOffer {
  id: Id
  tenantId: Id
  taskId: Id
  fromUserId: Id
  toUserId: Id
  note: string | null
  state: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED'
  decidedAt: string | null
  createDate: string
}

/** A helper on a task: may attach proof and submit, but does not own the task. */
export interface TaskCollaborator {
  id: Id
  taskId: Id
  userId: Id
  addedBy: Id
  isActive: boolean
  createDate: string
}

export interface TaskComment {
  id: Id
  taskId: Id
  userId: Id
  comment: string
  createDate: string
}

export interface TaskHistory {
  id: Id
  taskId: Id
  userId: Id | null
  status: TaskStatus
  description: string | null
  createDate: string
}

/**
 * Attachment. Two creation paths, exactly one per attachment: an
 * already-hosted URL, or a presigned upload's `storageKey`. Once created, only
 * `isRemoved` may change — the file itself is immutable.
 */
export interface TaskAttachment {
  id: Id
  taskId: Id
  userId: Id | null
  filetype: 'PHOTO' | 'PDF' | 'OTHER'
  filename: string
  url: string
  /** `tenants/{tenantId}/uploads/…` for uploaded files; null for URL attachments. */
  storageKey: string | null
  isRemoved: boolean
  createDate: string
}

/** Outbound status event delivered back to the dispatching partner. */
export interface StatusEvent {
  id: Id
  taskId: Id
  partnerId: Id
  status: TaskStatus
  deliveredAt: string | null
  attempts: number
  createDate: string
}

/** Audit trail. Group-grant changes in particular must always land here. */
export interface AuditEvent {
  id: Id
  tenantId: Id | null
  actorUserId: Id | null
  action: string
  target: string
  detail: string | null
  createDate: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString() }
function nextId(items: { id: Id }[]) {
  return String(items.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1)
}
function pid(v: unknown, fallback = '') { return (v != null && v !== '') ? String(v) : fallback }
function minutesFrom(iso: string, minutes: number) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString()
}

interface ListMeta { totalCount: number; nextCursor: string | null }
function listRes<T>(data: T[], meta?: Partial<ListMeta>) {
  return {
    version: 'v1' as const,
    data,
    meta: { totalCount: meta?.totalCount ?? data.length, nextCursor: meta?.nextCursor ?? null },
  }
}
function singleRes<T>(data: T) { return { version: 'v1' as const, data } }

const SEED = '2026-08-01T02:00:00.000Z'
/**
 * Seeded "now". Task due dates are laid out around this instant so the demo
 * shows a realistic spread of on-time and breached SLAs on first load.
 */
const SEED_NOW = '2026-08-25T03:00:00.000Z'

// ── seed: platform / tenancy ──────────────────────────────────────────────────

const tenantGroups: TenantGroup[] = [
  { id: '1', name: 'Aston', createDate: SEED },
  { id: '2', name: 'Favehotels', createDate: SEED },
  { id: '3', name: 'Neo', createDate: SEED },
]

const tenants: Tenant[] = [
  { id: '1', tenantGroupId: '1', name: 'Aston Simatupang', code: 'ASTN-SMTP', timezone: 'Asia/Jakarta', isActive: true, createDate: SEED },
  { id: '2', tenantGroupId: '1', name: 'Aston Kuningan Suites', code: 'ASTN-KNGN', timezone: 'Asia/Jakarta', isActive: true, createDate: SEED },
  { id: '3', tenantGroupId: '2', name: 'Favehotels Wahid Hasyim', code: 'FAVE-WHDH', timezone: 'Asia/Jakarta', isActive: true, createDate: SEED },
  { id: '4', tenantGroupId: '3', name: 'Neo Kuta Legian', code: 'NEO-KTLG', timezone: 'Asia/Makassar', isActive: true, createDate: SEED },
]

// The platform-wide source-app registry, straight from the platform briefing.
const sourceApps: SourceApp[] = [
  { code: 'sentec-tasks', name: 'Sentec Tasks', badgeColor: '#2563eb', isActive: true, createDate: SEED, updateDate: SEED },
  { code: 'sentec-butler', name: 'Sentec Butler', badgeColor: '#7c3aed', isActive: true, createDate: SEED, updateDate: SEED },
  { code: 'sentec-pms', name: 'Sentec PMS', badgeColor: '#059669', isActive: true, createDate: SEED, updateDate: SEED },
  { code: 'sentec-crm', name: 'Sentec CRM', badgeColor: '#d97706', isActive: true, createDate: SEED, updateDate: SEED },
  { code: 'sentec-ems', name: 'Sentec EMS', badgeColor: '#dc2626', isActive: true, createDate: SEED, updateDate: SEED },
  { code: 'sentec-sbe', name: 'Booking Engine', badgeColor: '#0891b2', isActive: true, createDate: SEED, updateDate: SEED },
]

const partners: Partner[] = [
  { id: '1', name: 'Sentec Butler', kind: 'Guest services', sourceAppCode: 'sentec-butler', isActive: true, createDate: SEED, lastDispatchAt: '2026-08-25T02:41:00.000Z' },
  { id: '2', name: 'Sentec PMS', kind: 'Property management', sourceAppCode: 'sentec-pms', isActive: true, createDate: SEED, lastDispatchAt: '2026-08-24T22:10:00.000Z' },
  { id: '3', name: 'Sentec EMS', kind: 'Employee management', sourceAppCode: 'sentec-ems', isActive: false, createDate: SEED, lastDispatchAt: null },
]

const groupGrants: GroupGrant[] = [
  // Regional manager: read+write across every Aston property in group 1.
  { id: '1', tenantGroupId: '1', userId: '20', grantedBy: '1', grantedAt: '2026-08-10T04:00:00.000Z', revokedAt: null, revokedBy: null },
]

// ── seed: tenant configuration ────────────────────────────────────────────────

const departments: Department[] = [
  { id: '1', tenantId: '1', name: 'Housekeeping', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', name: 'Maintenance', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', name: 'Front Office', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '4', tenantId: '1', name: 'Food & Beverage', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '5', tenantId: '2', name: 'Housekeeping', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', tenantId: '2', name: 'Maintenance', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '7', tenantId: '3', name: 'Housekeeping', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '8', tenantId: '3', name: 'Front Office', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '9', tenantId: '4', name: 'Operations', isActive: true, createDate: SEED, updateDate: SEED },
]

const slas: Sla[] = [
  { id: '1', tenantId: '1', name: 'Standard', responseTime: 15, resolutionTime: 45, isDefault: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', name: 'Urgent', responseTime: 5, resolutionTime: 20, isDefault: false, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', name: 'Scheduled', responseTime: 120, resolutionTime: 480, isDefault: false, createDate: SEED, updateDate: SEED },
  { id: '4', tenantId: '2', name: 'Standard', responseTime: 20, resolutionTime: 60, isDefault: true, createDate: SEED, updateDate: SEED },
  { id: '5', tenantId: '3', name: 'Standard', responseTime: 30, resolutionTime: 90, isDefault: true, createDate: SEED, updateDate: SEED },
  { id: '6', tenantId: '4', name: 'Standard', responseTime: 30, resolutionTime: 90, isDefault: true, createDate: SEED, updateDate: SEED },
]

const catalogCategories: CatalogCategory[] = [
  // Aston Simatupang (tenant 1)
  { id: '1', tenantId: '1', name: 'Housekeeping', code: 'HK', icon: '🧹', sort: 1, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', name: 'Maintenance', code: 'MNT', icon: '🔧', sort: 2, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', name: 'Concierge', code: 'CNS', icon: '🛎️', sort: 3, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '4', tenantId: '1', name: 'Food & Beverage', code: 'FNB', icon: '🍽️', sort: 4, isActive: true, createDate: SEED, updateDate: SEED },
  // A deactivated category, so the catalog screen's "keep it choosable only
  // for the item that already has it" behaviour is visible in the demo.
  { id: '10', tenantId: '1', name: 'Seasonal', code: 'SSN', icon: '🎄', sort: 5, isActive: false, createDate: SEED, updateDate: SEED },
  // Aston Kuningan Suites (tenant 2)
  { id: '5', tenantId: '2', name: 'Housekeeping', code: 'HK', icon: '🧹', sort: 1, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', tenantId: '2', name: 'Maintenance', code: 'MNT', icon: '🔧', sort: 2, isActive: true, createDate: SEED, updateDate: SEED },
  // Favehotels Wahid Hasyim (tenant 3)
  { id: '7', tenantId: '3', name: 'Housekeeping', code: 'HK', icon: '🧹', sort: 1, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '8', tenantId: '3', name: 'Concierge', code: 'CNS', icon: '🛎️', sort: 2, isActive: true, createDate: SEED, updateDate: SEED },
  // Neo Kuta Legian (tenant 4)
  { id: '9', tenantId: '4', name: 'Housekeeping', code: 'HK', icon: '🧹', sort: 1, isActive: true, createDate: SEED, updateDate: SEED },
]

/** Item seed helper: fills the fields most items leave at their defaults. */
function seedItem(row: Pick<CatalogItem, 'id' | 'tenantId' | 'categoryId' | 'name'> & Partial<CatalogItem>): CatalogItem {
  return {
    description: null,
    quantityEnabled: false,
    defaultPriority: 'NORMAL',
    requiresLocation: false,
    defaultChecklist: [],
    defaultDurationMinutes: null,
    minProofPhotos: 0,
    requiresCompletionNote: false,
    isActive: true,
    createDate: SEED,
    updateDate: SEED,
    ...row,
  }
}

const catalogItems: CatalogItem[] = [
  seedItem({ id: '1', tenantId: '1', categoryId: '1', name: 'Extra towels', quantityEnabled: true, requiresLocation: true, defaultDurationMinutes: 10 }),
  seedItem({
    id: '2', tenantId: '1', categoryId: '1', name: 'Room cleaning', requiresLocation: true, defaultDurationMinutes: 45,
    defaultChecklist: ['Strip and remake the beds', 'Vacuum and mop the floors', 'Restock amenities'],
    minProofPhotos: 2, requiresCompletionNote: true,
  }),
  seedItem({ id: '3', tenantId: '1', categoryId: '1', name: 'Turndown service', requiresLocation: true, defaultDurationMinutes: 15 }),
  seedItem({
    id: '4', tenantId: '1', categoryId: '2', name: 'Air conditioner not cooling', defaultPriority: 'URGENT', requiresLocation: true,
    defaultDurationMinutes: 60, minProofPhotos: 1, requiresCompletionNote: true,
  }),
  seedItem({ id: '5', tenantId: '1', categoryId: '2', name: 'Light bulb replacement', quantityEnabled: true, requiresLocation: true }),
  seedItem({
    id: '6', tenantId: '1', categoryId: '2', name: 'Plumbing / leak', defaultPriority: 'HIGH', requiresLocation: true,
    minProofPhotos: 2, requiresCompletionNote: true,
  }),
  seedItem({ id: '7', tenantId: '1', categoryId: '3', name: 'Airport transfer', description: 'Arrange the hotel car or a taxi' }),
  seedItem({ id: '8', tenantId: '1', categoryId: '3', name: 'Late checkout request', defaultPriority: 'LOW' }),
  seedItem({ id: '9', tenantId: '1', categoryId: '4', name: 'In-room dining', quantityEnabled: true, requiresLocation: true, defaultDurationMinutes: 30 }),
  seedItem({ id: '10', tenantId: '1', categoryId: '4', name: 'Minibar restock', quantityEnabled: true, requiresLocation: true }),
  seedItem({ id: '11', tenantId: '2', categoryId: '5', name: 'Extra towels', quantityEnabled: true, requiresLocation: true }),
  seedItem({ id: '12', tenantId: '2', categoryId: '6', name: 'Air conditioner not cooling', defaultPriority: 'URGENT', requiresLocation: true }),
  seedItem({ id: '13', tenantId: '3', categoryId: '7', name: 'Room cleaning', requiresLocation: true }),
  seedItem({ id: '14', tenantId: '3', categoryId: '8', name: 'Luggage assistance' }),
  seedItem({ id: '15', tenantId: '4', categoryId: '9', name: 'Room cleaning', requiresLocation: true }),
]

const seedRule = (r: Pick<RoutingRule, 'id' | 'tenantId' | 'departmentId' | 'slaId'> & Partial<RoutingRule>): RoutingRule => ({
  matchItemId: null, matchCategoryId: null, matchLocationTypeId: null, matchPriority: null,
  remark: null, isActive: true, createDate: SEED, updateDate: SEED, ...r,
})

const routingRules: RoutingRule[] = [
  // Specificity tiers: exact item > category > location type > priority > catch-all.
  seedRule({ id: '1', tenantId: '1', matchItemId: '4', departmentId: '2', slaId: '2', remark: 'AC faults are urgent' }),
  seedRule({ id: '2', tenantId: '1', matchCategoryId: '1', departmentId: '1', slaId: '1' }),
  seedRule({ id: '3', tenantId: '1', matchCategoryId: '2', departmentId: '2', slaId: '1' }),
  seedRule({ id: '4', tenantId: '1', matchCategoryId: '3', departmentId: '3', slaId: '1' }),
  seedRule({ id: '5', tenantId: '1', matchCategoryId: '4', departmentId: '4', slaId: '1' }),
  // Location-type tier: itemless work raised in a public area goes to Front Office.
  seedRule({ id: '6', tenantId: '1', matchLocationTypeId: '3', departmentId: '3', slaId: '1', remark: 'Public areas are Front Office ground' }),
  seedRule({ id: '7', tenantId: '2', matchCategoryId: '5', departmentId: '5', slaId: '4' }),
  seedRule({ id: '8', tenantId: '2', matchCategoryId: '6', departmentId: '6', slaId: '4' }),
  seedRule({ id: '9', tenantId: '3', matchCategoryId: '7', departmentId: '7', slaId: '5' }),
  seedRule({ id: '10', tenantId: '3', matchCategoryId: '8', departmentId: '8', slaId: '5' }),
  // Priority tier: urgent work nothing above routed still gets Maintenance eyes.
  seedRule({ id: '11', tenantId: '2', matchPriority: 'URGENT', departmentId: '6', slaId: '4', remark: 'Unrouted urgent work goes to Maintenance' }),
  // Catch-all: everything else at Favehotels lands with Housekeeping.
  seedRule({ id: '12', tenantId: '2', departmentId: '5', slaId: '4', remark: 'Catch-all' }),
]

// ── seed: locations ───────────────────────────────────────────────────────────

const locationTypes: LocationType[] = [
  { id: '1', tenantId: '1', name: 'Guest Room', code: 'RM', linksRequester: true, sort: 1, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', name: 'Floor', code: 'FL', linksRequester: false, sort: 2, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', name: 'Public Area', code: 'PA', linksRequester: false, sort: 3, isActive: true, createDate: SEED, updateDate: SEED },
  // Deactivated: must not be offered when creating a location, but locations
  // that already reference it keep showing its real name.
  { id: '4', tenantId: '1', name: 'Back Office', code: 'BO', linksRequester: false, sort: 4, isActive: false, createDate: SEED, updateDate: SEED },
  { id: '5', tenantId: '2', name: 'Guest Room', code: 'RM', linksRequester: true, sort: 1, isActive: true, createDate: SEED, updateDate: SEED },
]

const propertyLocations: PropertyLocation[] = [
  // `currentGuest` is the demo stand-in for the PMS lookup: rooms have one,
  // and Room 1102 deliberately has none so the "no guest matched" warning is
  // reachable in the demo.
  { id: '1', tenantId: '1', locationTypeId: '1', name: 'Room 1204', code: '1204', parentId: null, currentGuest: 'Amelia Chen', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', locationTypeId: '1', name: 'Room 0908', code: '0908', parentId: null, currentGuest: 'Marcus Reid', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', locationTypeId: '1', name: 'Room 1102', code: '1102', parentId: null, currentGuest: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '4', tenantId: '1', locationTypeId: '2', name: 'Floor 7', code: 'F7', parentId: null, currentGuest: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '5', tenantId: '1', locationTypeId: '3', name: 'Lobby', code: 'LBY', parentId: null, currentGuest: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', tenantId: '1', locationTypeId: '4', name: 'Staff Canteen', code: 'CANT', parentId: null, currentGuest: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '7', tenantId: '2', locationTypeId: '5', name: 'Room 0304', code: '0304', parentId: null, currentGuest: 'Guest 304', isActive: true, createDate: SEED, updateDate: SEED },
]

// ── seed: teams ───────────────────────────────────────────────────────────────

const teams: Team[] = [
  { id: '1', tenantId: '1', name: 'HK Morning Shift', description: 'Rooms and corridors, 06:00–14:00', departmentId: '1', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', name: 'Engineering On-Call', description: 'After-hours maintenance response', departmentId: '2', isActive: true, createDate: SEED, updateDate: SEED },
]

/** Membership rows: one per (team, user). Never duplicated — add is guarded. */
const teamMembers: Array<{ teamId: Id, userId: Id }> = [
  { teamId: '1', userId: '10' },
  { teamId: '1', userId: '11' },
  { teamId: '2', userId: '12' },
]

// ── seed: operating schedules ─────────────────────────────────────────────────

const operatingSchedules: OperatingSchedule[] = [
  {
    id: '1', tenantId: '1', name: 'Property 24/7', isDefault: true, departmentId: null,
    // Open around the clock, every day. 1440 = until midnight.
    windows: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensMinutes: 0, closesMinutes: 1440 })),
    exceptions: [],
    createDate: SEED, updateDate: SEED,
  },
  {
    id: '2', tenantId: '1', name: 'Engineering Hours', isDefault: false, departmentId: '2',
    // Sunday (weekday 0) has no window at all: that IS the closed flag.
    windows: [
      { weekday: 1, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 2, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 3, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 4, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 5, opensMinutes: 480, closesMinutes: 1020 },
      { weekday: 6, opensMinutes: 480, closesMinutes: 780 },
    ],
    exceptions: [
      { date: '2026-08-17', isClosed: true, opensMinutes: null, closesMinutes: null },
    ],
    createDate: SEED, updateDate: SEED,
  },
]

// ── seed: terminology overrides ───────────────────────────────────────────────

const terminologyOverrides: Array<{ tenantId: Id, key: TerminologyKey, value: string }> = [
  { tenantId: '1', key: 'requester', value: 'Guest' },
]

const boards: Board[] = [
  { id: '1', tenantId: '1', name: 'Operations Board', createDate: SEED },
  { id: '2', tenantId: '2', name: 'Operations Board', createDate: SEED },
  { id: '3', tenantId: '3', name: 'Operations Board', createDate: SEED },
  { id: '4', tenantId: '4', name: 'Operations Board', createDate: SEED },
]

const boardColumns: BoardColumn[] = [
  { id: '1', boardId: '1', name: 'New', description: 'Waiting to be picked up', columnSort: 1, status: 'NEW', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', boardId: '1', name: 'In Progress', description: 'Being worked on now', columnSort: 2, status: 'IN_PROGRESS', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', boardId: '1', name: 'On Hold', description: 'Blocked or waiting on the requester', columnSort: 3, status: 'PENDING', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '20', boardId: '1', name: 'Awaiting Review', description: 'Submitted, waiting for a leader to review', columnSort: 4, status: 'SUBMITTED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '4', boardId: '1', name: 'Finished', description: 'Work done, awaiting verification', columnSort: 5, status: 'FINISHED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '5', boardId: '1', name: 'Verified', description: 'Checked and closed', columnSort: 6, status: 'VERIFIED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', boardId: '1', name: 'Cancelled', description: 'No longer required', columnSort: 7, status: 'CANCELLED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '7', boardId: '2', name: 'New', description: null, columnSort: 1, status: 'NEW', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '8', boardId: '2', name: 'In Progress', description: null, columnSort: 2, status: 'IN_PROGRESS', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '9', boardId: '2', name: 'Finished', description: null, columnSort: 3, status: 'FINISHED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '10', boardId: '2', name: 'Verified', description: null, columnSort: 4, status: 'VERIFIED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '11', boardId: '2', name: 'Cancelled', description: null, columnSort: 5, status: 'CANCELLED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '12', boardId: '3', name: 'New', description: null, columnSort: 1, status: 'NEW', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '13', boardId: '3', name: 'In Progress', description: null, columnSort: 2, status: 'IN_PROGRESS', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '14', boardId: '3', name: 'Finished', description: null, columnSort: 3, status: 'FINISHED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '15', boardId: '3', name: 'Cancelled', description: null, columnSort: 4, status: 'CANCELLED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '16', boardId: '4', name: 'New', description: null, columnSort: 1, status: 'NEW', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '17', boardId: '4', name: 'In Progress', description: null, columnSort: 2, status: 'IN_PROGRESS', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '18', boardId: '4', name: 'Finished', description: null, columnSort: 3, status: 'FINISHED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '19', boardId: '4', name: 'Cancelled', description: null, columnSort: 4, status: 'CANCELLED', isActive: true, createDate: SEED, updateDate: SEED },
]

// ── seed: staff identity ──────────────────────────────────────────────────────

const staffUsers: StaffUser[] = [
  { id: '1', firstName: 'Rina', lastName: 'Wijaya', email: 'rina.w@sentineltech.com', picture: null, isOperator: true, isActive: true, lastLogin: '2026-08-24T09:12:00.000Z', createDate: SEED, updateDate: SEED },
  { id: '10', firstName: 'Budi', lastName: 'Santoso', email: 'budi.s@aston.example', picture: null, isOperator: false, isActive: true, lastLogin: '2026-08-25T01:05:00.000Z', createDate: SEED, updateDate: SEED },
  { id: '11', firstName: 'Sari', lastName: 'Lestari', email: 'sari.l@aston.example', picture: null, isOperator: false, isActive: true, lastLogin: '2026-08-25T00:40:00.000Z', createDate: SEED, updateDate: SEED },
  { id: '12', firstName: 'Agus', lastName: 'Pratama', email: 'agus.p@aston.example', picture: null, isOperator: false, isActive: true, lastLogin: '2026-08-24T23:00:00.000Z', createDate: SEED, updateDate: SEED },
  { id: '13', firstName: 'Dewi', lastName: 'Kartika', email: 'dewi.k@aston.example', picture: null, isOperator: false, isActive: true, lastLogin: '2026-08-24T16:20:00.000Z', createDate: SEED, updateDate: SEED },
  { id: '14', firstName: 'Joko', lastName: 'Susilo', email: 'joko.s@aston.example', picture: null, isOperator: false, isActive: true, lastLogin: null, createDate: SEED, updateDate: SEED },
  { id: '15', firstName: 'Maya', lastName: 'Anggraini', email: 'maya.a@aston.example', picture: null, isOperator: false, isActive: true, lastLogin: null, createDate: SEED, updateDate: SEED },
  { id: '20', firstName: 'Hendra', lastName: 'Gunawan', email: 'hendra.g@aston.example', picture: null, isOperator: false, isActive: true, lastLogin: '2026-08-23T08:00:00.000Z', createDate: SEED, updateDate: SEED },
  { id: '30', firstName: 'Putri', lastName: 'Handayani', email: 'putri.h@favehotels.example', picture: null, isOperator: false, isActive: true, lastLogin: null, createDate: SEED, updateDate: SEED },
]

const staffProfiles: StaffProfile[] = [
  // Aston Simatupang (tenant 1)
  { id: '1', tenantId: '1', userId: '10', departmentId: '1', position: 'Room Attendant', role: 'staff', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', userId: '11', departmentId: '1', position: 'Housekeeping Supervisor', role: 'leader', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', userId: '12', departmentId: '2', position: 'Technician', role: 'staff', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '4', tenantId: '1', userId: '13', departmentId: null, position: 'Operations Manager', role: 'admin', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '5', tenantId: '1', userId: '14', departmentId: '3', position: 'Front Desk Agent', role: 'staff', canCreateTask: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', tenantId: '1', userId: '15', departmentId: '4', position: 'F&B Attendant', role: 'staff', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
  // Aston Kuningan Suites (tenant 2) — Budi also works here, so the tenant
  // switcher has something to switch to; Hendra is the group-grant holder.
  { id: '7', tenantId: '2', userId: '10', departmentId: '5', position: 'Room Attendant', role: 'staff', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '8', tenantId: '2', userId: '20', departmentId: null, position: 'Regional Manager', role: 'admin', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
  // Favehotels Wahid Hasyim (tenant 3)
  { id: '9', tenantId: '3', userId: '30', departmentId: '7', position: 'Room Attendant', role: 'staff', canCreateTask: true, isActive: true, createDate: SEED, updateDate: SEED },
]

// ── seed: tasks ───────────────────────────────────────────────────────────────
//
// Laid out relative to SEED_NOW (2026-08-25T03:00Z) so the first render shows a
// realistic mix: fresh unclaimed work, in-progress work, a breached SLA, and
// closed history. Tenant 1 carries the rich demo data.

/** Task seed helper: fills the fields most rows leave at their defaults. */
function seedTask(row: Pick<Task, 'id' | 'tenantId' | 'status' | 'title' | 'activationDate'> & Partial<Task>): Task {
  return {
    partnerId: null,
    externalRef: null,
    itemId: null,
    departmentId: null,
    columnId: null,
    slaId: null,
    description: null,
    location: null,
    locationId: null,
    quantity: null,
    requestedFor: null,
    priority: 'NORMAL',
    checklist: [],
    completionNote: null,
    submittedBy: null,
    submittedAt: null,
    responseDueAt: null,
    resolutionDueAt: null,
    responseDuration: null,
    resolutionDuration: null,
    responseSlaStatus: 'EMPTY',
    resolutionSlaStatus: 'EMPTY',
    createDate: row.activationDate,
    updateDate: row.activationDate,
    ...row,
  }
}

const tasks: Task[] = [
  // Unclaimed, fresh, from Butler → Housekeeping. The staff "to claim" queue.
  seedTask({ id: '1', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88412', itemId: '1', status: 'NEW', departmentId: '1', columnId: '1', slaId: '1', title: 'Extra towels', description: 'Two bath towels please', location: '1204', locationId: '1', quantity: 2, requestedFor: 'Amelia Chen', activationDate: '2026-08-25T02:52:00.000Z', responseDueAt: '2026-08-25T03:07:00.000Z', resolutionDueAt: '2026-08-25T03:37:00.000Z' }),
  // Unclaimed and already past its response target → breached, needs attention.
  seedTask({ id: '2', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88399', itemId: '4', status: 'NEW', departmentId: '2', columnId: '1', slaId: '2', title: 'Air conditioner not cooling', description: 'Guest reports room is very warm', location: '0908', locationId: '2', requestedFor: 'Marcus Reid', priority: 'URGENT', activationDate: '2026-08-25T02:15:00.000Z', responseDueAt: '2026-08-25T02:20:00.000Z', resolutionDueAt: '2026-08-25T02:35:00.000Z', responseSlaStatus: 'BREACHED', resolutionSlaStatus: 'BREACHED' }),
  // Claimed by Budi (10) and in progress — his "my work" list.
  seedTask({ id: '3', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88350', itemId: '2', status: 'IN_PROGRESS', departmentId: '1', columnId: '2', slaId: '1', title: 'Room cleaning', description: 'Full clean after checkout', location: '1102', locationId: '3', requestedFor: 'Priya Nair', checklist: ['Strip and remake the beds', 'Vacuum and mop the floors', 'Restock amenities'], activationDate: '2026-08-25T02:30:00.000Z', responseDueAt: '2026-08-25T02:45:00.000Z', resolutionDueAt: '2026-08-25T03:15:00.000Z', responseDuration: 6, responseSlaStatus: 'ON_TIME', updateDate: '2026-08-25T02:36:00.000Z' }),
  // Assigned to Budi by his leader — proves assignment ≠ claim.
  seedTask({ id: '4', tenantId: '1', itemId: '3', status: 'NEW', departmentId: '1', columnId: '1', slaId: '3', title: 'Turndown service — floor 12', description: 'Evening turndown, rooms 1201-1210', location: 'Floor 12', activationDate: '2026-08-25T01:00:00.000Z', responseDueAt: '2026-08-25T03:00:00.000Z', resolutionDueAt: '2026-08-25T09:00:00.000Z', updateDate: '2026-08-25T01:05:00.000Z' }),
  // Held by another housekeeper — this is the task a leader must NOT be able to
  // steal via Claim (finding 1). Claim on this returns 409. Budi helps on it,
  // so the "Helping" queue has something to show.
  seedTask({ id: '5', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88301', itemId: '10', status: 'IN_PROGRESS', departmentId: '4', columnId: '2', slaId: '1', title: 'Minibar restock', description: 'Restock water and soft drinks', location: '0710', quantity: 4, requestedFor: 'Diego Santos', activationDate: '2026-08-25T02:00:00.000Z', responseDueAt: '2026-08-25T02:15:00.000Z', resolutionDueAt: '2026-08-25T02:45:00.000Z', responseDuration: 9, responseSlaStatus: 'ON_TIME', updateDate: '2026-08-25T02:09:00.000Z' }),
  // On hold, waiting on the guest.
  seedTask({ id: '6', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88288', itemId: '7', status: 'PENDING', departmentId: '3', columnId: '3', slaId: '1', title: 'Airport transfer', description: 'Guest to confirm flight time', location: 'Lobby', locationId: '5', requestedFor: 'Sofia Rossi', activationDate: '2026-08-25T00:30:00.000Z', responseDueAt: '2026-08-25T00:45:00.000Z', resolutionDueAt: '2026-08-25T01:15:00.000Z', responseDuration: 11, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED', updateDate: '2026-08-25T00:41:00.000Z' }),
  // Finished by Budi, awaiting verification — his "done" tab.
  seedTask({ id: '7', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88201', itemId: '1', status: 'FINISHED', departmentId: '1', columnId: '4', slaId: '1', title: 'Extra towels', location: '1015', quantity: 1, requestedFor: 'John Doe', activationDate: '2026-08-24T23:00:00.000Z', responseDueAt: '2026-08-24T23:15:00.000Z', resolutionDueAt: '2026-08-24T23:45:00.000Z', responseDuration: 4, resolutionDuration: 22, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME', updateDate: '2026-08-24T23:26:00.000Z' }),
  // Verified and closed.
  seedTask({ id: '8', tenantId: '1', partnerId: '2', externalRef: 'PMS-5512', itemId: '6', status: 'VERIFIED', departmentId: '2', columnId: '5', slaId: '3', title: 'Plumbing / leak', description: 'Slow drain reported by PMS housekeeping sweep', location: '0402', priority: 'HIGH', activationDate: '2026-08-24T18:00:00.000Z', responseDueAt: '2026-08-25T03:00:00.000Z', resolutionDueAt: '2026-08-25T09:00:00.000Z', responseDuration: 38, resolutionDuration: 96, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME', updateDate: '2026-08-24T21:14:00.000Z' }),
  // Cancelled.
  seedTask({ id: '9', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88150', itemId: '8', status: 'CANCELLED', departmentId: '3', columnId: '6', slaId: '1', title: 'Late checkout request', description: 'Guest checked out on time after all', location: '0611', requestedFor: 'Sofia Rossi', priority: 'LOW', activationDate: '2026-08-24T20:00:00.000Z', responseDueAt: '2026-08-24T20:15:00.000Z', resolutionDueAt: '2026-08-24T20:45:00.000Z', responseDuration: 7, responseSlaStatus: 'ON_TIME', updateDate: '2026-08-24T20:22:00.000Z' }),
  // Maintenance work sitting in the Engineering On-Call TEAM pool: assigned (so
  // nobody's Claim steals it silently) but owned by no individual until a team
  // member claims it into a personal assignment.
  seedTask({ id: '10', tenantId: '1', itemId: '5', status: 'NEW', departmentId: '2', columnId: '1', slaId: '1', title: 'Light bulb replacement', description: 'Corridor lights out on floor 7', location: 'Floor 7', locationId: '4', quantity: 3, activationDate: '2026-08-25T02:45:00.000Z', responseDueAt: '2026-08-25T03:00:00.000Z', resolutionDueAt: '2026-08-25T03:30:00.000Z' }),
  // In-room dining, F&B.
  seedTask({ id: '11', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88420', itemId: '9', status: 'NEW', departmentId: '4', columnId: '1', slaId: '1', title: 'In-room dining', description: '2x nasi goreng, 1x jus jeruk', location: '1204', locationId: '1', quantity: 3, requestedFor: 'Amelia Chen', activationDate: '2026-08-25T02:58:00.000Z', responseDueAt: '2026-08-25T03:13:00.000Z', resolutionDueAt: '2026-08-25T03:43:00.000Z' }),
  // Tenant 2 — so switching tenants visibly changes the data. Sits in the
  // Housekeeping DEPARTMENT pool after a return.
  seedTask({ id: '12', tenantId: '2', partnerId: '1', externalRef: 'BTLR-91002', itemId: '11', status: 'NEW', departmentId: '5', columnId: '7', slaId: '4', title: 'Extra towels', location: '0304', locationId: '7', quantity: 2, requestedFor: 'Guest 304', activationDate: '2026-08-25T02:40:00.000Z', responseDueAt: '2026-08-25T03:00:00.000Z', resolutionDueAt: '2026-08-25T03:40:00.000Z' }),
  seedTask({ id: '13', tenantId: '2', itemId: '12', status: 'IN_PROGRESS', departmentId: '6', columnId: '8', slaId: '4', title: 'Air conditioner not cooling', description: 'Unit 512 compressor check', location: '0512', priority: 'URGENT', activationDate: '2026-08-25T01:30:00.000Z', responseDueAt: '2026-08-25T01:50:00.000Z', resolutionDueAt: '2026-08-25T02:30:00.000Z', responseDuration: 12, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED', updateDate: '2026-08-25T01:42:00.000Z' }),
  // Tenant 3 — Favehotels.
  seedTask({ id: '14', tenantId: '3', partnerId: '1', externalRef: 'BTLR-77010', itemId: '13', status: 'NEW', departmentId: '7', columnId: '12', slaId: '5', title: 'Room cleaning', location: '0210', requestedFor: 'Guest 210', activationDate: '2026-08-25T02:20:00.000Z', responseDueAt: '2026-08-25T02:50:00.000Z', resolutionDueAt: '2026-08-25T03:50:00.000Z', responseSlaStatus: 'BREACHED' }),
  // Submitted for review: Budi finished the work, attached the two required
  // proof photos and a completion note, and a leader now has it to review.
  // The resolution verdict is stamped at submission; approval never re-stamps.
  seedTask({ id: '15', tenantId: '1', itemId: '2', status: 'SUBMITTED', departmentId: '1', columnId: '20', slaId: '1', title: 'Room cleaning', description: 'Post-checkout deep clean', location: '0908', locationId: '2', checklist: ['Strip and remake the beds', 'Vacuum and mop the floors', 'Restock amenities'], completionNote: 'Deep-cleaned and restocked. AC filter rinsed while I was in there.', submittedBy: '10', submittedAt: '2026-08-25T02:20:00.000Z', activationDate: '2026-08-25T01:15:00.000Z', responseDueAt: '2026-08-25T01:30:00.000Z', resolutionDueAt: '2026-08-25T02:00:00.000Z', responseDuration: 8, resolutionDuration: 65, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED', updateDate: '2026-08-25T02:20:00.000Z' }),
]

/** Assignment seed helper: personal STAFF rows are the common case. */
function seedAssignment(row: Pick<TaskAssignment, 'id' | 'taskId' | 'createDate'> & Partial<TaskAssignment>): TaskAssignment {
  return {
    kind: 'STAFF',
    userId: null,
    teamId: null,
    departmentId: null,
    assignedBy: null,
    remark: null,
    isActive: true,
    updateDate: row.createDate,
    ...row,
  }
}

const taskAssignments: TaskAssignment[] = [
  seedAssignment({ id: '1', taskId: '3', userId: '10', assignedBy: '10', remark: 'Claimed', createDate: '2026-08-25T02:36:00.000Z' }),
  seedAssignment({ id: '2', taskId: '4', userId: '10', assignedBy: '11', remark: 'Please cover floor 12 tonight', createDate: '2026-08-25T01:05:00.000Z' }),
  seedAssignment({ id: '3', taskId: '5', userId: '15', assignedBy: '15', remark: 'Claimed', createDate: '2026-08-25T02:09:00.000Z' }),
  seedAssignment({ id: '4', taskId: '6', userId: '14', assignedBy: '14', remark: 'Claimed', createDate: '2026-08-25T00:41:00.000Z' }),
  seedAssignment({ id: '5', taskId: '7', userId: '10', assignedBy: '10', remark: 'Claimed', createDate: '2026-08-24T23:04:00.000Z' }),
  seedAssignment({ id: '6', taskId: '8', userId: '12', assignedBy: '13', createDate: '2026-08-24T18:38:00.000Z' }),
  seedAssignment({ id: '7', taskId: '9', userId: '14', assignedBy: '14', remark: 'Claimed', createDate: '2026-08-24T20:07:00.000Z' }),
  seedAssignment({ id: '8', taskId: '13', userId: '10', assignedBy: '10', remark: 'Claimed', createDate: '2026-08-25T01:42:00.000Z' }),
  // Pool assignments: a TEAM pool at tenant 1, a DEPARTMENT pool at tenant 2.
  seedAssignment({ id: '9', taskId: '10', kind: 'TEAM', teamId: '2', assignedBy: '11', remark: 'For the on-call rotation', createDate: '2026-08-25T02:46:00.000Z' }),
  seedAssignment({ id: '10', taskId: '12', kind: 'DEPARTMENT', departmentId: '5', assignedBy: null, remark: 'Returned to the pool: guest asked to come back after 15:00', createDate: '2026-08-25T02:41:00.000Z' }),
  // The submitted task is held by Budi, awaiting a leader's review.
  seedAssignment({ id: '11', taskId: '15', userId: '10', assignedBy: '10', remark: 'Claimed', createDate: '2026-08-25T01:23:00.000Z' }),
]

/** Helpers: Budi lends a hand on Maya's minibar restock. */
const taskCollaborators: TaskCollaborator[] = [
  { id: '1', taskId: '5', userId: '10', addedBy: '11', isActive: true, createDate: '2026-08-25T02:12:00.000Z' },
]

/** One pending delegation offer, so the leader's inbox has something in it. */
const taskOffers: TaskOffer[] = [
  { id: '1', tenantId: '1', taskId: '3', fromUserId: '10', toUserId: '11', note: 'Taking my break at 11 — could you cover this one?', state: 'PENDING', decidedAt: null, createDate: '2026-08-25T02:50:00.000Z' },
]

const taskHistory: TaskHistory[] = [
  { id: '1', taskId: '1', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T02:52:00.000Z' },
  { id: '2', taskId: '2', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T02:15:00.000Z' },
  { id: '3', taskId: '3', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T02:30:00.000Z' },
  { id: '4', taskId: '3', userId: '10', status: 'IN_PROGRESS', description: 'On my way up', createDate: '2026-08-25T02:36:00.000Z' },
  { id: '5', taskId: '4', userId: '11', status: 'NEW', description: 'Created for the evening shift', createDate: '2026-08-25T01:00:00.000Z' },
  { id: '6', taskId: '5', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T02:00:00.000Z' },
  { id: '7', taskId: '5', userId: '15', status: 'IN_PROGRESS', description: null, createDate: '2026-08-25T02:09:00.000Z' },
  { id: '8', taskId: '6', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T00:30:00.000Z' },
  { id: '9', taskId: '6', userId: '14', status: 'IN_PROGRESS', description: null, createDate: '2026-08-25T00:41:00.000Z' },
  { id: '10', taskId: '6', userId: '14', status: 'PENDING', description: 'Waiting for the guest to confirm the flight time', createDate: '2026-08-25T00:55:00.000Z' },
  { id: '11', taskId: '7', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-24T23:00:00.000Z' },
  { id: '12', taskId: '7', userId: '10', status: 'IN_PROGRESS', description: null, createDate: '2026-08-24T23:04:00.000Z' },
  { id: '13', taskId: '7', userId: '10', status: 'FINISHED', description: 'Delivered', createDate: '2026-08-24T23:26:00.000Z' },
  { id: '14', taskId: '8', userId: null, status: 'NEW', description: 'Dispatched by Sentec PMS', createDate: '2026-08-24T18:00:00.000Z' },
  { id: '15', taskId: '8', userId: '12', status: 'IN_PROGRESS', description: null, createDate: '2026-08-24T18:38:00.000Z' },
  { id: '16', taskId: '8', userId: '12', status: 'FINISHED', description: 'Cleared the trap, drains normally now', createDate: '2026-08-24T20:14:00.000Z' },
  { id: '17', taskId: '8', userId: '13', status: 'VERIFIED', description: 'Checked, all good', createDate: '2026-08-24T21:14:00.000Z' },
  { id: '18', taskId: '9', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-24T20:00:00.000Z' },
  { id: '19', taskId: '9', userId: '14', status: 'CANCELLED', description: 'Guest checked out on time', createDate: '2026-08-24T20:22:00.000Z' },
  { id: '20', taskId: '10', userId: '12', status: 'NEW', description: null, createDate: '2026-08-25T02:45:00.000Z' },
  { id: '21', taskId: '11', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T02:58:00.000Z' },
  { id: '22', taskId: '12', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T02:40:00.000Z' },
  { id: '23', taskId: '13', userId: '10', status: 'NEW', description: null, createDate: '2026-08-25T01:30:00.000Z' },
  { id: '24', taskId: '13', userId: '10', status: 'IN_PROGRESS', description: null, createDate: '2026-08-25T01:42:00.000Z' },
  { id: '25', taskId: '14', userId: null, status: 'NEW', description: 'Dispatched by Sentec Butler', createDate: '2026-08-25T02:20:00.000Z' },
  { id: '26', taskId: '15', userId: '11', status: 'NEW', description: 'Post-checkout deep clean for 0908', createDate: '2026-08-25T01:15:00.000Z' },
  { id: '27', taskId: '15', userId: '10', status: 'IN_PROGRESS', description: null, createDate: '2026-08-25T01:23:00.000Z' },
  { id: '28', taskId: '15', userId: '10', status: 'SUBMITTED', description: 'Submitted for review', createDate: '2026-08-25T02:20:00.000Z' },
]

const taskComments: TaskComment[] = [
  { id: '1', taskId: '3', userId: '10', comment: 'Guest still in the room, will come back in 10 minutes.', createDate: '2026-08-25T02:40:00.000Z' },
  { id: '2', taskId: '3', userId: '11', comment: 'Noted — swap with 1108 if it drags on.', createDate: '2026-08-25T02:44:00.000Z' },
  { id: '3', taskId: '6', userId: '14', comment: 'Left a message with the guest, no answer yet.', createDate: '2026-08-25T01:10:00.000Z' },
  { id: '4', taskId: '8', userId: '12', comment: 'Needed a new trap seal, took one from stores.', createDate: '2026-08-24T19:50:00.000Z' },
]

const taskAttachments: TaskAttachment[] = [
  { id: '1', taskId: '8', userId: '12', filetype: 'PHOTO', filename: 'leak-before.jpg', url: 'https://storage.example.com/tasks/leak-before.jpg', storageKey: null, isRemoved: false, createDate: '2026-08-24T18:45:00.000Z' },
  { id: '2', taskId: '8', userId: '12', filetype: 'PHOTO', filename: 'leak-after.jpg', url: 'https://storage.example.com/tasks/leak-after.jpg', storageKey: null, isRemoved: false, createDate: '2026-08-24T20:12:00.000Z' },
  { id: '3', taskId: '8', userId: '13', filetype: 'PDF', filename: 'maintenance-checklist.pdf', url: 'https://storage.example.com/tasks/maintenance-checklist.pdf', storageKey: null, isRemoved: false, createDate: '2026-08-24T21:10:00.000Z' },
  // Task 15's proof photos: uploaded through the presigned path, so they carry
  // a storage key. Item 2 requires two photos — exactly what the gate demands.
  { id: '4', taskId: '15', userId: '10', filetype: 'PHOTO', filename: 'room-0908-bed.jpg', url: 'https://storage.sentec.example/tenants/1/uploads/1.jpg', storageKey: 'tenants/1/uploads/1.jpg', isRemoved: false, createDate: '2026-08-25T02:18:00.000Z' },
  { id: '5', taskId: '15', userId: '10', filetype: 'PHOTO', filename: 'room-0908-bath.jpg', url: 'https://storage.sentec.example/tenants/1/uploads/2.jpg', storageKey: 'tenants/1/uploads/2.jpg', isRemoved: false, createDate: '2026-08-25T02:19:00.000Z' },
]

const statusEvents: StatusEvent[] = [
  { id: '1', taskId: '3', partnerId: '1', status: 'IN_PROGRESS', deliveredAt: '2026-08-25T02:36:02.000Z', attempts: 1, createDate: '2026-08-25T02:36:00.000Z' },
  { id: '2', taskId: '7', partnerId: '1', status: 'FINISHED', deliveredAt: '2026-08-24T23:26:01.000Z', attempts: 1, createDate: '2026-08-24T23:26:00.000Z' },
  { id: '3', taskId: '8', partnerId: '2', status: 'VERIFIED', deliveredAt: null, attempts: 3, createDate: '2026-08-24T21:14:00.000Z' },
  { id: '4', taskId: '9', partnerId: '1', status: 'CANCELLED', deliveredAt: '2026-08-24T20:22:03.000Z', attempts: 1, createDate: '2026-08-24T20:22:00.000Z' },
]

const auditEvents: AuditEvent[] = [
  { id: '1', tenantId: null, actorUserId: '1', action: 'group_grant.granted', target: 'group:1 user:20', detail: 'Regional Manager granted read+write across Aston', createDate: '2026-08-10T04:00:00.000Z' },
  { id: '2', tenantId: null, actorUserId: '1', action: 'partner.created', target: 'partner:1', detail: 'Sentec Butler registered; secret issued once', createDate: SEED },
  { id: '3', tenantId: null, actorUserId: '1', action: 'tenant.created', target: 'tenant:4', detail: 'Neo Kuta Legian provisioned', createDate: SEED },
  { id: '4', tenantId: '1', actorUserId: '13', action: 'sla.updated', target: 'sla:2', detail: 'Urgent response target 10 → 5 minutes', createDate: '2026-08-20T06:30:00.000Z' },
  { id: '5', tenantId: '1', actorUserId: '13', action: 'routing_rule.created', target: 'routing_rule:1', detail: 'AC faults routed to Maintenance on the Urgent SLA', createDate: '2026-08-20T06:35:00.000Z' },
]

// ── errors ────────────────────────────────────────────────────────────────────

/** HTTP status is carried explicitly so callers can branch on 409 vs 403. */
export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'ApiError'
  }
}

function badRequest(message: string) { return new ApiError('BAD_REQUEST', message, 400) }
function unauthorized(message = 'Sign in to continue') { return new ApiError('UNAUTHORIZED', message, 401) }
function forbidden(message: string) { return new ApiError('FORBIDDEN', message, 403) }
function notFound(what: string) { return new ApiError('NOT_FOUND', `${what} not found`, 404) }
function conflict(code: string, message: string) { return new ApiError(code, message, 409) }

// ── session store ─────────────────────────────────────────────────────────────
//
// The real API issues an httpOnly cookie session with CSRF protection and a CORS
// allow-list. A browser-side mock cannot create an httpOnly cookie — that is
// necessarily a server concern — so this models the *shape* instead: login mints
// an opaque session id held in memory here, the client never sees a user id or a
// bearer token, and every request is resolved from the session id alone. Nothing
// authorization-bearing is written to localStorage.

interface Session {
  id: Id
  userId: Id
  createdAt: string
  /** Paired with the session the way the real CSRF double-submit token is. */
  csrfToken: string
}

/**
 * How long a signed-in shift lasts before the user has to authenticate again.
 * One shift plus a margin — long enough not to interrupt work, short enough
 * that a device left on a desk does not stay open indefinitely.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

/**
 * Opaque resume token, the mock's stand-in for the httpOnly session cookie.
 *
 * A real deployment keeps sessions in Postgres and the browser holds only the
 * cookie; here the session map is in-memory and therefore dies with the page,
 * so a token that re-establishes the session is what lets a refresh behave the
 * way a cookie would. It carries no privileges of its own: the user must still
 * exist and be active, and the token must be inside its TTL.
 */
function issueResumeToken(userId: Id, issuedAtMs: number) {
  return btoa(`v1.${userId}.${issuedAtMs}`)
}

function readResumeToken(token: string): { userId: Id, issuedAtMs: number } | null {
  let decoded: string
  try {
    decoded = atob(token)
  }
  catch {
    return null
  }
  const parts = decoded.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const issuedAtMs = Number(parts[2])
  if (!parts[1] || !Number.isFinite(issuedAtMs)) return null
  return { userId: parts[1], issuedAtMs }
}

const sessions = new Map<Id, Session>()
let sessionCounter = 0

/**
 * Monotonic counter behind the mock partner secret. A timestamp alone is not
 * enough: creating and rotating inside the same millisecond would mint the
 * identical string, so a "rotation" could hand back the very secret it was
 * meant to replace.
 */
let secretCounter = 0
function mintPartnerSecret(partnerId: Id) {
  secretCounter += 1
  return `sk_live_${partnerId}_${secretCounter.toString(36)}${Date.now().toString(36)}`
}

/** Monotonic counter behind presigned-upload storage keys. */
let uploadCounter = 2 // seeds 1 and 2 are task 15's proof photos

/**
 * Presigned-upload validation: the allow-list and per-type size caps the real
 * API enforces. 10 MiB for images, 20 MiB for PDFs.
 */
export const UPLOAD_MAX_BYTES: Record<string, number> = {
  'image/jpeg': 10 * 1024 * 1024,
  'image/png': 10 * 1024 * 1024,
  'image/webp': 10 * 1024 * 1024,
  'image/heic': 10 * 1024 * 1024,
  'application/pdf': 20 * 1024 * 1024,
}

/** Demo credentials. Each maps to a seeded user; the role comes from the seed. */
const DEMO_PASSWORDS: Record<string, { userId: Id; password: string }> = {
  staff: { userId: '10', password: 'staff123' },
  leader: { userId: '11', password: 'leader123' },
  admin: { userId: '13', password: 'admin123' },
  operator: { userId: '1', password: 'operator123' },
  regional: { userId: '20', password: 'regional123' },
}

export interface SessionUser {
  userId: Id
  displayName: string
  email: string
  isOperator: boolean
  /** Tenants this user may act in, already resolved through group grants. */
  tenants: Array<{ id: Id; name: string; role: TenantRole | null; viaGroupGrant: boolean }>
}

function displayNameOf(user: StaffUser) {
  return `${user.firstName} ${user.lastName}`.trim() || user.email
}

/**
 * Tenants reachable by a user: direct memberships, plus every tenant in a group
 * they hold a live grant on. Operators reach every active tenant.
 */
function reachableTenants(user: StaffUser): SessionUser['tenants'] {
  if (user.isOperator) {
    return tenants
      .filter(t => t.isActive)
      .map(t => ({ id: t.id, name: t.name, role: 'admin' as TenantRole, viaGroupGrant: false }))
  }

  const out = new Map<Id, SessionUser['tenants'][number]>()

  for (const profile of staffProfiles) {
    if (profile.userId !== user.id || !profile.isActive) continue
    const tenant = tenants.find(t => t.id === profile.tenantId && t.isActive)
    if (!tenant) continue
    out.set(tenant.id, { id: tenant.id, name: tenant.name, role: profile.role, viaGroupGrant: false })
  }

  // A group grant carries read+write into every tenant of that group. Direct
  // membership wins, so a grant never downgrades an existing role.
  for (const grant of groupGrants) {
    if (grant.userId !== user.id || grant.revokedAt) continue
    for (const tenant of tenants) {
      if (tenant.tenantGroupId !== grant.tenantGroupId || !tenant.isActive) continue
      if (out.has(tenant.id)) continue
      out.set(tenant.id, { id: tenant.id, name: tenant.name, role: 'admin', viaGroupGrant: true })
    }
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function sessionUser(user: StaffUser): SessionUser {
  return {
    userId: user.id,
    displayName: displayNameOf(user),
    email: user.email,
    isOperator: user.isOperator,
    tenants: reachableTenants(user),
  }
}

// ── per-request context ───────────────────────────────────────────────────────

interface RequestCtx {
  userId: Id | null
  user: StaffUser | null
  tenantId: Id | null
  isOperator: boolean
  /** Effective role at `tenantId`, operator folded in. */
  role: ResolvedRole
  /** The membership row at `tenantId`, when there is a direct one. */
  profile: StaffProfile | null
  /** Department at `tenantId`, or null for admins/operators with no department. */
  departmentId: Id | null
  canCreateTask: boolean
  reachableTenantIds: Id[]
}

const ANON: RequestCtx = {
  userId: null, user: null, tenantId: null, isOperator: false, role: null,
  profile: null, departmentId: null, canCreateTask: false, reachableTenantIds: [],
}

function resolveCtx(headers: Record<string, string>): RequestCtx {
  const sessionId = headers['x-session-id'] ?? ''
  const session = sessionId ? sessions.get(sessionId) : undefined
  if (!session) return ANON

  const user = staffUsers.find(u => u.id === session.userId && u.isActive)
  if (!user) return ANON

  const tenantId = headers['x-tenant-id'] ? String(headers['x-tenant-id']) : null
  const reachable = reachableTenants(user)
  const reachableTenantIds = reachable.map(t => t.id)

  if (user.isOperator) {
    return {
      userId: user.id, user, tenantId, isOperator: true, role: 'operator',
      profile: null, departmentId: null, canCreateTask: true, reachableTenantIds,
    }
  }

  const profile = tenantId
    ? staffProfiles.find(p => p.userId === user.id && p.tenantId === tenantId && p.isActive) ?? null
    : null

  // No direct membership but a live group grant → acts as an admin there.
  const granted = tenantId ? reachable.find(t => t.id === tenantId && t.viaGroupGrant) : undefined
  const role: ResolvedRole = profile ? profile.role : granted ? 'admin' : null

  return {
    userId: user.id,
    user,
    tenantId,
    isOperator: false,
    role,
    profile,
    departmentId: profile?.departmentId ?? null,
    canCreateTask: profile ? profile.canCreateTask || profile.role !== 'staff' : Boolean(granted),
    reachableTenantIds,
  }
}

function requireSession(ctx: RequestCtx) {
  if (!ctx.userId) throw unauthorized()
}

/** Operator-only. Used for provisioning: tenants, groups, partners, grants. */
function requireOperator(ctx: RequestCtx) {
  requireSession(ctx)
  if (!ctx.isOperator) throw forbidden('This action is restricted to Sentinel Tech operators')
}

/** Resolve the tenant for a tenant-scoped request and check reachability. */
function requireTenantId(ctx: RequestCtx): Id {
  requireSession(ctx)
  if (!ctx.tenantId) throw badRequest('A property must be selected for this request')
  if (!ctx.reachableTenantIds.includes(ctx.tenantId)) {
    throw forbidden('You do not have access to this property')
  }
  return ctx.tenantId
}

/** Require one of the listed tenant roles; operators always pass. */
function requireRole(ctx: RequestCtx, ...roles: Exclude<ResolvedRole, null>[]) {
  requireSession(ctx)
  if (ctx.isOperator) return
  if (!ctx.role) throw forbidden('You do not have access to this property')
  if (!roles.includes(ctx.role)) throw forbidden('You do not have permission to perform this action')
}

/** Leaders and admins see and act on the whole property; staff do not. */
function isManager(ctx: RequestCtx) {
  return ctx.isOperator || ctx.role === 'admin' || ctx.role === 'leader'
}

// ── join helpers ──────────────────────────────────────────────────────────────

function userBrief(id: Id | null) {
  if (!id) return null
  const u = staffUsers.find(x => x.id === id)
  return u ? { id: u.id, firstName: u.firstName, lastName: u.lastName, picture: u.picture } : null
}

function activeAssignment(taskId: Id) {
  return taskAssignments.find(a => a.taskId === taskId && a.isActive) ?? null
}

function teamBrief(id: Id | null) {
  if (!id) return null
  const t = teams.find(x => x.id === id)
  return t ? { id: t.id, name: t.name } : null
}

function assignmentBrief(taskId: Id) {
  const a = activeAssignment(taskId)
  if (!a) return null
  return {
    id: a.id,
    /** The only reliable "is it assigned" signal — pool rows have no userId. */
    kind: a.kind,
    userId: a.userId,
    teamId: a.teamId,
    departmentId: a.departmentId,
    assignedBy: a.assignedBy,
    remark: a.remark,
    user: userBrief(a.userId),
    team: teamBrief(a.teamId),
    department: departmentBrief(a.departmentId),
    assignedByUser: userBrief(a.assignedBy),
  }
}

function isActiveHelper(taskId: Id, userId: Id | null) {
  return Boolean(userId && taskCollaborators.some(c => c.taskId === taskId && c.userId === userId && c.isActive))
}

function pendingOfferFor(taskId: Id) {
  return taskOffers.find(o => o.taskId === taskId && o.state === 'PENDING') ?? null
}

/** Whether `userId` may claim this pool assignment (team member / dept staff). */
function canClaimPool(assignment: TaskAssignment, profile: StaffProfile | null, userId: Id) {
  if (assignment.kind === 'TEAM') {
    return teamMembers.some(m => m.teamId === assignment.teamId && m.userId === userId)
  }
  if (assignment.kind === 'DEPARTMENT') {
    return Boolean(profile && profile.departmentId === assignment.departmentId)
  }
  return false
}

function itemBrief(id: Id | null) {
  if (!id) return null
  const item = catalogItems.find(i => i.id === id)
  if (!item) return null
  const category = catalogCategories.find(c => c.id === item.categoryId) ?? null
  return {
    id: item.id,
    name: item.name,
    quantityEnabled: item.quantityEnabled,
    category: category ? { id: category.id, name: category.name, icon: category.icon } : null,
  }
}

function slaBrief(id: Id | null) {
  if (!id) return null
  const s = slas.find(x => x.id === id)
  return s ? { id: s.id, name: s.name, responseTime: s.responseTime, resolutionTime: s.resolutionTime } : null
}

function departmentBrief(id: Id | null) {
  if (!id) return null
  const d = departments.find(x => x.id === id)
  return d ? { id: d.id, name: d.name } : null
}

function columnBrief(id: Id | null) {
  if (!id) return null
  const c = boardColumns.find(x => x.id === id)
  return c ? { id: c.id, name: c.name, columnSort: c.columnSort, status: c.status } : null
}

function partnerBrief(id: Id | null) {
  if (!id) return null
  const p = partners.find(x => x.id === id)
  if (!p) return null
  // The registry is what lets a client badge the task with where it came from.
  const app = p.sourceAppCode ? sourceApps.find(a => a.code === p.sourceAppCode) : undefined
  return { id: p.id, name: p.name, kind: p.kind, sourceAppCode: p.sourceAppCode, badgeColor: app?.badgeColor ?? null }
}

function taskListItem(t: Task) {
  return {
    ...t,
    item: itemBrief(t.itemId),
    sla: slaBrief(t.slaId),
    department: departmentBrief(t.departmentId),
    column: columnBrief(t.columnId),
    partner: partnerBrief(t.partnerId),
    assignment: assignmentBrief(t.id),
  }
}

function taskDetail(t: Task) {
  const item = t.itemId ? catalogItems.find(i => i.id === t.itemId) ?? null : null
  const offer = pendingOfferFor(t.id)
  return {
    ...taskListItem(t),
    history: taskHistory
      .filter(h => h.taskId === t.id)
      .sort((a, b) => a.createDate.localeCompare(b.createDate))
      .map(h => ({ ...h, user: userBrief(h.userId) })),
    comments: taskComments
      .filter(c => c.taskId === t.id)
      .sort((a, b) => a.createDate.localeCompare(b.createDate))
      .map(c => ({ ...c, user: userBrief(c.userId) })),
    // Removed attachments stay in the list (flagged), so the UI can offer
    // Restore instead of pretending they never existed.
    attachments: taskAttachments
      .filter(a => a.taskId === t.id)
      .sort((a, b) => a.createDate.localeCompare(b.createDate))
      .map(a => ({ ...a, user: userBrief(a.userId) })),
    collaborators: taskCollaborators
      .filter(c => c.taskId === t.id && c.isActive)
      .map(c => ({ ...c, user: userBrief(c.userId) })),
    /** Zero-valued when the task has no item or the item no longer resolves. */
    proofRequirements: {
      minProofPhotos: item?.minProofPhotos ?? 0,
      requiresCompletionNote: item?.requiresCompletionNote ?? false,
    },
    pendingOffer: offer
      ? { id: offer.id, fromUserId: offer.fromUserId, toUserId: offer.toUserId, note: offer.note, createDate: offer.createDate, fromUser: userBrief(offer.fromUserId), toUser: userBrief(offer.toUserId) }
      : null,
  }
}

function boardForTenant(tenantId: Id) {
  const board = boards.find(b => b.tenantId === tenantId)
  if (!board) return null
  return {
    ...board,
    columns: boardColumns
      .filter(c => c.boardId === board.id && c.isActive && !c.isRemoved)
      .sort((a, b) => a.columnSort - b.columnSort),
  }
}

/** Exported for the UI's status/column pickers. */
export type TaskListItem = ReturnType<typeof taskListItem>
export type TaskDetail = ReturnType<typeof taskDetail>
export type BoardWithColumns = NonNullable<ReturnType<typeof boardForTenant>>

// ── task visibility ───────────────────────────────────────────────────────────

/**
 * Whether `ctx` may READ this task.
 *
 * Finding 2: the old endpoint checked nothing beyond the tenant, so any staff
 * member who knew an id could read another department's full history, comments
 * and attachments. Visibility is now:
 *   - managers (leader/admin) and operators: everything in the property;
 *   - staff: their own assigned work, plus their own department's queue.
 */
function canReadTask(ctx: RequestCtx, t: Task): boolean {
  if (isManager(ctx)) return true
  if (!ctx.userId) return false
  const assignment = activeAssignment(t.id)
  if (assignment?.userId === ctx.userId) return true
  // Helpers and the target of a pending offer see the task they were pulled
  // into, whatever department it belongs to.
  if (isActiveHelper(t.id, ctx.userId)) return true
  if (pendingOfferFor(t.id)?.toUserId === ctx.userId) return true
  return Boolean(ctx.departmentId && t.departmentId === ctx.departmentId)
}

/**
 * The staff task list.
 *
 * Rule change from Butler: the old behaviour hid every unclaimed task from
 * staff — which is backwards, since staff are exactly who should claim them.
 * Staff now see their own work plus the unclaimed queue in their department.
 */
function visibleTasks(ctx: RequestCtx, tenantId: Id): Task[] {
  const scoped = tasks.filter(t => t.tenantId === tenantId)
  if (isManager(ctx)) return scoped
  return scoped.filter(t => canReadTask(ctx, t))
}

// ── routing ───────────────────────────────────────────────────────────────────

/**
 * Match a task against the tenant's routing rules to pick its department + SLA.
 * Tiers run most-specific-first — exact item, then category, then location
 * type, then priority, then catch-all — and within a tier the oldest rule
 * wins. No match falls back to the tenant's default SLA with no department,
 * which surfaces the task to everyone rather than silently dropping it.
 */
function resolveRouting(tenantId: Id, itemId: Id | null, locationTypeId: Id | null, priority: TaskPriority) {
  const item = itemId ? catalogItems.find(i => i.id === itemId) ?? null : null
  const candidates = routingRules
    .filter(r => r.tenantId === tenantId && r.isActive)
    .sort((a, b) => Number(a.id) - Number(b.id))

  const tierMatchers: Record<RoutingTier, (rule: RoutingRule) => boolean> = {
    ITEM: rule => rule.matchItemId != null && rule.matchItemId === itemId,
    CATEGORY: rule => rule.matchCategoryId != null && item != null && rule.matchCategoryId === item.categoryId,
    LOCATION_TYPE: rule => rule.matchLocationTypeId != null && locationTypeId != null && rule.matchLocationTypeId === locationTypeId,
    PRIORITY: rule => rule.matchPriority != null && rule.matchPriority === priority,
    CATCH_ALL: rule => routingTier(rule) === 'CATCH_ALL',
  }
  for (const tier of ROUTING_TIERS) {
    const hit = candidates.find(rule => routingTier(rule) === tier && tierMatchers[tier](rule))
    if (hit) return hit
  }
  return null
}

function defaultSlaId(tenantId: Id): Id | null {
  return slas.find(s => s.tenantId === tenantId && s.isDefault)?.id ?? null
}

/**
 * Fixed UTC offsets for the timezones the demo tenants use. A mock has no
 * business shipping a timezone database; anything unknown falls back to UTC.
 */
const TIMEZONE_OFFSET_MINUTES: Record<string, number> = {
  'Asia/Jakarta': 420,
  'Asia/Makassar': 480,
}

function tenantUtcOffsetMinutes(tenantId: Id): number {
  const timezone = tenants.find(t => t.id === tenantId)?.timezone ?? ''
  return TIMEZONE_OFFSET_MINUTES[timezone] ?? 0
}

/** The schedule governing a department's clocks: its own, else the tenant default. */
function scheduleFor(tenantId: Id, departmentId: Id | null) {
  return (departmentId ? operatingSchedules.find(s => s.tenantId === tenantId && s.departmentId === departmentId) : undefined)
    ?? operatingSchedules.find(s => s.tenantId === tenantId && s.isDefault && s.departmentId === null)
    ?? null
}

/** The open windows on one local calendar day, exceptions first. */
function openWindowsOn(schedule: OperatingSchedule, localDate: string, weekday: number): Array<{ opens: number, closes: number }> {
  const exception = schedule.exceptions.find(e => e.date === localDate)
  if (exception) {
    if (exception.isClosed) return []
    return [{ opens: exception.opensMinutes ?? 0, closes: exception.closesMinutes ?? 1440 }]
  }
  return schedule.windows
    .filter(w => w.weekday === weekday)
    .map(w => ({ opens: w.opensMinutes, closes: w.closesMinutes }))
    .sort((a, b) => a.opens - b.opens)
}

/**
 * Advance `startIso` by `minutes` of OPEN time on the department's operating
 * schedule — an SLA deadline only ticks while the department is open. With no
 * schedule at all the clock is a plain wall clock, and a schedule that never
 * opens falls back the same way rather than producing a deadline at infinity.
 */
function addOpenMinutes(tenantId: Id, departmentId: Id | null, startIso: string, minutes: number): string {
  const schedule = scheduleFor(tenantId, departmentId)
  if (!schedule || minutes <= 0) return minutesFrom(startIso, minutes)

  const offsetMs = tenantUtcOffsetMinutes(tenantId) * 60_000
  const DAY = 1440 * 60_000
  // Work in "local ms": the UTC epoch shifted by the tenant offset, so a
  // calendar day is a plain [midnight, midnight) range.
  let cursor = Date.parse(startIso) + offsetMs
  let remaining = minutes * 60_000
  for (let day = 0; day < 400; day++) {
    const dayStart = Math.floor(cursor / DAY) * DAY
    const local = new Date(dayStart)
    const windows = openWindowsOn(schedule, local.toISOString().slice(0, 10), local.getUTCDay())
    for (const window of windows) {
      const from = Math.max(cursor, dayStart + window.opens * 60_000)
      const to = dayStart + window.closes * 60_000
      if (from >= to) continue
      if (remaining <= to - from) {
        return new Date(from + remaining - offsetMs).toISOString()
      }
      remaining -= to - from
      cursor = to
    }
    cursor = dayStart + DAY
  }
  return minutesFrom(startIso, minutes)
}

/**
 * Stamp response/resolution targets from the SLA, per the dispatch flow. Both
 * budgets count from activation — resolution is NOT stacked on response — and
 * both are measured in the owning department's open hours. Budgets are
 * snapshotted here at creation: editing an SLA never retro-changes a promise.
 */
function stampSla(task: Task, slaId: Id | null, activationIso: string) {
  const sla = slaId ? slas.find(s => s.id === slaId) : undefined
  task.slaId = slaId
  task.activationDate = activationIso
  if (!sla) {
    task.responseDueAt = null
    task.resolutionDueAt = null
    return
  }
  task.responseDueAt = addOpenMinutes(task.tenantId, task.departmentId, activationIso, sla.responseTime)
  task.resolutionDueAt = addOpenMinutes(task.tenantId, task.departmentId, activationIso, sla.resolutionTime)
}

/** Queue an outbound status event when the task came from a partner. */
function emitStatusEvent(task: Task, status: TaskStatus, now: string) {
  if (!task.partnerId) return
  statusEvents.push({
    id: nextId(statusEvents),
    taskId: task.id,
    partnerId: task.partnerId,
    status,
    deliveredAt: now,
    attempts: 1,
    createDate: now,
  })
}

function audit(ctx: RequestCtx, action: string, target: string, detail: string | null, now: string, tenantId: Id | null = null) {
  auditEvents.push({
    id: nextId(auditEvents),
    tenantId,
    actorUserId: ctx.userId,
    action,
    target,
    detail,
    createDate: now,
  })
}

// ── request router ────────────────────────────────────────────────────────────

export interface FakeApiOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  query?: Record<string, unknown>
}

/** Cursor pagination: opaque to callers, an offset here. See ADR-0003. */
function paginate<T>(rows: T[], query: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100)
  const offset = Number(query.cursor) || 0
  const page = rows.slice(offset, offset + limit)
  const next = offset + limit < rows.length ? String(offset + limit) : null
  return { page, meta: { totalCount: rows.length, nextCursor: next } }
}

export function handleFakeApiRequest(path: string, opts: FakeApiOptions = {}) {
  const method = (opts.method ?? 'GET').toUpperCase()
  const body = (opts.body ?? {}) as Record<string, unknown>
  const headers = (opts.headers ?? {}) as Record<string, string>
  const query = (opts.query ?? {}) as Record<string, unknown>
  const ctx = resolveCtx(headers)
  const now = nowIso()

  // ════════════════════════ Auth / session ════════════════════════

  if (method === 'POST' && path === '/v1/auth/login') {
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const demo = DEMO_PASSWORDS[username]
    // One generic message for both branches: never reveal which half was wrong.
    if (!demo || demo.password !== password) {
      throw new ApiError('INVALID_CREDENTIALS', 'Invalid username or password.', 401)
    }
    const user = staffUsers.find(u => u.id === demo.userId && u.isActive)
    if (!user) throw unauthorized('Account not found or deactivated.')

    const resolved = sessionUser(user)
    if (!resolved.tenants.length && !user.isOperator) {
      throw forbidden('This account has no property assignment yet.')
    }

    sessionCounter += 1
    const session: Session = {
      id: `sess_${sessionCounter}_${Date.parse(now)}`,
      userId: user.id,
      createdAt: now,
      csrfToken: `csrf_${sessionCounter}_${Date.parse(now)}`,
    }
    sessions.set(session.id, session)
    user.lastLogin = now

    return singleRes({
      sessionId: session.id,
      csrfToken: session.csrfToken,
      resumeToken: issueResumeToken(user.id, Date.parse(now)),
      user: resolved,
    })
  }

  /**
   * Re-establish a session from a resume token. Same response shape as login so
   * the client has one code path for "I am signed in".
   */
  if (method === 'POST' && path === '/v1/auth/resume') {
    const parsed = readResumeToken(String(body.token ?? ''))
    if (!parsed) throw unauthorized('Session expired. Please sign in again.')
    if (Date.parse(now) - parsed.issuedAtMs > SESSION_TTL_MS) {
      throw unauthorized('Session expired. Please sign in again.')
    }
    const user = staffUsers.find(u => u.id === parsed.userId && u.isActive)
    if (!user) throw unauthorized('Session expired. Please sign in again.')

    sessionCounter += 1
    const session: Session = {
      id: `sess_${sessionCounter}_${Date.parse(now)}`,
      userId: user.id,
      createdAt: now,
      csrfToken: `csrf_${sessionCounter}_${Date.parse(now)}`,
    }
    sessions.set(session.id, session)
    return singleRes({
      sessionId: session.id,
      csrfToken: session.csrfToken,
      // Keep the original issue time: resuming must not extend the shift window.
      resumeToken: issueResumeToken(user.id, parsed.issuedAtMs),
      user: sessionUser(user),
    })
  }

  if (method === 'POST' && path === '/v1/auth/logout') {
    const sessionId = headers['x-session-id'] ?? ''
    // Idempotent: logging out twice (or with a dead session) is not an error.
    if (sessionId) sessions.delete(sessionId)
    return singleRes({ ok: true })
  }

  if (method === 'GET' && path === '/v1/auth/session') {
    requireSession(ctx)
    return singleRes(sessionUser(ctx.user!))
  }

  // ════════════════════════ Tasks ════════════════════════

  if (method === 'GET' && path === '/v1/tasks') {
    const tenantId = requireTenantId(ctx)
    let rows = visibleTasks(ctx, tenantId)

    const status = String(query.status ?? '')
    if (status) {
      const wanted = status.split(',').map(s => s.trim()).filter(Boolean)
      rows = rows.filter(t => wanted.includes(t.status))
    }

    const departmentId = String(query.departmentId ?? '')
    if (departmentId) rows = rows.filter(t => t.departmentId === departmentId)

    const partnerId = String(query.partnerId ?? '')
    if (partnerId) {
      rows = partnerId === 'native'
        ? rows.filter(t => !t.partnerId)
        : rows.filter(t => t.partnerId === partnerId)
    }

    // `mine` / `unclaimed` are the two segments the staff list toggles between;
    // `helping` is the queue of tasks the caller lends a hand on. Mine and
    // helping are mutually exclusive by construction — one scope at a time.
    const scope = String(query.scope ?? '')
    if (scope === 'mine') {
      rows = rows.filter((t) => {
        const a = activeAssignment(t.id)
        return a?.kind === 'STAFF' && a.userId === ctx.userId
      })
    }
    // Unclaimed = owned by no individual: unassigned, or sitting in a pool.
    if (scope === 'unclaimed') rows = rows.filter(t => activeAssignment(t.id)?.kind !== 'STAFF')
    if (scope === 'helping') rows = rows.filter(t => isActiveHelper(t.id, ctx.userId))
    if (scope === 'breached') {
      rows = rows.filter(t => t.responseSlaStatus === 'BREACHED' || t.resolutionSlaStatus === 'BREACHED')
    }

    const q = String(query.q ?? '').trim().toLowerCase()
    if (q) {
      rows = rows.filter(t =>
        t.title.toLowerCase().includes(q)
        || (t.description ?? '').toLowerCase().includes(q)
        || (t.location ?? '').toLowerCase().includes(q)
        || (t.externalRef ?? '').toLowerCase().includes(q),
      )
    }

    rows = [...rows].sort((a, b) => b.createDate.localeCompare(a.createDate))
    const { page, meta } = paginate(rows, query)
    return listRes(page.map(taskListItem), meta)
  }

  /**
   * Create and preview share ONE resolution pipeline, so an input can never
   * preview clean and then fail on create (or vice versa) — the preview runs
   * every gate, it just never writes. Warnings (e.g. the requester lookup
   * finding nobody) travel in the envelope's `meta.warnings`, never inside the
   * resolved data.
   */
  if (method === 'POST' && (path === '/v1/tasks' || path === '/v1/tasks/preview')) {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    if (!ctx.canCreateTask) throw forbidden('Your role at this property cannot raise tasks')

    const warnings: string[] = []

    const title = String(body.title ?? '').trim()
    if (!title) throw badRequest('A title is required')

    const itemId = pid(body.itemId) || null
    const item = itemId ? catalogItems.find(i => i.id === itemId && i.tenantId === tenantId && i.isActive) : null
    if (itemId && !item) throw notFound('Catalog item')

    // Registry location, plus the free-text label. When only the registry id
    // is given, the label is filled from the location's name.
    const locationId = pid(body.locationId) || null
    const registryLocation = locationId ? propertyLocations.find(l => l.id === locationId && l.tenantId === tenantId) : null
    if (locationId && !registryLocation) throw badRequest('Pick a location at this property')
    if (registryLocation && !registryLocation.isActive) throw badRequest('That location is inactive — pick another')
    const location = (body.location as string | null)?.toString().trim() || registryLocation?.name || null
    if (item?.requiresLocation && !location) throw badRequest('This item requires a location')

    // Priority: explicit wins, else the item's default, else NORMAL. An
    // untouched control must send nothing, or the item default is unreachable.
    const priorities: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
    const explicitPriority = body.priority == null || body.priority === '' ? null : String(body.priority) as TaskPriority
    if (explicitPriority && !priorities.includes(explicitPriority)) throw badRequest('Pick a priority')
    const priority: TaskPriority = explicitPriority ?? item?.defaultPriority ?? 'NORMAL'

    // The item's own checklist is prepended; the request lists only additions.
    const extraSteps = Array.isArray(body.checklistLabels) ? body.checklistLabels : []
    const checklist = [
      ...(item?.defaultChecklist ?? []),
      ...extraSteps.map(step => String(step ?? '').trim()).filter(Boolean),
    ]

    // Requester: an explicit name wins and skips the lookup entirely. Absent
    // one, a location whose type links a requester resolves the current guest,
    // and finding nobody is a warning, not an error.
    let requestedFor = (body.requestedFor as string | null)?.toString().trim() || null
    if (!requestedFor && registryLocation) {
      const type = locationTypes.find(t => t.id === registryLocation.locationTypeId)
      if (type?.linksRequester) {
        if (registryLocation.currentGuest) requestedFor = registryLocation.currentGuest
        else warnings.push(`Requester lookup found no current guest at ${registryLocation.name}`)
      }
    }

    // Optional schedule: SLA clocks run from the scheduled start, not from now.
    const activationRaw = String(body.activationDate ?? '')
    const activationIso = activationRaw && Number.isFinite(Date.parse(activationRaw))
      ? new Date(Date.parse(activationRaw)).toISOString()
      : now

    // Optional creation-time assignee: yourself (staff), anyone (leader/admin),
    // or a team pool. DEPARTMENT pools exist only via return-to-pool.
    const assigneeRaw = (body.assignee ?? null) as { kind?: string, userId?: unknown, teamId?: unknown } | null
    let assignee: { kind: 'STAFF', userId: Id } | { kind: 'TEAM', teamId: Id } | null = null
    if (assigneeRaw) {
      if (assigneeRaw.kind === 'STAFF') {
        const userId = pid(assigneeRaw.userId)
        if (!userId) throw badRequest('Pick someone to assign this to')
        if (ctx.role === 'staff' && userId !== ctx.userId) {
          throw forbidden('Staff can only assign a new task to themselves')
        }
        if (!staffProfiles.some(p => p.userId === userId && p.tenantId === tenantId && p.isActive)) {
          throw badRequest('That person does not work at this property')
        }
        assignee = { kind: 'STAFF', userId }
      }
      else if (assigneeRaw.kind === 'TEAM') {
        const teamId = pid(assigneeRaw.teamId)
        const team = teams.find(t => t.id === teamId && t.tenantId === tenantId && t.isActive)
        if (!team) throw badRequest('Pick an active team at this property')
        assignee = { kind: 'TEAM', teamId: team.id }
      }
      else {
        throw badRequest('An assignee is a person or a team')
      }
    }

    const rule = resolveRouting(tenantId, itemId, registryLocation?.locationTypeId ?? null, priority)
    const slaId = rule?.slaId ?? defaultSlaId(tenantId)
    const departmentId = rule?.departmentId ?? ctx.departmentId
    const quantity = item?.quantityEnabled ? Math.max(1, Number(body.quantity) || 1) : null
    const description = (body.description as string | null)?.toString().trim() || null

    // The preview stops here: everything resolved, nothing written.
    if (path === '/v1/tasks/preview') {
      const sla = slaId ? slas.find(s => s.id === slaId) : undefined
      return {
        version: 'v1' as const,
        data: {
          task: {
            title,
            priority,
            departmentId,
            department: departmentBrief(departmentId),
            slaId,
            sla: slaBrief(slaId),
            requestedFor,
            location,
            locationId,
            quantity,
            activationDate: activationIso,
            responseDueAt: sla ? addOpenMinutes(tenantId, departmentId, activationIso, sla.responseTime) : null,
            resolutionDueAt: sla ? addOpenMinutes(tenantId, departmentId, activationIso, sla.resolutionTime) : null,
          },
          checklistLabels: checklist,
        },
        meta: { warnings },
      }
    }

    const board = boardForTenant(tenantId)
    const newColumn = board?.columns.find(c => c.status === 'NEW') ?? null

    const created: Task = {
      id: nextId(tasks),
      tenantId,
      partnerId: null,
      externalRef: null,
      itemId,
      status: 'NEW',
      departmentId,
      columnId: newColumn?.id ?? null,
      slaId: null,
      title,
      description,
      location,
      locationId,
      quantity,
      requestedFor,
      priority,
      checklist,
      completionNote: null,
      submittedBy: null,
      submittedAt: null,
      activationDate: activationIso,
      responseDueAt: null,
      resolutionDueAt: null,
      responseDuration: null,
      resolutionDuration: null,
      responseSlaStatus: 'EMPTY',
      resolutionSlaStatus: 'EMPTY',
      createDate: now,
      updateDate: now,
    }
    stampSla(created, slaId, activationIso)
    tasks.push(created)
    taskHistory.push({ id: nextId(taskHistory), taskId: created.id, userId: ctx.userId, status: 'NEW', description: null, createDate: now })

    if (assignee) {
      taskAssignments.push({
        id: nextId(taskAssignments),
        taskId: created.id,
        kind: assignee.kind,
        userId: assignee.kind === 'STAFF' ? assignee.userId : null,
        teamId: assignee.kind === 'TEAM' ? assignee.teamId : null,
        departmentId: null,
        assignedBy: ctx.userId,
        remark: null,
        isActive: true,
        createDate: now,
        updateDate: now,
      })
    }

    return { version: 'v1' as const, data: taskDetail(created), meta: { warnings } }
  }

  /**
   * Claim. Creates an assignment; it does NOT change status — there is no
   * `CLAIMED` status in this product.
   *
   * Finding 1: this used to deactivate whatever assignment already existed,
   * which let a leader silently take a task off the person holding it. Now:
   *   - held by someone else → 409, reassignment must go through Assign;
   *   - already held by you  → success, no new row (double-tap safe);
   *   - unheld               → assigned to you.
   */
  /**
   * Claim, pool-aware. Personal assignments are never stolen (409); pool
   * assignments (TEAM / DEPARTMENT) are claimable by their members only, and
   * claiming converts the pool row into a personal one.
   */
  if (method === 'POST' && path === '/v1/tasks/claim') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (!canReadTask(ctx, task)) throw forbidden('This task belongs to another department')

    const existing = activeAssignment(task.id)
    if (existing) {
      if (existing.kind === 'STAFF') {
        if (existing.userId === ctx.userId) return singleRes(taskDetail(task))
        const holder = userBrief(existing.userId)
        const who = holder ? `${holder.firstName} ${holder.lastName}`.trim() : 'someone else'
        throw conflict('ALREADY_ASSIGNED', `Already being handled by ${who}. Use Assign to hand it over.`)
      }
      // A pool: only its own members may claim out of it. Operators pass —
      // they act as admin, but pool membership is a real-people concept, so
      // they go through Assign instead of Claim.
      if (!ctx.isOperator && !canClaimPool(existing, ctx.profile, ctx.userId!)) {
        const poolName = existing.kind === 'TEAM'
          ? teamBrief(existing.teamId)?.name ?? 'that team'
          : departmentBrief(existing.departmentId)?.name ?? 'that department'
        throw forbidden(`This task is pooled for ${poolName} — only its members can claim it`)
      }
      existing.isActive = false
      existing.updateDate = now
    }

    taskAssignments.push({
      id: nextId(taskAssignments),
      taskId: task.id,
      kind: 'STAFF',
      userId: ctx.userId!,
      teamId: null,
      departmentId: null,
      assignedBy: ctx.userId,
      remark: 'Claimed',
      isActive: true,
      createDate: now,
      updateDate: now,
    })
    task.updateDate = now
    return singleRes(taskDetail(task))
  }

  /**
   * Return to pool: the current personal assignee hands the task back with a
   * reason. The new owner, by first matching rule: the task's most recent pool
   * assignment recreated, else the returner's most recent team, else the
   * task's own department, else nobody. IN_PROGRESS goes back to NEW.
   */
  if (method === 'POST' && path === '/v1/tasks/return') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')

    const existing = activeAssignment(task.id)
    if (!existing || existing.kind !== 'STAFF' || existing.userId !== ctx.userId) {
      throw forbidden('Only the person holding this task can return it')
    }
    // Whitelist, mirroring the UI's: a submitted task is with its reviewer, and
    // anything closed has nothing to return.
    if (task.status === 'SUBMITTED') throw conflict('AWAITING_REVIEW', 'This task is awaiting review')
    if (task.status !== 'NEW' && task.status !== 'IN_PROGRESS') throw conflict('TASK_CLOSED', 'This task is closed')

    const reason = String(body.reason ?? '').trim()
    if (!reason) throw badRequest('Say why the task is going back')
    if (reason.length > 500) throw badRequest('Keep the reason under 500 characters')

    existing.isActive = false
    existing.updateDate = now

    // A return invalidates the holder's pending offer — they no longer hold it.
    const offer = pendingOfferFor(task.id)
    if (offer) {
      offer.state = 'CANCELLED'
      offer.decidedAt = now
    }

    const lastPool = [...taskAssignments]
      .reverse()
      .find(a => a.taskId === task.id && !a.isActive && a.kind !== 'STAFF')
    const lastTeamId = [...teamMembers].reverse().find(m => m.userId === ctx.userId)?.teamId ?? null

    let next: Pick<TaskAssignment, 'kind' | 'teamId' | 'departmentId'> | null = null
    if (lastPool) next = { kind: lastPool.kind, teamId: lastPool.teamId, departmentId: lastPool.departmentId }
    else if (lastTeamId) next = { kind: 'TEAM', teamId: lastTeamId, departmentId: null }
    else if (task.departmentId) next = { kind: 'DEPARTMENT', teamId: null, departmentId: task.departmentId }

    if (next) {
      taskAssignments.push({
        id: nextId(taskAssignments),
        taskId: task.id,
        kind: next.kind,
        userId: null,
        teamId: next.teamId,
        departmentId: next.departmentId,
        assignedBy: ctx.userId,
        remark: reason,
        isActive: true,
        createDate: now,
        updateDate: now,
      })
    }

    if (task.status === 'IN_PROGRESS') {
      task.status = 'NEW'
      const board = boardForTenant(tenantId)
      task.columnId = board?.columns.find(c => c.status === 'NEW')?.id ?? task.columnId
    }
    task.updateDate = now
    taskHistory.push({ id: nextId(taskHistory), taskId: task.id, userId: ctx.userId, status: task.status, description: `Returned to the pool: ${reason}`, createDate: now })
    return singleRes(taskDetail(task))
  }

  /** Assign / reassign. Leaders and admins only — the deliberate hand-over path. */
  if (method === 'POST' && path === '/v1/tasks/assign') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')

    const userId = pid(body.userId)
    if (!userId) throw badRequest('Pick someone to assign this to')
    const assignee = staffProfiles.find(p => p.userId === userId && p.tenantId === tenantId && p.isActive)
    if (!assignee) throw badRequest('That person does not work at this property')

    taskAssignments
      .filter(a => a.taskId === task.id && a.isActive)
      .forEach((a) => { a.isActive = false; a.updateDate = now })

    // Assigning a person supersedes any pending offer the old holder had out.
    const supersededOffer = pendingOfferFor(task.id)
    if (supersededOffer) {
      supersededOffer.state = 'CANCELLED'
      supersededOffer.decidedAt = now
    }

    taskAssignments.push({
      id: nextId(taskAssignments),
      taskId: task.id,
      kind: 'STAFF',
      userId,
      teamId: null,
      departmentId: null,
      assignedBy: ctx.userId,
      remark: (body.remark as string | null)?.toString().trim() || null,
      isActive: true,
      createDate: now,
      updateDate: now,
    })
    task.updateDate = now
    return singleRes(taskDetail(task))
  }

  // ════════════════════════ Delegation offers ════════════════════════

  /**
   * Send an offer: the current personal assignee proposes handing the task to
   * a named colleague, who accepts or declines. At most one pending offer per
   * task, and offers never change the task's status.
   */
  if (method === 'POST' && path === '/v1/tasks/offers') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')

    const holding = activeAssignment(task.id)
    if (!holding || holding.kind !== 'STAFF' || holding.userId !== ctx.userId) {
      throw forbidden('Only the person holding this task can offer it to someone')
    }
    if (task.status !== 'NEW' && task.status !== 'IN_PROGRESS') {
      throw conflict('TASK_NOT_OPEN', 'This task is not open')
    }

    const toUserId = pid(body.toUserId)
    if (!toUserId) throw badRequest('Pick someone to offer this to')
    if (toUserId === ctx.userId) throw badRequest('You cannot offer a task to yourself')
    const targetProfile = staffProfiles.find(p => p.userId === toUserId && p.tenantId === tenantId && p.isActive)
    if (!targetProfile) throw notFound('Staff member')
    // Same cross-department rule as Assign: the target either has no
    // department, or shares the task's.
    if (targetProfile.departmentId && task.departmentId && targetProfile.departmentId !== task.departmentId) {
      throw badRequest('They work in a different department to this task')
    }
    if (pendingOfferFor(task.id)) throw conflict('OFFER_PENDING', 'An offer is already pending for this task')

    const note = (body.note as string | null)?.toString().trim() || null
    if (note && note.length > 500) throw badRequest('Keep the note under 500 characters')

    const created: TaskOffer = {
      id: nextId(taskOffers),
      tenantId,
      taskId: task.id,
      fromUserId: ctx.userId!,
      toUserId,
      note,
      state: 'PENDING',
      decidedAt: null,
      createDate: now,
    }
    taskOffers.push(created)
    return singleRes(created)
  }

  /** The caller's pending-offer inbox, newest first. */
  if (method === 'GET' && path === '/v1/offers') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = taskOffers
      .filter(o => o.tenantId === tenantId && o.toUserId === ctx.userId && o.state === 'PENDING')
      .sort((a, b) => b.createDate.localeCompare(a.createDate))
      .map(o => ({
        ...o,
        fromUser: userBrief(o.fromUserId),
        taskTitle: tasks.find(t => t.id === o.taskId)?.title ?? '',
      }))
    return listRes(rows)
  }

  /**
   * Accept: only the target, and only while the sender still holds the task —
   * a stale offer (the sender moved on) is cancelled on the spot with a 409
   * rather than silently reassigning from the wrong starting point.
   */
  if (method === 'POST' && path === '/v1/offers/accept') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const offer = taskOffers.find(o => o.id === pid(body.offerId) && o.tenantId === tenantId)
    if (!offer) throw notFound('Offer')
    if (offer.state !== 'PENDING') throw conflict('OFFER_DECIDED', 'This offer is not pending')
    if (offer.toUserId !== ctx.userId) throw forbidden('This offer is addressed to someone else')

    const task = tasks.find(t => t.id === offer.taskId)!
    const holding = activeAssignment(task.id)
    if (!holding || holding.kind !== 'STAFF' || holding.userId !== offer.fromUserId) {
      offer.state = 'CANCELLED'
      offer.decidedAt = now
      throw conflict('OFFER_STALE', 'This offer is stale — the sender no longer holds the task')
    }

    holding.isActive = false
    holding.updateDate = now
    // The new holder stops being a mere helper, if they were one.
    taskCollaborators
      .filter(c => c.taskId === task.id && c.userId === ctx.userId && c.isActive)
      .forEach((c) => { c.isActive = false })
    taskAssignments.push({
      id: nextId(taskAssignments),
      taskId: task.id,
      kind: 'STAFF',
      userId: ctx.userId!,
      teamId: null,
      departmentId: null,
      assignedBy: offer.fromUserId,
      remark: offer.note,
      isActive: true,
      createDate: now,
      updateDate: now,
    })
    offer.state = 'ACCEPTED'
    offer.decidedAt = now
    task.updateDate = now
    return singleRes(taskDetail(task))
  }

  /** Decline: the target passes; nothing about the task changes. */
  if (method === 'POST' && path === '/v1/offers/decline') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const offer = taskOffers.find(o => o.id === pid(body.offerId) && o.tenantId === tenantId)
    if (!offer) throw notFound('Offer')
    if (offer.state !== 'PENDING') throw conflict('OFFER_DECIDED', 'This offer is not pending')
    if (offer.toUserId !== ctx.userId) throw forbidden('This offer is addressed to someone else')
    offer.state = 'DECLINED'
    offer.decidedAt = now
    return singleRes(offer)
  }

  /** Cancel: the sender withdraws; nothing about the task changes. */
  if (method === 'POST' && path === '/v1/offers/cancel') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const offer = taskOffers.find(o => o.id === pid(body.offerId) && o.tenantId === tenantId)
    if (!offer) throw notFound('Offer')
    if (offer.state !== 'PENDING') throw conflict('OFFER_DECIDED', 'This offer is not pending')
    if (offer.fromUserId !== ctx.userId) throw forbidden('Only the sender can cancel an offer')
    offer.state = 'CANCELLED'
    offer.decidedAt = now
    return singleRes(offer)
  }

  // ════════════════════════ Helpers ════════════════════════

  /**
   * Add a helper. Who may manage helpers: an admin, a leader, or the task's
   * current assignee. Closed tasks (FINISHED / VERIFIED / CANCELLED) take no
   * helper changes — but SUBMITTED does, since review can send it back.
   */
  if (method === 'POST' && (path === '/v1/tasks/collaborators' || path === '/v1/tasks/collaborators/remove')) {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (['FINISHED', 'VERIFIED', 'CANCELLED'].includes(task.status)) {
      throw conflict('TASK_CLOSED', 'This task is closed')
    }

    const userId = pid(body.userId)
    const removing = path.endsWith('/remove')
    const holding = activeAssignment(task.id)
    const isAssignee = holding?.kind === 'STAFF' && holding.userId === ctx.userId
    const isSelfLeave = removing && userId === ctx.userId
    if (!isManager(ctx) && !isAssignee && !isSelfLeave) {
      throw forbidden('Only a leader or the person holding this task can change its helpers')
    }

    if (removing) {
      // Idempotent: removing someone who is not helping is a no-op.
      taskCollaborators
        .filter(c => c.taskId === task.id && c.userId === userId && c.isActive)
        .forEach((c) => { c.isActive = false })
      task.updateDate = now
      return singleRes({ ok: true })
    }

    if (!staffProfiles.some(p => p.userId === userId && p.tenantId === tenantId && p.isActive)) {
      throw notFound('Staff member')
    }
    if (holding?.kind === 'STAFF' && holding.userId === userId) {
      throw badRequest('The assignee cannot also be a helper')
    }
    const already = taskCollaborators.find(c => c.taskId === task.id && c.userId === userId && c.isActive)
    if (already) return singleRes(already)

    const created: TaskCollaborator = {
      id: nextId(taskCollaborators),
      taskId: task.id,
      userId,
      addedBy: ctx.userId!,
      isActive: true,
      createDate: now,
    }
    taskCollaborators.push(created)
    task.updateDate = now
    return singleRes(created)
  }

  // ════════════════════════ Submit & review ════════════════════════

  /**
   * Submit for review: the assignee or an active helper hands the finished
   * work to a leader. The proof gates (photos, completion note) come from the
   * catalog item and are enforced HERE — the client's disabled button is a
   * courtesy. The resolution verdict is stamped at submission; a later
   * approval never re-stamps it.
   */
  if (method === 'POST' && path === '/v1/tasks/submit') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')

    const holding = activeAssignment(task.id)
    const isAssignee = holding?.kind === 'STAFF' && holding.userId === ctx.userId
    if (!isAssignee && !isActiveHelper(task.id, ctx.userId)) {
      throw forbidden('Only the person holding this task, or a helper on it, can submit it')
    }
    if (task.status !== 'IN_PROGRESS') throw conflict('NOT_IN_PROGRESS', 'This task is not in progress')

    const item = task.itemId ? catalogItems.find(i => i.id === task.itemId) : undefined
    const minPhotos = item?.minProofPhotos ?? 0
    const photoCount = taskAttachments.filter(a => a.taskId === task.id && a.filetype === 'PHOTO' && !a.isRemoved).length
    if (photoCount < minPhotos) {
      throw badRequest(`This task needs ${minPhotos} proof photo${minPhotos === 1 ? '' : 's'} — it has ${photoCount}`)
    }
    const note = String(body.completionNote ?? '').trim()
    if ((item?.requiresCompletionNote ?? false) && !note) {
      throw badRequest('This task requires a completion note')
    }
    if (note.length > 2000) throw badRequest('Keep the completion note under 2000 characters')

    task.status = 'SUBMITTED'
    task.completionNote = note || null
    task.submittedBy = ctx.userId
    task.submittedAt = now
    const board = boardForTenant(tenantId)
    task.columnId = board?.columns.find(c => c.status === 'SUBMITTED')?.id ?? task.columnId
    // The resolution clock stops at submission, not at approval.
    if (task.resolutionDuration === null) {
      task.resolutionDuration = Math.max(0, Math.round((Date.parse(now) - Date.parse(task.activationDate)) / 60_000))
      task.resolutionSlaStatus = task.resolutionDueAt && Date.parse(now) > Date.parse(task.resolutionDueAt) ? 'BREACHED' : 'ON_TIME'
    }
    task.updateDate = now
    taskHistory.push({ id: nextId(taskHistory), taskId: task.id, userId: ctx.userId, status: 'SUBMITTED', description: note || 'Submitted for review', createDate: now })
    emitStatusEvent(task, 'SUBMITTED', now)
    return singleRes(taskDetail(task))
  }

  /**
   * Review: a leader of the task's own department (or an admin — and a task
   * with no department is admin-only) approves to FINISHED or sends it back to
   * IN_PROGRESS with a note. Sending it back resets the resolution clock so
   * the next submission is measured cleanly.
   */
  if (method === 'POST' && path === '/v1/tasks/review') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (task.status !== 'SUBMITTED') throw conflict('NOT_SUBMITTED', 'This task is not awaiting review')

    const isAdmin = ctx.isOperator || ctx.role === 'admin'
    if (!isAdmin) {
      // A leader reviews their own department's work; the department is read
      // from the profile, not from anything the client claims.
      if (!task.departmentId || ctx.departmentId !== task.departmentId) {
        throw forbidden('Only a leader of this task\'s department can review it')
      }
    }

    const decision = String(body.decision ?? '')
    const board = boardForTenant(tenantId)
    if (decision === 'APPROVE') {
      task.status = 'FINISHED'
      task.columnId = board?.columns.find(c => c.status === 'FINISHED')?.id ?? task.columnId
      task.updateDate = now
      taskHistory.push({ id: nextId(taskHistory), taskId: task.id, userId: ctx.userId, status: 'FINISHED', description: 'Approved on review', createDate: now })
      emitStatusEvent(task, 'FINISHED', now)
      return singleRes(taskDetail(task))
    }
    if (decision === 'REQUEST_CHANGES') {
      const note = String(body.note ?? '').trim()
      if (!note) throw badRequest('Say what needs to change')
      if (note.length > 1000) throw badRequest('Keep the note under 1000 characters')
      task.status = 'IN_PROGRESS'
      task.columnId = board?.columns.find(c => c.status === 'IN_PROGRESS')?.id ?? task.columnId
      // The next submission re-accumulates from a clean clock.
      task.resolutionDuration = null
      task.resolutionSlaStatus = 'EMPTY'
      task.updateDate = now
      taskHistory.push({ id: nextId(taskHistory), taskId: task.id, userId: ctx.userId, status: 'IN_PROGRESS', description: `Changes requested: ${note}`, createDate: now })
      emitStatusEvent(task, 'IN_PROGRESS', now)
      return singleRes(taskDetail(task))
    }
    throw badRequest('A review is APPROVE or REQUEST_CHANGES')
  }

  if (method === 'PATCH' && path === '/v1/tasks/status') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (!canReadTask(ctx, task)) throw forbidden('This task belongs to another department')

    const columnId = pid(body.columnId)
    const board = boardForTenant(tenantId)
    const column = board?.columns.find(c => c.id === columnId)
    if (!column) throw badRequest('That column is not on this property\'s board')
    // NEW is unreachable via the status route: going back to the start means
    // returning the task to the pool, which carries a reason.
    if (column.status === 'NEW') throw badRequest('Tasks cannot be moved back to New — return them to the pool instead')
    // A submitted task is frozen: it is with its reviewer, and only the review
    // decision (approve / request changes) moves it.
    if (task.status === 'SUBMITTED') throw conflict('AWAITING_REVIEW', 'This task is awaiting review — approve it or request changes instead')
    // SUBMITTED is only reachable through submission, which enforces the proof
    // gates; a bare column move would walk straight past them.
    if (column.status === 'SUBMITTED') throw badRequest('Submit the task for review instead — submission checks the proof requirements')
    // Cancelling is for open work: NEW, IN_PROGRESS or PENDING.
    if (column.status === 'CANCELLED' && !['NEW', 'IN_PROGRESS', 'PENDING'].includes(task.status)) {
      throw conflict('TASK_CLOSED', 'Only open tasks can be cancelled')
    }
    // Verification is sign-off, not progress: leaders and admins only.
    if (column.status === 'VERIFIED' && !isManager(ctx)) {
      throw forbidden('Only a team leader can verify a task')
    }
    // Proof-gated work cannot be marked finished by the person doing it — that
    // decision belongs to a leader, via submit-for-review.
    if (column.status === 'FINISHED' && !isManager(ctx)) {
      const gatedItem = task.itemId ? catalogItems.find(i => i.id === task.itemId) : undefined
      if ((gatedItem?.minProofPhotos ?? 0) > 0 || gatedItem?.requiresCompletionNote) {
        throw conflict('NEEDS_REVIEW', 'This task requires proof — submit it for review instead')
      }
    }

    // Staff may only move work they hold; managers may move anything.
    const assignment = activeAssignment(task.id)
    if (!isManager(ctx) && assignment && assignment.userId !== ctx.userId) {
      throw forbidden('Only the person handling this task can move it')
    }

    task.columnId = column.id
    task.status = column.status
    task.updateDate = now

    // First entry into IN_PROGRESS is the "response" — a NEW→PENDING park is
    // not one; reaching FINISHED without a submission stamps the resolution.
    const activationMs = Date.parse(task.activationDate)
    if (column.status === 'IN_PROGRESS' && task.responseDuration === null) {
      task.responseDuration = Math.max(0, Math.round((Date.parse(now) - activationMs) / 60_000))
      task.responseSlaStatus = task.responseDueAt && Date.parse(now) > Date.parse(task.responseDueAt) ? 'BREACHED' : 'ON_TIME'
    }
    if ((column.status === 'FINISHED' || column.status === 'VERIFIED') && task.resolutionDuration === null) {
      task.resolutionDuration = Math.max(0, Math.round((Date.parse(now) - activationMs) / 60_000))
      task.resolutionSlaStatus = task.resolutionDueAt && Date.parse(now) > Date.parse(task.resolutionDueAt) ? 'BREACHED' : 'ON_TIME'
    }

    taskHistory.push({
      id: nextId(taskHistory),
      taskId: task.id,
      userId: ctx.userId,
      status: column.status,
      description: (body.description as string | null)?.toString().trim() || null,
      createDate: now,
    })
    emitStatusEvent(task, column.status, now)
    return singleRes(taskDetail(task))
  }

  /**
   * Direct edit of a task's describing fields — the admin board's edit dialog.
   * Deliberately narrow: status moves stay on their own gated routes, and
   * closed work is history, not editable.
   */
  if (method === 'POST' && path === '/v1/tasks/update') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (!['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING'].includes(task.status)) {
      throw conflict('TASK_CLOSED', 'Closed tasks cannot be edited')
    }

    const title = String(body.title ?? '').trim()
    if (!title) throw badRequest('A title is required')
    if (title.length > 200) throw badRequest('Keep the title under 200 characters')
    const description = (body.description as string | null)?.toString().trim() || null
    if (description && description.length > 2000) throw badRequest('Keep the description under 2000 characters')
    const priority = String(body.priority ?? '') as TaskPriority
    if (!TASK_PRIORITY_VALUES.includes(priority)) throw badRequest('Pick a priority')

    const changed: string[] = []
    if (task.title !== title) changed.push('title')
    if (task.description !== description) changed.push('description')
    if (task.priority !== priority) changed.push('priority')
    task.title = title
    task.description = description
    task.priority = priority
    task.updateDate = now
    if (changed.length) {
      taskHistory.push({ id: nextId(taskHistory), taskId: task.id, userId: ctx.userId, status: task.status, description: `Edited: ${changed.join(', ')}`, createDate: now })
      audit(ctx, 'task.updated', `task:${task.id}`, task.title, now, tenantId)
    }
    return singleRes(taskDetail(task))
  }

  if (method === 'POST' && path === '/v1/tasks/comments') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (!canReadTask(ctx, task)) throw forbidden('This task belongs to another department')
    const comment = String(body.comment ?? '').trim()
    if (!comment) throw badRequest('Write something first')

    const created: TaskComment = { id: nextId(taskComments), taskId: task.id, userId: ctx.userId!, comment, createDate: now }
    taskComments.push(created)
    return singleRes({ ...created, user: userBrief(created.userId) })
  }

  /**
   * Presign an upload. The mock validates exactly what the real API does —
   * type allow-list, per-type size caps — and hands back a storage key; the
   * "upload" itself is virtual here, since the demo has no object store.
   */
  if (method === 'POST' && path === '/v1/uploads') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')

    const filename = String(body.filename ?? '').trim()
    if (!filename) throw badRequest('filename is required')
    const contentType = String(body.contentType ?? '')
    const limit = UPLOAD_MAX_BYTES[contentType]
    if (!limit) {
      throw badRequest(`contentType must be one of ${Object.keys(UPLOAD_MAX_BYTES).join(', ')}`)
    }
    const sizeBytes = Number(body.sizeBytes)
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw badRequest('sizeBytes must be positive')
    if (sizeBytes > limit) throw badRequest(`sizeBytes exceeds the ${limit} byte limit for ${contentType}`)

    uploadCounter += 1
    const ext = contentType === 'application/pdf' ? 'pdf' : contentType.split('/')[1] ?? 'bin'
    const storageKey = `tenants/${tenantId}/uploads/${uploadCounter}.${ext}`
    return singleRes({
      uploadUrl: `https://storage.sentec.example/presigned/${storageKey}`,
      storageKey,
      expiresAt: minutesFrom(now, 15),
    })
  }

  /**
   * Attach a file: an already-hosted URL, or a presigned upload's storage key —
   * exactly one of the two. Once created, only `isRemoved` may change.
   */
  if (method === 'POST' && path === '/v1/tasks/attachments') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (!canReadTask(ctx, task)) throw forbidden('This task belongs to another department')

    const url = String(body.url ?? '').trim()
    const storageKey = String(body.storageKey ?? '').trim()
    if ((url && storageKey) || (!url && !storageKey)) {
      throw badRequest('Provide either url or storageKey, not both')
    }

    const activeCount = taskAttachments.filter(a => a.taskId === task.id && !a.isRemoved).length
    if (activeCount >= 30) throw conflict('ATTACHMENT_LIMIT', 'This task already has 30 attachments')

    let created: TaskAttachment
    if (storageKey) {
      // The key must be one of THIS tenant's uploads — a key smuggled in from
      // another partition is refused, same as any cross-tenant reference.
      if (!storageKey.startsWith(`tenants/${tenantId}/uploads/`)) {
        throw badRequest('That upload does not belong to this property')
      }
      const declared = String(body.filetype ?? '')
      if (declared !== 'PHOTO' && declared !== 'PDF') throw badRequest('filetype must be PHOTO or PDF')
      created = {
        id: nextId(taskAttachments),
        taskId: task.id,
        userId: ctx.userId,
        filetype: declared,
        filename: String(body.filename ?? '').trim() || storageKey.split('/').pop() || 'upload',
        url: `https://storage.sentec.example/${storageKey}`,
        storageKey,
        isRemoved: false,
        createDate: now,
      }
    }
    else {
      if (!/^https?:\/\//i.test(url)) throw badRequest('Enter a full http(s) URL to an already-hosted file')
      const filename = url.split('/').pop() || 'attachment'
      const lower = filename.toLowerCase()
      const filetype: TaskAttachment['filetype'] = /\.(png|jpe?g|gif|webp|heic)$/.test(lower)
        ? 'PHOTO'
        : lower.endsWith('.pdf') ? 'PDF' : 'OTHER'
      created = {
        id: nextId(taskAttachments),
        taskId: task.id,
        userId: ctx.userId,
        filetype,
        filename,
        url,
        storageKey: null,
        isRemoved: false,
        createDate: now,
      }
    }
    taskAttachments.push(created)
    task.updateDate = now
    return singleRes({ ...created, user: userBrief(created.userId) })
  }

  /** Remove / restore an attachment. The file itself is immutable. */
  if (method === 'POST' && path === '/v1/tasks/attachments/update') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const attachment = taskAttachments.find(a => a.id === pid(body.id))
    const task = attachment ? tasks.find(t => t.id === attachment.taskId && t.tenantId === tenantId) : undefined
    if (!attachment || !task) throw notFound('Attachment')
    if (!canReadTask(ctx, task)) throw forbidden('This task belongs to another department')
    if (body.isRemoved === undefined) throw badRequest('Only isRemoved can change on an attachment')
    // Restoring must respect the same cap that creation does.
    if (attachment.isRemoved && body.isRemoved === false) {
      const activeCount = taskAttachments.filter(a => a.taskId === task.id && !a.isRemoved).length
      if (activeCount >= 30) throw conflict('ATTACHMENT_LIMIT', 'This task already has 30 attachments')
    }
    attachment.isRemoved = Boolean(body.isRemoved)
    task.updateDate = now
    return singleRes({ ...attachment, user: userBrief(attachment.userId) })
  }

  if (method === 'GET' && /^\/v1\/tasks\/[^/]+$/.test(path)) {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const id = path.split('/').pop()!
    const task = tasks.find(t => t.id === id && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    // Finding 2: knowing the id is not authorization.
    if (!canReadTask(ctx, task)) throw forbidden('You do not have access to this task')
    return singleRes(taskDetail(task))
  }

  // ════════════════════════ Board ════════════════════════

  if (method === 'GET' && path === '/v1/board') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const board = boardForTenant(tenantId)
    if (!board) throw notFound('Board')
    return singleRes(board)
  }

  if (method === 'POST' && path === '/v1/board/columns/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const board = boardForTenant(tenantId)
    if (!board) throw notFound('Board')

    const id = pid(body.id)
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A column name is required')
    const status = String(body.status ?? '') as TaskStatus
    const allowed: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED']
    if (!allowed.includes(status)) throw badRequest('Pick the status this column sets')
    // The schema documents no minimum, but a zero or fractional sort renders
    // the board unpredictably — enforce the real rule here.
    if (body.columnSort !== undefined && (!Number.isInteger(Number(body.columnSort)) || Number(body.columnSort) < 1)) {
      throw badRequest('Order must be a whole number of 1 or more')
    }

    if (id) {
      const column = boardColumns.find(c => c.id === id && c.boardId === board.id && !c.isRemoved)
      if (!column) throw notFound('Column')
      column.name = name
      column.description = (body.description as string | null)?.toString().trim() || null
      column.status = status
      column.columnSort = Number(body.columnSort) || column.columnSort
      column.isActive = body.isActive === undefined ? column.isActive : Boolean(body.isActive)
      column.updateDate = now
      audit(ctx, 'board_column.updated', `board_column:${column.id}`, name, now, tenantId)
      return singleRes(column)
    }

    const created: BoardColumn = {
      id: nextId(boardColumns),
      boardId: board.id,
      name,
      description: (body.description as string | null)?.toString().trim() || null,
      columnSort: Number(body.columnSort) || board.columns.length + 1,
      status,
      isActive: true,
      createDate: now,
      updateDate: now,
    }
    boardColumns.push(created)
    audit(ctx, 'board_column.created', `board_column:${created.id}`, name, now, tenantId)
    return singleRes(created)
  }

  /**
   * Soft-remove a column. If the column still has open work the removal is
   * SKIPPED and reported as a warning — a 200 here does not mean it happened.
   * Failing the whole request instead would be wrong too: the admin's intent
   * ("tidy the board") is fine, only this column is not ready to go.
   */
  if (method === 'POST' && path === '/v1/board/columns/remove') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const board = boardForTenant(tenantId)
    if (!board) throw notFound('Board')
    const column = boardColumns.find(c => c.id === pid(body.id) && c.boardId === board.id && !c.isRemoved)
    if (!column) throw notFound('Column')

    const openCount = tasks.filter(t =>
      t.tenantId === tenantId
      && t.columnId === column.id
      && ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING'].includes(t.status),
    ).length
    if (openCount > 0) {
      const plural = openCount === 1 ? 'task' : 'tasks'
      return singleRes({
        removed: false,
        warning: `"${column.name}" still has ${openCount} open ${plural}, so the removal was skipped. Move or finish that work first.`,
      })
    }

    column.isRemoved = true
    column.updateDate = now
    audit(ctx, 'board_column.removed', `board_column:${column.id}`, column.name, now, tenantId)
    return singleRes({ removed: true, warning: null })
  }

  // ════════════════════════ Catalog (native) ════════════════════════

  if (method === 'GET' && path === '/v1/catalog/categories') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = catalogCategories
      .filter(c => c.tenantId === tenantId)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/catalog/categories/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A category name is required')
    const code = String(body.code ?? '').trim().toUpperCase()
    if (!code) throw badRequest('A category code is required')
    const sort = Number(body.sort)
    if (!Number.isInteger(sort) || sort < 0) throw badRequest('Sort must be a whole number of 0 or more')
    const icon = (body.icon as string | null)?.toString().trim() || null

    const id = pid(body.id)
    if (id) {
      const category = catalogCategories.find(c => c.id === id && c.tenantId === tenantId)
      if (!category) throw notFound('Category')
      category.name = name
      category.code = code
      category.icon = icon
      category.sort = sort
      category.isActive = body.isActive === undefined ? category.isActive : Boolean(body.isActive)
      category.updateDate = now
      audit(ctx, 'catalog_category.updated', `catalog_category:${category.id}`, name, now, tenantId)
      return singleRes(category)
    }

    const created: CatalogCategory = {
      id: nextId(catalogCategories),
      tenantId,
      name,
      code,
      icon,
      sort,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createDate: now,
      updateDate: now,
    }
    catalogCategories.push(created)
    audit(ctx, 'catalog_category.created', `catalog_category:${created.id}`, name, now, tenantId)
    return singleRes(created)
  }

  if (method === 'GET' && path === '/v1/catalog/items') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = catalogItems
      .filter(i => i.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name))
    return listRes(rows)
  }

  /**
   * Catalog item upsert. A FULL REPLACE, not a patch: every stored field takes
   * the request's value, so a client that does not edit a field must still echo
   * it back — omitting `defaultDurationMinutes` clears it (the bug the admin
   * screen once had: every save silently wiped the duration another producer
   * had written).
   */
  if (method === 'POST' && path === '/v1/catalog/items/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('An item name is required')

    const id = pid(body.id)
    const existing = id ? catalogItems.find(i => i.id === id && i.tenantId === tenantId) : undefined
    if (id && !existing) throw notFound('Catalog item')

    const categoryId = pid(body.categoryId)
    const category = catalogCategories.find(c => c.id === categoryId && c.tenantId === tenantId)
    if (!category) throw badRequest('Pick a category at this property')
    // Keeping an item on the deactivated category it already has is fine;
    // moving an item onto one is a choice whose only outcome is confusion.
    if (!category.isActive && existing?.categoryId !== categoryId) {
      throw badRequest('That category is deactivated — pick an active one')
    }

    const priority = String(body.defaultPriority ?? 'NORMAL') as TaskPriority
    const priorities: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
    if (!priorities.includes(priority)) throw badRequest('Pick a priority')

    const minProofPhotos = Number(body.minProofPhotos ?? 0)
    if (!Number.isInteger(minProofPhotos) || minProofPhotos < 0 || minProofPhotos > 10) {
      throw badRequest('Min proof photos must be a whole number between 0 and 10')
    }

    // Blank steps are dropped, not just trimmed: an empty label would seed a
    // blank checklist step onto every task raised from this item.
    const checklistRaw = Array.isArray(body.defaultChecklist) ? body.defaultChecklist : []
    const defaultChecklist = checklistRaw.map(step => String(step ?? '').trim()).filter(Boolean)

    const duration = Number(body.defaultDurationMinutes)
    const defaultDurationMinutes = Number.isInteger(duration) && duration > 0 ? duration : null

    const next = {
      categoryId,
      name,
      description: (body.description as string | null)?.toString().trim() || null,
      quantityEnabled: Boolean(body.quantityEnabled),
      defaultPriority: priority,
      requiresLocation: Boolean(body.requiresLocation),
      defaultChecklist,
      defaultDurationMinutes,
      minProofPhotos,
      requiresCompletionNote: Boolean(body.requiresCompletionNote),
    }

    if (existing) {
      Object.assign(existing, next)
      existing.isActive = body.isActive === undefined ? existing.isActive : Boolean(body.isActive)
      existing.updateDate = now
      return singleRes(existing)
    }

    const created: CatalogItem = {
      id: nextId(catalogItems),
      tenantId,
      ...next,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createDate: now,
      updateDate: now,
    }
    catalogItems.push(created)
    return singleRes(created)
  }

  // ════════════════════════ Locations ════════════════════════

  if (method === 'GET' && path === '/v1/location-types') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = locationTypes
      .filter(t => t.tenantId === tenantId)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/location-types/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A location type name is required')
    const code = String(body.code ?? '').trim().toUpperCase()
    if (!code) throw badRequest('A location type code is required')
    const sort = Number(body.sort)
    if (!Number.isInteger(sort) || sort < 0) throw badRequest('Sort must be a whole number of 0 or more')

    const id = pid(body.id)
    if (id) {
      const type = locationTypes.find(t => t.id === id && t.tenantId === tenantId)
      if (!type) throw notFound('Location type')
      type.name = name
      type.code = code
      type.linksRequester = Boolean(body.linksRequester)
      type.sort = sort
      type.isActive = body.isActive === undefined ? type.isActive : Boolean(body.isActive)
      type.updateDate = now
      audit(ctx, 'location_type.updated', `location_type:${type.id}`, name, now, tenantId)
      return singleRes(type)
    }

    const created: LocationType = {
      id: nextId(locationTypes),
      tenantId,
      name,
      code,
      linksRequester: Boolean(body.linksRequester),
      sort,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createDate: now,
      updateDate: now,
    }
    locationTypes.push(created)
    audit(ctx, 'location_type.created', `location_type:${created.id}`, name, now, tenantId)
    return singleRes(created)
  }

  if (method === 'GET' && path === '/v1/locations') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = propertyLocations
      .filter(l => l.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/locations/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A location name is required')
    const code = String(body.code ?? '').trim()
    if (!code) throw badRequest('A location code is required')

    const id = pid(body.id)
    const existing = id ? propertyLocations.find(l => l.id === id && l.tenantId === tenantId) : undefined
    if (id && !existing) throw notFound('Location')

    const locationTypeId = pid(body.locationTypeId)
    const type = locationTypes.find(t => t.id === locationTypeId && t.tenantId === tenantId)
    if (!type) throw badRequest('Pick a location type at this property')
    // A location may stay on a since-deactivated type; it may not move onto one.
    if (!type.isActive && existing?.locationTypeId !== locationTypeId) {
      throw badRequest('That location type is deactivated — pick an active one')
    }

    if (existing) {
      existing.name = name
      existing.code = code
      existing.locationTypeId = locationTypeId
      existing.isActive = body.isActive === undefined ? existing.isActive : Boolean(body.isActive)
      existing.updateDate = now
      audit(ctx, 'location.updated', `location:${existing.id}`, name, now, tenantId)
      return singleRes(existing)
    }

    const created: PropertyLocation = {
      id: nextId(propertyLocations),
      tenantId,
      locationTypeId,
      name,
      code,
      parentId: null,
      // The guest register belongs to the PMS side; the admin console never
      // writes it.
      currentGuest: null,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createDate: now,
      updateDate: now,
    }
    propertyLocations.push(created)
    audit(ctx, 'location.created', `location:${created.id}`, name, now, tenantId)
    return singleRes(created)
  }

  // ════════════════════════ Teams ════════════════════════

  if (method === 'GET' && path === '/v1/teams') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = teams
      .filter(t => t.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => ({ ...t, memberCount: teamMembers.filter(m => m.teamId === t.id).length }))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/teams/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A team name is required')
    const departmentId = pid(body.departmentId) || null
    if (departmentId && !departments.some(d => d.id === departmentId && d.tenantId === tenantId)) {
      throw badRequest('Pick a department at this property')
    }

    const id = pid(body.id)
    if (id) {
      const team = teams.find(t => t.id === id && t.tenantId === tenantId)
      if (!team) throw notFound('Team')
      team.name = name
      team.description = (body.description as string | null)?.toString().trim() || null
      team.departmentId = departmentId
      team.isActive = body.isActive === undefined ? team.isActive : Boolean(body.isActive)
      team.updateDate = now
      audit(ctx, 'team.updated', `team:${team.id}`, name, now, tenantId)
      return singleRes(team)
    }

    const created: Team = {
      id: nextId(teams),
      tenantId,
      name,
      description: (body.description as string | null)?.toString().trim() || null,
      departmentId,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createDate: now,
      updateDate: now,
    }
    teams.push(created)
    audit(ctx, 'team.created', `team:${created.id}`, name, now, tenantId)
    return singleRes(created)
  }

  /** Member user ids for one team. */
  if (method === 'GET' && /^\/v1\/teams\/[^/]+\/members$/.test(path)) {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const teamId = path.split('/')[3]!
    const team = teams.find(t => t.id === teamId && t.tenantId === tenantId)
    if (!team) throw notFound('Team')
    return listRes(teamMembers.filter(m => m.teamId === team.id).map(m => m.userId))
  }

  /**
   * Add a member. Adding someone already on the team is a 409, not a silent
   * duplicate row — a double-clicked Add must not list the same person twice.
   */
  if (method === 'POST' && /^\/v1\/teams\/[^/]+\/members\/add$/.test(path)) {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const teamId = path.split('/')[3]!
    const team = teams.find(t => t.id === teamId && t.tenantId === tenantId)
    if (!team) throw notFound('Team')
    const userId = pid(body.userId)
    if (!staffProfiles.some(p => p.userId === userId && p.tenantId === tenantId && p.isActive)) {
      throw badRequest('That person does not work at this property')
    }
    if (teamMembers.some(m => m.teamId === team.id && m.userId === userId)) {
      throw conflict('ALREADY_MEMBER', 'That person is already on this team')
    }
    teamMembers.push({ teamId: team.id, userId })
    team.updateDate = now
    audit(ctx, 'team.member_added', `team:${team.id} user:${userId}`, null, now, tenantId)
    return singleRes({ teamId: team.id, userId })
  }

  /** Remove a member. Removing someone not on the team is a 404. */
  if (method === 'POST' && /^\/v1\/teams\/[^/]+\/members\/remove$/.test(path)) {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const teamId = path.split('/')[3]!
    const team = teams.find(t => t.id === teamId && t.tenantId === tenantId)
    if (!team) throw notFound('Team')
    const userId = pid(body.userId)
    const index = teamMembers.findIndex(m => m.teamId === team.id && m.userId === userId)
    if (index === -1) throw notFound('Team member')
    teamMembers.splice(index, 1)
    team.updateDate = now
    audit(ctx, 'team.member_removed', `team:${team.id} user:${userId}`, null, now, tenantId)
    return singleRes({ ok: true })
  }

  // ════════════════════════ Operating schedules ════════════════════════

  if (method === 'GET' && path === '/v1/operating-schedules') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = operatingSchedules
      .filter(s => s.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name))
    return listRes(rows)
  }

  /**
   * Schedule upsert. Every save replaces the FULL windows/exceptions set —
   * there is no partial merge, so a rename must echo the hours back and an
   * hours edit must echo the name back.
   */
  if (method === 'POST' && path === '/v1/operating-schedules/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A schedule name is required')
    const departmentId = pid(body.departmentId) || null
    if (departmentId && !departments.some(d => d.id === departmentId && d.tenantId === tenantId)) {
      throw badRequest('Pick a department at this property')
    }
    const isDefault = Boolean(body.isDefault)

    const id = pid(body.id)
    const existing = id ? operatingSchedules.find(s => s.id === id && s.tenantId === tenantId) : undefined
    if (id && !existing) throw notFound('Operating schedule')

    // One default per tenant, one schedule per department — refused, not
    // silently reshuffled: the caller should see which schedule is in the way.
    if (isDefault && operatingSchedules.some(s => s.tenantId === tenantId && s.isDefault && s.id !== existing?.id)) {
      throw conflict('DUPLICATE_DEFAULT', 'Another schedule is already the default for this property')
    }
    if (departmentId && operatingSchedules.some(s => s.tenantId === tenantId && s.departmentId === departmentId && s.id !== existing?.id)) {
      throw conflict('DEPARTMENT_SCHEDULED', 'That department already has an operating schedule')
    }

    // A weekday with no window is closed; a present window must be a real span.
    const windowsRaw = Array.isArray(body.windows) ? body.windows as Array<Record<string, unknown>> : []
    const windows: OperatingWindow[] = windowsRaw.map((w) => {
      const weekday = Number(w.weekday)
      const opensMinutes = Number(w.opensMinutes)
      const closesMinutes = Number(w.closesMinutes)
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest('Weekday must be 0 (Sunday) to 6 (Saturday)')
      if (!Number.isInteger(opensMinutes) || opensMinutes < 0 || opensMinutes > 1439) throw badRequest('Opening time must be within the day')
      if (!Number.isInteger(closesMinutes) || closesMinutes <= opensMinutes || closesMinutes > 1440) {
        throw badRequest('A window must close after it opens (1440 = until midnight)')
      }
      return { weekday, opensMinutes, closesMinutes }
    })

    const exceptionsRaw = Array.isArray(body.exceptions) ? body.exceptions as Array<Record<string, unknown>> : []
    const exceptions: OperatingException[] = exceptionsRaw.map((e) => {
      const date = String(e.date ?? '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('An exception needs a date (YYYY-MM-DD)')
      const isClosed = Boolean(e.isClosed)
      if (isClosed) return { date, isClosed, opensMinutes: null, closesMinutes: null }
      const opensMinutes = Number(e.opensMinutes)
      const closesMinutes = Number(e.closesMinutes)
      if (!Number.isInteger(opensMinutes) || !Number.isInteger(closesMinutes) || closesMinutes <= opensMinutes) {
        throw badRequest('An open exception needs opening hours that close after they open')
      }
      return { date, isClosed, opensMinutes, closesMinutes }
    })

    if (existing) {
      existing.name = name
      existing.isDefault = isDefault
      existing.departmentId = departmentId
      existing.windows = windows
      existing.exceptions = exceptions
      existing.updateDate = now
      audit(ctx, 'operating_schedule.updated', `operating_schedule:${existing.id}`, name, now, tenantId)
      return singleRes(existing)
    }

    const created: OperatingSchedule = {
      id: nextId(operatingSchedules),
      tenantId,
      name,
      isDefault,
      departmentId,
      windows,
      exceptions,
      createDate: now,
      updateDate: now,
    }
    operatingSchedules.push(created)
    audit(ctx, 'operating_schedule.created', `operating_schedule:${created.id}`, name, now, tenantId)
    return singleRes(created)
  }

  // ════════════════════════ Terminology ════════════════════════

  /** The merged map: this tenant's overrides on top of the product defaults. */
  if (method === 'GET' && path === '/v1/terminology') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const merged: Record<TerminologyKey, string> = { ...TERMINOLOGY_DEFAULTS }
    for (const override of terminologyOverrides) {
      if (override.tenantId === tenantId) merged[override.key] = override.value
    }
    return singleRes(merged)
  }

  if (method === 'PATCH' && path === '/v1/terminology') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const key = String(body.key ?? '') as TerminologyKey
    if (!TERMINOLOGY_KEYS.includes(key)) throw badRequest('That term cannot be renamed')
    const value = String(body.value ?? '').trim()
    if (!value) throw badRequest('A term needs a name')
    if (value.length > 50) throw badRequest('Keep the term under 50 characters')

    const existing = terminologyOverrides.find(o => o.tenantId === tenantId && o.key === key)
    if (existing) existing.value = value
    else terminologyOverrides.push({ tenantId, key, value })
    audit(ctx, 'terminology.updated', `terminology:${key}`, value, now, tenantId)

    const merged: Record<TerminologyKey, string> = { ...TERMINOLOGY_DEFAULTS }
    for (const override of terminologyOverrides) {
      if (override.tenantId === tenantId) merged[override.key] = override.value
    }
    return singleRes(merged)
  }

  // ════════════════════════ Departments ════════════════════════

  if (method === 'GET' && path === '/v1/departments') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = departments
      .filter(d => d.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/departments/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A department name is required')

    const id = pid(body.id)
    if (id) {
      const dept = departments.find(d => d.id === id && d.tenantId === tenantId)
      if (!dept) throw notFound('Department')
      dept.name = name
      dept.isActive = body.isActive === undefined ? dept.isActive : Boolean(body.isActive)
      dept.updateDate = now
      audit(ctx, 'department.updated', `department:${dept.id}`, name, now, tenantId)
      return singleRes(dept)
    }

    const created: Department = {
      id: nextId(departments),
      tenantId,
      name,
      isActive: true,
      createDate: now,
      updateDate: now,
    }
    departments.push(created)
    audit(ctx, 'department.created', `department:${created.id}`, name, now, tenantId)
    return singleRes(created)
  }

  // ════════════════════════ SLAs ════════════════════════

  if (method === 'GET' && path === '/v1/slas') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = slas
      .filter(s => s.tenantId === tenantId)
      .sort((a, b) => a.responseTime - b.responseTime)
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/slas/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('An SLA name is required')
    // Whole minutes only: "15.5" silently becoming a real SLA target is the
    // same class of risk as a seconds/minutes conversion bug.
    const responseTime = Number(body.responseTime)
    const resolutionTime = Number(body.resolutionTime)
    if (!Number.isInteger(responseTime) || responseTime < 1) throw badRequest('Response target must be a whole number of minutes, at least 1')
    if (!Number.isInteger(resolutionTime) || resolutionTime < 1) throw badRequest('Resolution target must be a whole number of minutes, at least 1')
    // Both budgets count from activation, so a resolution shorter than the
    // response would demand the work finish before anyone need start it.
    if (resolutionTime < responseTime) throw badRequest('Resolution cannot be shorter than response — both count from activation')
    const isDefault = Boolean(body.isDefault)

    const id = pid(body.id)
    const target = id ? slas.find(s => s.id === id && s.tenantId === tenantId) : undefined
    if (id && !target) throw notFound('SLA')

    // Exactly one default per tenant.
    if (isDefault) {
      slas.filter(s => s.tenantId === tenantId).forEach((s) => { s.isDefault = false })
    }

    if (target) {
      target.name = name
      target.responseTime = responseTime
      target.resolutionTime = resolutionTime
      target.isDefault = isDefault
      target.updateDate = now
      audit(ctx, 'sla.updated', `sla:${target.id}`, `${name} ${responseTime}/${resolutionTime}m`, now, tenantId)
      return singleRes(target)
    }

    const created: Sla = {
      id: nextId(slas),
      tenantId,
      name,
      responseTime,
      resolutionTime,
      // First SLA for a tenant becomes the default whatever the caller said.
      isDefault: isDefault || !slas.some(s => s.tenantId === tenantId),
      createDate: now,
      updateDate: now,
    }
    slas.push(created)
    audit(ctx, 'sla.created', `sla:${created.id}`, `${name} ${responseTime}/${resolutionTime}m`, now, tenantId)
    return singleRes(created)
  }

  // ════════════════════════ Routing rules ════════════════════════

  if (method === 'GET' && path === '/v1/routing-rules') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'leader', 'admin')
    const rows = routingRules
      .filter(r => r.tenantId === tenantId)
      .sort((a, b) => ROUTING_TIERS.indexOf(routingTier(a)) - ROUTING_TIERS.indexOf(routingTier(b)) || Number(a.id) - Number(b.id))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/routing-rules/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')

    const departmentId = pid(body.departmentId)
    if (!departments.some(d => d.id === departmentId && d.tenantId === tenantId)) {
      throw badRequest('Pick a department at this property')
    }
    const slaId = pid(body.slaId)
    if (!slas.some(s => s.id === slaId && s.tenantId === tenantId)) {
      throw badRequest('Pick an SLA at this property')
    }

    // At most ONE matcher — the matcher decides the rule's specificity tier,
    // and a rule sitting in two tiers at once could not be reasoned about.
    // No matcher at all is legal: that is the catch-all tier.
    const matchItemId = pid(body.matchItemId) || null
    const matchCategoryId = pid(body.matchCategoryId) || null
    const matchLocationTypeId = pid(body.matchLocationTypeId) || null
    const matchPriorityRaw = body.matchPriority == null || body.matchPriority === '' ? null : String(body.matchPriority) as TaskPriority
    if (matchPriorityRaw && !TASK_PRIORITY_VALUES.includes(matchPriorityRaw)) throw badRequest('Pick a priority to match on')
    const matcherCount = [matchItemId, matchCategoryId, matchLocationTypeId, matchPriorityRaw].filter(Boolean).length
    if (matcherCount > 1) throw badRequest('A rule matches on one thing: an item, a category, a location type, a priority — or nothing (catch-all)')
    if (matchItemId && !catalogItems.some(i => i.id === matchItemId && i.tenantId === tenantId)) throw badRequest('Pick a catalog item at this property')
    if (matchCategoryId && !catalogCategories.some(c => c.id === matchCategoryId && c.tenantId === tenantId)) throw badRequest('Pick a category at this property')
    if (matchLocationTypeId && !locationTypes.some(t => t.id === matchLocationTypeId && t.tenantId === tenantId)) throw badRequest('Pick a location type at this property')

    const id = pid(body.id)
    if (id) {
      const rule = routingRules.find(r => r.id === id && r.tenantId === tenantId)
      if (!rule) throw notFound('Routing rule')
      rule.matchItemId = matchItemId
      rule.matchCategoryId = matchCategoryId
      rule.matchLocationTypeId = matchLocationTypeId
      rule.matchPriority = matchPriorityRaw
      rule.departmentId = departmentId
      rule.slaId = slaId
      rule.remark = (body.remark as string | null)?.toString().trim() || null
      rule.isActive = body.isActive === undefined ? rule.isActive : Boolean(body.isActive)
      rule.updateDate = now
      audit(ctx, 'routing_rule.updated', `routing_rule:${rule.id}`, rule.remark, now, tenantId)
      return singleRes(rule)
    }

    const created: RoutingRule = {
      id: nextId(routingRules),
      tenantId,
      matchItemId,
      matchCategoryId,
      matchLocationTypeId,
      matchPriority: matchPriorityRaw,
      departmentId,
      slaId,
      remark: (body.remark as string | null)?.toString().trim() || null,
      isActive: true,
      createDate: now,
      updateDate: now,
    }
    routingRules.push(created)
    audit(ctx, 'routing_rule.created', `routing_rule:${created.id}`, created.remark, now, tenantId)
    return singleRes(created)
  }

  /** Delete a routing rule. Hard delete: rules carry no history worth keeping. */
  if (method === 'POST' && path === '/v1/routing-rules/delete') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const index = routingRules.findIndex(r => r.id === pid(body.id) && r.tenantId === tenantId)
    if (index === -1) throw notFound('Routing rule')
    const [removed] = routingRules.splice(index, 1)
    audit(ctx, 'routing_rule.deleted', `routing_rule:${removed!.id}`, removed!.remark, now, tenantId)
    return singleRes({ ok: true })
  }

  // ════════════════════════ Staff directory ════════════════════════

  if (method === 'GET' && path === '/v1/staff') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')

    // The assign picker defaults to the task's own department; `departmentId`
    // narrows it, and the UI's "show all" toggle simply omits the filter.
    const departmentId = String(query.departmentId ?? '')
    const rows = staffProfiles
      .filter(p => p.tenantId === tenantId && p.isActive)
      .filter(p => !departmentId || p.departmentId === departmentId)
      .map((p) => {
        const user = staffUsers.find(u => u.id === p.userId)
        return {
          profileId: p.id,
          userId: p.userId,
          firstName: user?.firstName ?? '',
          lastName: user?.lastName ?? '',
          email: user?.email ?? '',
          picture: user?.picture ?? null,
          position: p.position,
          role: p.role,
          departmentId: p.departmentId,
          department: departmentBrief(p.departmentId),
          canCreateTask: p.canCreateTask,
          isActive: p.isActive,
          /** How much open work they are already carrying. */
          openTaskCount: tasks.filter(t =>
            t.tenantId === tenantId
            && activeAssignment(t.id)?.userId === p.userId
            && ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING'].includes(t.status),
          ).length,
        }
      })
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/staff/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')

    const role = String(body.role ?? '') as TenantRole
    if (!['staff', 'leader', 'admin'].includes(role)) throw badRequest('Pick a role')
    const departmentId = pid(body.departmentId) || null
    if (departmentId && !departments.some(d => d.id === departmentId && d.tenantId === tenantId)) {
      throw badRequest('Pick a department at this property')
    }

    const profileId = pid(body.profileId)
    if (profileId) {
      const profile = staffProfiles.find(p => p.id === profileId && p.tenantId === tenantId)
      if (!profile) throw notFound('Staff member')
      profile.role = role
      profile.departmentId = departmentId
      profile.position = (body.position as string | null)?.toString().trim() || null
      profile.canCreateTask = Boolean(body.canCreateTask)
      profile.isActive = body.isActive === undefined ? profile.isActive : Boolean(body.isActive)
      profile.updateDate = now
      audit(ctx, 'staff.updated', `staff_profile:${profile.id}`, `role=${role}`, now, tenantId)
      return singleRes(profile)
    }

    // Adding someone new: match on email, creating the user if unknown.
    // Admin cannot be granted at creation — the account is added as staff or
    // leader, then promoted in a second, deliberate step. One request that both
    // invents an account and hands it the property is too much power in one
    // typo.
    if (role === 'admin') {
      throw badRequest('Admin cannot be granted at creation. Add them as staff or leader, then promote them.')
    }
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email) throw badRequest('An email address is required')
    const firstName = String(body.firstName ?? '').trim()
    const lastName = String(body.lastName ?? '').trim()
    if (!firstName) throw badRequest('A first name is required')

    let user = staffUsers.find(u => u.email.toLowerCase() === email)
    if (!user) {
      user = {
        id: nextId(staffUsers),
        firstName,
        lastName,
        email,
        picture: null,
        isOperator: false,
        isActive: true,
        lastLogin: null,
        createDate: now,
        updateDate: now,
      }
      staffUsers.push(user)
    }

    if (staffProfiles.some(p => p.userId === user!.id && p.tenantId === tenantId && p.isActive)) {
      throw conflict('ALREADY_MEMBER', 'That person already works at this property')
    }

    const created: StaffProfile = {
      id: nextId(staffProfiles),
      tenantId,
      userId: user.id,
      departmentId,
      position: (body.position as string | null)?.toString().trim() || null,
      role,
      canCreateTask: Boolean(body.canCreateTask),
      isActive: true,
      createDate: now,
      updateDate: now,
    }
    staffProfiles.push(created)
    audit(ctx, 'staff.added', `staff_profile:${created.id}`, email, now, tenantId)
    return singleRes(created)
  }

  // ════════════════════════ Reports ════════════════════════

  /**
   * Property summary for the tenant dashboard.
   */
  if (method === 'GET' && path === '/v1/reports/summary') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const scoped = visibleTasks(ctx, tenantId)
    const open = scoped.filter(t => ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING'].includes(t.status))
    return singleRes({
      tenantId,
      total: scoped.length,
      open: open.length,
      unclaimed: open.filter(t => !activeAssignment(t.id)).length,
      breached: scoped.filter(t => t.responseSlaStatus === 'BREACHED' || t.resolutionSlaStatus === 'BREACHED').length,
      finishedToday: scoped.filter(t => ['FINISHED', 'VERIFIED'].includes(t.status)).length,
      byStatus: (['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED'] as TaskStatus[])
        .map(status => ({ status, count: scoped.filter(t => t.status === status).length })),
      byDepartment: departments
        .filter(d => d.tenantId === tenantId && d.isActive)
        .map(d => ({
          departmentId: d.id,
          name: d.name,
          open: open.filter(t => t.departmentId === d.id).length,
        })),
    })
  }

  /**
   * Cross-property report for a group.
   *
   * Scoped to the member properties of the requested group and nothing else —
   * the query is bounded to that tenant list rather than sweeping every
   * partition, which is what keeps a group report both correct and cheap.
   */
  if (method === 'GET' && path === '/v1/reports/group') {
    requireSession(ctx)
    const groupId = String(query.tenantGroupId ?? '')
    const group = tenantGroups.find(g => g.id === groupId)
    if (!group) throw notFound('Group')

    const memberIds = tenants.filter(t => t.tenantGroupId === group.id && t.isActive).map(t => t.id)
    // Only the properties this user can actually reach within the group.
    const allowed = memberIds.filter(id => ctx.reachableTenantIds.includes(id))
    if (!allowed.length) throw forbidden('You do not have access to any property in this group')

    const rows = allowed.map((tenantId) => {
      const scoped = tasks.filter(t => t.tenantId === tenantId)
      const open = scoped.filter(t => ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING'].includes(t.status))
      return {
        tenantId,
        tenantName: tenants.find(t => t.id === tenantId)?.name ?? tenantId,
        total: scoped.length,
        open: open.length,
        unclaimed: open.filter(t => !activeAssignment(t.id)).length,
        breached: scoped.filter(t => t.responseSlaStatus === 'BREACHED' || t.resolutionSlaStatus === 'BREACHED').length,
      }
    })

    return singleRes({
      tenantGroupId: group.id,
      tenantGroupName: group.name,
      /** Properties in the group the caller cannot see, for an honest footnote. */
      hiddenPropertyCount: memberIds.length - allowed.length,
      properties: rows,
      totals: {
        total: rows.reduce((n, r) => n + r.total, 0),
        open: rows.reduce((n, r) => n + r.open, 0),
        unclaimed: rows.reduce((n, r) => n + r.unclaimed, 0),
        breached: rows.reduce((n, r) => n + r.breached, 0),
      },
    })
  }

  if (method === 'GET' && path === '/v1/tenant-groups') {
    requireSession(ctx)
    // Groups the caller can see at least one property in.
    const rows = tenantGroups.filter(g =>
      tenants.some(t => t.tenantGroupId === g.id && ctx.reachableTenantIds.includes(t.id)),
    )
    return listRes(rows)
  }

  // ════════════════════════ Operator / platform ════════════════════════

  if (path === '/v1/operator/tenants') {
    requireOperator(ctx)
    if (method === 'GET') {
      const rows = tenants.map(t => ({
        ...t,
        tenantGroup: t.tenantGroupId ? tenantGroups.find(g => g.id === t.tenantGroupId) ?? null : null,
        staffCount: staffProfiles.filter(p => p.tenantId === t.id && p.isActive).length,
        openTaskCount: tasks.filter(x => x.tenantId === t.id && ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING'].includes(x.status)).length,
      })).sort((a, b) => a.name.localeCompare(b.name))
      return listRes(rows)
    }
    if (method === 'POST') {
      const name = String(body.name ?? '').trim()
      if (!name) throw badRequest('A property name is required')
      const code = String(body.code ?? '').trim().toUpperCase()
      if (!code) throw badRequest('A property code is required')
      if (tenants.some(t => t.code === code)) throw conflict('DUPLICATE_CODE', 'That property code is already taken')
      const tenantGroupId = pid(body.tenantGroupId) || null
      if (tenantGroupId && !tenantGroups.some(g => g.id === tenantGroupId)) throw badRequest('Unknown group')

      const created: Tenant = {
        id: nextId(tenants),
        tenantGroupId,
        name,
        code,
        timezone: String(body.timezone ?? 'Asia/Jakarta'),
        isActive: true,
        createDate: now,
      }
      tenants.push(created)

      // Provision the pieces a property cannot function without: a board with
      // the standard columns, and a default SLA. Onboarding is done by us, not
      // self-serve, so this is the moment it has to happen.
      const board: Board = { id: nextId(boards), tenantId: created.id, name: 'Operations Board', createDate: now }
      boards.push(board)
      const standard: Array<{ name: string; status: TaskStatus }> = [
        { name: 'New', status: 'NEW' },
        { name: 'In Progress', status: 'IN_PROGRESS' },
        { name: 'Awaiting Review', status: 'SUBMITTED' },
        { name: 'Finished', status: 'FINISHED' },
        { name: 'Verified', status: 'VERIFIED' },
        { name: 'Cancelled', status: 'CANCELLED' },
      ]
      standard.forEach((col, index) => {
        boardColumns.push({
          id: nextId(boardColumns),
          boardId: board.id,
          name: col.name,
          description: null,
          columnSort: index + 1,
          status: col.status,
          isActive: true,
          createDate: now,
          updateDate: now,
        })
      })
      slas.push({
        id: nextId(slas),
        tenantId: created.id,
        name: 'Standard',
        responseTime: 30,
        resolutionTime: 90,
        isDefault: true,
        createDate: now,
        updateDate: now,
      })

      audit(ctx, 'tenant.created', `tenant:${created.id}`, `${name} (${code})`, now)
      return singleRes(created)
    }
  }

  if (path === '/v1/operator/tenant-groups') {
    requireOperator(ctx)
    if (method === 'GET') {
      const rows = tenantGroups.map(g => ({
        ...g,
        propertyCount: tenants.filter(t => t.tenantGroupId === g.id).length,
        grantCount: groupGrants.filter(x => x.tenantGroupId === g.id && !x.revokedAt).length,
      })).sort((a, b) => a.name.localeCompare(b.name))
      return listRes(rows)
    }
    if (method === 'POST') {
      const name = String(body.name ?? '').trim()
      if (!name) throw badRequest('A group name is required')
      if (tenantGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
        throw conflict('DUPLICATE_NAME', 'A group with that name already exists')
      }
      const created: TenantGroup = { id: nextId(tenantGroups), name, createDate: now }
      tenantGroups.push(created)
      audit(ctx, 'tenant_group.created', `tenant_group:${created.id}`, name, now)
      return singleRes(created)
    }
  }

  if (path === '/v1/operator/partners') {
    requireOperator(ctx)
    if (method === 'GET') {
      const rows = partners.map(p => ({
        ...p,
        // Never echo the secret on a list. It is shown once, at creation.
        secretPreview: undefined,
        taskCount: tasks.filter(t => t.partnerId === p.id).length,
        undeliveredEventCount: statusEvents.filter(e => e.partnerId === p.id && !e.deliveredAt).length,
      })).sort((a, b) => a.name.localeCompare(b.name))
      return listRes(rows)
    }
    if (method === 'POST') {
      const name = String(body.name ?? '').trim()
      if (!name) throw badRequest('A partner name is required')
      if (partners.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        throw conflict('DUPLICATE_NAME', 'A partner with that name already exists')
      }
      const sourceAppCode = String(body.sourceAppCode ?? '').trim() || null
      if (sourceAppCode && !sourceApps.some(a => a.code === sourceAppCode && a.isActive)) {
        throw badRequest('Pick a source app from the registry')
      }
      const created: Partner = {
        id: nextId(partners),
        name,
        kind: String(body.kind ?? '').trim() || 'Integration',
        sourceAppCode,
        isActive: true,
        createDate: now,
        lastDispatchAt: null,
      }
      partners.push(created)
      audit(ctx, 'partner.created', `partner:${created.id}`, name, now)
      // The one and only time the secret is returned. It is AES-256-GCM
      // encrypted at rest and cannot be read back afterwards — only rotated.
      return singleRes({ ...created, secretPreview: mintPartnerSecret(created.id) })
    }
  }

  /**
   * The source-app registry. Reading is open to every authenticated user —
   * badges are rendered everywhere — but curation is an operator concern.
   */
  if (method === 'GET' && path === '/v1/source-apps') {
    requireRole(ctx, 'staff', 'leader', 'admin')
    return listRes([...sourceApps].sort((a, b) => a.name.localeCompare(b.name)))
  }

  if (method === 'POST' && path === '/v1/operator/source-apps/upsert') {
    requireOperator(ctx)
    const code = String(body.code ?? '').trim()
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(code)) throw badRequest('A code is lowercase letters, digits and hyphens')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('A name is required')
    const badgeColor = String(body.badgeColor ?? '').trim()
    if (!/^#[0-9a-f]{6}$/i.test(badgeColor)) throw badRequest('The badge colour is a 6-digit hex value like #2563eb')

    const existing = sourceApps.find(a => a.code === code)
    if (existing) {
      existing.name = name
      existing.badgeColor = badgeColor
      existing.isActive = body.isActive === undefined ? existing.isActive : Boolean(body.isActive)
      existing.updateDate = now
      audit(ctx, 'source_app.updated', `source_app:${code}`, name, now)
      return singleRes(existing)
    }
    const created: SourceApp = { code, name, badgeColor, isActive: true, createDate: now, updateDate: now }
    sourceApps.push(created)
    audit(ctx, 'source_app.created', `source_app:${code}`, name, now)
    return singleRes(created)
  }

  if (method === 'POST' && path === '/v1/operator/partners/rotate-secret') {
    requireOperator(ctx)
    const partner = partners.find(p => p.id === pid(body.partnerId))
    if (!partner) throw notFound('Partner')
    audit(ctx, 'partner.secret_rotated', `partner:${partner.id}`, partner.name, now)
    return singleRes({ ...partner, secretPreview: mintPartnerSecret(partner.id) })
  }

  if (path === '/v1/operator/group-grants') {
    requireOperator(ctx)
    if (method === 'GET') {
      const rows = groupGrants.map(g => ({
        ...g,
        tenantGroup: tenantGroups.find(x => x.id === g.tenantGroupId) ?? null,
        user: userBrief(g.userId),
        grantedByUser: userBrief(g.grantedBy),
        propertyCount: tenants.filter(t => t.tenantGroupId === g.tenantGroupId && t.isActive).length,
      })).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
      return listRes(rows)
    }
    if (method === 'POST') {
      const tenantGroupId = pid(body.tenantGroupId)
      if (!tenantGroups.some(g => g.id === tenantGroupId)) throw badRequest('Pick a group')
      const userId = pid(body.userId)
      const user = staffUsers.find(u => u.id === userId && u.isActive)
      if (!user) throw badRequest('Pick a user')
      if (groupGrants.some(g => g.tenantGroupId === tenantGroupId && g.userId === userId && !g.revokedAt)) {
        throw conflict('ALREADY_GRANTED', 'That user already holds a live grant on this group')
      }
      const created: GroupGrant = {
        id: nextId(groupGrants),
        tenantGroupId,
        userId,
        grantedBy: ctx.userId!,
        grantedAt: now,
        revokedAt: null,
        revokedBy: null,
      }
      groupGrants.push(created)
      // Group grants are read+write across a whole group, so every grant and
      // revocation is audited — non-negotiable per the architecture doc.
      audit(ctx, 'group_grant.granted', `group:${tenantGroupId} user:${userId}`, displayNameOf(user), now)
      return singleRes(created)
    }
  }

  if (method === 'POST' && path === '/v1/operator/group-grants/revoke') {
    requireOperator(ctx)
    const grant = groupGrants.find(g => g.id === pid(body.grantId) && !g.revokedAt)
    if (!grant) throw notFound('Live grant')
    grant.revokedAt = now
    grant.revokedBy = ctx.userId
    audit(ctx, 'group_grant.revoked', `group:${grant.tenantGroupId} user:${grant.userId}`, null, now)
    return singleRes(grant)
  }

  if (method === 'GET' && path === '/v1/operator/status-events') {
    requireOperator(ctx)
    const rows = [...statusEvents]
      .sort((a, b) => b.createDate.localeCompare(a.createDate))
      .map(e => ({
        ...e,
        partner: partnerBrief(e.partnerId),
        task: (() => {
          const t = tasks.find(x => x.id === e.taskId)
          return t ? { id: t.id, title: t.title, tenantId: t.tenantId } : null
        })(),
      }))
    const { page, meta } = paginate(rows, query)
    return listRes(page, meta)
  }

  if (method === 'GET' && path === '/v1/operator/users') {
    requireOperator(ctx)
    const rows = staffUsers.map(u => ({
      ...u,
      displayName: displayNameOf(u),
      tenantCount: staffProfiles.filter(p => p.userId === u.id && p.isActive).length,
      grantCount: groupGrants.filter(g => g.userId === u.id && !g.revokedAt).length,
    })).sort((a, b) => a.displayName.localeCompare(b.displayName))
    return listRes(rows)
  }

  // ════════════════════════ Audit trail ════════════════════════

  if (method === 'GET' && path === '/v1/audit-events') {
    requireSession(ctx)
    let rows = [...auditEvents]
    // A tenant admin sees their own property's trail; operators see everything,
    // including the platform-level rows that carry no tenant.
    if (!ctx.isOperator) {
      const tenantId = requireTenantId(ctx)
      requireRole(ctx, 'admin')
      rows = rows.filter(e => e.tenantId === tenantId)
    }
    const action = String(query.action ?? '')
    if (action) rows = rows.filter(e => e.action.includes(action))
    rows.sort((a, b) => b.createDate.localeCompare(a.createDate))
    const { page, meta } = paginate(rows, query)
    return listRes(
      page.map(e => ({
        ...e,
        actor: userBrief(e.actorUserId),
        tenant: e.tenantId ? tenants.find(t => t.id === e.tenantId) ?? null : null,
      })),
      meta,
    )
  }

  throw new ApiError('NOT_IMPLEMENTED', `No mock handler for ${method} ${path}`, 501)
}

// ── test / diagnostic surface ─────────────────────────────────────────────────

/**
 * Drop every live session. Called on logout so a shared shift device keeps no
 * server-side session behind, and used by tests to reset between cases.
 */
export function resetSessions() {
  sessions.clear()
}

/** How many sessions are live. Diagnostics only. */
export function activeSessionCount() {
  return sessions.size
}

/** The demo logins offered on the sign-in screen. */
export function demoLogins() {
  return Object.entries(DEMO_PASSWORDS).map(([username, v]) => {
    const user = staffUsers.find(u => u.id === v.userId)
    const profile = staffProfiles.find(p => p.userId === v.userId && p.isActive)
    return {
      username,
      password: v.password,
      displayName: user ? displayNameOf(user) : username,
      role: user?.isOperator ? 'operator' : profile?.role ?? 'staff',
    }
  })
}
