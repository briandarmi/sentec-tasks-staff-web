<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FilterXIcon, LayoutListIcon, RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Department, TaskListItem } from '~/utils/clientFakeApi'

definePageMeta({ title: 'Tasks' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()

/**
 * Filters live in the URL, not in component state.
 *
 * That makes a filtered view shareable ("look at the breached ones") and makes
 * it survive a refresh or a back-navigation from a task detail — which is the
 * common path, and losing the filter every time was the annoyance this fixes.
 */
const search = ref(String(route.query.q ?? ''))
const status = computed(() => String(route.query.status ?? ''))
const scope = computed(() => String(route.query.scope ?? ''))
const departmentId = computed(() => String(route.query.dept ?? ''))

const tasks = ref<TaskListItem[]>([])
const departments = ref<Department[]>([])
const totalCount = ref(0)
const nextCursor = ref<string | null>(null)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const errorMessage = ref('')

const PAGE_SIZE = 20

const hasFilters = computed(() => Boolean(status.value || scope.value || departmentId.value || search.value.trim()))

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

function currentQuery() {
  return {
    status: status.value,
    scope: scope.value as '' | 'mine' | 'unclaimed' | 'breached' | 'helping',
    departmentId: departmentId.value,
    q: search.value.trim(),
    limit: PAGE_SIZE,
  }
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const res = await api.listTasks(currentQuery())
    tasks.value = res.data
    totalCount.value = res.meta.totalCount
    nextCursor.value = res.meta.nextCursor
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
    tasks.value = [...tasks.value, ...res.data]
    nextCursor.value = res.meta.nextCursor
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoadingMore.value = false
  }
}

async function loadDepartments() {
  try {
    departments.value = await api.listDepartments()
  }
  catch {
    // Staff can read departments, but a failure here only costs the filter.
    departments.value = []
  }
}

// Debounce typing so each keystroke does not become a request.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setFilter('q', value.trim()), 250)
})

// One watcher drives loading: any URL change reloads from the first page.
watch(() => route.query, load, { immediate: true, deep: true })

onMounted(loadDepartments)

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'IN_PROGRESS', label: 'Active' },
  // Leaders read this as their review queue; staff as "waiting on review".
  { value: 'SUBMITTED', label: 'In review' },
  { value: 'FINISHED,VERIFIED', label: 'Closed' },
]

const SCOPE_TABS = [
  { value: 'unclaimed', label: 'To claim' },
  { value: 'mine', label: 'Mine' },
  { value: 'helping', label: 'Helping' },
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
      <Input v-model="search" placeholder="Search title, location, reference…" class="pl-9" />
    </div>

    <!-- Status tabs; horizontally scrollable so they never wrap on a phone. -->
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

    <div v-if="departments.length > 1" class="flex items-center gap-2">
      <Select
        :model-value="toSelectValue(departmentId)"
        @update:model-value="value => setFilter('dept', fromSelectValue(value))"
      >
        <SelectTrigger class="w-full">
          <SelectValue placeholder="All departments" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="SELECT_EMPTY">All departments</SelectItem>
          <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.name }}</SelectItem>
        </SelectContent>
      </Select>
      <Button
        v-if="hasFilters"
        variant="outline"
        size="icon"
        aria-label="Clear filters"
        title="Clear filters"
        @click="clearFilters"
      >
        <FilterXIcon class="h-4 w-4" />
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
      v-else-if="tasks.length === 0"
      :icon="LayoutListIcon"
      title="No tasks match"
      :description="hasFilters ? 'Try clearing a filter or a different search.' : 'Nothing to show at this property yet.'"
    >
      <Button v-if="hasFilters" variant="outline" size="sm" @click="clearFilters">Clear filters</Button>
    </EmptyState>

    <template v-else>
      <div class="space-y-3">
        <TaskCard v-for="task in tasks" :key="task.id" :task="task" />
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
