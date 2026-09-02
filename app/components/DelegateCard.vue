<script setup lang="ts">
import { computed, ref } from 'vue'
import { SendIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { TaskDetail } from '~/utils/clientFakeApi'
import { displayName } from '~/utils/task-ui'

const props = defineProps<{ task: TaskDetail }>()
const emit = defineEmits<{ updated: [] }>()

const api = useTasksApi()
const session = useSession()

/**
 * Whitelist, mirroring the server: the offer route refuses everything but NEW
 * and IN_PROGRESS, so showing the form anywhere else could only produce a 409
 * after the person filled it in. Self-gated for the same reason SubmitPanel is.
 */
const OFFER_ALLOWED = new Set(['NEW', 'IN_PROGRESS'])
const isMine = computed(() =>
  props.task.assignment?.kind === 'STAFF' && props.task.assignment.staffId === session.userId.value,
)
const visible = computed(() => isMine.value && OFFER_ALLOWED.has(props.task.status))

const toUserId = ref('')
const note = ref('')
const isSending = ref(false)
const isCancelling = ref(false)
const errorMessage = ref('')

// One pending offer per task, so the form and the pending notice are mutually
// exclusive — mirroring the invariant rather than juggling both.
const pending = computed(() => props.task.pendingOffer)

async function send() {
  if (!toUserId.value || isSending.value) return
  isSending.value = true
  errorMessage.value = ''
  try {
    await api.sendOffer({ taskId: props.task.id, toStaffId: toUserId.value, note: note.value.trim() || null })
    toUserId.value = ''
    note.value = ''
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isSending.value = false
  }
}

async function cancel() {
  if (!pending.value || isCancelling.value) return
  isCancelling.value = true
  errorMessage.value = ''
  try {
    await api.cancelOffer(pending.value.id)
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isCancelling.value = false
  }
}
</script>

<template>
  <Card v-if="visible">
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-sm">
        <SendIcon class="h-4 w-4" /> Delegate
      </CardTitle>
      <CardDescription class="text-xs">
        Offer this task to a colleague — it moves only if they accept.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-2">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Could not send the offer</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div v-if="pending" class="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
        <span class="min-w-0 truncate text-sm">
          Offered to <span class="font-semibold">{{ displayName(pending.toStaffName) }}</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          class="shrink-0 text-muted-foreground hover:text-destructive"
          :disabled="isCancelling"
          :aria-busy="isCancelling"
          @click="cancel"
        >
          {{ isCancelling ? 'Cancelling…' : 'Cancel offer' }}
        </Button>
      </div>

      <template v-else>
        <StaffSelect
          v-model="toUserId"
          :exclude="session.userId.value ? [session.userId.value] : []"
          placeholder="Offer to…"
          :aria-label="`Staff member to offer ${task.title} to`"
        />
        <Textarea v-model="note" rows="2" maxlength="500" class="resize-none" placeholder="Note (optional)" />
        <Button variant="outline" class="min-h-11 w-full" :disabled="!toUserId || isSending" :aria-busy="isSending" @click="send">
          {{ isSending ? 'Sending…' : 'Send offer' }}
        </Button>
      </template>
    </CardContent>
  </Card>
</template>
