<script setup lang="ts">
import { computed, ref } from 'vue'
import { CameraIcon, ClipboardCheckIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { UPLOAD_MAX_BYTES, type TaskDetail } from '~/utils/clientFakeApi'

const props = defineProps<{
  task: TaskDetail
  /** The permission half: assignee or active helper. The parent knows both. */
  canSubmit: boolean
}>()

const emit = defineEmits<{ updated: [TaskDetail] }>()

const api = useTasksApi()

/**
 * Self-gated: the status half of the server's guard lives HERE, not at the
 * mount site — an implicit "the parent only renders me sometimes" gate rots
 * the first time a refactor moves the mount point.
 */
const visible = computed(() => props.task.status === 'IN_PROGRESS' && props.canSubmit)

const note = ref('')
const isSubmitting = ref(false)
const isUploading = ref(false)
const errorMessage = ref('')

/**
 * Photos this panel added THIS session, minus any already reflected on the
 * task prop. Any unrelated mutation can refresh the prop with a fresh detail
 * that legitimately contains a photo uploaded here moments earlier — without
 * the dedupe, that photo counts twice and the gate silently overstates proof.
 */
const locallyAdded = ref<Array<{ id: string, filetype: string }>>([])

const minPhotos = computed(() => props.task.proofRequirements.minProofPhotos)
const needsNote = computed(() => props.task.proofRequirements.requiresCompletionNote)

const photoCount = computed(() => {
  // The detail carries non-removed attachments only.
  const onTask = new Set((props.task.attachments ?? []).map(a => a.id))
  const existing = (props.task.attachments ?? []).filter(a => a.filetype === 'PHOTO').length
  const local = locallyAdded.value.filter(p => p.filetype === 'PHOTO' && !onTask.has(p.id)).length
  return existing + local
})

const photoGateMet = computed(() => photoCount.value >= minPhotos.value)
const noteGateMet = computed(() => !needsNote.value || note.value.trim().length > 0)
const canSend = computed(() => photoGateMet.value && noteGateMet.value && !isSubmitting.value && !isUploading.value)

async function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // Reset immediately so re-picking the same file still fires `change`.
  input.value = ''
  if (!files.length || isUploading.value) return
  isUploading.value = true
  errorMessage.value = ''
  try {
    // Sequential, not Promise.all: a failed file's error stays unambiguous.
    for (const file of files) {
      if (!UPLOAD_MAX_BYTES[file.type]) {
        throw new Error(`contentType must be one of ${Object.keys(UPLOAD_MAX_BYTES).join(', ')}`)
      }
      const presigned = await api.presignUpload({ filename: file.name, contentType: file.type, sizeBytes: file.size })
      const attached = await api.createAttachment({
        taskId: props.task.id,
        storageKey: presigned.storageKey,
        filetype: file.type === 'application/pdf' ? 'PDF' : 'PHOTO',
      })
      locallyAdded.value = [...locallyAdded.value, { id: attached.id, filetype: attached.filetype }]
    }
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isUploading.value = false
  }
}

async function submit() {
  if (!canSend.value) return
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    const detail = await api.submitTask({ taskId: props.task.id, completionNote: note.value.trim() || null })
    note.value = ''
    locallyAdded.value = []
    emit('updated', detail)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <Card v-if="visible">
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-base">
        <ClipboardCheckIcon class="size-5" /> Submit work
      </CardTitle>
      <CardDescription class="text-sm">
        A team leader reviews the submission before it counts as finished.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Could not submit</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <!-- The gates say what stands between here and Submitted, before the tap. -->
      <div v-if="minPhotos > 0" class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
        <span class="text-muted-foreground">Proof photos</span>
        <span class="font-semibold tabular-nums" :class="photoGateMet ? 'text-success-tint-foreground' : 'text-danger-tint-foreground'">
          {{ photoCount }} of {{ minPhotos }}
        </span>
      </div>
      <p v-if="needsNote && !noteGateMet" role="alert" class="text-sm font-semibold text-danger-tint-foreground">
        A completion note is required for this task.
      </p>

      <div v-if="minPhotos > 0" class="space-y-1">
        <label
          class="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-medium text-muted-foreground active:bg-accent"
        >
          <CameraIcon class="h-4 w-4" />
          {{ isUploading ? 'Uploading…' : 'Add photos' }}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            capture="environment"
            multiple
            class="sr-only"
            :disabled="isUploading"
            @change="onFilesPicked"
          >
        </label>
      </div>

      <div class="space-y-1.5">
        <Label for="submit-note">Completion note{{ needsNote ? '' : ' (optional)' }}</Label>
        <Textarea
          id="submit-note"
          v-model="note"
          rows="2"
          maxlength="2000"
          class="resize-none"
          placeholder="What was done, anything the reviewer should know"
        />
      </div>

      <Button class="min-h-11 w-full" :disabled="!canSend" :aria-busy="isSubmitting" @click="submit">
        {{ isSubmitting ? 'Submitting…' : 'Submit for review' }}
      </Button>
    </CardContent>
  </Card>
</template>
