<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { HandIcon, RefreshCwIcon, SquareKanbanIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import { useNow } from '~/composables/useNow'
import type { Board, BoardColumn, TaskListItem } from '~/utils/clientFakeApi'
import { isClaimable } from '~/utils/task-ui'
import { compareByHeat, statusSignal } from '~/utils/task-signals'

definePageMeta({ title: 'Board' })

const api = useTasksApi()
const caps = useCaps()
const now = useNow()

const board = ref<(Board & { columns: BoardColumn[] }) | null>(null)
const tasks = ref<TaskListItem[]>([])
const isLoading = ref(false)
const errorMessage = ref('')
const activeColumnId = ref('')
const claimingId = ref('')
const totalCount = ref(0)

const columns = computed(() => board.value?.columns ?? [])

const countByColumn = computed(() => {
  const counts = new Map<string, number>()
  for (const task of tasks.value) {
    if (!task.columnId) continue
    counts.set(task.columnId, (counts.get(task.columnId) ?? 0) + 1)
  }
  return counts
})

/** The column's cards, hottest first: the red ones are why someone opened the board. */
const activeTasks = computed(() =>
  tasks.value
    .filter(task => task.columnId === activeColumnId.value)
    .sort((a, b) => compareByHeat(a, b, now.value)),
)

/**
 * Claimable straight off the card: nothing personal holds it — unassigned, or
 * sitting in a pool (whose membership the server checks on the tap).
 */
function canClaimCard(task: TaskListItem) {
  return caps.canWork.value && isClaimable(task.status) && task.assignment?.kind !== 'STAFF'
}

function claimLabel(task: TaskListItem) {
  const a = task.assignment
  if (a?.kind === 'TEAM') return `Claim from ${a.teamName ?? 'the team'}`
  if (a?.kind === 'DEPARTMENT') return `Claim from ${a.departmentName ?? 'the department'}`
  return 'Claim this'
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    try {
      board.value = await api.getKanbanBoard()
    }
    catch (e) {
      // A property with no provisioned board is a real state, not an error.
      if (!/not found/i.test((e as Error).message)) throw e
      board.value = null
    }
    if (board.value) {
      // The API caps a page at 100; say so when the board is showing a slice.
      const res = await api.listTasks({ limit: 100 })
      tasks.value = res.data
      totalCount.value = res.meta.total
    }
    else {
      tasks.value = []
      totalCount.value = 0
    }
    if (board.value?.columns.length && !board.value.columns.some(column => column.id === activeColumnId.value)) {
      activeColumnId.value = board.value.columns[0]!.id
    }
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

/**
 * Claim straight off the card. This is the one-handed path: see the queue,
 * take the job, keep walking — without opening the task first.
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
    // A 409 here means somebody beat us to it in the seconds since the list
    // rendered. Say that plainly and refresh so the board stops lying.
    errorMessage.value = (e as Error).message
    await load()
  }
  finally {
    claimingId.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-xl font-bold tracking-tight">Board</h2>
        <p class="text-sm text-muted-foreground">
          Live workflow for this property. Project tasks are on their project's board, not here.
          <template v-if="totalCount > tasks.length"> Showing {{ tasks.length }} of {{ totalCount }}.</template>
        </p>
      </div>
      <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" title="Refresh" @click="load">
        <RefreshCwIcon class="size-5" :class="isLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !board" class="space-y-3">
      <Skeleton class="h-11 w-full rounded-full" />
      <Skeleton v-for="n in 3" :key="n" class="h-36 w-full rounded-2xl" />
    </div>

    <EmptyState
      v-else-if="!board"
      :icon="SquareKanbanIcon"
      title="No board for this property"
      description="Boards are provisioned per property during onboarding. Ask an operator to set one up."
    />

    <template v-else>
      <!-- One column at a time on a phone: a horizontal kanban is unusable at
           this width, so the columns become a scrollable selector instead. -->
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Board columns">
        <FilterChip
          v-for="column in columns"
          :key="column.id"
          role="tab"
          :aria-selected="column.id === activeColumnId"
          :active="column.id === activeColumnId"
          :icon="column.status ? statusSignal(column.status).icon : undefined"
          :dot="column.status ? undefined : 'bg-muted-foreground/40'"
          :label="column.name"
          :count="countByColumn.get(column.id) ?? 0"
          @click="activeColumnId = column.id"
        />
      </div>

      <div v-if="activeTasks.length" class="space-y-3">
        <div v-for="task in activeTasks" :key="task.id" class="space-y-2">
          <TaskCard :task="task" />
          <Button
            v-if="canClaimCard(task)"
            variant="secondary"
            class="min-h-11 w-full"
            :disabled="claimingId === task.id"
            :aria-busy="claimingId === task.id"
            @click="claim(task)"
          >
            <HandIcon class="size-5" />
            {{ claimingId === task.id ? 'Claiming…' : claimLabel(task) }}
          </Button>
        </div>
      </div>
      <EmptyState v-else bare title="Nothing in this column" description="Tasks move here as the work moves along." />
    </template>
  </div>
</template>
