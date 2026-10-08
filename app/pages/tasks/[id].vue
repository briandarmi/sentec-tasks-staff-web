<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  FolderKanbanIcon,
  HandIcon,
  InfoIcon,
  MapPinIcon,
  RepeatIcon,
  RotateCcwIcon,
  SendIcon,
  UserRoundIcon,
  UserRoundPlusIcon,
} from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import { useSourceApps } from '~/composables/useSourceApps'
import { useNow } from '~/composables/useNow'
import type { BoardColumn, ProjectLevel, TaskDetail } from '~/utils/clientFakeApi'
import { displayName, formatDateTime, initials, isClaimable, relativeTime, taskRef } from '~/utils/task-ui'
import { CLOCK_WORDS, taskHeat, taskSignals } from '~/utils/task-signals'

definePageMeta({ title: 'Task' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()
const session = useSession()
const caps = useCaps()
const sourceApps = useSourceApps()
const now = useNow()

const id = computed(() => String(route.params.id))
const task = ref<TaskDetail | null>(null)
/** The traffic light and its reasons: the banner at the top, the chips in the header. */
const heat = computed(() => (task.value ? taskHeat(task.value, now.value) : 'none'))
const signals = computed(() => (task.value ? taskSignals(task.value, now.value) : []))
const reasons = computed(() => signals.value.filter(signal => signal.kind === 'escalation' || signal.kind === 'priority'))
const columns = ref<BoardColumn[]>([])
const isLoading = ref(false)
const errorMessage = ref('')
/** Set when the task itself cannot be shown at all (404), not a failed action. */
const loadFailed = ref(false)
/**
 * A child's post-success refetch failing is NOT a page failure — the action
 * already landed and the task is fully rendered, so this shows as a small
 * notice instead of replacing the view.
 */
const refreshError = ref('')
const acting = ref(false)
const moveOpen = ref(false)
const assignOpen = ref(false)
const comment = ref('')

const assignment = computed(() => task.value?.assignment ?? null)
const isMine = computed(() => assignment.value?.kind === 'STAFF' && assignment.value.staffId === session.userId.value)
const isHelper = computed(() => Boolean(task.value?.collaborators?.some(c => c.staffId === session.userId.value)))
const heldBySomeoneElse = computed(() => assignment.value?.kind === 'STAFF' && !isMine.value)

/**
 * The viewer's standing in the task's project (feat/projects). Fetched only
 * when the task carries a project: the manager passes every leader check on
 * its tasks (assign, move, helpers, checklist), members may comment, viewers
 * may not. `null` for a non-member admin and when the read is refused.
 */
const projectLevel = ref<ProjectLevel | null>(null)
const isProjectManager = computed(() => projectLevel.value === 'MANAGER')
/** Comments are for members and managers; a viewer follows the work and does not write on it. */
const canComment = computed(() => !(task.value?.project && projectLevel.value === 'VIEWER'))
/** Leader rights on THIS task: the property's leaders and admins, plus the project's manager. */
const leadsThisTask = computed(() => caps.isLeader.value || isProjectManager.value)
/** Just created with Repeat on: say where the schedule lives, once. */
const repeatsNotice = computed(() => route.query.repeats === '1')
/** The pool this task sits in, when it does — what the Claim button names. */
const poolName = computed(() => {
  const a = assignment.value
  if (!a || a.kind === 'STAFF') return null
  return a.kind === 'TEAM' ? a.teamName ?? 'a team' : a.departmentName ?? 'a department'
})

const sourceBadge = computed(() => {
  if (!task.value || task.value.sourceProduct === 'sentec-tasks') return null
  return sourceApps.badge(task.value.sourceProduct)
})
/** The originating app by its full registry name — every task has one, this app included. */
const createdBy = computed(() => (task.value ? sourceApps.nameOf(task.value.sourceProduct) : null))

/**
 * Claim is offered when nobody personally holds the task: unassigned, or
 * sitting in a pool (whose membership the server checks — a non-member gets
 * the real 403 naming the pool). A person's assignment is never stolen via
 * Claim; hand-over is an explicit Assign.
 */
const canClaim = computed(() => Boolean(
  task.value
  && caps.canWork.value
  && isClaimable(task.value.status)
  && assignment.value?.kind !== 'STAFF',
))
const claimLabel = computed(() => (poolName.value ? `Claim from ${poolName.value}` : 'Claim'))

/** Return goes back to the pool with a reason: holder only, open work only. */
const canReturn = computed(() => Boolean(
  task.value && isMine.value && (task.value.status === 'NEW' || task.value.status === 'IN_PROGRESS'),
))
const returnOpen = ref(false)
const returnReason = ref('')
const isReturning = ref(false)
const returnError = ref('')

/**
 * The move sheet mirrors the API's guards: NEW is unreachable (that is what
 * return-to-pool is for), SUBMITTED is only reachable through submission,
 * VERIFIED is leader sign-off — and a SUBMITTED task is frozen for staff and
 * offers only park/cancel to leaders (review is the deciding action).
 */
const moveColumns = computed(() => columns.value.filter((column) => {
  if (!column.status || column.status === 'NEW' || column.status === 'SUBMITTED') return false
  if (column.status === 'VERIFIED' && !leadsThisTask.value) return false
  if (task.value?.status === 'SUBMITTED' && !['PENDING', 'CANCELLED'].includes(column.status)) return false
  return true
}))
const canMove = computed(() => Boolean(
  task.value
  && moveColumns.value.length
  && (leadsThisTask.value || (isMine.value && task.value.status !== 'SUBMITTED')),
))
/** Assign is a leader action — and the project manager's, on the project's tasks. */
const canAssign = computed(() => caps.canAssign.value || (isProjectManager.value && caps.canWork.value))

/** Helper changes close with the task — but SUBMITTED still takes them. */
const HELPER_CLOSED = new Set(['FINISHED', 'VERIFIED', 'CANCELLED'])
const canManageHelpers = computed(() => Boolean(
  task.value && !HELPER_CLOSED.has(task.value.status) && (isMine.value || leadsThisTask.value),
))

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    task.value = await api.getTask(id.value)
    void sourceApps.ensureLoaded()
    void loadProjectLevel()
    try {
      columns.value = (await api.getKanbanBoard()).columns
    }
    catch {
      // A property without a provisioned board still shows the task, just with
      // no move action.
      columns.value = []
    }
  }
  catch (e) {
    errorMessage.value = (e as Error).message
    loadFailed.value = true
  }
  finally {
    isLoading.value = false
  }
}

/** The project's own read carries `myLevel`; a refusal just means no project rights here. */
async function loadProjectLevel() {
  const projectId = task.value?.project?.id
  if (!projectId) {
    projectLevel.value = null
    return
  }
  try {
    projectLevel.value = (await api.getProject(projectId)).myLevel ?? null
  }
  catch {
    projectLevel.value = null
  }
}

/** Run a mutation, then refetch so the timeline and SLA state stay truthful. */
async function act(fn: () => Promise<unknown>) {
  if (acting.value) return
  acting.value = true
  errorMessage.value = ''
  try {
    await fn()
    task.value = await api.getTask(id.value)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    acting.value = false
  }
}

function claim() {
  return act(() => api.claimTask(id.value))
}

function move(payload: { columnId: string, description: string | null }) {
  return act(async () => {
    await api.moveTask({ taskId: id.value, ...payload })
    moveOpen.value = false
  })
}

function assign(payload: { staffId: string, remark: string | null }) {
  return act(async () => {
    await api.assignTask({ taskId: id.value, ...payload })
    assignOpen.value = false
  })
}

async function returnToPool() {
  const reason = returnReason.value.trim()
  if (!reason || isReturning.value) return
  isReturning.value = true
  returnError.value = ''
  try {
    task.value = await api.returnTask(id.value, reason)
    // Only success closes the dialog — a failure must not eat the typed reason.
    returnOpen.value = false
    returnReason.value = ''
  }
  catch (e) {
    returnError.value = (e as Error).message
  }
  finally {
    isReturning.value = false
  }
}

function sendComment() {
  const text = comment.value.trim()
  if (!text) return
  return act(async () => {
    await api.addComment({ taskId: id.value, comment: text })
    comment.value = ''
  })
}

/** A child already succeeded; only the refresh can fail here. */
async function refresh() {
  refreshError.value = ''
  try {
    task.value = await api.getTask(id.value)
  }
  catch (e) {
    refreshError.value = (e as Error).message
  }
}

function applyDetail(detail: TaskDetail) {
  task.value = detail
  refreshError.value = ''
}

/** Absolute due times: staff plan the corridor route around clock time, not a countdown. */
const formatAbsolute = formatDateTime

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <button
      type="button"
      class="flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-muted-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
      @click="router.back()"
    >
      <ArrowLeftIcon class="size-5" aria-hidden="true" /> Back
    </button>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>{{ loadFailed ? 'Can\'t open this task' : 'That didn\'t work' }}</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !task" class="space-y-3">
      <Skeleton class="h-36 w-full rounded-2xl" />
      <Skeleton class="h-24 w-full rounded-2xl" />
      <Skeleton class="h-48 w-full rounded-2xl" />
    </div>

    <template v-else-if="task">
      <!-- The traffic light, spelled out, before anything else. -->
      <HeatBanner :heat="heat" :signals="signals" />

      <Card>
        <CardHeader class="gap-2">
          <!-- Same scan order as the cards: where, then how urgent, then what.
               The room is the thing someone mid-corridor looks for first. -->
          <div class="flex items-start justify-between gap-2">
            <p v-if="task.roomNumber" class="flex items-center gap-1.5 text-3xl font-bold tabular-nums tracking-tight text-foreground">
              <MapPinIcon class="size-6 text-muted-foreground" aria-hidden="true" />
              {{ task.roomNumber }}
            </p>
            <p v-else class="flex items-center gap-1.5 text-base font-semibold text-muted-foreground">
              <MapPinIcon class="size-5" aria-hidden="true" />
              {{ task.locationTypeName ?? 'No room' }}
            </p>
            <div class="ml-auto shrink-0">
              <SlaBadge :task="task" />
            </div>
          </div>
          <CardTitle class="text-xl leading-snug">{{ task.title }}</CardTitle>
          <!-- The request itself is what the person walking there needs first —
               it lives with the title, not buried under the metadata rows. -->
          <p v-if="task.description" class="text-base leading-relaxed text-foreground/85">{{ task.description }}</p>
          <div class="flex flex-wrap items-center gap-1.5">
            <!-- Why the banner is the colour it is, then the lifecycle status. -->
            <SignalChip
              v-for="signal in reasons"
              :key="signal.kind"
              :heat="signal.heat"
              :icon="signal.icon"
              :label="signal.label"
              :title="signal.kind === 'escalation' && task.escalatedAt ? `${signal.detail} Escalated ${relativeTime(task.escalatedAt)}.` : signal.detail"
            />
            <StatusPill :status="task.status" />
            <!-- Only when the task came from elsewhere: a Butler request has a
                 guest waiting on the other end. The dot is the registry's
                 colour — data, not a theme token. -->
            <Badge v-if="sourceBadge" variant="outline" class="min-h-7 gap-1.5 text-muted-foreground">
              <span
                v-if="sourceBadge.color"
                class="size-2 rounded-full"
                :style="{ backgroundColor: sourceBadge.color }"
                aria-hidden="true"
              />
              {{ sourceBadge.label }}
            </Badge>
          </div>
          <p class="text-xs font-medium text-muted-foreground">
            {{ taskRef(task.id) }} · opened {{ relativeTime(task.createdAt) }}
          </p>
          <!-- A project task has left the hotel board; the chip is the way back
               to where its siblings are. -->
          <NuxtLink
            v-if="task.project"
            :to="`/projects/${task.project.id}`"
            class="inline-flex min-h-11 max-w-full items-center gap-1.5 self-start rounded-full border border-primary/30 bg-primary-tint/60 px-4 py-1 text-sm font-semibold text-primary-tint-foreground transition-colors active:bg-primary-tint focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
          >
            <FolderKanbanIcon class="size-4 shrink-0" aria-hidden="true" />
            <span class="truncate">Project · {{ task.project.name }}</span>
          </NuxtLink>
        </CardHeader>
        <CardContent class="flex flex-wrap gap-1.5">
          <!-- A department the hotel has since retired still owns its old
               tasks; say so rather than show a name nobody can pick any more. -->
          <Badge v-if="task.department" variant="outline" class="min-h-7">{{ task.department.name }}{{ task.department.isActive === false ? ' (inactive)' : '' }}</Badge>
          <Badge v-if="task.itemName && task.itemName !== task.title" variant="outline" class="min-h-7">{{ task.itemName }}</Badge>
          <Badge v-if="task.quantity && task.quantity > 1" variant="outline" class="min-h-7 tabular-nums">×{{ task.quantity }}</Badge>
          <Badge v-if="task.categoryName" variant="outline" class="min-h-7">{{ task.categoryName }}</Badge>
        </CardContent>
      </Card>

      <!-- A child's action landed but the follow-up refresh failed: keep the
           page, say so quietly, offer a refresh. -->
      <Alert v-if="refreshError">
        <InfoIcon />
        <AlertTitle>That worked, but the view may be stale</AlertTitle>
        <AlertDescription class="space-y-2">
          <p>{{ refreshError }}</p>
          <Button variant="secondary" @click="refresh">Refresh</Button>
        </AlertDescription>
      </Alert>

      <!-- Straight from "New task" with Repeat on: the first run is this task;
           the schedule itself lives under Repeats. -->
      <Alert v-if="repeatsNotice">
        <RepeatIcon />
        <AlertTitle>This task repeats</AlertTitle>
        <AlertDescription class="space-y-2">
          <p>This is the first run. The next ones are made on the schedule you set.</p>
          <Button variant="secondary" @click="navigateTo('/recurring')">Manage repeats</Button>
        </AlertDescription>
      </Alert>

      <!-- Actions. Claim shows when no PERSON holds the task; a pool claim
           names the pool it is taking from. -->
      <div class="flex flex-wrap gap-2">
        <Button v-if="canClaim" class="min-h-11 flex-1" :disabled="acting" @click="claim">
          <HandIcon class="size-5" aria-hidden="true" /> {{ claimLabel }}
        </Button>
        <Button
          v-if="canAssign"
          class="min-h-11 flex-1"
          :variant="canClaim ? 'secondary' : 'default'"
          :disabled="acting"
          @click="assignOpen = true"
        >
          <UserRoundPlusIcon class="size-5" aria-hidden="true" />
          {{ assignment?.kind === 'STAFF' ? 'Reassign' : 'Assign' }}
        </Button>
        <Button
          v-if="canMove"
          class="min-h-11 flex-1"
          :variant="canClaim || canAssign ? 'secondary' : 'default'"
          :disabled="acting"
          @click="moveOpen = true"
        >
          <ArrowRightLeftIcon class="size-5" aria-hidden="true" /> Move
        </Button>
        <Button
          v-if="canReturn"
          variant="secondary"
          class="min-h-11 flex-1"
          :disabled="acting"
          :aria-expanded="returnOpen"
          @click="returnOpen = true"
        >
          <RotateCcwIcon class="size-5" aria-hidden="true" /> Return to pool
        </Button>
      </div>

      <!--
        Why there is no Claim button. Staff hitting a task another person is
        already handling need to know the route exists (ask a leader) rather
        than assume the screen is broken.
      -->
      <Alert v-if="heldBySomeoneElse && !canAssign && !isHelper">
        <InfoIcon />
        <AlertTitle>{{ displayName(assignment?.staffName) }} is handling this</AlertTitle>
        <AlertDescription>
          Only a team leader can hand it over. Ask yours if it needs to move to you.
        </AlertDescription>
      </Alert>

      <!-- The leader's review lives right under the actions when it applies. -->
      <ReviewPanel :task="task" @updated="applyDetail" />
      <SubmitPanel :task="task" :can-submit="isMine || isHelper" @updated="applyDetail" />

      <Card>
        <CardContent class="space-y-3 pt-6 text-sm">
          <div class="flex items-center gap-2">
            <UserRoundIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="text-muted-foreground">Assignee</span>
            <span class="ml-auto flex min-w-0 items-center gap-2 font-medium">
              <template v-if="assignment?.kind === 'STAFF'">
                <Avatar class="size-6">
                  <AvatarFallback class="bg-primary-tint text-xs font-bold text-primary-tint-foreground">{{ initials(assignment.staffName) }}</AvatarFallback>
                </Avatar>
                <span class="truncate">{{ displayName(assignment.staffName) }}</span>
                <span v-if="isMine" class="text-xs text-muted-foreground">(you)</span>
              </template>
              <span v-else-if="poolName" class="truncate text-muted-foreground">{{ poolName }} pool</span>
              <span v-else class="text-muted-foreground">Unclaimed</span>
            </span>
          </div>
          <div v-if="assignment?.remark" class="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            “{{ assignment.remark }}”
          </div>
          <div v-if="task.requesterName" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">Requested for</span>
            <span class="ml-auto truncate font-medium">{{ task.requesterName }}</span>
          </div>
          <!-- Which system raised it, by full name — the badge above only
               marks tasks from elsewhere; this row answers the question for
               every task, and shows the raw code when the registry has no
               entry rather than hiding a real fact. -->
          <div v-if="createdBy" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">Created by</span>
            <span class="ml-auto truncate font-medium">{{ createdBy }}</span>
          </div>
          <div v-if="task.sla" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">Deadlines</span>
            <span class="ml-auto font-medium">{{ task.sla.name }}</span>
          </div>
          <!-- The countdown badge says how long; these say WHEN — what someone
               planning the next hour actually reasons in. -->
          <div v-if="task.responseDueAt" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">{{ CLOCK_WORDS.response }}</span>
            <span
              class="ml-auto font-medium tabular-nums"
              :class="task.responseSlaStatus === 'BREACHED' ? 'font-bold text-danger-tint-foreground' : ''"
            >{{ formatAbsolute(task.responseDueAt) }}</span>
          </div>
          <div v-if="task.resolutionDueAt" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">{{ CLOCK_WORDS.resolution }}</span>
            <span
              class="ml-auto font-medium tabular-nums"
              :class="task.resolutionSlaStatus === 'BREACHED' ? 'font-bold text-danger-tint-foreground' : ''"
            >{{ formatAbsolute(task.resolutionDueAt) }}</span>
          </div>
          <div v-if="task.dueAt" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">Due</span>
            <span class="ml-auto font-medium tabular-nums">{{ formatAbsolute(task.dueAt) }}</span>
          </div>
          <p v-if="task.notes" class="rounded-lg bg-muted/60 px-3 py-2 text-foreground">{{ task.notes }}</p>
        </CardContent>
      </Card>

      <ChecklistCard
        :task="task"
        :is-assignee="isMine"
        :is-helper="isHelper"
        :project-level="projectLevel"
        @updated="refresh"
      />

      <TaskContextCard :task-id="task.id" />

      <DelegateCard :task="task" @updated="refresh" />

      <HelpersCard :task="task" :can-manage="canManageHelpers" @updated="refresh" />

      <AttachmentsCard :task="task" @updated="refresh" />

      <!-- Keyed on updatedAt: the sweep stamps the task when a step fires, so
           a refetch that shows a new level also reloads the steps. -->
      <EscalationCard :key="`escalation-${task.updatedAt}`" :task="task" />

      <!-- Keyed on updatedAt so a claim, return or submit refreshes the split. -->
      <TimeAttributionCard :key="task.updatedAt" :task-id="task.id" />

      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-base">Activity</CardTitle></CardHeader>
        <CardContent class="space-y-4">
          <!-- The same history twice, on purpose: the strip answers "how is
               this going against the clock" at a glance, the list below says
               who did what and when. -->
          <TaskTimelineChart :task="task" />
          <Separator />
          <TaskTimeline :task="task" />
          <div v-if="canComment" class="flex items-end gap-2">
            <Textarea
              v-model="comment"
              placeholder="Add a comment…"
              rows="1"
              class="min-h-11 resize-none text-base"
              @keydown.enter.exact.prevent="sendComment"
            />
            <Button
              size="icon"
              :disabled="acting || !comment.trim()"
              aria-label="Send comment"
              title="Send comment"
              @click="sendComment"
            >
              <SendIcon class="size-5" aria-hidden="true" />
            </Button>
          </div>
          <p v-else class="text-xs text-muted-foreground">Project viewers can follow this task but not comment on it.</p>
        </CardContent>
      </Card>

      <StatusMoveSheet
        v-model:open="moveOpen"
        :columns="moveColumns"
        :current-column-id="task.columnId"
        :busy="acting"
        @move="move"
      />

      <AssignSheet
        v-model:open="assignOpen"
        :department-id="task.hotelDepartmentId"
        :department-name="task.department?.name ?? null"
        :current-assignee-id="assignment?.staffId ?? null"
        :task-id="task.id"
        :busy="acting"
        @assign="assign"
      />

      <Dialog v-model:open="returnOpen">
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Return to pool</DialogTitle>
            <DialogDescription>
              The task goes back to your team or department to pick up. The reason travels with it.
            </DialogDescription>
          </DialogHeader>

          <Alert v-if="returnError" variant="destructive">
            <AlertTitle>Could not return the task</AlertTitle>
            <AlertDescription>{{ returnError }}</AlertDescription>
          </Alert>

          <div class="space-y-2">
            <Label for="return-reason">Why are you returning this task?</Label>
            <Textarea id="return-reason" v-model="returnReason" rows="3" maxlength="500" class="resize-none" />
          </div>

          <DialogFooter>
            <Button variant="secondary" :disabled="isReturning" @click="returnOpen = false">Cancel</Button>
            <Button :disabled="!returnReason.trim() || isReturning" :aria-busy="isReturning" @click="returnToPool">
              {{ isReturning ? 'Returning…' : 'Return task' }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </template>
  </div>
</template>
