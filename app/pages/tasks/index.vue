<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FilterXIcon, LayoutListIcon, RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { useTasksApi, type TaskQuery } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { TaskListItem } from '~/utils/clientFakeApi'

definePageMeta({ title: 'Tasks' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()
const session = useSession()

/**
 * Filters live in the URL, not in component state — a filtered view is
 * shareable and survives a refresh or back-navigation from a task detail.
 *
 * Every chip maps to a REAL list parameter (status, assignedStaffId,
 * helping=1, responseSlaStatus/resolutionSlaStatus). The two exceptions are
 * labeled where they happen: "To claim" narrows the fetched page to pool rows
 * client-side (the API's staff auto-scope already returns own + unclaimed
 * work, but has no unclaimed-only parameter), and the search box filters the
 * loaded page only — the API has no free-text search.
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

async function load() {
  isLoading.value = true
  errorMessage.value = ''
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

// One watcher drives loading: any server-filter change reloads from page one.
watch(() => [route.query.status, route.query.scope], load, { immediate: true })

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'IN_PROGRESS', label: 'Active' },
  // Leaders read this as their review queue; staff as "waiting on review".
  { value: 'SUBMITTED', label: 'In review' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'VERIFIED', label: 'Verified' },
]

const SCOPE_TABS = [
  { value: 'unclaimed', label: 'To claim' },
  { value: 'mine', label: 'Mine' },
  { value: 'helping', label: 'Helping' },
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
        {{ tab.label }}
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
        {{ s.label }}
      </button>
    </div>

    <div v-if="hasFilters" class="flex justify-end">
      <Button variant="outline" size="sm" @click="clearFilters">
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
      :description="hasFilters ? 'Try clearing a filter or a different search.' : 'Nothing to show at this property yet.'"
    >
      <Button v-if="hasFilters" variant="outline" size="sm" @click="clearFilters">Clear filters</Button>
    </EmptyState>

    <template v-else>
      <div class="space-y-3">
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
