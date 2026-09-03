<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckCheckIcon, UndoIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import type { TaskDetail, TaskListItem } from '~/utils/clientFakeApi'
import { displayName, formatClockTime } from '~/utils/task-ui'

const props = defineProps<{ task: TaskDetail }>()
const emit = defineEmits<{ updated: [TaskDetail] }>()

const api = useTasksApi()
const caps = useCaps()

/**
 * Self-gated on status AND role. The server additionally requires a leader to
 * lead this task's own department — that cannot be verified from the detail
 * payload, so a leader elsewhere still sees the panel and gets the real 403.
 */
const visible = computed(() => props.task.status === 'SUBMITTED' && caps.isLeader.value)

/**
 * `submittedBy` is a bare id. Resolve it from what the detail already carries —
 * the assignment, then the helper list — and fall back to the raw id rather
 * than fabricating a name.
 */
const submitterName = computed(() => {
  const { submittedBy, assignment, collaborators } = props.task
  if (!submittedBy) return ''
  if (assignment?.kind === 'STAFF' && assignment.staffId === submittedBy) return displayName(assignment.staffName)
  const helper = collaborators?.find(c => c.staffId === submittedBy)
  if (helper) return displayName(helper.staffName)
  return 'a teammate'
})

// The detail carries non-removed attachments only.
const proofPhotos = computed(() => (props.task.attachments ?? []).filter(a => a.filetype === 'PHOTO'))

/**
 * "on time" / "late" next to the submission time: the resolution verdict the
 * API stamped when the work was submitted. It is never re-judged by how long
 * the review itself takes, so an EMPTY status simply shows no word.
 */
const verdict = computed(() => {
  switch (props.task.resolutionSlaStatus) {
    case 'ON_TIME': return { label: 'on time', cls: 'text-success' }
    case 'BREACHED': return { label: 'late', cls: 'text-destructive' }
    default: return null
  }
})

/**
 * Other submissions waiting on a reviewer, so a leader clearing this one sees
 * what is queued without leaving the page. Best effort: fetched when the panel
 * becomes visible, once per task id, and a failure renders nothing — it is a
 * courtesy next to the actual decision, not something to raise an alert over.
 * The list is scoped like everything else: a leader sees their own property's
 * SUBMITTED tasks, which is exactly the queue they may review.
 */
const alsoPending = ref<TaskListItem[]>([])
const alsoPendingFor = ref('')

async function loadAlsoPending() {
  const taskId = props.task.id
  try {
    const res = await api.listTasks({ status: 'SUBMITTED', limit: 4 })
    alsoPending.value = res.data.filter(t => t.id !== taskId).slice(0, 3)
    alsoPendingFor.value = taskId
  }
  catch {
    alsoPending.value = []
  }
}

watch(visible, (isVisible) => {
  if (isVisible && alsoPendingFor.value !== props.task.id) void loadAlsoPending()
}, { immediate: true })

const isApproving = ref(false)
const isSending = ref(false)
const showChangesForm = ref(false)
const changesNote = ref('')
const errorMessage = ref('')

async function approve() {
  // Approve and send-back are the same decision on the same task: firing both
  // concurrently could only race one into a preventable 409.
  if (isApproving.value || isSending.value) return
  isApproving.value = true
  errorMessage.value = ''
  try {
    emit('updated', await api.reviewTask({ taskId: props.task.id, decision: 'APPROVE' }))
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isApproving.value = false
  }
}

async function sendBack() {
  const note = changesNote.value.trim()
  if (!note || isSending.value || isApproving.value) return
  isSending.value = true
  errorMessage.value = ''
  try {
    const detail = await api.reviewTask({ taskId: props.task.id, decision: 'REQUEST_CHANGES', note })
    // Only success closes the form — a failure must not eat the typed note.
    showChangesForm.value = false
    changesNote.value = ''
    emit('updated', detail)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isSending.value = false
  }
}
</script>

<template>
  <Card v-if="visible" class="border-primary/30">
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-sm">
        <CheckCheckIcon class="h-4 w-4" /> Review submission
      </CardTitle>
      <!-- The sign-off line: who, when (clock time — reviewers reason in shift
           time, not "3h ago"), and the verdict the clock already reached. -->
      <CardDescription class="text-xs">
        Submitted by {{ submitterName }}<template v-if="task.submittedAt"> · {{ formatClockTime(task.submittedAt) }}</template><span
          v-if="verdict"
          class="font-semibold"
          :class="verdict.cls"
        > · {{ verdict.label }}</span>
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Could not record the review</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <p v-if="task.completionNote" class="whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
        {{ task.completionNote }}
      </p>

      <div v-if="proofPhotos.length" class="space-y-1.5">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proof photos</p>
        <a
          v-for="(photo, index) in proofPhotos"
          :key="photo.id"
          :href="photo.filepath || undefined"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm active:bg-accent"
        >
          <span class="min-w-0 flex-1 truncate">Proof photo {{ index + 1 }}<template v-if="!photo.filepath"> · preview unavailable</template></span>
        </a>
      </div>

      <div class="flex gap-2">
        <Button
          class="min-h-11 flex-1"
          :disabled="isApproving || isSending"
          :aria-busy="isApproving"
          @click="approve"
        >
          <CheckCheckIcon class="h-4 w-4" />
          {{ isApproving ? 'Approving…' : 'Approve' }}
        </Button>
        <!-- The one action here that is not the happy path reads that way:
             destructive outline, never a second primary. -->
        <Button
          variant="outline"
          class="min-h-11 flex-1 border-destructive/40 text-destructive hover:text-destructive"
          :disabled="isApproving"
          :aria-expanded="showChangesForm"
          @click="showChangesForm = !showChangesForm"
        >
          <UndoIcon class="h-4 w-4" /> Request changes
        </Button>
      </div>

      <div v-if="showChangesForm" class="space-y-2 rounded-lg border px-3 py-3">
        <Label for="review-note">What needs to change?</Label>
        <Textarea id="review-note" v-model="changesNote" rows="2" maxlength="1000" class="resize-none" />
        <Button
          variant="outline"
          class="min-h-11 w-full"
          :disabled="!changesNote.trim() || isSending || isApproving"
          :aria-busy="isSending"
          @click="sendBack"
        >
          {{ isSending ? 'Sending…' : 'Send back' }}
        </Button>
      </div>

      <div v-if="alsoPending.length" class="space-y-1.5 pt-1">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Also pending</p>
        <NuxtLink
          v-for="row in alsoPending"
          :key="row.id"
          :to="`/tasks/${row.id}`"
          class="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm active:bg-accent"
        >
          <span v-if="row.roomNumber" class="shrink-0 font-bold tabular-nums">{{ row.roomNumber }}</span>
          <span class="min-w-0 flex-1 truncate">{{ row.title }}</span>
          <span v-if="row.assignment?.kind === 'STAFF'" class="shrink-0 text-xs text-muted-foreground">
            {{ displayName(row.assignment.staffName) }}
          </span>
        </NuxtLink>
      </div>
    </CardContent>
  </Card>
</template>
