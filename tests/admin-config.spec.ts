import { describe, expect, it } from 'vitest'
import { ApiError, handleFakeApiRequest as call } from '~/utils/clientFakeApi'

// Behavioural contract for the configuration surface ported from the
// sentec-tasks-admin repo (github.com/SentinelTech-com/sentec-tasks-admin).
// Each suite pins one of that repo's findings against this mock, so the local
// console can't quietly regress a rule the real console already learned the
// hard way: the full-replace duration wipe, closed weekdays saved as open,
// double-added team members, admin granted in the same breath as creation.

type Session = { sessionId: string, csrfToken: string, user: any }

function login(username: string, password: string): Session {
  return call('/v1/auth/login', { method: 'POST', body: { username, password } }).data as Session
}

function h(session: Session, tenantId?: string) {
  return { 'x-session-id': session.sessionId, ...(tenantId ? { 'x-tenant-id': tenantId } : {}) }
}

function errCode(fn: () => unknown): string {
  try {
    fn()
    return 'NO_ERROR'
  }
  catch (e) {
    return e instanceof ApiError ? e.code : `UNEXPECTED:${String(e)}`
  }
}

describe('catalog categories are per property', () => {
  it('lists only the active property\'s categories', () => {
    const admin = login('admin', 'admin123')
    const rows = call('/v1/catalog/categories', { headers: h(admin, '1') }).data
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((c: any) => c.tenantId === '1')).toBe(true)
  })

  it('refuses an item pointing at another property\'s category', () => {
    const admin = login('admin', 'admin123')
    // Category 5 belongs to tenant 2.
    expect(errCode(() => call('/v1/catalog/items/upsert', {
      method: 'POST',
      body: { categoryId: '5', name: 'X', quantityEnabled: false, defaultPriority: 'NORMAL', requiresLocation: false, defaultChecklist: [], defaultDurationMinutes: null, minProofPhotos: 0, requiresCompletionNote: false },
      headers: h(admin, '1'),
    }))).toBe('BAD_REQUEST')
  })

  it('creates and edits a category, admin-only', () => {
    const admin = login('admin', 'admin123')
    const leader = login('leader', 'leader123')
    const created = call('/v1/catalog/categories/upsert', { method: 'POST', body: { name: 'Wellness', code: 'wel', sort: 6 }, headers: h(admin, '1') }).data
    expect(created.code).toBe('WEL')
    expect(created.tenantId).toBe('1')
    expect(errCode(() => call('/v1/catalog/categories/upsert', { method: 'POST', body: { name: 'Nope', code: 'NO', sort: 1 }, headers: h(leader, '1') })))
      .toBe('FORBIDDEN')
  })
})

describe('catalog item upsert is a full replace', () => {
  const itemBody = (overrides: Record<string, unknown>) => ({
    id: '2',
    categoryId: '1',
    name: 'Room cleaning',
    quantityEnabled: false,
    defaultPriority: 'NORMAL',
    requiresLocation: true,
    defaultChecklist: ['Strip and remake the beds'],
    minProofPhotos: 2,
    requiresCompletionNote: true,
    ...overrides,
  })

  it('preserves defaultDurationMinutes only when the caller echoes it back', () => {
    const admin = login('admin', 'admin123')
    // Seeded at 45. Echoed back → kept.
    const kept = call('/v1/catalog/items/upsert', { method: 'POST', body: itemBody({ defaultDurationMinutes: 45 }), headers: h(admin, '1') }).data
    expect(kept.defaultDurationMinutes).toBe(45)
    // Omitted → cleared. This is the wipe the admin screen must round-trip
    // against; the screen carries the value with no control bound to it.
    const wiped = call('/v1/catalog/items/upsert', { method: 'POST', body: itemBody({}), headers: h(admin, '1') }).data
    expect(wiped.defaultDurationMinutes).toBeNull()
    // Restore the seed for anything reading it later in this file.
    call('/v1/catalog/items/upsert', { method: 'POST', body: itemBody({ defaultDurationMinutes: 45 }), headers: h(admin, '1') })
  })

  it('drops blank checklist steps rather than seeding empty ones', () => {
    const admin = login('admin', 'admin123')
    const saved = call('/v1/catalog/items/upsert', {
      method: 'POST',
      body: itemBody({ defaultDurationMinutes: 45, defaultChecklist: ['  Vacuum  ', '', '   ', 'Restock'] }),
      headers: h(admin, '1'),
    }).data
    expect(saved.defaultChecklist).toEqual(['Vacuum', 'Restock'])
  })

  it('enforces the proof-photo gate as a whole number between 0 and 10', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/catalog/items/upsert', { method: 'POST', body: itemBody({ defaultDurationMinutes: 45, minProofPhotos: 11 }), headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
    expect(errCode(() => call('/v1/catalog/items/upsert', { method: 'POST', body: itemBody({ defaultDurationMinutes: 45, minProofPhotos: 1.5 }), headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })

  it('lets an item keep its deactivated category, but not move onto one', () => {
    const admin = login('admin', 'admin123')
    // Category 10 (Seasonal) is deactivated. Moving item 2 onto it: refused.
    expect(errCode(() => call('/v1/catalog/items/upsert', { method: 'POST', body: itemBody({ defaultDurationMinutes: 45, categoryId: '10' }), headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
    // An item already on it keeps it: create while active is impossible here,
    // so simulate by deactivating after the fact and re-saving unchanged.
    const created = call('/v1/catalog/items/upsert', {
      method: 'POST',
      body: { categoryId: '4', name: 'Fruit basket', quantityEnabled: false, defaultPriority: 'LOW', requiresLocation: false, defaultChecklist: [], defaultDurationMinutes: null, minProofPhotos: 0, requiresCompletionNote: false },
      headers: h(admin, '1'),
    }).data
    call('/v1/catalog/categories/upsert', { method: 'POST', body: { id: '4', name: 'Food & Beverage', code: 'FNB', icon: '🍽️', sort: 4, isActive: false }, headers: h(admin, '1') })
    const resaved = call('/v1/catalog/items/upsert', {
      method: 'POST',
      body: { id: created.id, categoryId: '4', name: 'Fruit basket', quantityEnabled: false, defaultPriority: 'LOW', requiresLocation: false, defaultChecklist: [], defaultDurationMinutes: null, minProofPhotos: 0, requiresCompletionNote: false },
      headers: h(admin, '1'),
    }).data
    expect(resaved.categoryId).toBe('4')
    // Reactivate so later suites see the seed shape.
    call('/v1/catalog/categories/upsert', { method: 'POST', body: { id: '4', name: 'Food & Beverage', code: 'FNB', icon: '🍽️', sort: 4, isActive: true }, headers: h(admin, '1') })
  })
})

describe('locations', () => {
  it('scopes types and locations to the property', () => {
    const admin = login('admin', 'admin123')
    expect(call('/v1/location-types', { headers: h(admin, '1') }).data.every((t: any) => t.tenantId === '1')).toBe(true)
    expect(call('/v1/locations', { headers: h(admin, '1') }).data.every((l: any) => l.tenantId === '1')).toBe(true)
  })

  it('refuses a new location on a deactivated type, but lets an existing one stay', () => {
    const admin = login('admin', 'admin123')
    // Type 4 (Back Office) is deactivated.
    expect(errCode(() => call('/v1/locations/upsert', { method: 'POST', body: { locationTypeId: '4', name: 'Store Room', code: 'STR' }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
    // Location 6 already sits on type 4 — renaming it must not be blocked.
    const renamed = call('/v1/locations/upsert', { method: 'POST', body: { id: '6', locationTypeId: '4', name: 'Staff Canteen B1', code: 'CANT' }, headers: h(admin, '1') }).data
    expect(renamed.name).toBe('Staff Canteen B1')
    expect(renamed.locationTypeId).toBe('4')
  })

  it('requires name, code and a same-property type', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/locations/upsert', { method: 'POST', body: { locationTypeId: '1', name: '', code: 'X' }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
    expect(errCode(() => call('/v1/locations/upsert', { method: 'POST', body: { locationTypeId: '1', name: 'X', code: '' }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
    // Type 5 belongs to tenant 2.
    expect(errCode(() => call('/v1/locations/upsert', { method: 'POST', body: { locationTypeId: '5', name: 'X', code: 'X' }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
  })
})

describe('teams and membership', () => {
  it('lists teams with a member count', () => {
    const admin = login('admin', 'admin123')
    const rows = call('/v1/teams', { headers: h(admin, '1') }).data
    expect(rows.find((t: any) => t.id === '1')?.memberCount).toBe(2)
    expect(call('/v1/teams/1/members', { headers: h(admin, '1') }).data).toEqual(['10', '11'])
  })

  it('refuses adding someone twice — a double-clicked Add is one membership', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/teams/1/members/add', { method: 'POST', body: { userId: '10' }, headers: h(admin, '1') })))
      .toBe('ALREADY_MEMBER')
  })

  it('adds and removes a member, and 404s a second remove', () => {
    const admin = login('admin', 'admin123')
    call('/v1/teams/2/members/add', { method: 'POST', body: { userId: '10' }, headers: h(admin, '1') })
    expect(call('/v1/teams/2/members', { headers: h(admin, '1') }).data).toContain('10')
    call('/v1/teams/2/members/remove', { method: 'POST', body: { userId: '10' }, headers: h(admin, '1') })
    expect(errCode(() => call('/v1/teams/2/members/remove', { method: 'POST', body: { userId: '10' }, headers: h(admin, '1') })))
      .toBe('NOT_FOUND')
  })

  it('only admits people who work at the property', () => {
    const admin = login('admin', 'admin123')
    // User 30 works at tenant 3.
    expect(errCode(() => call('/v1/teams/1/members/add', { method: 'POST', body: { userId: '30' }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })
})

describe('operating schedules', () => {
  it('treats a weekday with no window as closed — absence is the flag', () => {
    const admin = login('admin', 'admin123')
    const schedules = call('/v1/operating-schedules', { headers: h(admin, '1') }).data
    const engineering = schedules.find((s: any) => s.name === 'Engineering Hours')
    // Sunday (0) has no window at all; there is no zero-width representation.
    expect(engineering.windows.some((w: any) => w.weekday === 0)).toBe(false)
    expect(engineering.windows).toHaveLength(6)
  })

  it('rejects a window that closes at or before it opens', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/operating-schedules/upsert', {
      method: 'POST',
      body: { name: 'Broken', windows: [{ weekday: 1, opensMinutes: 600, closesMinutes: 600 }], exceptions: [] },
      headers: h(admin, '1'),
    }))).toBe('BAD_REQUEST')
  })

  it('accepts 1440 as until-midnight', () => {
    const admin = login('admin', 'admin123')
    const created = call('/v1/operating-schedules/upsert', {
      method: 'POST',
      body: { name: 'Night Desk', departmentId: '3', windows: [{ weekday: 5, opensMinutes: 1080, closesMinutes: 1440 }], exceptions: [] },
      headers: h(admin, '1'),
    }).data
    expect(created.windows[0].closesMinutes).toBe(1440)
  })

  it('refuses a second default and a second schedule per department', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/operating-schedules/upsert', { method: 'POST', body: { name: 'Another default', isDefault: true, windows: [], exceptions: [] }, headers: h(admin, '1') })))
      .toBe('DUPLICATE_DEFAULT')
    // Department 2 already has Engineering Hours.
    expect(errCode(() => call('/v1/operating-schedules/upsert', { method: 'POST', body: { name: 'Second eng', departmentId: '2', windows: [], exceptions: [] }, headers: h(admin, '1') })))
      .toBe('DEPARTMENT_SCHEDULED')
  })

  it('replaces the full windows set on every save — a rename must echo hours back', () => {
    const admin = login('admin', 'admin123')
    const created = call('/v1/operating-schedules/upsert', {
      method: 'POST',
      body: { name: 'Spa Hours', departmentId: '4', windows: [{ weekday: 2, opensMinutes: 540, closesMinutes: 1020 }], exceptions: [] },
      headers: h(admin, '1'),
    }).data
    // A "rename" that forgets the windows wipes them: full replace, no merge.
    const renamed = call('/v1/operating-schedules/upsert', {
      method: 'POST',
      body: { id: created.id, name: 'Spa & Wellness Hours', departmentId: '4' },
      headers: h(admin, '1'),
    }).data
    expect(renamed.windows).toHaveLength(0)
  })

  it('validates exceptions: dated, and open ones carry a real span', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/operating-schedules/upsert', {
      method: 'POST',
      body: { name: 'Bad exception', windows: [], exceptions: [{ date: 'someday', isClosed: true }] },
      headers: h(admin, '1'),
    }))).toBe('BAD_REQUEST')
    expect(errCode(() => call('/v1/operating-schedules/upsert', {
      method: 'POST',
      body: { name: 'Bad exception', windows: [], exceptions: [{ date: '2026-12-25', isClosed: false, opensMinutes: 600, closesMinutes: 500 }] },
      headers: h(admin, '1'),
    }))).toBe('BAD_REQUEST')
  })
})

describe('terminology', () => {
  it('merges the property\'s overrides over the defaults, per property', () => {
    const admin = login('admin', 'admin123')
    const regional = login('regional', 'regional123')
    // Tenant 1 renamed "Requester" to "Guest" in the seed.
    expect(call('/v1/terminology', { headers: h(admin, '1') }).data.requester).toBe('Guest')
    expect(call('/v1/terminology', { headers: h(admin, '1') }).data.department).toBe('Department')
    // Tenant 2 has no overrides: pure defaults, untouched by tenant 1's rename.
    expect(call('/v1/terminology', { headers: h(regional, '2') }).data.requester).toBe('Requester')
  })

  it('lets an admin rename a term and returns the merged map', () => {
    const admin = login('admin', 'admin123')
    const map = call('/v1/terminology', { method: 'PATCH', body: { key: 'location', value: 'Room' }, headers: h(admin, '1') }).data
    expect(map.location).toBe('Room')
    expect(map.requester).toBe('Guest')
  })

  it('is admin-only to write, readable by staff', () => {
    const staff = login('staff', 'staff123')
    expect(call('/v1/terminology', { headers: h(staff, '1') }).data.requester).toBe('Guest')
    expect(errCode(() => call('/v1/terminology', { method: 'PATCH', body: { key: 'visit', value: 'Stay' }, headers: h(staff, '1') })))
      .toBe('FORBIDDEN')
  })

  it('rejects unknown terms and blank values', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/terminology', { method: 'PATCH', body: { key: 'task', value: 'Job' }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
    expect(errCode(() => call('/v1/terminology', { method: 'PATCH', body: { key: 'visit', value: '  ' }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
  })
})

describe('SLA targets are whole minutes', () => {
  it('refuses fractional minutes on create and edit', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/slas/upsert', { method: 'POST', body: { name: 'Frac', responseTime: 15.5, resolutionTime: 45 }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
    expect(errCode(() => call('/v1/slas/upsert', { method: 'POST', body: { id: '1', name: 'Standard', responseTime: 15, resolutionTime: 45.25, isDefault: true }, headers: h(admin, '1') })))
      .toBe('BAD_REQUEST')
  })
})

describe('routing rule deletion', () => {
  it('is admin-only and hard-deletes the rule', () => {
    const admin = login('admin', 'admin123')
    const leader = login('leader', 'leader123')
    const created = call('/v1/routing-rules/upsert', {
      method: 'POST',
      body: { priority: 70, matchItemId: '8', departmentId: '3', slaId: '1' },
      headers: h(admin, '1'),
    }).data
    expect(errCode(() => call('/v1/routing-rules/delete', { method: 'POST', body: { id: created.id }, headers: h(leader, '1') })))
      .toBe('FORBIDDEN')
    call('/v1/routing-rules/delete', { method: 'POST', body: { id: created.id }, headers: h(admin, '1') })
    expect(call('/v1/routing-rules', { headers: h(admin, '1') }).data.some((r: any) => r.id === created.id)).toBe(false)
    expect(errCode(() => call('/v1/routing-rules/delete', { method: 'POST', body: { id: created.id }, headers: h(admin, '1') })))
      .toBe('NOT_FOUND')
  })
})

describe('board column removal', () => {
  it('skips (with a warning) a column that still holds open work', () => {
    const admin = login('admin', 'admin123')
    // Column 3 (On Hold) holds task 6, which is PENDING — open.
    const result = call('/v1/board/columns/remove', { method: 'POST', body: { id: '3' }, headers: h(admin, '1') }).data
    expect(result.removed).toBe(false)
    expect(result.warning).toContain('skipped')
    // A 200 with a warning means nothing happened: the column is still there.
    const board = call('/v1/board', { headers: h(admin, '1') }).data
    expect(board.columns.some((c: any) => c.id === '3')).toBe(true)
  })

  it('removes a column with no open work', () => {
    const admin = login('admin', 'admin123')
    const created = call('/v1/board/columns/upsert', { method: 'POST', body: { name: 'Awaiting parts', status: 'PENDING', columnSort: 7 }, headers: h(admin, '1') }).data
    const result = call('/v1/board/columns/remove', { method: 'POST', body: { id: created.id }, headers: h(admin, '1') }).data
    expect(result.removed).toBe(true)
    const board = call('/v1/board', { headers: h(admin, '1') }).data
    expect(board.columns.some((c: any) => c.id === created.id)).toBe(false)
    // Removal is terminal: the column cannot be edited back to life.
    expect(errCode(() => call('/v1/board/columns/upsert', { method: 'POST', body: { id: created.id, name: 'Zombie', status: 'PENDING' }, headers: h(admin, '1') })))
      .toBe('NOT_FOUND')
  })

  it('rejects a fractional or zero column order', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/board/columns/upsert', { method: 'POST', body: { name: 'X', status: 'PENDING', columnSort: 1.5 }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
    expect(errCode(() => call('/v1/board/columns/upsert', { method: 'POST', body: { name: 'X', status: 'PENDING', columnSort: 0 }, headers: h(admin, '1') }))).toBe('BAD_REQUEST')
  })
})

describe('two-step admin promotion', () => {
  it('refuses admin at creation', () => {
    const admin = login('admin', 'admin123')
    expect(errCode(() => call('/v1/staff/upsert', {
      method: 'POST',
      body: { email: 'new.admin@aston.example', firstName: 'Nadia', lastName: 'Putri', role: 'admin', canCreateTask: true },
      headers: h(admin, '1'),
    }))).toBe('BAD_REQUEST')
  })

  it('creates as staff or leader, then promotes in a separate request', () => {
    const admin = login('admin', 'admin123')
    const created = call('/v1/staff/upsert', {
      method: 'POST',
      body: { email: 'new.admin@aston.example', firstName: 'Nadia', lastName: 'Putri', role: 'leader', canCreateTask: true },
      headers: h(admin, '1'),
    }).data
    expect(created.role).toBe('leader')
    const promoted = call('/v1/staff/upsert', {
      method: 'POST',
      body: { profileId: created.id, role: 'admin', canCreateTask: true },
      headers: h(admin, '1'),
    }).data
    expect(promoted.role).toBe('admin')
  })
})
