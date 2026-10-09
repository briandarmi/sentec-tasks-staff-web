#!/usr/bin/env node
/**
 * Seed varied tasks into a Sentec Tasks API, so the staff app has every
 * condition it can show: each priority, each assignment kind, each lifecycle
 * status, a scheduled start, a hard due date, a pending offer, a helper, a
 * reviewed submission and a returned task.
 *
 * Usage (against the dev Lambda, as a leader or admin of the property):
 *
 *   TASKS_EMAIL=leader@example.com TASKS_PASSWORD=... \
 *   node scripts/seed-dev-tasks.mjs [--api <url>] [--hotel <hotelRef>] [--cancel-previous]
 *
 * --api defaults to the dev Function URL from nuxt.config.ts; --hotel to the
 * account's first property. --cancel-previous first moves every still-open
 * task from an earlier run (title starts with "[seed") to the Cancelled
 * column. The account signs in with a password (POST /v1/auth/staff/login),
 * which the API still accepts alongside Google and magic links.
 *
 * Roles. A LEADER can do everything alone: create, claim, submit, review.
 * An ADMIN creates, assigns, moves, cancels and reviews, but cannot claim —
 * so the staff-side conditions (in progress, on hold, submitted, reviewed,
 * returned, offered, helped) need a second, staff account, the "worker":
 *
 *   TASKS_WORKER_EMAIL=tasks-seed-worker@example.com TASKS_WORKER_PASSWORD=... \
 *   node scripts/seed-dev-tasks.mjs --create-worker
 *
 * --create-worker lets the admin create that staff member (first active
 * department of the property, createTask on) when it does not exist yet; on
 * later runs the same two variables just sign it in.
 *
 * What it cannot do: backdate the clocks. "Late", "due soon" and escalated
 * states come from the API's own SLA clocks and escalation worker, so with the
 * Standard SLA (15 min to pick up, 45 to finish) they appear on their own
 * within the hour. One task is created with a backdated activation date in
 * case the API accepts it — it is reported either way.
 *
 * The seeding itself is `seedTasks(api)`, which only needs an object with
 * get/post/patch/putBinary; tests/seed-dev-tasks.spec.ts runs it against the
 * in-browser mock, which is wire-faithful to the API.
 */
import { pathToFileURL } from 'node:url'

export const SEED_TAG = '[seed'

/** A 1×1 white JPEG, for proof photos where an item demands one. */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
)

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

/**
 * The live transport: one cookie jar, the CSRF echo and the hotel scope on
 * every call, the API's `{ data, errors }` envelope unwrapped.
 */
export function liveApi({ apiUrl, email, password, hotelRef = null, fetchImpl = globalThis.fetch }) {
  let cookie = ''
  let csrf = ''
  let me = null
  let hotel = hotelRef

  async function raw(path, { method = 'GET', query, body, headers = {} } = {}) {
    const url = new URL(path, apiUrl)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    const init = {
      method,
      headers: {
        'accept': 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...(hotel ? { 'x-hotel-id': hotel } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
    // A Function URL drops the odd connection (cold starts, resets). Reads and
    // the sign-in are safe to repeat; a create is not, so it is tried once.
    const attempts = method === 'GET' || path === '/v1/auth/staff/login' ? 3 : 1
    let res
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetchImpl(url, init)
        break
      }
      catch (err) {
        if (attempt < attempts) {
          await new Promise(resolve => setTimeout(resolve, 1500 * attempt))
          continue
        }
        // undici says only "fetch failed"; the cause and the request are what a reader needs.
        const cause = err?.cause ?? err
        const detail = [cause?.name, cause?.code, cause?.message, ...(cause?.errors ?? []).map(e => `${e.code ?? e.name ?? ''} ${e.address ?? ''}`.trim())]
          .filter(Boolean).join(' · ') || String(err)
        throw new ApiError('NETWORK', `${method} ${url.pathname}: ${detail}`, 0)
      }
    }
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') ?? '']
    for (const line of setCookies) {
      const match = /st_session=([^;]+)/.exec(line ?? '')
      if (match) cookie = `st_session=${match[1]}`
    }
    const text = await res.text()
    let envelope = null
    try {
      envelope = text ? JSON.parse(text) : null
    }
    catch {
      envelope = null
    }
    if (!res.ok) {
      const first = envelope?.errors?.[0]
      throw new ApiError(first?.code ?? `HTTP_${res.status}`, first?.message ?? text.slice(0, 200) ?? res.statusText, res.status)
    }
    return envelope
  }

  return {
    async login() {
      const env = await raw('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
      csrf = env.data.csrfToken
      me = env.data.staff
      if (!hotel) hotel = me.properties?.[0]?.hotelRef ?? me.memberships?.[0]?.hotelRef ?? null
      if (!hotel) throw new ApiError('NO_HOTEL', 'the account has no property; pass --hotel')
      return me
    },
    get me() { return me },
    get hotelRef() { return hotel },
    get: (path, query) => raw(path, { query }).then(env => env?.data),
    /** A list call with its envelope kept, for the cursor in `meta`. */
    list: (path, query) => raw(path, { query }),
    post: (path, body) => raw(path, { method: 'POST', body }).then(env => env?.data),
    patch: (path, body) => raw(path, { method: 'PATCH', body }).then(env => env?.data),
    async putBinary(url, bytes, contentType) {
      const res = await fetchImpl(url, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes })
      if (!res.ok) throw new ApiError(`HTTP_${res.status}`, `upload failed: ${res.statusText}`, res.status)
    },
  }
}

/** The account's role at the hotel in use (memberships carry the role; the top level does not). */
export function roleAt(api) {
  const me = api.me
  return me?.memberships?.find(m => m.hotelRef === api.hotelRef)?.role ?? me?.role ?? 'staff'
}

/**
 * Find or create the staff account that does the staff-side work for an
 * admin run: a plain staff member, allowed to create tasks, in the property's
 * busiest active department — the one with the most staff, so there is a
 * colleague to offer a task to. Admin only (POST /v1/staff).
 */
export async function ensureWorker(api, { email, password, name = 'Seed worker' }) {
  const rows = (await api.get('/v1/staff').catch(() => null)) ?? []
  const existing = rows.find(s => (s.email ?? '').toLowerCase() === email.toLowerCase())
  if (existing) return { staff: existing, created: false }
  const departments = ((await api.get('/v1/hotel-departments').catch(() => null)) ?? []).filter(d => d.isActive !== false)
  const colleagues = (await api.get('/v1/staff/assignable').catch(() => null)) ?? []
  const headcount = id => colleagues.filter(s => s.hotelDepartmentId === id).length
  const department = [...departments].sort((a, b) => headcount(b.id) - headcount(a.id))[0] ?? null
  const staff = await api.post('/v1/staff', { email, name, password, role: 'staff', hotels: [api.hotelRef], hotelDepartmentId: department?.id ?? null, createTask: true })
  return { staff, created: true }
}

/** One proof photo on a task: presign, upload, attach. */
async function attachPhoto(api, taskId, n) {
  const presigned = await api.post('/v1/uploads', { filename: `seed-${n}.jpg`, contentType: 'image/jpeg', sizeBytes: TINY_JPEG.length })
  await api.putBinary(presigned.uploadUrl, TINY_JPEG, 'image/jpeg')
  return api.post('/v1/tasks/attachments', { taskId, storageKey: presigned.storageKey, filetype: 'PHOTO' })
}

/**
 * Create the varied set. Every condition is attempted on its own and reported
 * with the task it left behind, so one refusal (a role the account lacks, an
 * item the property does not have) never stops the rest.
 */
export async function seedTasks(api, { worker = api, now = Date.now(), runId = new Date(now).toISOString().slice(11, 16).replace(':', '') } = {}) {
  const tag = `${SEED_TAG} ${runId}]`
  const me = api.me
  // Who does what: `api` creates, assigns, moves and reviews; `worker` claims,
  // works, submits, returns and offers. A leader is both; an admin needs a
  // staff worker, because the API refuses an admin's claim outright.
  const workerRole = roleAt(worker)
  const workerCanClaim = workerRole === 'staff' || workerRole === 'leader'
  const apiRole = roleAt(api)
  const reviewer = apiRole === 'leader' || apiRole === 'admin' ? api : worker
  const mover = apiRole === 'leader' || apiRole === 'admin' ? api : worker
  const needWorker = () => {
    if (!workerCanClaim) throw new ApiError('ADMIN_CANNOT_CLAIM', 'an admin cannot claim: pass TASKS_WORKER_EMAIL / TASKS_WORKER_PASSWORD (add --create-worker once), or run as a leader')
  }
  // Relative dates are measured from whichever is later, the caller's clock or
  // the wall clock: the API stamps activation with ITS clock, and a due date
  // before that is refused.
  const base = Math.max(now, Date.now())
  const [items, locations, teams, staff] = await Promise.all([
    api.get('/v1/catalog-items').then(rows => rows ?? []),
    api.get('/v1/locations').then(rows => rows ?? []),
    api.get('/v1/teams').then(rows => rows ?? []),
    api.get('/v1/staff/assignable').then(rows => rows ?? []).catch(() => []),
  ])
  let columns = []
  try {
    columns = (await api.get('/v1/kanban-board'))?.columns ?? []
  }
  catch {
    columns = []
  }
  const columnFor = status => columns.find(c => c.status === status && !c.isRemoved) ?? null

  const active = items.filter(i => i.isActive !== false)
  const location = locations[0] ?? null
  const team = teams[0] ?? null
  const withItem = item => (item ? { itemRef: item.id, ...(item.requiresLocation && location ? { locationRef: location.id } : {}) } : {})

  /**
   * Claiming is refused outside the actor's own department, so the items the
   * flows claim are chosen by where the API's routing preview says they land:
   * the actor's department, or none. An admin has no department and may
   * claim anything.
   */
  const myDept = worker.me?.memberships?.find(m => m.hotelRef === worker.hotelRef)?.hotelDepartmentId
    ?? staff.find(s => s.id === worker.me?.id)?.hotelDepartmentId
    ?? null
  // Offers and helpers go to someone in the worker's own department when
  // there is one: the API refuses a hand-over across departments.
  const others = staff.filter(s => s.id !== me?.id && s.id !== worker.me?.id)
  /** Anyone else: a helper may come from any department. */
  const colleague = others.find(s => myDept === null || s.hotelDepartmentId === myDept) ?? others[0] ?? null
  /** Someone in the task's own department: an offer across departments is refused. */
  const offerTo = others.find(s => myDept === null || s.hotelDepartmentId === myDept) ?? null
  async function routesToMine(extra) {
    if (myDept === null) return true
    try {
      const preview = await api.post('/v1/tasks/preview', { title: 'routing probe', ...extra })
      const dept = preview?.task?.hotelDepartmentId ?? null
      return dept === null || dept === myDept
    }
    catch {
      return false
    }
  }
  async function pickItem(predicate) {
    for (const item of active.filter(predicate)) {
      if (await routesToMine(withItem(item))) return item
    }
    return null
  }
  const plainItem = await pickItem(i => !i.minProofPhotos && !i.requiresCompletionNote && !i.requiresLocation)
  const proofItem = await pickItem(i => i.minProofPhotos > 0)
  const quantityItem = (await pickItem(i => i.itemQuantity)) ?? plainItem
  /** The claimable shape: routed to the actor's own department. */
  const mine = withItem(plainItem)

  const results = []
  async function condition(name, fn) {
    try {
      const outcome = await fn()
      results.push({ condition: name, ok: true, ...outcome })
    }
    catch (e) {
      results.push({ condition: name, ok: false, error: `${e.code ? `${e.code}: ` : ''}${e.message}` })
    }
  }
  const create = (title, extra = {}) => api.post('/v1/tasks/staff-create', { title: `${tag} ${title}`, ...extra })
  const claim = (taskId) => {
    needWorker()
    return worker.post('/v1/tasks/claim', { taskId })
  }
  const move = (taskId, status, description, by = mover) => {
    const column = columnFor(status)
    if (!column) throw new ApiError('NO_COLUMN', `the board has no column for ${status}`)
    return by.patch('/v1/tasks/status', { taskId, columnId: column.id, description: description ?? null })
  }
  /** Claiming only takes the task; work starts with the move to In Progress, as in the app. */
  const start = async (taskId) => {
    await claim(taskId)
    return move(taskId, 'IN_PROGRESS', null, worker)
  }
  const submit = async (taskId, item) => {
    for (let n = 1; n <= (item?.minProofPhotos ?? 0); n++) await attachPhoto(worker, taskId, n)
    return worker.post('/v1/tasks/submit', { taskId, completionNote: 'Seeded: done as requested.' })
  }
  const row = (task, note) => ({ id: task.id, title: task.title, status: task.status, note })

  await condition('NEW · normal · unassigned', async () => row(await create('Extra towels', { description: 'Two bath towels', roomNumber: '1510', ...withItem(plainItem) }), 'plain item'))
  await condition('NEW · high · team pool', async () => {
    if (!team) throw new ApiError('NO_TEAM', 'the property has no team')
    return row(await create('Deep clean — floor 9 corridor', { priority: 'HIGH', roomNumber: 'Floor 9', assignee: { assigneeKind: 'TEAM', assigneeTeamId: team.id } }), `team ${team.name}`)
  })
  await condition('NEW · urgent · requester + free-text room', async () => row(await create('Allergy meal replacement', { priority: 'URGENT', roomNumber: '1206', requesterName: 'Marcus Reid', description: 'Nut allergy — hold the tray' })))
  await condition('NEW · low · quantity', async () => row(await create('Extra hangers', { priority: 'LOW', roomNumber: '0804', quantity: 6, ...withItem(quantityItem) })))
  await condition('NEW · scheduled start (+2 h)', async () => row(await create('Turndown — floor 15', { roomNumber: 'Floor 15', activationDate: new Date(base + 120 * 60_000).toISOString() }), 'clocks start at activation'))
  await condition('NEW · hard due date (+6 h)', async () => row(await create('Birthday cake to room', { roomNumber: '1808', requesterName: 'Amelia Chen', dueAt: new Date(base + 360 * 60_000).toISOString() })))
  await condition('NEW · backdated activation (−2 h), late if accepted', async () => row(await create('Extra pillows', { roomNumber: '1407', activationDate: new Date(base - 120 * 60_000).toISOString() }), 'late now if the API accepted the past date'))
  await condition('NEW · checklist steps', async () => row(await create('Room reset after late checkout', { roomNumber: '1102', checklistLabels: ['Strip the beds', 'Restock the minibar', 'Check the safe is open'] })))

  await condition('IN_PROGRESS · mine · comment + a step ticked', async () => {
    const created = await create('Carpet shampoo', { roomNumber: '1101', checklistLabels: ['Move the furniture', 'Shampoo and extract'], ...mine })
    const claimed = await start(created.id)
    await worker.post('/v1/tasks/comments', { taskId: created.id, comment: 'Seeded: starting now, windows open.' })
    const detail = await worker.get(`/v1/tasks/${created.id}`)
    const first = detail?.checklist?.[0]
    if (first) await worker.post('/v1/tasks/checklist/done', { taskId: created.id, itemId: first.id, isDone: true })
    return row(claimed, `claimed by ${worker.me?.name ?? 'the worker'}`)
  })
  await condition('PENDING · on hold', async () => {
    const created = await create('Airport pickup — flight delayed', { roomNumber: '0702', ...mine })
    await start(created.id)
    return row(await move(created.id, 'PENDING', 'Waiting for the new arrival time', worker))
  })
  await condition('SUBMITTED · awaiting review', async () => {
    const created = await create('Restock minibar', { roomNumber: '1312', ...withItem(proofItem ?? plainItem) })
    await start(created.id)
    return row(await submit(created.id, proofItem ?? plainItem), proofItem ? `${proofItem.minProofPhotos} proof photo(s) uploaded` : 'no proof needed')
  })
  await condition('FINISHED · approved on review', async () => {
    const created = await create('Replace shower curtain', { roomNumber: '0611', ...withItem(proofItem ?? plainItem) })
    await start(created.id)
    await submit(created.id, proofItem ?? plainItem)
    return row(await reviewer.post('/v1/tasks/review', { taskId: created.id, decision: 'APPROVE' }), `reviewed by ${reviewer.me?.name ?? 'the reviewer'}`)
  })
  await condition('IN_PROGRESS · changes requested on review', async () => {
    const created = await create('Polish the brass door handles', { roomNumber: 'Lobby', ...withItem(proofItem ?? plainItem) })
    await start(created.id)
    await submit(created.id, proofItem ?? plainItem)
    return row(await reviewer.post('/v1/tasks/review', { taskId: created.id, decision: 'REQUEST_CHANGES', note: 'Seeded: the lift lobby set is still dull.' }))
  })
  await condition('CANCELLED', async () => {
    const created = await create('Late checkout request', { roomNumber: '0509', ...mine })
    // A leader or admin cancels outright; a plain staff worker must hold the task first.
    if (mover === worker) await claim(created.id)
    return row(await move(created.id, 'CANCELLED', 'Guest checked out on time after all'))
  })
  await condition('NEW · returned to the pool', async () => {
    // Claimed, then handed back: the API returns it to the department (or team) it came from.
    const created = await create('Luggage to room', { roomNumber: '0312', ...mine })
    await start(created.id)
    return row(await worker.post('/v1/tasks/return', { taskId: created.id, reason: 'Seeded: called away to the desk.' }))
  })
  await condition('IN_PROGRESS · pending offer to a colleague', async () => {
    if (!offerTo) throw new ApiError('NO_COLLEAGUE', 'nobody in the worker\'s department to offer the task to')
    const created = await create('Welcome amenity for VIP arrival', { roomNumber: '2001', ...mine })
    const claimed = await start(created.id)
    await worker.post('/v1/tasks/offers', { taskId: created.id, toStaffId: offerTo.id, note: 'Seeded: can you take this one?' })
    return row(claimed, `offered to ${offerTo.name}`)
  })
  await condition('IN_PROGRESS · with a helper', async () => {
    if (!colleague) throw new ApiError('NO_COLLEAGUE', 'nobody else to add as a helper')
    const created = await create('Move furniture for carpet fitting', { roomNumber: '1203', ...mine })
    const claimed = await start(created.id)
    await worker.post('/v1/tasks/collaborators', { taskId: created.id, staffId: colleague.id })
    return row(claimed, `helper ${colleague.name}`)
  })

  return { tag, base, results }
}

/** Move every still-open task from earlier runs to the Cancelled column. */
export async function cancelPrevious(api) {
  const columns = (await api.get('/v1/kanban-board').catch(() => null))?.columns ?? []
  const cancelled = columns.find(c => c.status === 'CANCELLED' && !c.isRemoved)
  if (!cancelled) throw new ApiError('NO_COLUMN', 'the board has no Cancelled column')
  const open = new Set(['NEW', 'IN_PROGRESS', 'PENDING', 'SUBMITTED'])
  let cursor = null
  const done = []
  do {
    const env = await api.list('/v1/tasks', { limit: 100, ...(cursor ? { cursor } : {}) })
    const rows = env?.data ?? []
    for (const task of rows) {
      if (!task.title.startsWith(SEED_TAG) || !open.has(task.status)) continue
      try {
        await api.patch('/v1/tasks/status', { taskId: task.id, columnId: cancelled.id, description: 'Seed clean-up' })
        done.push(task.id)
      }
      catch { /* a frozen SUBMITTED task refuses the move for staff; leave it */ }
    }
    cursor = env?.meta?.nextCursor ?? null
  } while (cursor)
  return done
}

function parseArgs(argv) {
  const args = { api: 'https://cy2ori3ybex2n5ibpa3j2kxq3e0zyzjo.lambda-url.ap-southeast-3.on.aws', hotel: null, cancelPrevious: false, createWorker: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--api') args.api = argv[++i]
    else if (a === '--hotel') args.hotel = argv[++i]
    else if (a === '--cancel-previous') args.cancelPrevious = true
    else if (a === '--create-worker') args.createWorker = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const email = process.env.TASKS_EMAIL
  const password = process.env.TASKS_PASSWORD
  if (args.help || !email || !password) {
    console.error('Usage: TASKS_EMAIL=... TASKS_PASSWORD=... [TASKS_WORKER_EMAIL=... TASKS_WORKER_PASSWORD=...] node scripts/seed-dev-tasks.mjs [--api <url>] [--hotel <hotelRef>] [--cancel-previous] [--create-worker]')
    process.exit(args.help ? 0 : 2)
  }
  const api = liveApi({ apiUrl: args.api, email, password, hotelRef: args.hotel })
  const me = await api.login()
  const property = me.properties?.find(p => p.hotelRef === api.hotelRef)?.name ?? api.hotelRef
  console.log(`Signed in as ${me.name ?? me.email} (${roleAt(api)}) at ${property} on ${args.api}`)
  if (args.cancelPrevious) {
    const cancelled = await cancelPrevious(api)
    console.log(`Cancelled ${cancelled.length} task(s) from earlier runs.`)
  }
  let worker = api
  if (roleAt(api) === 'admin') {
    const workerEmail = process.env.TASKS_WORKER_EMAIL
    const workerPassword = process.env.TASKS_WORKER_PASSWORD
    if (workerEmail && workerPassword) {
      if (args.createWorker) {
        const { staff, created } = await ensureWorker(api, { email: workerEmail, password: workerPassword })
        console.log(created ? `Created the worker account ${staff.email} (${staff.id})` : `Worker account ${staff.email} already exists; signing it in`)
      }
      worker = liveApi({ apiUrl: args.api, email: workerEmail, password: workerPassword, hotelRef: api.hotelRef })
      const w = await worker.login()
      console.log(`Worker: ${w.name ?? w.email} (${roleAt(worker)})`)
    }
    else {
      console.log('This account is an admin and cannot claim: the staff-side conditions need TASKS_WORKER_EMAIL / TASKS_WORKER_PASSWORD (add --create-worker to create that account).')
    }
  }
  const { tag, results } = await seedTasks(api, { worker })
  console.log(`\nRun ${tag}: ${results.filter(r => r.ok).length} of ${results.length} conditions seeded\n`)
  for (const r of results) {
    if (r.ok) console.log(`  OK   ${r.condition.padEnd(48)} ${r.status.padEnd(12)} ${r.id}${r.note ? `  (${r.note})` : ''}`)
    else console.log(`  FAIL ${r.condition.padEnd(48)} ${r.error}`)
  }
  console.log('\nLate, due-soon and escalated states follow the SLA clocks: with the Standard SLA they appear within the hour.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`seed failed: ${e.code ? `${e.code}: ` : ''}${e.message}`)
    process.exit(1)
  })
}
