<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  ExternalLinkIcon,
  HandIcon,
  InfoIcon,
  MapPinIcon,
  PaperclipIcon,
  SendIcon,
  UserRoundIcon,
  UserRoundPlusIcon,
} from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import type { BoardColumn, TaskDetail } from '~/utils/clientFakeApi'
import { fullName, initials, isOpen, relativeTime, taskRef } from '~/utils/task-ui'

definePageMeta({ title: 'Task' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()
const session = useSession()
const caps = useCaps()

const id = computed(() => String(route.params.id))
const task = ref<TaskDetail | null>(null)
const columns = ref<BoardColumn[]>([])
const isLoading = ref(false)
const errorMessage = ref('')
/** Set when the task itself cannot be shown at all (403 / 404), not a failed action. */
const loadFailed = ref(false)
const acting = ref(false)
const moveOpen = ref(false)
const assignOpen = ref(false)
const attachOpen = ref(false)
const comment = ref('')

const assignee = computed(() => task.value?.assignment?.user ?? null)
const isMine = computed(() => Boolean(task.value?.assignment && task.value.assignment.userId === session.userId.value))
const heldBySomeoneElse = computed(() => Boolean(task.value?.assignment) && !isMine.value)

/**
 * Claim is offered only when the task is genuinely unheld.
 *
 * This is finding 1 on the UI side: the button used to appear even when someone
 * else held the task, and the old backend honoured it — so a leader tapping
 * Claim quietly took the task off whoever was working it. Handing over is now
 * an explicit Assign, and the button below says so.
 */
const canClaim = computed(() => Boolean(task.value && caps.canWork.value && !task.value.assignment && isOpen(task.value.status)))
const canMove = computed(() => Boolean(task.value && columns.value.length && (caps.isLeader.value || isMine.value)))

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    task.value = await api.getTask(id.value)
    try {
      columns.value = (await api.getBoard()).columns
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

function assign(payload: { userId: string, remark: string | null }) {
  return act(async () => {
    await api.assignTask({ taskId: id.value, ...payload })
    assignOpen.value = false
  })
}

function attach(payload: { url: string }) {
  return act(async () => {
    await api.attachUrl({ taskId: id.value, url: payload.url })
    attachOpen.value = false
  })
}

function sendComment() {
  const text = comment.value.trim()
  if (!text) return
  return act(async () => {
    await api.addComment({ taskId: id.value, comment: text })
    comment.value = ''
  })
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <button
      type="button"
      class="flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground active:text-foreground"
      @click="router.back()"
    >
      <ArrowLeftIcon class="h-4 w-4" /> Back
    </button>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>{{ loadFailed ? 'Can\'t open this task' : 'That didn\'t work' }}</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !task" class="space-y-3">
      <Skeleton class="h-36 w-full rounded-xl" />
      <Skeleton class="h-24 w-full rounded-xl" />
      <Skeleton class="h-48 w-full rounded-xl" />
    </div>

    <template v-else-if="task">
      <Card>
        <CardHeader class="gap-2">
          <div class="flex items-center justify-between gap-2">
            <StatusPill :status="task.status" />
            <SlaBadge :task="task" :status="task.status" show-countdown />
          </div>
          <CardTitle class="text-lg leading-snug">{{ task.title }}</CardTitle>
          <p class="text-xs font-medium text-muted-foreground">
            {{ taskRef(task.id) }} · opened {{ relativeTime(task.createDate) }}
            <template v-if="task.partner"> · via {{ task.partner.name }}</template>
          </p>
        </CardHeader>
        <CardContent class="flex flex-wrap gap-1.5">
          <Badge v-if="task.location" variant="secondary" class="gap-1">
            <MapPinIcon class="h-3 w-3" />{{ task.location }}
          </Badge>
          <Badge v-if="task.department" variant="outline">{{ task.department.name }}</Badge>
          <Badge v-if="task.item" variant="outline">{{ task.item.name }}</Badge>
          <Badge v-if="task.quantity && task.quantity > 1" variant="outline">×{{ task.quantity }}</Badge>
          <Badge v-if="task.item?.category" variant="outline">{{ task.item.category.name }}</Badge>
        </CardContent>
      </Card>

      <!-- Actions. Claim only shows when nothing holds the task; when something
           does, the hand-over path is named explicitly instead. -->
      <div class="flex flex-wrap gap-2">
        <Button v-if="canClaim" class="min-h-11 flex-1" :disabled="acting" @click="claim">
          <HandIcon class="h-4 w-4" /> Claim
        </Button>
        <Button
          v-if="caps.canAssign.value"
          class="min-h-11 flex-1"
          :variant="canClaim ? 'outline' : 'default'"
          :disabled="acting"
          @click="assignOpen = true"
        >
          <UserRoundPlusIcon class="h-4 w-4" />
          {{ task.assignment ? 'Reassign' : 'Assign' }}
        </Button>
        <Button
          v-if="canMove"
          class="min-h-11 flex-1"
          :variant="canClaim || caps.canAssign.value ? 'outline' : 'default'"
          :disabled="acting"
          @click="moveOpen = true"
        >
          <ArrowRightLeftIcon class="h-4 w-4" /> Move
        </Button>
      </div>

      <!--
        Why there is no Claim button. Staff hitting a task another person is
        already handling need to know the route exists (ask a leader) rather
        than assume the screen is broken.
      -->
      <Alert v-if="heldBySomeoneElse && !caps.canAssign.value">
        <InfoIcon />
        <AlertTitle>{{ fullName(assignee) }} is handling this</AlertTitle>
        <AlertDescription>
          Only a team leader can hand it over. Ask yours if it needs to move to you.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent class="space-y-3 pt-6 text-sm">
          <div class="flex items-center gap-2">
            <UserRoundIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="text-muted-foreground">Assignee</span>
            <span class="ml-auto flex min-w-0 items-center gap-2 font-medium">
              <template v-if="assignee">
                <Avatar class="h-5 w-5">
                  <AvatarFallback class="bg-primary/10 text-[9px] font-semibold text-primary">{{ initials(assignee) }}</AvatarFallback>
                </Avatar>
                <span class="truncate">{{ fullName(assignee) }}</span>
                <span v-if="isMine" class="text-xs text-muted-foreground">(you)</span>
              </template>
              <span v-else class="text-muted-foreground">Unclaimed</span>
            </span>
          </div>
          <div v-if="task.assignment?.remark" class="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            “{{ task.assignment.remark }}”
          </div>
          <div v-if="task.requestedFor" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">Requested for</span>
            <span class="ml-auto truncate font-medium">{{ task.requestedFor }}</span>
          </div>
          <div v-if="task.sla" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">SLA</span>
            <span class="ml-auto font-medium">{{ task.sla.name }}</span>
          </div>
          <div v-if="task.externalRef" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">Partner reference</span>
            <span class="ml-auto truncate font-mono text-xs">{{ task.externalRef }}</span>
          </div>
          <p v-if="task.description" class="rounded-lg bg-muted/60 px-3 py-2 text-foreground">{{ task.description }}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex-row items-center justify-between gap-2 pb-2">
          <CardTitle class="flex items-center gap-2 text-sm">
            <PaperclipIcon class="h-4 w-4" /> Attachments
          </CardTitle>
          <Button variant="outline" size="sm" :disabled="acting" @click="attachOpen = true">Attach</Button>
        </CardHeader>
        <CardContent class="space-y-2">
          <a
            v-for="attachment in task.attachments"
            :key="attachment.id"
            :href="attachment.url"
            target="_blank"
            rel="noopener noreferrer"
            class="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm active:bg-accent"
          >
            <PaperclipIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">{{ attachment.filename }}</span>
            <Badge variant="secondary" class="shrink-0 text-[10px]">{{ attachment.filetype }}</Badge>
            <ExternalLinkIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          </a>
          <p v-if="task.attachments.length === 0" class="py-2 text-xs text-muted-foreground">
            No attachments. Files are linked by URL — direct photo upload isn't built yet.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-sm">Activity</CardTitle></CardHeader>
        <CardContent>
          <TaskTimeline :history="task.history" :comments="task.comments" />
          <div class="mt-4 flex items-end gap-2">
            <Textarea
              v-model="comment"
              placeholder="Add a comment…"
              rows="1"
              class="min-h-11 resize-none"
              @keydown.enter.exact.prevent="sendComment"
            />
            <Button
              size="icon"
              class="min-h-11 min-w-11"
              :disabled="acting || !comment.trim()"
              aria-label="Send comment"
              @click="sendComment"
            >
              <SendIcon class="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <StatusMoveSheet
        v-model:open="moveOpen"
        :columns="columns"
        :current-column-id="task.columnId"
        :busy="acting"
        @move="move"
      />

      <AssignSheet
        v-model:open="assignOpen"
        :department-id="task.departmentId"
        :department-name="task.department?.name ?? null"
        :current-assignee-id="task.assignment?.userId ?? null"
        :busy="acting"
        @assign="assign"
      />

      <AttachUrlDialog v-model:open="attachOpen" :busy="acting" @attach="attach" />
    </template>
  </div>
</template>
