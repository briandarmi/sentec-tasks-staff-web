<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Component } from 'vue'
import { AlarmClockIcon, CalendarArrowDownIcon, CalendarArrowUpIcon, ClockAlertIcon, DoorOpenIcon, FilterIcon, FilterXIcon, FlagIcon, FlameIcon, HandIcon, InfoIcon, LayersIcon, LayoutListIcon, ListOrderedIcon, RefreshCwIcon, SearchIcon, TimerIcon, UserRoundIcon, UsersIcon } from '@lucide/vue'
import { useTasksApi, type TaskQuery } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import { useSourceApps } from '~/composables/useSourceApps'
import { useNow } from '~/composables/useNow'
import type { Board, BoardColumn, TaskListItem } from '~/utils/clientFakeApi'
import { groupIntoLanes } from '~/utils/source-lanes'
import { isClaimable } from '~/utils/task-ui'
import { SELECT_EMPTY, fromSelectValue, toSelectValue } from '~/utils/select-empty'
import { PRIORITY_RANK, STATUS_SIGNAL, compareByHeat, statusSignal } from '~/utils/task-signals'

definePageMeta({ title: 'Tasks' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()
const session = useSession()
const caps = useCaps()
const sourceApps = useSourceApps()
void sourceApps.ensureLoaded()

/**
 * Filters live in the URL, not in component state — a filtered view is
 * shareable and survives a refresh or back-navigation from a task detail.
 *
 * Every chip maps to a REAL list parameter (columnId, status, assignedStaffId,
 * helping=1, responseSlaStatus/resolutionSlaStatus). The two exceptions are
 * labeled where they happen: "To claim" narrows the fetched page to pool rows
 * client-side (the API's staff auto-scope already returns own + unclaimed
 * work, but has no unclaimed-only parameter), and the search box filters the
 * loaded page only — the API has no free-text search. The queue chips also
 * carry the server's total for their filter (see `refreshCounts`).
 *
 * Since 2026-10-09 this page is the board as well: the property's columns are
 * the Status select (`column=<id>`, the API's columnId filter, each option
 * with a live total), so the one-column-at-a-time view the phone board
 * offered is a pick here, with the search, the Show select, the Sort select,
 * paging and the one-tap Claim kept. Selects rather than scrolling chip
 * strips: every option is visible at once, nothing hides off the right edge.
 * A property without a provisioned board falls back to plain statuses;
 * `status=` in an incoming link still works either way.
 *
 * Sort is in the URL too (`sort=`), because most orders are the API's own
 * (`sort`/`order`, which also drive the cursor) and a shared link should open
 * the same way. The few the API cannot do — urgency, priority, room, and the
 * grouping by source app — are applied over the loaded rows instead.
 */
const search = ref(String(route.query.q ?? ''))
const status = computed(() => String(route.query.status ?? ''))
const scope = computed(() => String(route.query.scope ?? ''))
const column = computed(() => String(route.query.column ?? ''))

// ── sort ────────────────────────────────────────────────────────────────────

type SortKey = 'urgency' | 'priority' | 'pickup' | 'finish' | 'newest' | 'oldest' | 'status' | 'room' | 'source'

interface SortOption {
  value: SortKey
  label: string
  icon: Component
  /** The API's own order, which also drives the cursor paging. */
  server?: Pick<TaskQuery, 'sort' | 'order'>
  /** An order the API has no parameter for, applied over the loaded rows. */
  client?: (a: TaskListItem, b: TaskListItem, nowMs: number) => number
}

/** Rooms in natural order (0710 before 1204, Floor 7 before Floor 12), no-room last, hottest first within a room. */
const byRoom: SortOption['client'] = (a, b, nowMs) => {
  const ra = a.roomNumber ?? ''
  const rb = b.roomNumber ?? ''
  if (!ra !== !rb) return ra ? -1 : 1
  return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' }) || compareByHeat(a, b, nowMs)
}

const byPriority: SortOption['client'] = (a, b, nowMs) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || compareByHeat(a, b, nowMs)

const SORTS: SortOption[] = [
  { value: 'urgency', label: 'Most urgent first', icon: FlameIcon, client: compareByHeat },
  { value: 'priority', label: 'Highest priority first', icon: FlagIcon, client: byPriority },
  { value: 'pickup', label: 'Pick-up deadline', icon: AlarmClockIcon, server: { sort: 'responseDueAt', order: 'asc' } },
  { value: 'finish', label: 'Finish deadline', icon: TimerIcon, server: { sort: 'resolutionDueAt', order: 'asc' } },
  { value: 'newest', label: 'Newest first', icon: CalendarArrowDownIcon, server: { sort: 'createdAt', order: 'desc' } },
  { value: 'oldest', label: 'Oldest first', icon: CalendarArrowUpIcon, server: { sort: 'createdAt', order: 'asc' } },
  { value: 'status', label: 'By status', icon: ListOrderedIcon, server: { sort: 'status', order: 'asc' } },
  { value: 'room', label: 'By room', icon: DoorOpenIcon, client: byRoom },
  // One lane per originating app, the lane holding a fire on top; hottest first within a lane.
  { value: 'source', label: 'Grouped by source app', icon: LayersIcon, client: compareByHeat },
]

const sortKey = computed<SortKey>(() => {
  const value = String(route.query.sort ?? '')
  return SORTS.some(option => option.value === value) ? value as SortKey : 'urgency'
})
const sort = computed(() => SORTS.find(option => option.value === sortKey.value)!)

/**
 * Grouping by source needs the registry's names; while it is unavailable the
 * option is withheld and a `sort=source` link reads as the default order.
 */
const canGroupBySource = computed(() => sourceApps.status.value !== 'failed')
const sortOptions = computed(() => SORTS.filter(option => option.value !== 'source' || canGroupBySource.value))
const grouped = computed(() => sortKey.value === 'source' && canGroupBySource.value)

const tasks = ref<TaskListItem[]>([])
const totalCount = ref(0)
const nextCursor = ref<string | null>(null)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const errorMessage = ref('')

const PAGE_SIZE = 20

const hasFilters = computed(() => Boolean(status.value || scope.value || column.value || search.value.trim()))

/** Write filters into the URL, dropping the cursor so paging restarts. */
function setFilters(patch: Record<string, string>) {
  const query = { ...route.query }
  for (const [key, value] of Object.entries(patch)) {
    if (value) query[key] = value
    else delete query[key]
  }
  router.replace({ query })
}

const setFilter = (key: string, value: string) => setFilters({ [key]: value })

/** Filters go; the chosen order stays, it is a preference, not a narrowing. */
function clearFilters() {
  search.value = ''
  router.replace({ query: sortKey.value === 'urgency' ? {} : { sort: sortKey.value } })
}

// ── the board's columns ──────────────────────────────────────────────────────

const board = ref<(Board & { columns: BoardColumn[] }) | null>(null)
const columns = computed(() => (board.value?.columns ?? []).filter(c => !c.isRemoved))

/** Loaded once. A property without a board is a real state, not an error: the strip just shows statuses. */
async function loadBoard() {
  try {
    board.value = await api.getKanbanBoard()
  }
  catch {
    board.value = null
  }
  refreshColumnCounts()
}

/** A column chip is lit by its id — or by the status an incoming link named. */
function columnActive(col: BoardColumn) {
  if (column.value) return column.value === col.id
  return Boolean(status.value) && col.status === status.value
}

function pickColumn(col: BoardColumn | null) {
  setFilters({ column: col?.id ?? '', status: '' })
}

/**
 * The Status select's value: the chosen column, else the column an incoming
 * `status=` link names; without a board, the status itself.
 */
const statusSelectValue = computed(() => {
  if (columns.value.length) return column.value || (status.value ? columns.value.find(c => c.status === status.value)?.id ?? '' : '')
  return status.value
})

function onStatusSelect(value: string) {
  if (columns.value.length) pickColumn(columns.value.find(c => c.id === value) ?? null)
  else setFilters({ status: value, column: '' })
}

function currentQuery(): TaskQuery {
  const query: TaskQuery = { limit: PAGE_SIZE, ...(sort.value.server ?? {}) }
  // A column is the board's own filter; a status is the fallback, and what links from elsewhere use.
  if (column.value) query.columnId = column.value
  else if (status.value) query.status = status.value as TaskQuery['status']
  switch (scope.value) {
    case 'mine':
      query.assignedStaffId = session.userId.value ?? undefined
      break
    case 'helping':
      query.helping = '1'
      break
    case 'late-response':
      query.responseSlaStatus = 'BREACHED'
      break
    case 'breached':
      query.resolutionSlaStatus = 'BREACHED'
      break
  }
  return query
}

/** "To claim" narrows to pool rows after the fetch — labeled client-side. */
const clientNarrow = (rows: TaskListItem[]) =>
  scope.value === 'unclaimed' ? rows.filter(t => !t.assignment || t.assignment.kind !== 'STAFF') : rows

/**
 * Server totals on the chips that people use as queues — every column,
 * "Mine", "Helping", and for leaders "In review" — one `limit=1` list call
 * each, read for `meta.total` only. Fire-and-forget: a slow or failed count
 * never delays the list, the chip just shows its plain label until (or
 * unless) the number lands.
 */
const counts = ref<Record<string, number | null>>({})

async function fetchCount(key: string, query: TaskQuery) {
  try {
    const res = await api.listTasks({ ...query, limit: 1 })
    counts.value = { ...counts.value, [key]: res.meta.total }
  }
  catch {
    counts.value = { ...counts.value, [key]: null }
  }
}

function refreshColumnCounts() {
  for (const col of columns.value) void fetchCount(`col:${col.id}`, { columnId: col.id })
}

function refreshCounts() {
  const userId = session.userId.value
  if (userId) {
    void fetchCount('mine', { assignedStaffId: userId })
    void fetchCount('helping', { helping: '1' })
  }
  // Leaders read "In review" as their own queue; for staff it is just a status.
  if (caps.isLeader.value) void fetchCount('SUBMITTED', { status: 'SUBMITTED' })
  refreshColumnCounts()
}

function countFor(key?: string): number | null {
  const n = key ? counts.value[key] : null
  return typeof n === 'number' ? n : null
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  refreshCounts()
  try {
    const res = await api.listTasks(currentQuery())
    tasks.value = clientNarrow(res.data)
    totalCount.value = res.meta.total
    nextCursor.value = res.meta.nextCursor ?? null
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

/** Cursor paging: append rather than replace, so scroll position is kept. */
async function loadMore() {
  if (!nextCursor.value || isLoadingMore.value) return
  isLoadingMore.value = true
  try {
    const res = await api.listTasks({ ...currentQuery(), cursor: nextCursor.value })
    tasks.value = [...tasks.value, ...clientNarrow(res.data)]
    nextCursor.value = res.meta.nextCursor ?? null
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoadingMore.value = false
  }
}

// ── claim straight off the card ─────────────────────────────────────────────

const claimingId = ref('')

/**
 * Claimable straight off the card: nothing personal holds it — unassigned, or
 * sitting in a pool (whose membership the server checks on the tap).
 */
function canClaimCard(task: TaskListItem) {
  return caps.canWork.value && isClaimable(task.status) && task.assignment?.kind !== 'STAFF'
}

/**
 * The one-handed path: see the queue, take the job, keep walking — without
 * opening the task first. A 409 means somebody was faster; the reload makes
 * the list stop lying either way.
 */
async function claim(task: TaskListItem) {
  if (claimingId.value) return
  claimingId.value = task.id
  errorMessage.value = ''
  try {
    await api.claimTask(task.id)
    await load()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
    await load()
  }
  finally {
    claimingId.value = ''
  }
}

// The search box filters the LOADED rows — the API has no q parameter. Kept in
// the URL anyway so a shared link carries it.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setFilter('q', value.trim()), 250)
})

const now = useNow()

/**
 * The loaded rows in the chosen order. The API's own orders arrive sorted
 * (and page in that order); the client-side ones — hottest first by default,
 * so on a phone the red cards float to the top of whatever page is loaded —
 * are applied here, over the rows the search left.
 */
const shownTasks = computed(() => {
  const query = search.value.trim().toLowerCase()
  const rows = !query
    ? tasks.value
    : tasks.value.filter(t =>
        t.title.toLowerCase().includes(query)
        || (t.roomNumber ?? '').toLowerCase().includes(query)
        || (t.description ?? '').toLowerCase().includes(query)
        || t.id.startsWith(query),
      )
  const compare = sort.value.client
  return compare ? [...rows].sort((a, b) => compare(a, b, now.value)) : rows
})

/** "Grouped by source app": the same rows, one lane per originating app, the lane holding a fire on top. */
const lanes = computed(() => groupIntoLanes(shownTasks.value, sourceApps.byCode.value, now.value))

// One watcher drives loading: any server-side change — filter or order — reloads from page one.
watch(() => [route.query.status, route.query.scope, route.query.column, route.query.sort], load, { immediate: true })
void loadBoard()

interface Chip { value: string, label: string, icon: Component, countKey?: string }

/** The fallback strip for a property without a board; each chip wears its pill's icon. */
const STATUS_TABS: Chip[] = [
  { value: '', label: 'All statuses', icon: LayoutListIcon },
  { value: 'NEW', label: STATUS_SIGNAL.NEW.label, icon: STATUS_SIGNAL.NEW.icon },
  { value: 'IN_PROGRESS', label: STATUS_SIGNAL.IN_PROGRESS.label, icon: STATUS_SIGNAL.IN_PROGRESS.icon },
  // Leaders read this as their review queue; staff as "waiting on review".
  { value: 'SUBMITTED', label: STATUS_SIGNAL.SUBMITTED.label, icon: STATUS_SIGNAL.SUBMITTED.icon, countKey: 'SUBMITTED' },
  { value: 'FINISHED', label: STATUS_SIGNAL.FINISHED.label, icon: STATUS_SIGNAL.FINISHED.icon },
  { value: 'VERIFIED', label: STATUS_SIGNAL.VERIFIED.label, icon: STATUS_SIGNAL.VERIFIED.icon },
]

/**
 * "What shows here" is an info button beside the heading that opens a dialog,
 * not a disclosure under it: the text is read once, then never again, so it
 * should not hold a line of the list's vertical space on a phone.
 */
const scopeInfoOpen = ref(false)

/**
 * What the list covers, in the viewer's terms — the [DR-15] rule as of
 * feat/projects. Behaviour is server-side; this only describes it.
 */
const scopeDescription = computed(() => {
  if (caps.isLeader.value) return 'Every task at this property. Project tasks are not listed here — open them under Mine, Helping or in the project itself.'
  return 'Tasks you claimed; unclaimed tasks in your department; unclaimed tasks with no department anywhere at the property; your teams\' pools; tasks with a step handed to you (read-only); and every task of your projects. Project tasks are not listed here — open them under Mine, Helping or in the project.'
})

const SCOPE_TABS: Chip[] = [
  { value: 'unclaimed', label: 'To claim', icon: HandIcon },
  { value: 'mine', label: 'Mine', icon: UserRoundIcon, countKey: 'mine' },
  { value: 'helping', label: 'Helping', icon: UsersIcon, countKey: 'helping' },
  // The two SLA clocks, by their plain names: "Picked up late" is a missed
  // response target, "Late" a missed resolution target.
  { value: 'late-response', label: 'Picked up late', icon: ClockAlertIcon },
  { value: 'breached', label: 'Late', icon: ClockAlertIcon },
]

const activeColumnName = computed(() => columns.value.find(col => columnActive(col))?.name ?? '')
</script>

<template>
  <div class="space-y-4">
    <!-- Three rows of 44px, no stacked labels: on a phone the sticky block
         must leave most of the screen to the cards it filters. -->
    <StickyListHeader>
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1">
          <!-- The count is the heading: "32 Tasks" says what the subtitle used
               to, in two words. Plain "Tasks" only until the first page lands. -->
          <h2 class="text-xl font-bold tracking-tight">
            {{ isLoading && tasks.length === 0 ? 'Tasks' : `${totalCount} ${totalCount === 1 ? 'Task' : 'Tasks'}` }}
          </h2>
          <Button size="icon" variant="ghost" aria-label="What shows here" title="What shows here" @click="scopeInfoOpen = true">
            <InfoIcon class="size-5" />
          </Button>
        </div>
        <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" title="Refresh" @click="load">
          <RefreshCwIcon class="size-5" :class="isLoading ? 'animate-spin' : ''" />
        </Button>
      </div>

      <!-- Search, then the order beside it as an icon-only select: it
           rearranges the rows, it does not narrow them, so it sits apart from
           the two filters below. The trigger wears the current order's icon;
           the menu spells every order out. Clear filters joins the row only
           while there is something to clear. -->
      <div class="flex items-center gap-2">
        <div class="relative min-w-0 flex-1">
          <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <!-- 16px type on purpose: iOS zooms into any smaller input on focus. -->
          <Input v-model="search" placeholder="Search room or title" aria-label="Search the loaded tasks" class="h-11 pl-10 text-base" />
        </div>
        <Select :model-value="sortKey" @update:model-value="value => setFilter('sort', String(value ?? '') === 'urgency' ? '' : String(value ?? ''))">
          <SelectTrigger id="filter-sort" size="sm" class="h-11 shrink-0 px-2.5" aria-label="Sort" :title="`Sort: ${sort.label}`">
            <SelectValue>
              <component :is="sort.icon" class="size-5 text-foreground" aria-hidden="true" />
              <span class="sr-only">{{ sort.label }}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem v-for="option in sortOptions" :key="option.value" :value="option.value">
              <component :is="option.icon" aria-hidden="true" />
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button v-if="hasFilters" size="icon" variant="secondary" class="shrink-0" aria-label="Clear filters" title="Clear filters" @click="clearFilters">
          <FilterXIcon class="size-5" />
        </Button>
      </div>

      <!-- Two selects side by side: where the work stands (the board's columns,
           each with its live total — or the plain statuses where the property
           has no board) and whose it is / how its clocks stand. Every option in
           view at once, nothing hiding off the right edge. No labels above
           them: the empty options name the axis ("All statuses", "Everything")
           and the trigger carries the name for assistive tech. -->
      <div class="grid grid-cols-2 gap-2">
        <Select :model-value="toSelectValue(statusSelectValue)" @update:model-value="value => onStatusSelect(fromSelectValue(value))">
          <SelectTrigger id="filter-status" size="sm" class="h-11 w-full" aria-label="Status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <template v-if="columns.length">
              <SelectItem :value="SELECT_EMPTY">
                <LayoutListIcon aria-hidden="true" /> All statuses
              </SelectItem>
              <SelectItem v-for="col in columns" :key="col.id" :value="col.id">
                <component :is="col.status ? statusSignal(col.status).icon : LayoutListIcon" aria-hidden="true" />
                {{ col.name }}
                <span v-if="countFor(`col:${col.id}`) !== null" class="tabular-nums text-muted-foreground">({{ countFor(`col:${col.id}`) }})</span>
              </SelectItem>
            </template>
            <template v-else>
              <SelectItem v-for="tab in STATUS_TABS" :key="tab.value" :value="toSelectValue(tab.value)">
                <component :is="tab.icon" aria-hidden="true" />
                {{ tab.label }}
                <span v-if="countFor(tab.countKey) !== null" class="tabular-nums text-muted-foreground">({{ countFor(tab.countKey) }})</span>
              </SelectItem>
            </template>
          </SelectContent>
        </Select>

        <Select :model-value="toSelectValue(scope)" @update:model-value="value => setFilter('scope', fromSelectValue(value))">
          <SelectTrigger id="filter-scope" size="sm" class="h-11 w-full" aria-label="Show">
            <SelectValue placeholder="Everything" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="SELECT_EMPTY">
              <FilterIcon aria-hidden="true" /> Everything
            </SelectItem>
            <SelectItem v-for="s in SCOPE_TABS" :key="s.value" :value="s.value">
              <component :is="s.icon" aria-hidden="true" />
              {{ s.label }}
              <span v-if="countFor(s.countKey) !== null" class="tabular-nums text-muted-foreground">({{ countFor(s.countKey) }})</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </StickyListHeader>

    <!-- A one-paragraph read: no footer, no rules, the corner X is the only
         way out. -->
    <Dialog v-model:open="scopeInfoOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader :divided="false">
          <DialogTitle>What shows here</DialogTitle>
          <DialogDescription class="leading-relaxed">{{ scopeDescription }}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && tasks.length === 0" class="space-y-3">
      <Skeleton v-for="n in 4" :key="n" class="h-36 w-full rounded-2xl" />
    </div>

    <EmptyState
      v-else-if="shownTasks.length === 0"
      :icon="LayoutListIcon"
      :title="activeColumnName ? `Nothing in ${activeColumnName}` : 'No tasks match'"
      :description="activeColumnName && !scope && !search.trim()
        ? 'Tasks move here as the work moves along.'
        : hasFilters ? 'Try clearing a filter or a different search.' : caps.isLeader.value ? 'Nothing to show at this property yet. Project tasks live in their projects.' : 'Nothing you can see at this property right now: your claimed work, your department\'s and the property\'s unclaimed tasks, your team pools, steps handed to you, and your projects\' tasks (those show in the project).'"
    >
      <Button v-if="hasFilters" variant="secondary" class="min-h-11" @click="clearFilters">
        <FilterXIcon class="size-5" /> Clear filters
      </Button>
    </EmptyState>

    <template v-else>
      <!-- Lanes: the same cards, re-partitioned by originating app with the
           lane holding a fire on top. The square is the registry's colour —
           data, not a theme token; the Other lane has none. -->
      <div v-if="grouped" class="space-y-5">
        <section v-for="lane in lanes" :key="lane.key" class="space-y-2">
          <h3 class="flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <span
              class="size-3 shrink-0 rounded-sm"
              :class="lane.color ? '' : 'bg-muted-foreground/40'"
              :style="lane.color ? { backgroundColor: lane.color } : undefined"
              aria-hidden="true"
            />
            {{ lane.label }}
            <span class="rounded-full bg-muted px-2 text-xs tabular-nums">{{ lane.tasks.length }}</span>
          </h3>
          <div class="space-y-3">
            <TaskCard
              v-for="task in lane.tasks"
              :key="task.id"
              :task="task"
              :claimable="canClaimCard(task)"
              :claiming="claimingId === task.id"
              @claim="claim(task)"
            />
          </div>
        </section>
      </div>

      <!-- Claim without opening the task — the one-handed path the board had,
           inside every card nobody personally holds. -->
      <div v-else class="space-y-3">
        <TaskCard
          v-for="task in shownTasks"
          :key="task.id"
          :task="task"
          :claimable="canClaimCard(task)"
          :claiming="claimingId === task.id"
          @claim="claim(task)"
        />
      </div>

      <Button
        v-if="nextCursor"
        variant="secondary"
        class="min-h-12 w-full"
        :disabled="isLoadingMore"
        @click="loadMore"
      >
        {{ isLoadingMore ? 'Loading…' : `Load more (${tasks.length} of ${totalCount})` }}
      </Button>
      <p v-else-if="tasks.length >= PAGE_SIZE" class="pb-2 text-center text-sm text-muted-foreground">
        That's all {{ totalCount }}.
      </p>
    </template>
  </div>
</template>
