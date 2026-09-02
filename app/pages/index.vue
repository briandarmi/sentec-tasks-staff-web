<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ChevronRightIcon, ClipboardCheckIcon, HandIcon, InboxIcon, RefreshCwIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { isClaimable, isOpen } from '~/utils/task-ui'

definePageMeta({ title: 'My work' })

const api = useTasksApi()
const session = useSession()
const caps = useCaps()

const mine = ref<TaskListItem[]>([])
const queue = ref<TaskListItem[]>([])
/** Pending delegation offers addressed to this user — the inbox badge. */
const offerCount = ref(0)
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
    const [mineRes, queueRes, offers] = await Promise.all([
      api.listTasks({ scope: 'mine', limit: 100 }),
      api.listTasks({ scope: 'unclaimed', limit: 100 }),
      api.listOffers(),
    ])
    mine.value = mineRes.data
    queue.value = queueRes.data
    offerCount.value = offers.length
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

// ── claim straight off the queue ──────────────────────────────────────────────

const claimingId = ref('')

/** Same rule as the board: nothing personal holds it, and the status allows it. */
function canClaimCard(task: TaskListItem) {
  return caps.canWork.value && isClaimable(task.status) && task.assignment?.kind !== 'STAFF'
}

function claimLabel(task: TaskListItem) {
  const a = task.assignment
  if (a?.kind === 'TEAM') return `Claim from ${a.team?.name ?? 'the team'}`
  if (a?.kind === 'DEPARTMENT') return `Claim from ${a.department?.name ?? 'the department'}`
  return 'Claim this'
}

/**
 * The one-handed path: see the queue, take the job, keep walking — without
 * opening the task first. A 409 means somebody was faster; the reload makes
 * the queue stop lying either way.
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
      <div class="flex items-center gap-1">
        <Button size="icon" variant="ghost" class="relative" aria-label="Offers" @click="navigateTo('/offers')">
          <InboxIcon class="h-4 w-4" />
          <span
            v-if="offerCount > 0"
            class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground"
          >
            {{ offerCount }}
          </span>
        </Button>
        <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" @click="load">
          <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
        </Button>
      </div>
    </div>

    <!-- Offers demand an answer — the sender is waiting on it. A badge on an
         icon is easy to walk past; a banner is not. -->
    <NuxtLink
      v-if="offerCount > 0"
      to="/offers"
      class="flex min-h-11 items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-3 transition-colors active:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <InboxIcon class="h-4 w-4 shrink-0 text-primary" />
      <span class="min-w-0 flex-1 text-sm font-medium text-foreground">
        {{ offerCount === 1 ? 'A colleague wants to hand you a task' : `${offerCount} colleagues want to hand you tasks` }}
      </span>
      <span class="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary">
        Review <ChevronRightIcon class="h-3.5 w-3.5" />
      </span>
    </NuxtLink>

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
        <div v-for="task in shown" :key="task.id" class="space-y-2">
          <TaskCard :task="task" :mine="tab !== 'queue'" />
          <!-- Claim without opening the task — the board's one-handed path,
               here on the queue where the work actually gets picked up. -->
          <Button
            v-if="tab === 'queue' && canClaimCard(task)"
            variant="outline"
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
    </template>
  </div>
</template>
