<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { TimerIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { TaskTimeAttribution } from '~/utils/clientFakeApi'
import { displayName, formatMinutes } from '~/utils/task-ui'

/**
 * "Who held it" — GET /v1/tasks/{id}/attribution. Anyone who can open the
 * task may ask. Minutes follow the operating schedule (open hours), and the
 * split is shown ONLY when the API says it reconciles; otherwise the total
 * stands alone and the card says why.
 */
const props = defineProps<{ taskId: string }>()

const api = useTasksApi()
const session = useSession()

const data = ref<TaskTimeAttribution | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')

const stillOpen = computed(() => data.value?.cutoffReason === 'open')
const holders = computed(() => (data.value?.holders ?? []).filter(h => h.minutes > 0 || h.holds > 0))

function holderName(holder: { staffId: string, staffName?: string | null }) {
  return holder.staffId === session.userId.value ? 'You' : displayName(holder.staffName)
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    data.value = await api.getTaskAttribution(props.taskId)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

defineExpose({ load })

onMounted(load)
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-sm">
        <TimerIcon class="h-4 w-4" /> Who held it
      </CardTitle>
      <CardDescription class="text-xs">
        Open-hours minutes, from activation {{ stillOpen ? 'so far' : 'to submission' }}.
      </CardDescription>
    </CardHeader>
    <CardContent class="text-sm">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Couldn't work out the time split</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div v-else-if="isLoading && !data" class="space-y-2">
        <Skeleton class="h-5 w-2/3 rounded" />
        <Skeleton class="h-4 w-1/2 rounded" />
      </div>

      <template v-else-if="data">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-muted-foreground">Total{{ stillOpen ? ' so far' : '' }}</span>
          <span class="text-base font-bold tabular-nums">{{ formatMinutes(data.totalMinutes) }}</span>
        </div>

        <template v-if="data.reconciles">
          <Separator class="my-2" />
          <dl class="space-y-1.5">
            <div v-if="data.unclaimedMinutes > 0" class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Unclaimed</dt>
              <dd class="font-medium tabular-nums">{{ formatMinutes(data.unclaimedMinutes) }}</dd>
            </div>
            <div v-if="data.pooledMinutes > 0" class="flex justify-between gap-2">
              <dt class="text-muted-foreground">In a pool</dt>
              <dd class="font-medium tabular-nums">{{ formatMinutes(data.pooledMinutes) }}</dd>
            </div>
            <div v-for="holder in holders" :key="holder.staffId" class="flex justify-between gap-2">
              <dt class="min-w-0 truncate text-muted-foreground">
                {{ holderName(holder) }}
                <span v-if="holder.holds > 1" class="text-xs">· {{ holder.holds }} holds</span>
              </dt>
              <dd class="shrink-0 font-medium tabular-nums">{{ formatMinutes(holder.minutes) }}</dd>
            </div>
            <p v-if="!holders.length && data.unclaimedMinutes === 0 && data.pooledMinutes === 0" class="text-xs text-muted-foreground">Nothing to split yet.</p>
          </dl>
        </template>
        <p v-else class="mt-2 text-xs text-muted-foreground">
          The split by holder could not be reconciled with the total, so only the total is shown.
        </p>
      </template>
    </CardContent>
  </Card>
</template>
