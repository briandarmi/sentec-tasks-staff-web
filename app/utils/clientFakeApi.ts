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
export interface Partner {
  id: Id
  name: string
  /** Free-form label for what the partner is, e.g. "Guest services". */
  kind: string
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
  /** Minutes from activation until the task must be picked up. */
  responseTime: number
  /** Minutes after response until the task must be finished. */
  resolutionTime: number
  isDefault: boolean
  createDate: string
  updateDate: string
}

/** Native catalog — Tasks owns this, so it works with no partner connected. */
export interface CatalogCategory {
  id: Id
  name: string
  icon: string
  createDate: string
}

export interface CatalogItem {
  id: Id
  tenantId: Id
  categoryId: Id
  name: string
  /** Whether the item takes a quantity (e.g. "2 extra towels"). */
  quantityEnabled: boolean
  isActive: boolean
  createDate: string
  updateDate: string
}

/**
 * Routing rule: decides which department a task lands in, and which SLA gets
 * stamped on it. Matched most-specific-first by `priority` (lower runs first).
 * A rule matches on catalog item, or whole category, or the dispatching partner.
 */
export interface RoutingRule {
  id: Id
  tenantId: Id
  priority: number
  matchItemId: Id | null
  matchCategoryId: Id | null
  matchPartnerId: Id | null
  departmentId: Id
  slaId: Id
  remark: string | null
  isActive: boolean
  createDate: string
  updateDate: string
}

export type TaskStatus = 'NEW' | 'IN_PROGRESS' | 'PENDING' | 'FINISHED' | 'VERIFIED' | 'CANCELLED'
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
  quantity: number | null
  /** Free-text requester label from the partner (e.g. a guest name). */
  requestedFor: string | null
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

export interface TaskAssignment {
  id: Id
  taskId: Id
  userId: Id
  assignedBy: Id | null
  remark: string | null
  isActive: boolean
  createDate: string
  updateDate: string
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
 * Attachment. The API accepts an already-hosted URL only — there is no
 * multipart, presigned or base64 path yet, so the UI must not pretend to
 * upload. Blocked on a storage decision (local disk vs S3 vs presigned).
 */
export interface TaskAttachment {
  id: Id
  taskId: Id
  userId: Id | null
  filetype: 'PHOTO' | 'PDF' | 'OTHER'
  filename: string
  url: string
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

const partners: Partner[] = [
  { id: '1', name: 'Sentec Butler', kind: 'Guest services', isActive: true, createDate: SEED, lastDispatchAt: '2026-08-25T02:41:00.000Z' },
  { id: '2', name: 'Sentec PMS', kind: 'Property management', isActive: true, createDate: SEED, lastDispatchAt: '2026-08-24T22:10:00.000Z' },
  { id: '3', name: 'Sentec EMS', kind: 'Employee management', isActive: false, createDate: SEED, lastDispatchAt: null },
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
  { id: '1', name: 'Housekeeping', icon: '🧹', createDate: SEED },
  { id: '2', name: 'Maintenance', icon: '🔧', createDate: SEED },
  { id: '3', name: 'Concierge', icon: '🛎️', createDate: SEED },
  { id: '4', name: 'Food & Beverage', icon: '🍽️', createDate: SEED },
]

const catalogItems: CatalogItem[] = [
  { id: '1', tenantId: '1', categoryId: '1', name: 'Extra towels', quantityEnabled: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', categoryId: '1', name: 'Room cleaning', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', categoryId: '1', name: 'Turndown service', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '4', tenantId: '1', categoryId: '2', name: 'Air conditioner not cooling', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '5', tenantId: '1', categoryId: '2', name: 'Light bulb replacement', quantityEnabled: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', tenantId: '1', categoryId: '2', name: 'Plumbing / leak', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '7', tenantId: '1', categoryId: '3', name: 'Airport transfer', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '8', tenantId: '1', categoryId: '3', name: 'Late checkout request', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '9', tenantId: '1', categoryId: '4', name: 'In-room dining', quantityEnabled: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '10', tenantId: '1', categoryId: '4', name: 'Minibar restock', quantityEnabled: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '11', tenantId: '2', categoryId: '1', name: 'Extra towels', quantityEnabled: true, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '12', tenantId: '2', categoryId: '2', name: 'Air conditioner not cooling', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '13', tenantId: '3', categoryId: '1', name: 'Room cleaning', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '14', tenantId: '3', categoryId: '3', name: 'Luggage assistance', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '15', tenantId: '4', categoryId: '1', name: 'Room cleaning', quantityEnabled: false, isActive: true, createDate: SEED, updateDate: SEED },
]

const routingRules: RoutingRule[] = [
  // Most specific first: single item, then category, then partner-wide fallback.
  { id: '1', tenantId: '1', priority: 10, matchItemId: '4', matchCategoryId: null, matchPartnerId: null, departmentId: '2', slaId: '2', remark: 'AC faults are urgent', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '2', tenantId: '1', priority: 20, matchItemId: null, matchCategoryId: '1', matchPartnerId: null, departmentId: '1', slaId: '1', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '3', tenantId: '1', priority: 20, matchItemId: null, matchCategoryId: '2', matchPartnerId: null, departmentId: '2', slaId: '1', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '4', tenantId: '1', priority: 20, matchItemId: null, matchCategoryId: '3', matchPartnerId: null, departmentId: '3', slaId: '1', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '5', tenantId: '1', priority: 20, matchItemId: null, matchCategoryId: '4', matchPartnerId: null, departmentId: '4', slaId: '1', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', tenantId: '1', priority: 90, matchItemId: null, matchCategoryId: null, matchPartnerId: '2', departmentId: '2', slaId: '3', remark: 'PMS housekeeping sweeps', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '7', tenantId: '2', priority: 20, matchItemId: null, matchCategoryId: '1', matchPartnerId: null, departmentId: '5', slaId: '4', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '8', tenantId: '2', priority: 20, matchItemId: null, matchCategoryId: '2', matchPartnerId: null, departmentId: '6', slaId: '4', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '9', tenantId: '3', priority: 20, matchItemId: null, matchCategoryId: '1', matchPartnerId: null, departmentId: '7', slaId: '5', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
  { id: '10', tenantId: '3', priority: 20, matchItemId: null, matchCategoryId: '3', matchPartnerId: null, departmentId: '8', slaId: '5', remark: null, isActive: true, createDate: SEED, updateDate: SEED },
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
  { id: '4', boardId: '1', name: 'Finished', description: 'Work done, awaiting verification', columnSort: 4, status: 'FINISHED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '5', boardId: '1', name: 'Verified', description: 'Checked and closed', columnSort: 5, status: 'VERIFIED', isActive: true, createDate: SEED, updateDate: SEED },
  { id: '6', boardId: '1', name: 'Cancelled', description: 'No longer required', columnSort: 6, status: 'CANCELLED', isActive: true, createDate: SEED, updateDate: SEED },
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

const tasks: Task[] = [
  // Unclaimed, fresh, from Butler → Housekeeping. The staff "to claim" queue.
  { id: '1', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88412', itemId: '1', status: 'NEW', departmentId: '1', columnId: '1', slaId: '1', title: 'Extra towels', description: 'Two bath towels please', location: '1204', quantity: 2, requestedFor: 'Amelia Chen', activationDate: '2026-08-25T02:52:00.000Z', responseDueAt: '2026-08-25T03:07:00.000Z', resolutionDueAt: '2026-08-25T03:52:00.000Z', responseDuration: null, resolutionDuration: null, responseSlaStatus: 'EMPTY', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T02:52:00.000Z', updateDate: '2026-08-25T02:52:00.000Z' },
  // Unclaimed and already past its response target → breached, needs attention.
  { id: '2', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88399', itemId: '4', status: 'NEW', departmentId: '2', columnId: '1', slaId: '2', title: 'Air conditioner not cooling', description: 'Guest reports room is very warm', location: '0908', quantity: null, requestedFor: 'Marcus Reid', activationDate: '2026-08-25T02:15:00.000Z', responseDueAt: '2026-08-25T02:20:00.000Z', resolutionDueAt: '2026-08-25T02:40:00.000Z', responseDuration: null, resolutionDuration: null, responseSlaStatus: 'BREACHED', resolutionSlaStatus: 'BREACHED', createDate: '2026-08-25T02:15:00.000Z', updateDate: '2026-08-25T02:15:00.000Z' },
  // Claimed by Budi (10) and in progress — his "my work" list.
  { id: '3', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88350', itemId: '2', status: 'IN_PROGRESS', departmentId: '1', columnId: '2', slaId: '1', title: 'Room cleaning', description: 'Full clean after checkout', location: '1102', quantity: null, requestedFor: 'Priya Nair', activationDate: '2026-08-25T02:30:00.000Z', responseDueAt: '2026-08-25T02:45:00.000Z', resolutionDueAt: '2026-08-25T03:30:00.000Z', responseDuration: 6, resolutionDuration: null, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T02:30:00.000Z', updateDate: '2026-08-25T02:36:00.000Z' },
  // Assigned to Budi by his leader — proves assignment ≠ claim.
  { id: '4', tenantId: '1', partnerId: null, externalRef: null, itemId: '3', status: 'NEW', departmentId: '1', columnId: '1', slaId: '3', title: 'Turndown service — floor 12', description: 'Evening turndown, rooms 1201-1210', location: 'Floor 12', quantity: null, requestedFor: null, activationDate: '2026-08-25T01:00:00.000Z', responseDueAt: '2026-08-25T03:00:00.000Z', resolutionDueAt: '2026-08-25T11:00:00.000Z', responseDuration: null, resolutionDuration: null, responseSlaStatus: 'EMPTY', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T01:00:00.000Z', updateDate: '2026-08-25T01:05:00.000Z' },
  // Held by another housekeeper — this is the task a leader must NOT be able to
  // steal via Claim (finding 1). Claim on this returns 409.
  { id: '5', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88301', itemId: '10', status: 'IN_PROGRESS', departmentId: '4', columnId: '2', slaId: '1', title: 'Minibar restock', description: 'Restock water and soft drinks', location: '0710', quantity: 4, requestedFor: 'Diego Santos', activationDate: '2026-08-25T02:00:00.000Z', responseDueAt: '2026-08-25T02:15:00.000Z', resolutionDueAt: '2026-08-25T03:00:00.000Z', responseDuration: 9, resolutionDuration: null, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T02:00:00.000Z', updateDate: '2026-08-25T02:09:00.000Z' },
  // On hold, waiting on the guest.
  { id: '6', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88288', itemId: '7', status: 'PENDING', departmentId: '3', columnId: '3', slaId: '1', title: 'Airport transfer', description: 'Guest to confirm flight time', location: 'Lobby', quantity: null, requestedFor: 'Sofia Rossi', activationDate: '2026-08-25T00:30:00.000Z', responseDueAt: '2026-08-25T00:45:00.000Z', resolutionDueAt: '2026-08-25T01:30:00.000Z', responseDuration: 11, resolutionDuration: null, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED', createDate: '2026-08-25T00:30:00.000Z', updateDate: '2026-08-25T00:41:00.000Z' },
  // Finished by Budi, awaiting verification — his "done" tab.
  { id: '7', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88201', itemId: '1', status: 'FINISHED', departmentId: '1', columnId: '4', slaId: '1', title: 'Extra towels', description: null, location: '1015', quantity: 1, requestedFor: 'John Doe', activationDate: '2026-08-24T23:00:00.000Z', responseDueAt: '2026-08-24T23:15:00.000Z', resolutionDueAt: '2026-08-25T00:00:00.000Z', responseDuration: 4, resolutionDuration: 22, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME', createDate: '2026-08-24T23:00:00.000Z', updateDate: '2026-08-24T23:26:00.000Z' },
  // Verified and closed.
  { id: '8', tenantId: '1', partnerId: '2', externalRef: 'PMS-5512', itemId: '6', status: 'VERIFIED', departmentId: '2', columnId: '5', slaId: '3', title: 'Plumbing / leak', description: 'Slow drain reported by PMS housekeeping sweep', location: '0402', quantity: null, requestedFor: null, activationDate: '2026-08-24T18:00:00.000Z', responseDueAt: '2026-08-24T20:00:00.000Z', resolutionDueAt: '2026-08-25T02:00:00.000Z', responseDuration: 38, resolutionDuration: 96, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'ON_TIME', createDate: '2026-08-24T18:00:00.000Z', updateDate: '2026-08-24T21:14:00.000Z' },
  // Cancelled.
  { id: '9', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88150', itemId: '8', status: 'CANCELLED', departmentId: '3', columnId: '6', slaId: '1', title: 'Late checkout request', description: 'Guest checked out on time after all', location: '0611', quantity: null, requestedFor: 'Sofia Rossi', activationDate: '2026-08-24T20:00:00.000Z', responseDueAt: '2026-08-24T20:15:00.000Z', resolutionDueAt: '2026-08-24T21:00:00.000Z', responseDuration: 7, resolutionDuration: null, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-24T20:00:00.000Z', updateDate: '2026-08-24T20:22:00.000Z' },
  // Maintenance queue, unclaimed — Agus (12) is the maintenance staff.
  { id: '10', tenantId: '1', partnerId: null, externalRef: null, itemId: '5', status: 'NEW', departmentId: '2', columnId: '1', slaId: '1', title: 'Light bulb replacement', description: 'Corridor lights out on floor 7', location: 'Floor 7', quantity: 3, requestedFor: null, activationDate: '2026-08-25T02:45:00.000Z', responseDueAt: '2026-08-25T03:00:00.000Z', resolutionDueAt: '2026-08-25T03:45:00.000Z', responseDuration: null, resolutionDuration: null, responseSlaStatus: 'EMPTY', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T02:45:00.000Z', updateDate: '2026-08-25T02:45:00.000Z' },
  // In-room dining, F&B.
  { id: '11', tenantId: '1', partnerId: '1', externalRef: 'BTLR-88420', itemId: '9', status: 'NEW', departmentId: '4', columnId: '1', slaId: '1', title: 'In-room dining', description: '2x nasi goreng, 1x jus jeruk', location: '1204', quantity: 3, requestedFor: 'Amelia Chen', activationDate: '2026-08-25T02:58:00.000Z', responseDueAt: '2026-08-25T03:13:00.000Z', resolutionDueAt: '2026-08-25T03:58:00.000Z', responseDuration: null, resolutionDuration: null, responseSlaStatus: 'EMPTY', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T02:58:00.000Z', updateDate: '2026-08-25T02:58:00.000Z' },
  // Tenant 2 — so switching tenants visibly changes the data.
  { id: '12', tenantId: '2', partnerId: '1', externalRef: 'BTLR-91002', itemId: '11', status: 'NEW', departmentId: '5', columnId: '7', slaId: '4', title: 'Extra towels', description: null, location: '0304', quantity: 2, requestedFor: 'Guest 304', activationDate: '2026-08-25T02:40:00.000Z', responseDueAt: '2026-08-25T03:00:00.000Z', resolutionDueAt: '2026-08-25T04:00:00.000Z', responseDuration: null, resolutionDuration: null, responseSlaStatus: 'EMPTY', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T02:40:00.000Z', updateDate: '2026-08-25T02:40:00.000Z' },
  { id: '13', tenantId: '2', partnerId: null, externalRef: null, itemId: '12', status: 'IN_PROGRESS', departmentId: '6', columnId: '8', slaId: '4', title: 'Air conditioner not cooling', description: 'Unit 512 compressor check', location: '0512', quantity: null, requestedFor: null, activationDate: '2026-08-25T01:30:00.000Z', responseDueAt: '2026-08-25T01:50:00.000Z', resolutionDueAt: '2026-08-25T02:50:00.000Z', responseDuration: 12, resolutionDuration: null, responseSlaStatus: 'ON_TIME', resolutionSlaStatus: 'BREACHED', createDate: '2026-08-25T01:30:00.000Z', updateDate: '2026-08-25T01:42:00.000Z' },
  // Tenant 3 — Favehotels.
  { id: '14', tenantId: '3', partnerId: '1', externalRef: 'BTLR-77010', itemId: '13', status: 'NEW', departmentId: '7', columnId: '12', slaId: '5', title: 'Room cleaning', description: null, location: '0210', quantity: null, requestedFor: 'Guest 210', activationDate: '2026-08-25T02:20:00.000Z', responseDueAt: '2026-08-25T02:50:00.000Z', resolutionDueAt: '2026-08-25T04:20:00.000Z', responseDuration: null, resolutionDuration: null, responseSlaStatus: 'BREACHED', resolutionSlaStatus: 'EMPTY', createDate: '2026-08-25T02:20:00.000Z', updateDate: '2026-08-25T02:20:00.000Z' },
]

const taskAssignments: TaskAssignment[] = [
  { id: '1', taskId: '3', userId: '10', assignedBy: '10', remark: 'Claimed', isActive: true, createDate: '2026-08-25T02:36:00.000Z', updateDate: '2026-08-25T02:36:00.000Z' },
  { id: '2', taskId: '4', userId: '10', assignedBy: '11', remark: 'Please cover floor 12 tonight', isActive: true, createDate: '2026-08-25T01:05:00.000Z', updateDate: '2026-08-25T01:05:00.000Z' },
  { id: '3', taskId: '5', userId: '15', assignedBy: '15', remark: 'Claimed', isActive: true, createDate: '2026-08-25T02:09:00.000Z', updateDate: '2026-08-25T02:09:00.000Z' },
  { id: '4', taskId: '6', userId: '14', assignedBy: '14', remark: 'Claimed', isActive: true, createDate: '2026-08-25T00:41:00.000Z', updateDate: '2026-08-25T00:41:00.000Z' },
  { id: '5', taskId: '7', userId: '10', assignedBy: '10', remark: 'Claimed', isActive: true, createDate: '2026-08-24T23:04:00.000Z', updateDate: '2026-08-24T23:04:00.000Z' },
  { id: '6', taskId: '8', userId: '12', assignedBy: '13', remark: null, isActive: true, createDate: '2026-08-24T18:38:00.000Z', updateDate: '2026-08-24T18:38:00.000Z' },
  { id: '7', taskId: '9', userId: '14', assignedBy: '14', remark: 'Claimed', isActive: true, createDate: '2026-08-24T20:07:00.000Z', updateDate: '2026-08-24T20:07:00.000Z' },
  { id: '8', taskId: '13', userId: '10', assignedBy: '10', remark: 'Claimed', isActive: true, createDate: '2026-08-25T01:42:00.000Z', updateDate: '2026-08-25T01:42:00.000Z' },
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
]

const taskComments: TaskComment[] = [
  { id: '1', taskId: '3', userId: '10', comment: 'Guest still in the room, will come back in 10 minutes.', createDate: '2026-08-25T02:40:00.000Z' },
  { id: '2', taskId: '3', userId: '11', comment: 'Noted — swap with 1108 if it drags on.', createDate: '2026-08-25T02:44:00.000Z' },
  { id: '3', taskId: '6', userId: '14', comment: 'Left a message with the guest, no answer yet.', createDate: '2026-08-25T01:10:00.000Z' },
  { id: '4', taskId: '8', userId: '12', comment: 'Needed a new trap seal, took one from stores.', createDate: '2026-08-24T19:50:00.000Z' },
]

const taskAttachments: TaskAttachment[] = [
  { id: '1', taskId: '8', userId: '12', filetype: 'PHOTO', filename: 'leak-before.jpg', url: 'https://storage.example.com/tasks/leak-before.jpg', isRemoved: false, createDate: '2026-08-24T18:45:00.000Z' },
  { id: '2', taskId: '8', userId: '12', filetype: 'PHOTO', filename: 'leak-after.jpg', url: 'https://storage.example.com/tasks/leak-after.jpg', isRemoved: false, createDate: '2026-08-24T20:12:00.000Z' },
  { id: '3', taskId: '8', userId: '13', filetype: 'PDF', filename: 'maintenance-checklist.pdf', url: 'https://storage.example.com/tasks/maintenance-checklist.pdf', isRemoved: false, createDate: '2026-08-24T21:10:00.000Z' },
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

function assignmentBrief(taskId: Id) {
  const a = activeAssignment(taskId)
  return a
    ? { id: a.id, userId: a.userId, assignedBy: a.assignedBy, remark: a.remark, user: userBrief(a.userId), assignedByUser: userBrief(a.assignedBy) }
    : null
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
  return p ? { id: p.id, name: p.name, kind: p.kind } : null
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
    attachments: taskAttachments
      .filter(a => a.taskId === t.id && !a.isRemoved)
      .sort((a, b) => a.createDate.localeCompare(b.createDate))
      .map(a => ({ ...a, user: userBrief(a.userId) })),
  }
}

function boardForTenant(tenantId: Id) {
  const board = boards.find(b => b.tenantId === tenantId)
  if (!board) return null
  return {
    ...board,
    columns: boardColumns
      .filter(c => c.boardId === board.id && c.isActive)
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
 * Rules run by ascending `priority`; the first match wins. Falls back to the
 * tenant's default SLA with no department, which surfaces the task to everyone
 * rather than silently dropping it.
 */
function resolveRouting(tenantId: Id, itemId: Id | null, partnerId: Id | null) {
  const item = itemId ? catalogItems.find(i => i.id === itemId) ?? null : null
  const candidates = routingRules
    .filter(r => r.tenantId === tenantId && r.isActive)
    .sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id))

  for (const rule of candidates) {
    if (rule.matchItemId && rule.matchItemId === itemId) return rule
    if (rule.matchCategoryId && item && rule.matchCategoryId === item.categoryId) return rule
    if (rule.matchPartnerId && rule.matchPartnerId === partnerId) return rule
  }
  return null
}

function defaultSlaId(tenantId: Id): Id | null {
  return slas.find(s => s.tenantId === tenantId && s.isDefault)?.id ?? null
}

/** Stamp response/resolution targets from the SLA, per the dispatch flow. */
function stampSla(task: Task, slaId: Id | null, activationIso: string) {
  const sla = slaId ? slas.find(s => s.id === slaId) : undefined
  task.slaId = slaId
  task.activationDate = activationIso
  if (!sla) {
    task.responseDueAt = null
    task.resolutionDueAt = null
    return
  }
  task.responseDueAt = minutesFrom(activationIso, sla.responseTime)
  task.resolutionDueAt = minutesFrom(activationIso, sla.responseTime + sla.resolutionTime)
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

    // `mine` / `unclaimed` are the two segments the staff list toggles between.
    const scope = String(query.scope ?? '')
    if (scope === 'mine') rows = rows.filter(t => activeAssignment(t.id)?.userId === ctx.userId)
    if (scope === 'unclaimed') rows = rows.filter(t => !activeAssignment(t.id))
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

  if (method === 'POST' && path === '/v1/tasks') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    if (!ctx.canCreateTask) throw forbidden('Your role at this property cannot raise tasks')

    const title = String(body.title ?? '').trim()
    if (!title) throw badRequest('A title is required')

    const itemId = pid(body.itemId) || null
    const item = itemId ? catalogItems.find(i => i.id === itemId && i.tenantId === tenantId && i.isActive) : null
    if (itemId && !item) throw notFound('Catalog item')

    const rule = resolveRouting(tenantId, itemId, null)
    const slaId = rule?.slaId ?? defaultSlaId(tenantId)
    const board = boardForTenant(tenantId)
    const newColumn = board?.columns.find(c => c.status === 'NEW') ?? null

    const created: Task = {
      id: nextId(tasks),
      tenantId,
      partnerId: null,
      externalRef: null,
      itemId,
      status: 'NEW',
      departmentId: rule?.departmentId ?? ctx.departmentId,
      columnId: newColumn?.id ?? null,
      slaId: null,
      title,
      description: (body.description as string | null)?.toString().trim() || null,
      location: (body.location as string | null)?.toString().trim() || null,
      quantity: item?.quantityEnabled ? Math.max(1, Number(body.quantity) || 1) : null,
      requestedFor: (body.requestedFor as string | null)?.toString().trim() || null,
      activationDate: now,
      responseDueAt: null,
      resolutionDueAt: null,
      responseDuration: null,
      resolutionDuration: null,
      responseSlaStatus: 'EMPTY',
      resolutionSlaStatus: 'EMPTY',
      createDate: now,
      updateDate: now,
    }
    stampSla(created, slaId, now)
    tasks.push(created)
    taskHistory.push({ id: nextId(taskHistory), taskId: created.id, userId: ctx.userId, status: 'NEW', description: null, createDate: now })
    return singleRes(taskDetail(created))
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
  if (method === 'POST' && path === '/v1/tasks/claim') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (!canReadTask(ctx, task)) throw forbidden('This task belongs to another department')

    const existing = activeAssignment(task.id)
    if (existing) {
      if (existing.userId === ctx.userId) return singleRes(taskDetail(task))
      const holder = userBrief(existing.userId)
      const who = holder ? `${holder.firstName} ${holder.lastName}`.trim() : 'someone else'
      throw conflict('ALREADY_ASSIGNED', `Already being handled by ${who}. Use Assign to hand it over.`)
    }

    taskAssignments.push({
      id: nextId(taskAssignments),
      taskId: task.id,
      userId: ctx.userId!,
      assignedBy: ctx.userId,
      remark: 'Claimed',
      isActive: true,
      createDate: now,
      updateDate: now,
    })
    task.updateDate = now
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

    taskAssignments.push({
      id: nextId(taskAssignments),
      taskId: task.id,
      userId,
      assignedBy: ctx.userId,
      remark: (body.remark as string | null)?.toString().trim() || null,
      isActive: true,
      createDate: now,
      updateDate: now,
    })
    task.updateDate = now
    return singleRes(taskDetail(task))
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

    // Staff may only move work they hold; managers may move anything.
    const assignment = activeAssignment(task.id)
    if (!isManager(ctx) && assignment && assignment.userId !== ctx.userId) {
      throw forbidden('Only the person handling this task can move it')
    }

    const previous = task.status
    task.columnId = column.id
    task.status = column.status
    task.updateDate = now

    // First move off NEW is the "response"; reaching FINISHED is the resolution.
    const activationMs = Date.parse(task.activationDate)
    if (previous === 'NEW' && column.status !== 'NEW' && task.responseDuration === null) {
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
   * Attach by URL. The API takes an already-hosted URL only — there is no
   * multipart, presigned or base64 path yet, so there is nothing to upload to.
   * The UI says so plainly rather than faking a file picker.
   */
  if (method === 'POST' && path === '/v1/tasks/attachments') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const task = tasks.find(t => t.id === pid(body.taskId) && t.tenantId === tenantId)
    if (!task) throw notFound('Task')
    if (!canReadTask(ctx, task)) throw forbidden('This task belongs to another department')

    const url = String(body.url ?? '').trim()
    if (!url) throw badRequest('A file URL is required')
    if (!/^https?:\/\//i.test(url)) throw badRequest('Enter a full http(s) URL to an already-hosted file')

    const filename = url.split('/').pop() || 'attachment'
    const lower = filename.toLowerCase()
    const filetype: TaskAttachment['filetype'] = /\.(png|jpe?g|gif|webp|heic)$/.test(lower)
      ? 'PHOTO'
      : lower.endsWith('.pdf') ? 'PDF' : 'OTHER'

    const created: TaskAttachment = {
      id: nextId(taskAttachments),
      taskId: task.id,
      userId: ctx.userId,
      filetype,
      filename,
      url,
      isRemoved: false,
      createDate: now,
    }
    taskAttachments.push(created)
    task.updateDate = now
    return singleRes({ ...created, user: userBrief(created.userId) })
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
    const allowed: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED']
    if (!allowed.includes(status)) throw badRequest('Pick the status this column sets')

    if (id) {
      const column = boardColumns.find(c => c.id === id && c.boardId === board.id)
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

  // ════════════════════════ Catalog (native) ════════════════════════

  if (method === 'GET' && path === '/v1/catalog/categories') {
    requireSession(ctx)
    return listRes([...catalogCategories].sort((a, b) => a.name.localeCompare(b.name)))
  }

  if (method === 'GET' && path === '/v1/catalog/items') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'staff', 'leader', 'admin')
    const rows = catalogItems
      .filter(i => i.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name))
    return listRes(rows)
  }

  if (method === 'POST' && path === '/v1/catalog/items/upsert') {
    const tenantId = requireTenantId(ctx)
    requireRole(ctx, 'admin')
    const name = String(body.name ?? '').trim()
    if (!name) throw badRequest('An item name is required')
    const categoryId = pid(body.categoryId)
    if (!catalogCategories.some(c => c.id === categoryId)) throw badRequest('Pick a category')

    const id = pid(body.id)
    if (id) {
      const item = catalogItems.find(i => i.id === id && i.tenantId === tenantId)
      if (!item) throw notFound('Catalog item')
      item.name = name
      item.categoryId = categoryId
      item.quantityEnabled = Boolean(body.quantityEnabled)
      item.isActive = body.isActive === undefined ? item.isActive : Boolean(body.isActive)
      item.updateDate = now
      return singleRes(item)
    }

    const created: CatalogItem = {
      id: nextId(catalogItems),
      tenantId,
      categoryId,
      name,
      quantityEnabled: Boolean(body.quantityEnabled),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createDate: now,
      updateDate: now,
    }
    catalogItems.push(created)
    return singleRes(created)
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
    const responseTime = Number(body.responseTime)
    const resolutionTime = Number(body.resolutionTime)
    if (!Number.isFinite(responseTime) || responseTime < 1) throw badRequest('Response target must be at least 1 minute')
    if (!Number.isFinite(resolutionTime) || resolutionTime < 1) throw badRequest('Resolution target must be at least 1 minute')
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
      .sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id))
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

    const matchItemId = pid(body.matchItemId) || null
    const matchCategoryId = pid(body.matchCategoryId) || null
    const matchPartnerId = pid(body.matchPartnerId) || null
    if (!matchItemId && !matchCategoryId && !matchPartnerId) {
      throw badRequest('A rule needs something to match on: an item, a category, or a partner')
    }

    const priority = Number(body.priority)
    const id = pid(body.id)
    if (id) {
      const rule = routingRules.find(r => r.id === id && r.tenantId === tenantId)
      if (!rule) throw notFound('Routing rule')
      rule.priority = Number.isFinite(priority) ? priority : rule.priority
      rule.matchItemId = matchItemId
      rule.matchCategoryId = matchCategoryId
      rule.matchPartnerId = matchPartnerId
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
      priority: Number.isFinite(priority) ? priority : 50,
      matchItemId,
      matchCategoryId,
      matchPartnerId,
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
            && ['NEW', 'IN_PROGRESS', 'PENDING'].includes(t.status),
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
    const open = scoped.filter(t => ['NEW', 'IN_PROGRESS', 'PENDING'].includes(t.status))
    return singleRes({
      tenantId,
      total: scoped.length,
      open: open.length,
      unclaimed: open.filter(t => !activeAssignment(t.id)).length,
      breached: scoped.filter(t => t.responseSlaStatus === 'BREACHED' || t.resolutionSlaStatus === 'BREACHED').length,
      finishedToday: scoped.filter(t => ['FINISHED', 'VERIFIED'].includes(t.status)).length,
      byStatus: (['NEW', 'IN_PROGRESS', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED'] as TaskStatus[])
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
      const open = scoped.filter(t => ['NEW', 'IN_PROGRESS', 'PENDING'].includes(t.status))
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
        openTaskCount: tasks.filter(x => x.tenantId === t.id && ['NEW', 'IN_PROGRESS', 'PENDING'].includes(x.status)).length,
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
      const created: Partner = {
        id: nextId(partners),
        name,
        kind: String(body.kind ?? '').trim() || 'Integration',
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
