<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FilterXIcon, LayersIcon, LayoutListIcon, RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { useTasksApi, type TaskQuery } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import { useSourceApps } from '~/composables/useSourceApps'
import { useNow } from '~/composables/useNow'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { groupIntoLanes } from '~/utils/source-lanes'

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
 * Every chip maps to a REAL list parameter (status, assignedStaffId,
 * helping=1, responseSlaStatus/resolutionSlaStatus). The two exceptions are
 * labeled where they happen: "To claim" narrows the fetched page to pool rows
 * client-side (the API's staff auto-scope already returns own + unclaimed
 * work, but has no unclaimed-only parameter), and the search box filters the
 * loaded page only — the API has no free-text search. The queue chips also
 * carry the server's total for their filter (see `refreshCounts`).
 */
const search = ref(String(route.query.q ?? ''))
const status = computed(() => String(route.query.status ?? ''))
const scope = computed(() => String(route.query.scope ?? ''))

const tasks = ref<TaskListItem[]>([])
const totalCount = ref(0)
const nextCursor = ref<string | null>(null)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const errorMessage = ref('')

const PAGE_SIZE = 20

const hasFilters = computed(() => Boolean(status.value || scope.value || search.value.trim()))

/** Write one filter into the URL, dropping the cursor so paging restarts. */
function setFilter(key: string, value: string) {
  const query = { ...route.query }
  if (value) query[key] = value
  else delete query[key]
  router.replace({ query })
}

function clearFilters() {
  search.value = ''
  router.replace({ query: {} })
}

function currentQuery(): TaskQuery {
  const query: TaskQuery = { limit: PAGE_SIZE }
  if (status.value) query.status = status.value as TaskQuery['status']
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
 * Server totals on the chips that people use as queues — "Mine", "Helping",
 * and for leaders "In review" — one `limit=1` list call each, read for
 * `meta.total` only. Fire-and-forget: a slow or failed count never delays the
 * list, the chip just shows its plain label until (or unless) the number lands.
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

function refreshCounts() {
  const userId = session.userId.value
  if (userId) {
    void fetchCount('mine', { assignedStaffId: userId })
    void fetchCount('helping', { helping: '1' })
  }
  // Leaders read "In review" as their own queue; for staff it is just a status.
  if (caps.isLeader.value) void fetchCount('SUBMITTED', { status: 'SUBMITTED' })
}

function withCount(label: string, key?: string) {
  const n = key ? counts.value[key] : null
  return typeof n === 'number' ? `${label} (${n})` : label
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

// The search box filters the LOADED rows — the API has no q parameter. Kept in
// the URL anyway so a shared link carries it.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setFilter('q', value.trim()), 250)
})

const shownTasks = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return tasks.value
  return tasks.value.filter(t =>
    t.title.toLowerCase().includes(query)
    || (t.roomNumber ?? '').toLowerCase().includes(query)
    || (t.description ?? '').toLowerCase().includes(query)
    || t.id.startsWith(query),
  )
})

/**
 * "Group by source" rearranges the loaded rows into one lane per originating
 * app, most urgent lane first — a display toggle, not a filter, so it stays
 * client state and never enters the URL. Hidden when the registry failed to
 * load: grouping without names would produce a single "Other" lane.
 */
const groupBySource = ref(false)
const canGroupBySource = computed(() => sourceApps.status.value !== 'failed')
const now = useNow()
const lanes = computed(() => groupIntoLanes(shownTasks.value, sourceApps.byCode.value, now.value))

// One watcher drives loading: any server-filter change reloads from page one.
watch(() => [route.query.status, route.query.scope], load, { immediate: true })

interface Chip { value: string, label: string, countKey?: string }

const STATUS_TABS: Chip[] = [
  { value: '', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'IN_PROGRESS', label: 'Active' },
  // Leaders read this as their review queue; staff as "waiting on review".
  { value: 'SUBMITTED', label: 'In review', countKey: 'SUBMITTED' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'VERIFIED', label: 'Verified' },
]

/**
 * What the list covers, in the viewer's terms — the [DR-15] rule as of
 * feat/projects. Behaviour is server-side; this only describes it.
 */
const scopeDescription = computed(() => {
  if (caps.isLeader.value) return 'Every task at this property. Project tasks are not listed here — open them under Mine, Helping or in the project itself.'
  return 'Tasks you claimed; unclaimed tasks in your department; unclaimed tasks with no department anywhere at the property; your teams\' pools; tasks with a step handed to you (read-only); and every task of your projects. Project tasks are not listed here — open them under Mine, Helping or in the project.'
})

const SCOPE_TABS: Chip[] = [
  { value: 'unclaimed', label: 'To claim' },
  { value: 'mine', label: 'Mine', countKey: 'mine' },
  { value: 'helping', label: 'Helping', countKey: 'helping' },
  { value: 'late-response', label: 'Late response' },
  { value: 'breached', label: 'Breached' },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-lg font-bold tracking-tight">Tasks</h2>
        <p class="text-xs text-muted-foreground">
          {{ totalCount }} {{ totalCount === 1 ? 'task' : 'tasks' }} you can see here.
        </p>
        <details class="text-xs text-muted-foreground">
          <summary class="min-h-6 cursor-pointer select-none font-medium text-primary">What shows here</summary>
          <p class="mt-1 leading-relaxed">{{ scopeDescription }}</p>
        </details>
      </div>
      <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" @click="load">
        <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <div class="relative">
      <SearchIcon class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="search" placeholder="Filter the loaded tasks…" class="pl-9" />
    </div>

    <!-- Status + scope chips; horizontally scrollable so they never wrap. -->
    <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <button
        v-for="tab in STATUS_TABS"
        :key="tab.value"
        type="button"
        class="min-h-9 shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="status === tab.value ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
        @click="setFilter('status', tab.value)"
      >
        {{ withCount(tab.label, tab.countKey) }}
      </button>
      <span class="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
      <button
        v-for="s in SCOPE_TABS"
        :key="s.value"
        type="button"
        class="min-h-9 shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="scope === s.value ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
        @click="setFilter('scope', scope === s.value ? '' : s.value)"
      >
        {{ withCount(s.label, s.countKey) }}
      </button>
    </div>

    <div v-if="canGroupBySource || hasFilters" class="flex items-center justify-between gap-2">
      <!-- A switch, not a chip: it rearranges the rows below, it does not
           narrow them, so it lives outside the filter strip. -->
      <button
        v-if="canGroupBySource"
        type="button"
        role="switch"
        :aria-checked="groupBySource"
        class="flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="groupBySource ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
        @click="groupBySource = !groupBySource"
      >
        <LayersIcon class="h-3.5 w-3.5" /> Group by source
      </button>
      <span v-else />
      <Button v-if="hasFilters" variant="outline" size="sm" @click="clearFilters">
        <FilterXIcon class="h-4 w-4" /> Clear filters
      </Button>
    </div>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && tasks.length === 0" class="space-y-3">
      <Skeleton v-for="n in 4" :key="n" class="h-32 w-full rounded-xl" />
    </div>

    <EmptyState
      v-else-if="shownTasks.length === 0"
      :icon="LayoutListIcon"
      title="No tasks match"
      :description="hasFilters ? 'Try clearing a filter or a different search.' : caps.isLeader.value ? 'Nothing to show at this property yet. Project tasks live in their projects.' : 'Nothing you can see at this property right now: your claimed work, your department\'s and the property\'s unclaimed tasks, your team pools, steps handed to you, and your projects\' tasks (those show in the project).'"
    >
      <Button v-if="hasFilters" variant="outline" size="sm" @click="clearFilters">Clear filters</Button>
    </EmptyState>

    <template v-else>
      <!-- Lanes: the same cards, re-partitioned by originating app with the
           lane holding a fire on top. The square is the registry's colour —
           data, not a theme token; the Other lane has none. -->
      <div v-if="groupBySource" class="space-y-5">
        <section v-for="lane in lanes" :key="lane.key" class="space-y-2">
          <h3 class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-sm"
              :class="lane.color ? '' : 'bg-muted-foreground/40'"
              :style="lane.color ? { backgroundColor: lane.color } : undefined"
              aria-hidden="true"
            />
            {{ lane.label }}
            <span class="rounded-full bg-muted px-1.5 tabular-nums">{{ lane.tasks.length }}</span>
          </h3>
          <div class="space-y-3">
            <TaskCard v-for="task in lane.tasks" :key="task.id" :task="task" />
          </div>
        </section>
      </div>

      <div v-else class="space-y-3">
        <TaskCard v-for="task in shownTasks" :key="task.id" :task="task" />
      </div>

      <Button
        v-if="nextCursor"
        variant="outline"
        class="w-full"
        :disabled="isLoadingMore"
        @click="loadMore"
      >
        {{ isLoadingMore ? 'Loading…' : `Load more (${tasks.length} of ${totalCount})` }}
      </Button>
      <p v-else-if="tasks.length >= PAGE_SIZE" class="pb-2 text-center text-xs text-muted-foreground">
        That's all {{ totalCount }}.
      </p>
    </template>
  </div>
</template>
