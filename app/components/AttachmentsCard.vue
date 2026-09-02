<script setup lang="ts">
import { computed, ref } from 'vue'
import { ExternalLinkIcon, PaperclipIcon, UploadIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { UPLOAD_MAX_BYTES, type TaskAttachment, type TaskDetail } from '~/utils/clientFakeApi'

const props = defineProps<{ task: TaskDetail }>()

/**
 * Bare `updated`: none of these endpoints return a full TaskDetail, so the
 * parent refetches. This is also what unsticks SubmitPanel's photo gate — it
 * counts photos off the page's task, never off this card's own state.
 */
const emit = defineEmits<{ updated: [] }>()

const api = useTasksApi()

const attachOpen = ref(false)
const isAttaching = ref(false)
const isUploading = ref(false)
/** One id at a time: every remove disables while any one is in flight. */
const removingId = ref('')
const errorMessage = ref('')

/** The detail carries non-removed rows only — a removed attachment is gone. */
const attachments = computed(() => props.task.attachments ?? [])

/** No filename in the read model: label from the URL's basename, else the type. */
function attachmentLabel(attachment: TaskAttachment): string {
  if (attachment.filepath) {
    try {
      const base = new URL(attachment.filepath).pathname.split('/').pop()
      if (base) return decodeURIComponent(base)
    }
    catch { /* not a parseable URL — fall through to the type label */ }
  }
  return attachment.filetype === 'PDF' ? 'PDF document' : 'Photo'
}

async function attachByUrl(payload: { url: string }) {
  if (isAttaching.value) return
  isAttaching.value = true
  errorMessage.value = ''
  try {
    // The API requires an explicit filetype; a .pdf link is the one PDF case.
    const filetype = /\.pdf(\?|#|$)/i.test(payload.url) ? 'PDF' : 'PHOTO'
    await api.createAttachment({ taskId: props.task.id, url: payload.url, filetype })
    attachOpen.value = false
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isAttaching.value = false
  }
}

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
      await api.createAttachment({
        taskId: props.task.id,
        storageKey: presigned.storageKey,
        filetype: file.type === 'application/pdf' ? 'PDF' : 'PHOTO',
      })
    }
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isUploading.value = false
  }
}

/**
 * Removal is one-way from this screen: the read model only returns active
 * rows, so a removed attachment disappears rather than lingering as a
 * restorable ghost. (The API can un-remove by id; the id is gone with the row.)
 */
async function remove(attachment: TaskAttachment) {
  if (removingId.value) return
  removingId.value = attachment.id
  errorMessage.value = ''
  try {
    await api.setAttachmentRemoved({ id: attachment.id, taskId: props.task.id, filetype: attachment.filetype, isRemoved: true })
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    removingId.value = ''
  }
}
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-center justify-between gap-2 pb-2">
      <CardTitle class="flex items-center gap-2 text-sm">
        <PaperclipIcon class="h-4 w-4" /> Attachments
      </CardTitle>
      <Button variant="outline" size="sm" :disabled="isAttaching" @click="attachOpen = true">Link URL</Button>
    </CardHeader>
    <CardContent class="space-y-2">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>That didn't work</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div
        v-for="attachment in attachments"
        :key="attachment.id"
        class="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
      >
        <PaperclipIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
        <!-- filepath '' means "preview unavailable" (signer off) — say so
             rather than rendering a dead link. -->
        <a
          v-if="attachment.filepath"
          :href="attachment.filepath"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-w-0 flex-1 items-center gap-1 truncate active:text-primary"
        >
          <span class="min-w-0 truncate">{{ attachmentLabel(attachment) }}</span>
          <ExternalLinkIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        </a>
        <span v-else class="min-w-0 flex-1 truncate text-muted-foreground">
          {{ attachmentLabel(attachment) }} · preview unavailable
        </span>
        <Badge variant="secondary" class="shrink-0 text-[10px]">{{ attachment.filetype }}</Badge>
        <Button
          size="sm"
          variant="ghost"
          class="shrink-0 text-muted-foreground hover:text-destructive"
          :disabled="Boolean(removingId)"
          :aria-busy="removingId === attachment.id"
          :aria-label="`Remove ${attachmentLabel(attachment)}`"
          @click="remove(attachment)"
        >
          {{ removingId === attachment.id ? '…' : 'Remove' }}
        </Button>
      </div>

      <p v-if="attachments.length === 0" class="py-1 text-xs text-muted-foreground">
        No attachments yet.
      </p>

      <label
        class="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-medium text-muted-foreground active:bg-accent"
      >
        <UploadIcon class="h-4 w-4" />
        {{ isUploading ? 'Uploading…' : 'Upload photos or PDFs' }}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          multiple
          class="sr-only"
          :disabled="isUploading"
          @change="onFilesPicked"
        >
      </label>
    </CardContent>

    <AttachUrlDialog v-model:open="attachOpen" :busy="isAttaching" @attach="attachByUrl" />
  </Card>
</template>
