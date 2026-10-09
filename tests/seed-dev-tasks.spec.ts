import { describe, expect, it } from 'vitest'
import { IDS, handleFakeApiRequest as call } from '~/utils/clientFakeApi'
import { SEED_TAG, cancelPrevious, ensureWorker, roleAt, seedTasks } from '../scripts/seed-dev-tasks.mjs'

// The dev-seeding script, driven against the in-browser mock — which is
// wire-faithful to the API — so every call it makes (create, claim, move,
// upload, attach, submit, review, return, offer, helper, comment, checklist)
// is exercised before anyone points it at the real dev database.

interface Session { cookie: string, csrf: string, staff: { id: string, name: string, properties: Array<{ hotelRef: string }>, memberships: Array<{ hotelRef: string, role: string }> } }

function login(email: string, password: string): Session {
  const res = call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
  const data = res.body!.data as { csrfToken: string, staff: Session['staff'], _sessionCookie: string }
  return { cookie: `st_session=${data._sessionCookie}`, csrf: data.csrfToken, staff: data.staff }
}

/** The script's transport shape over the mock: get/post/patch unwrap the envelope, uploads are a no-op. */
function mockApi(session: Session, hotelRef: string) {
  const headers = { 'cookie': session.cookie, 'x-csrf-token': session.csrf, 'x-hotel-id': hotelRef }
  const unwrap = (path: string, opts: Record<string, unknown>) => Promise.resolve(call(path, { ...opts, headers }).body?.data)
  return {
    me: session.staff,
    hotelRef,
    get: (path: string, query?: Record<string, unknown>) => unwrap(path, { query }),
    list: (path: string, query?: Record<string, unknown>) => Promise.resolve(call(path, { query, headers }).body),
    post: (path: string, body?: unknown) => unwrap(path, { method: 'POST', body }),
    patch: (path: string, body?: unknown) => unwrap(path, { method: 'PATCH', body }),
    putBinary: async () => {},
  }
}

const H = IDS.hotel.simatupang
/** The mock stamps activation with the wall clock, so the plan is dated from it too. */
const NOW = Date.now()

describe('seed-dev-tasks against the mock', () => {
  it('seeds every condition as a leader, each one landing in the status it names', async () => {
    const sari = login('leader@aston.example', 'leader123')
    const { tag, results } = await seedTasks(mockApi(sari, H), { now: NOW, runId: 'T1' })
    expect(tag).toBe(`${SEED_TAG} T1]`)
    const failed = results.filter(r => !r.ok)
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([])
    expect(results).toHaveLength(17)

    const byCondition = Object.fromEntries(results.map(r => [r.condition, r]))
    expect(byCondition['IN_PROGRESS · mine · comment + a step ticked'].status).toBe('IN_PROGRESS')
    expect(byCondition['PENDING · on hold'].status).toBe('PENDING')
    expect(byCondition['SUBMITTED · awaiting review'].status).toBe('SUBMITTED')
    expect(byCondition['FINISHED · approved on review'].status).toBe('FINISHED')
    expect(byCondition['IN_PROGRESS · changes requested on review'].status).toBe('IN_PROGRESS')
    expect(byCondition['CANCELLED'].status).toBe('CANCELLED')
    expect(byCondition['NEW · returned to the pool'].status).toBe('NEW')
    expect(byCondition['IN_PROGRESS · pending offer to a colleague'].status).toBe('IN_PROGRESS')
    for (const r of results) expect(r.title.startsWith(`${SEED_TAG} T1]`)).toBe(true)
  })

  it('records the priorities, the team pool and the scheduled start it asked for', async () => {
    const sari = login('leader@aston.example', 'leader123')
    const api = mockApi(sari, H)
    const { base, results } = await seedTasks(api, { now: NOW, runId: 'T2' })
    const detail = async (name: string) => api.get(`/v1/tasks/${results.find(r => r.condition === name)!.id}`) as Promise<any>
    expect((await detail('NEW · high · team pool')).priority).toBe('HIGH')
    expect((await detail('NEW · high · team pool')).assignment?.kind).toBe('TEAM')
    expect((await detail('NEW · urgent · requester + free-text room')).priority).toBe('URGENT')
    expect((await detail('NEW · low · quantity')).quantity).toBe(6)
    expect((await detail('NEW · scheduled start (+2 h)')).activationDate).toBe(new Date(base + 120 * 60_000).toISOString())
    expect((await detail('NEW · hard due date (+6 h)')).dueAt).toBe(new Date(base + 360 * 60_000).toISOString())
    expect((await detail('NEW · checklist steps')).checklist).toHaveLength(3)
    expect((await detail('IN_PROGRESS · mine · comment + a step ticked')).checklist?.[0]?.isDone).toBe(true)
    expect((await detail('IN_PROGRESS · with a helper')).collaborators).toHaveLength(1)
  })

  it('as an admin, creates a worker account and seeds the staff-side conditions through it', async () => {
    const agus = login('admin@aston.example', 'admin123')
    const admin = mockApi(agus, H)
    expect(roleAt(admin)).toBe('admin')
    // An admin alone cannot claim: every staff-side condition says so plainly.
    const alone = await seedTasks(admin, { now: NOW, runId: 'T3' })
    const refused = alone.results.filter(r => !r.ok).map(r => r.error)
    expect(refused.length).toBeGreaterThan(5)
    for (const error of refused) expect(error).toMatch(/ADMIN_CANNOT_CLAIM|NO_TEAM/)
    // With a worker the admin created, the spread is complete.
    const { staff: created, created: isNew } = await ensureWorker(admin, { email: 'tasks-seed-worker@example.com', password: 'seed-worker-pass-1' })
    expect(isNew).toBe(true)
    expect((await ensureWorker(admin, { email: 'tasks-seed-worker@example.com', password: 'x' })).created).toBe(false)
    const workerSession = login('tasks-seed-worker@example.com', 'seed-worker-pass-1')
    expect(workerSession.staff.id).toBe(created.id)
    const worker = mockApi(workerSession, H)
    expect(roleAt(worker)).toBe('staff')
    const { results } = await seedTasks(admin, { worker, now: NOW, runId: 'T4' })
    const failed = results.filter(r => !r.ok)
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([])
    const byCondition = Object.fromEntries(results.map(r => [r.condition, r]))
    expect(byCondition['SUBMITTED · awaiting review'].status).toBe('SUBMITTED')
    expect(byCondition['FINISHED · approved on review'].status).toBe('FINISHED')
    expect(byCondition['NEW · returned to the pool'].status).toBe('NEW')
    const detail = (await admin.get(`/v1/tasks/${byCondition['IN_PROGRESS · mine · comment + a step ticked'].id}`)) as any
    expect(detail.assignment?.staffId).toBe(created.id)
  })

  it('cancels the open tasks of earlier runs and leaves everything else alone', async () => {
    const sari = login('leader@aston.example', 'leader123')
    const api = mockApi(sari, H)
    const cancelled = await cancelPrevious(api)
    expect(cancelled.length).toBeGreaterThan(20)
    const list = (await api.list('/v1/tasks', { limit: 100 })) as { data: Array<{ title: string, status: string }> }
    const seeded = list.data.filter(t => t.title.startsWith(SEED_TAG))
    // SUBMITTED is frozen for everyone but the reviewer's decision; a leader may still park or cancel it.
    expect(seeded.filter(t => ['NEW', 'IN_PROGRESS', 'PENDING'].includes(t.status))).toEqual([])
    expect(list.data.some(t => t.title === 'Extra towels' && !t.title.startsWith(SEED_TAG))).toBe(true)
  })
})
