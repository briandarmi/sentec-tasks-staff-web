<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Component } from 'vue'
import { ClockAlertIcon, FilterXIcon, HandIcon, LayersIcon, LayoutListIcon, RefreshCwIcon, SearchIcon, UserRoundIcon, UsersIcon } from '@lucide/vue'
import { useTasksApi, type TaskQuery } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import { useSourceApps } from '~/composables/useSourceApps'
import { useNow } from '~/composables/useNow'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { groupIntoLanes } from '~/utils/source-lanes'
import { STATUS_SIGNAL, compareByHeat } from '~/utils/task-signals'

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

// The search box filters the LOADED rows — the API has no q parameter. Kept in
// the URL anyway so a shared link carries it.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setFilter('q', value.trim()), 250)
})

const now = useNow()

/**
 * The loaded rows, hottest first. The server orders by creation; on a phone
 * the red cards are what the reader came for, so they float to the top of
 * whatever page is loaded (a display order, never a filter).
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
  return [...rows].sort((a, b) => compareByHeat(a, b, now.value))
})

/**
 * "Group by source" rearranges the loaded rows into one lane per originating
 * app, most urgent lane first — a display toggle, not a filter, so it stays
 * client state and never enters the URL. Hidden when the registry failed to
 * load: grouping without names would produce a single "Other" lane.
 */
const groupBySource = ref(false)
const canGroupBySource = computed(() => sourceApps.status.value !== 'failed')
const lanes = computed(() => groupIntoLanes(shownTasks.value, sourceApps.byCode.value, now.value))

// One watcher drives loading: any server-filter change reloads from page one.
watch(() => [route.query.status, route.query.scope], load, { immediate: true })

interface Chip { value: string, label: string, icon: Component, countKey?: string }

/** Each status chip wears the same icon as its pill, so the two always match. */
const STATUS_TABS: Chip[] = [
  { value: '', label: 'All', icon: LayoutListIcon },
  { value: 'NEW', label: STATUS_SIGNAL.NEW.label, icon: STATUS_SIGNAL.NEW.icon },
  { value: 'IN_PROGRESS', label: STATUS_SIGNAL.IN_PROGRESS.label, icon: STATUS_SIGNAL.IN_PROGRESS.icon },
  // Leaders read this as their review queue; staff as "waiting on review".
  { value: 'SUBMITTED', label: STATUS_SIGNAL.SUBMITTED.label, icon: STATUS_SIGNAL.SUBMITTED.icon, countKey: 'SUBMITTED' },
  { value: 'FINISHED', label: STATUS_SIGNAL.FINISHED.label, icon: STATUS_SIGNAL.FINISHED.icon },
  { value: 'VERIFIED', label: STATUS_SIGNAL.VERIFIED.label, icon: STATUS_SIGNAL.VERIFIED.icon },
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
  { value: 'unclaimed', label: 'To claim', icon: HandIcon },
  { value: 'mine', label: 'Mine', icon: UserRoundIcon, countKey: 'mine' },
  { value: 'helping', label: 'Helping', icon: UsersIcon, countKey: 'helping' },
  // The two SLA clocks, by their plain names: "Picked up late" is a missed
  // response target, "Late" a missed resolution target.
  { value: 'late-response', label: 'Picked up late', icon: ClockAlertIcon },
  { value: 'breached', label: 'Late', icon: ClockAlertIcon },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-xl font-bold tracking-tight">Tasks</h2>
        <p class="text-sm text-muted-foreground">
          {{ totalCount }} {{ totalCount === 1 ? 'task' : 'tasks' }} you can see here.
        </p>
        <details class="text-sm text-muted-foreground">
          <summary class="min-h-8 cursor-pointer select-none font-semibold text-primary-tint-foreground">What shows here</summary>
          <p class="mt-1 leading-relaxed">{{ scopeDescription }}</p>
        </details>
      </div>
      <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" title="Refresh" @click="load">
        <RefreshCwIcon class="size-5" :class="isLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <div class="relative">
      <SearchIcon class="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input v-model="search" placeholder="Search room or title" aria-label="Search the loaded tasks" class="h-12 rounded-xl pl-11 text-base" />
    </div>

    <!-- Status + scope chips; horizontally scrollable so they never wrap. -->
    <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <FilterChip
        v-for="tab in STATUS_TABS"
        :key="tab.value"
        :active="status === tab.value"
        :aria-pressed="status === tab.value"
        :icon="tab.icon"
        :label="tab.label"
        :count="countFor(tab.countKey)"
        @click="setFilter('status', tab.value)"
      />
      <span class="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
      <FilterChip
        v-for="s in SCOPE_TABS"
        :key="s.value"
        :active="scope === s.value"
        :aria-pressed="scope === s.value"
        :icon="s.icon"
        :label="s.label"
        :count="countFor(s.countKey)"
        @click="setFilter('scope', scope === s.value ? '' : s.value)"
      />
    </div>

    <div v-if="canGroupBySource || hasFilters" class="flex items-center justify-between gap-2">
      <!-- A switch, not a chip: it rearranges the rows below, it does not
           narrow them, so it lives outside the filter strip. -->
      <FilterChip
        v-if="canGroupBySource"
        role="switch"
        :aria-checked="groupBySource"
        :active="groupBySource"
        :icon="LayersIcon"
        label="Group by source"
        @click="groupBySource = !groupBySource"
      />
      <span v-else />
      <Button v-if="hasFilters" variant="secondary" class="min-h-11" @click="clearFilters">
        <FilterXIcon class="size-5" /> Clear filters
      </Button>
    </div>

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
      title="No tasks match"
      :description="hasFilters ? 'Try clearing a filter or a different search.' : caps.isLeader.value ? 'Nothing to show at this property yet. Project tasks live in their projects.' : 'Nothing you can see at this property right now: your claimed work, your department\'s and the property\'s unclaimed tasks, your team pools, steps handed to you, and your projects\' tasks (those show in the project).'"
    >
      <Button v-if="hasFilters" variant="secondary" class="min-h-11" @click="clearFilters">
        <FilterXIcon class="size-5" /> Clear filters
      </Button>
    </EmptyState>

    <template v-else>
      <!-- Lanes: the same cards, re-partitioned by originating app with the
           lane holding a fire on top. The square is the registry's colour —
           data, not a theme token; the Other lane has none. -->
      <div v-if="groupBySource" class="space-y-5">
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
            <TaskCard v-for="task in lane.tasks" :key="task.id" :task="task" />
          </div>
        </section>
      </div>

      <div v-else class="space-y-3">
        <TaskCard v-for="task in shownTasks" :key="task.id" :task="task" />
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
