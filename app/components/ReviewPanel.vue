<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCheckIcon, UndoIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import type { TaskDetail } from '~/utils/clientFakeApi'
import { displayName, relativeTime } from '~/utils/task-ui'

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
      <CardDescription class="text-xs">
        Submitted by {{ submitterName }}<template v-if="task.submittedAt"> · {{ relativeTime(task.submittedAt) }}</template>
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
        <Button
          variant="outline"
          class="min-h-11 flex-1"
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
    </CardContent>
  </Card>
</template>
