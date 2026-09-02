<script setup lang="ts">
import { computed, ref } from 'vue'
import { ExternalLinkIcon, PaperclipIcon, UploadIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { UPLOAD_MAX_BYTES, type TaskDetail } from '~/utils/clientFakeApi'

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
/** One id at a time: every toggle disables while any one is in flight. */
const togglingId = ref('')
const errorMessage = ref('')

const attachments = computed(() => props.task.attachments)

async function attachByUrl(payload: { url: string }) {
  if (isAttaching.value) return
  isAttaching.value = true
  errorMessage.value = ''
  try {
    await api.attachUrl({ taskId: props.task.id, url: payload.url })
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
      const presigned = await api.createUpload({ filename: file.name, contentType: file.type, sizeBytes: file.size })
      await api.attachUpload({
        taskId: props.task.id,
        storageKey: presigned.storageKey,
        filetype: file.type === 'application/pdf' ? 'PDF' : 'PHOTO',
        filename: file.name,
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

async function toggleRemoved(attachment: { id: string, isRemoved: boolean }) {
  if (togglingId.value) return
  togglingId.value = attachment.id
  errorMessage.value = ''
  try {
    await api.updateAttachment({ id: attachment.id, isRemoved: !attachment.isRemoved })
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    togglingId.value = ''
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
        :class="attachment.isRemoved ? 'opacity-55' : ''"
      >
        <PaperclipIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
        <template v-if="attachment.isRemoved">
          <span class="min-w-0 flex-1 truncate line-through">{{ attachment.filename }}</span>
        </template>
        <a
          v-else
          :href="attachment.url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-w-0 flex-1 items-center gap-1 truncate active:text-primary"
        >
          <span class="min-w-0 truncate">{{ attachment.filename }}</span>
          <ExternalLinkIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        </a>
        <Badge variant="secondary" class="shrink-0 text-[10px]">{{ attachment.filetype }}</Badge>
        <Button
          size="sm"
          variant="ghost"
          class="shrink-0 text-muted-foreground"
          :disabled="Boolean(togglingId)"
          :aria-busy="togglingId === attachment.id"
          :aria-label="`${attachment.isRemoved ? 'Restore' : 'Remove'} ${attachment.filename}`"
          @click="toggleRemoved(attachment)"
        >
          {{ togglingId === attachment.id ? '…' : attachment.isRemoved ? 'Restore' : 'Remove' }}
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
