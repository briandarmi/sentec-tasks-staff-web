<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckIcon, ChevronRightIcon, ClipboardCheckIcon, ClockAlertIcon, ClockIcon, HandIcon, InboxIcon, PlayIcon, RefreshCwIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import { useNow } from '~/composables/useNow'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { isClaimable, isOpen } from '~/utils/task-ui'
import { HEAT_TONE, compareByHeat, taskHeat } from '~/utils/task-signals'
import type { Heat } from '~/utils/task-signals'

definePageMeta({ title: 'My work' })

const api = useTasksApi()
const session = useSession()
const caps = useCaps()
const now = useNow()

const mine = ref<TaskListItem[]>([])
const queue = ref<TaskListItem[]>([])
/** Pending delegation offers addressed to this user — the inbox badge. */
const offerCount = ref(0)
const isLoading = ref(false)
const errorMessage = ref('')
const tab = ref<'open' | 'queue' | 'done'>('open')

/** Hottest first: the red cards are what someone opening the app came for. */
const byHeat = (rows: TaskListItem[]) => [...rows].sort((a, b) => compareByHeat(a, b, now.value))

const openTasks = computed(() => byHeat(mine.value.filter(task => isOpen(task.status))))
const doneTasks = computed(() => mine.value.filter(task => !isOpen(task.status)))
/** Unclaimed work in the user's own department — what they should pick up next. */
const claimable = computed(() => byHeat(queue.value.filter(task => isOpen(task.status))))

/**
 * The two numbers that decide what to do next, as tappable chips above the
 * list: how many open tasks are red, how many amber. Tapping one narrows the
 * Open tab to that colour; tapping again shows everything.
 */
const lateCount = computed(() => openTasks.value.filter(task => taskHeat(task, now.value) === 'late').length)
const soonCount = computed(() => openTasks.value.filter(task => taskHeat(task, now.value) === 'soon').length)
const focus = ref<Extract<Heat, 'late' | 'soon'> | null>(null)

function toggleFocus(which: 'late' | 'soon') {
  focus.value = focus.value === which ? null : which
  tab.value = 'open'
}

const shown = computed(() => {
  switch (tab.value) {
    case 'queue': return claimable.value
    case 'done': return doneTasks.value
    default: return focus.value ? openTasks.value.filter(task => taskHeat(task, now.value) === focus.value) : openTasks.value
  }
})

const emptyCopy = computed(() => {
  if (tab.value === 'queue') return { icon: HandIcon, title: 'Queue is clear', description: 'No unclaimed work in your department right now.' }
  if (tab.value === 'done') return { icon: ClipboardCheckIcon, title: 'Nothing finished yet', description: 'Tasks you finish or that get verified appear here.' }
  if (focus.value === 'late') return { icon: ClockAlertIcon, title: 'Nothing late', description: 'None of your open tasks is late right now.' }
  if (focus.value === 'soon') return { icon: ClockIcon, title: 'Nothing due soon', description: 'None of your open tasks is due in the next half hour.' }
  return { icon: ClipboardCheckIcon, title: 'Nothing open', description: 'Work assigned to you, or that you claim, shows up here.' }
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    // "Mine" is the real assignedStaffId filter (a plain staff actor is
    // clamped to it server-side anyway). The API has no "unclaimed" filter:
    // the [DR-15] auto-scope already returns own work plus the department's
    // unclaimed queue, so the queue tab filters that result to pool rows.
    const [mineRes, scopedRes, offers] = await Promise.all([
      api.listTasks({ assignedStaffId: session.userId.value ?? undefined, limit: 100 }),
      api.listTasks({ limit: 100 }),
      api.listOffers(),
    ])
    mine.value = mineRes.data
    queue.value = scopedRes.data.filter(task => !task.assignment || task.assignment.kind !== 'STAFF')
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
    <!-- The offers banner rides inside on purpose: it is a demand for an answer,
         and it should not scroll away. `flush`: the tabs are the last row, their
         rail is the block's bottom edge. -->
    <StickyListHeader flush>
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-xl font-bold tracking-tight">
            {{ session.displayName.value ? `Hi, ${session.displayName.value.split(' ')[0]}` : 'My work' }}
          </h2>
          <p class="text-sm text-muted-foreground">Your tasks at {{ session.activeHotel.value?.name ?? 'this property' }}.</p>
        </div>
        <div class="flex items-center gap-1">
          <Button size="icon" variant="ghost" class="relative" aria-label="Offers" title="Offers" @click="navigateTo('/offers')">
            <InboxIcon class="size-5" />
            <span
              v-if="offerCount > 0"
              class="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground"
            >
              {{ offerCount }}
            </span>
          </Button>
          <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" title="Refresh" @click="load">
            <RefreshCwIcon class="size-5" :class="isLoading ? 'animate-spin' : ''" />
          </Button>
        </div>
      </div>

      <!-- The traffic light, counted: red and amber open tasks, as chips that
           narrow the list. Absent when everything is calm. -->
      <div v-if="lateCount || soonCount" class="flex flex-wrap gap-2" aria-label="What needs you">
        <button
          v-if="lateCount"
          type="button"
          class="flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-shadow focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
          :class="[HEAT_TONE.late.band, focus === 'late' ? 'ring-[3px] ring-destructive/30' : '']"
          :aria-pressed="focus === 'late'"
          @click="toggleFocus('late')"
        >
          <ClockAlertIcon class="size-5" aria-hidden="true" />
          {{ lateCount }} {{ lateCount === 1 ? 'needs' : 'need' }} you now
        </button>
        <button
          v-if="soonCount"
          type="button"
          class="flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-shadow focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
          :class="[HEAT_TONE.soon.band, focus === 'soon' ? 'ring-[3px] ring-warning/30' : '']"
          :aria-pressed="focus === 'soon'"
          @click="toggleFocus('soon')"
        >
          <ClockIcon class="size-5" aria-hidden="true" />
          {{ soonCount }} due soon
        </button>
      </div>

      <!-- Offers demand an answer — the sender is waiting on it. A badge on an
           icon is easy to walk past; a banner is not. -->
      <NuxtLink
        v-if="offerCount > 0"
        to="/offers"
        class="flex min-h-12 items-center gap-3 rounded-xl border border-primary/30 bg-primary-tint/60 px-4 py-3 transition-colors active:bg-primary-tint focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
      >
        <InboxIcon class="size-5 shrink-0 text-primary-tint-foreground" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {{ offerCount === 1 ? 'A colleague wants to hand you a task' : `${offerCount} colleagues want to hand you tasks` }}
        </span>
        <span class="flex shrink-0 items-center gap-0.5 text-sm font-bold text-primary-tint-foreground">
          Review <ChevronRightIcon class="size-4" aria-hidden="true" />
        </span>
      </NuxtLink>

      <Tabs v-model="tab">
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="open" class="min-h-11 px-2">
            <PlayIcon aria-hidden="true" /> Open ({{ openTasks.length }})
          </TabsTrigger>
          <TabsTrigger value="queue" class="min-h-11 px-2">
            <HandIcon aria-hidden="true" /> To claim ({{ claimable.length }})
          </TabsTrigger>
          <TabsTrigger value="done" class="min-h-11 px-2">
            <CheckIcon aria-hidden="true" /> Done ({{ doneTasks.length }})
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </StickyListHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !mine.length && !queue.length" class="space-y-3">
      <Skeleton v-for="n in 3" :key="n" class="h-36 w-full rounded-2xl" />
    </div>

    <template v-else>
      <EmptyState
        v-if="shown.length === 0"
        :icon="emptyCopy.icon"
        :title="emptyCopy.title"
        :description="emptyCopy.description"
      >
        <Button v-if="focus && tab === 'open'" variant="secondary" class="min-h-11" @click="focus = null">Show every open task</Button>
      </EmptyState>

      <!-- Claim without opening the task — the one-handed path, inside the
           card, on the queue where the work actually gets picked up. -->
      <div v-else class="space-y-3">
        <TaskCard
          v-for="task in shown"
          :key="task.id"
          :task="task"
          :mine="tab !== 'queue'"
          :claimable="tab === 'queue' && canClaimCard(task)"
          :claiming="claimingId === task.id"
          @claim="claim(task)"
        />
      </div>
    </template>
  </div>
</template>
