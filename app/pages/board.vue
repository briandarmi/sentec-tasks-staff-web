<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { HandIcon, RefreshCwIcon, SquareKanbanIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import type { Board, BoardColumn, TaskListItem } from '~/utils/clientFakeApi'
import { isClaimable, statusMeta } from '~/utils/task-ui'

definePageMeta({ title: 'Board' })

const api = useTasksApi()
const caps = useCaps()

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

const activeTasks = computed(() => tasks.value.filter(task => task.columnId === activeColumnId.value))

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
        <h2 class="text-lg font-bold tracking-tight">Board</h2>
        <p class="text-xs text-muted-foreground">
          Live workflow for this property. Project tasks are on their project's board, not here.
          <template v-if="totalCount > tasks.length"> Showing {{ tasks.length }} of {{ totalCount }}.</template>
        </p>
      </div>
      <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" @click="load">
        <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !board" class="space-y-3">
      <Skeleton class="h-9 w-full rounded-lg" />
      <Skeleton v-for="n in 3" :key="n" class="h-32 w-full rounded-xl" />
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
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          v-for="column in columns"
          :key="column.id"
          type="button"
          class="flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="column.id === activeColumnId ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
          @click="activeColumnId = column.id"
        >
          <span class="h-2 w-2 rounded-full" :class="column.status ? statusMeta(column.status).dot : 'bg-muted-foreground/40'" />
          {{ column.name }}
          <span class="rounded-full bg-background/70 px-1.5 tabular-nums">{{ countByColumn.get(column.id) ?? 0 }}</span>
        </button>
      </div>

      <div v-if="activeTasks.length" class="space-y-3">
        <div v-for="task in activeTasks" :key="task.id" class="space-y-2">
          <TaskCard :task="task" />
          <Button
            v-if="canClaimCard(task)"
            variant="secondary"
            size="sm"
            class="min-h-11 w-full"
            :disabled="claimingId === task.id"
            :aria-busy="claimingId === task.id"
            @click="claim(task)"
          >
            <HandIcon class="h-4 w-4" />
            {{ claimingId === task.id ? 'Claiming…' : claimLabel(task) }}
          </Button>
        </div>
      </div>
      <p v-else class="select-none py-12 text-center text-sm text-muted-foreground/60">Nothing in this column</p>
    </template>
  </div>
</template>
