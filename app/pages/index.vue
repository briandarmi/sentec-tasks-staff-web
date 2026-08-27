<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ClipboardCheckIcon, HandIcon, RefreshCwIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { isOpen } from '~/utils/task-ui'

definePageMeta({ title: 'My work' })

const api = useTasksApi()
const session = useSession()

const mine = ref<TaskListItem[]>([])
const queue = ref<TaskListItem[]>([])
const isLoading = ref(false)
const errorMessage = ref('')
const tab = ref<'open' | 'queue' | 'done'>('open')

const openTasks = computed(() => mine.value.filter(task => isOpen(task.status)))
const doneTasks = computed(() => mine.value.filter(task => !isOpen(task.status)))
/** Unclaimed work in the user's own department — what they should pick up next. */
const claimable = computed(() => queue.value.filter(task => isOpen(task.status)))

const shown = computed(() => {
  switch (tab.value) {
    case 'queue': return claimable.value
    case 'done': return doneTasks.value
    default: return openTasks.value
  }
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    // Two scoped calls rather than one broad fetch filtered on the client: the
    // server decides what this user may see, so asking narrowly keeps the two
    // lists honest even as the visibility rules change.
    const [mineRes, queueRes] = await Promise.all([
      api.listTasks({ scope: 'mine', limit: 100 }),
      api.listTasks({ scope: 'unclaimed', limit: 100 }),
    ])
    mine.value = mineRes.data
    queue.value = queueRes.data
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-lg font-bold tracking-tight">
          {{ session.displayName.value ? `Hi, ${session.displayName.value.split(' ')[0]}` : 'My work' }}
        </h2>
        <p class="text-xs text-muted-foreground">Your tasks at {{ session.activeTenant.value?.name ?? 'this property' }}.</p>
      </div>
      <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" @click="load">
        <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <Tabs v-model="tab">
      <TabsList class="grid w-full grid-cols-3">
        <TabsTrigger value="open">Open ({{ openTasks.length }})</TabsTrigger>
        <TabsTrigger value="queue">To claim ({{ claimable.length }})</TabsTrigger>
        <TabsTrigger value="done">Done ({{ doneTasks.length }})</TabsTrigger>
      </TabsList>
    </Tabs>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !mine.length && !queue.length" class="space-y-3">
      <Skeleton v-for="n in 3" :key="n" class="h-32 w-full rounded-xl" />
    </div>

    <template v-else>
      <EmptyState
        v-if="shown.length === 0"
        :icon="tab === 'queue' ? HandIcon : ClipboardCheckIcon"
        :title="tab === 'open' ? 'Nothing open' : tab === 'queue' ? 'Queue is clear' : 'Nothing finished yet'"
        :description="tab === 'open'
          ? 'Work assigned to you, or that you claim, shows up here.'
          : tab === 'queue'
            ? 'No unclaimed work in your department right now.'
            : 'Tasks you finish or that get verified appear here.'"
      />

      <div v-else class="space-y-3">
        <TaskCard
          v-for="task in shown"
          :key="task.id"
          :task="task"
          :mine="tab !== 'queue'"
        />
      </div>
    </template>
  </div>
</template>
