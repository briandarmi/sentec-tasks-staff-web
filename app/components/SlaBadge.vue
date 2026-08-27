<script setup lang="ts">
import { computed } from 'vue'
import { ClockIcon } from '@lucide/vue'
import type { SlaStatus } from '~/utils/clientFakeApi'
import { dueIn, slaState } from '~/utils/task-ui'

const props = defineProps<{
  task: {
    responseSlaStatus: SlaStatus
    resolutionSlaStatus: SlaStatus
    responseDueAt?: string | null
    resolutionDueAt?: string | null
  }
  /** The task's status, which decides which SLA clock is still running. */
  status?: string
  /** Show the live countdown alongside the state. Off on dense cards. */
  showCountdown?: boolean
}>()

const state = computed(() => slaState(props.task))

/**
 * Which clock is actually running: until the task is picked up it is the
 * response target, after that the resolution target. Showing the wrong one is
 * worse than showing none, so a finished task shows no countdown at all.
 */
const countdown = computed(() => {
  if (!props.showCountdown) return null
  if (props.status && !['NEW', 'IN_PROGRESS', 'PENDING'].includes(props.status)) return null
  const due = props.status === 'NEW' ? props.task.responseDueAt : props.task.resolutionDueAt
  return dueIn(due ?? null)
})

const meta = computed(() => {
  switch (state.value) {
    case 'BREACHED': return { label: 'SLA breached', cls: 'bg-destructive/10 text-destructive' }
    case 'ON_TIME': return { label: 'On time', cls: 'bg-success/10 text-success' }
    default: return null
  }
})
</script>

<template>
  <span v-if="meta || countdown" class="inline-flex items-center gap-1.5">
    <span
      v-if="meta"
      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      :class="meta.cls"
    >
      <ClockIcon class="h-3 w-3" />
      {{ meta.label }}
    </span>
    <span
      v-if="countdown"
      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
      :class="countdown.overdue ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'"
    >
      <ClockIcon v-if="!meta" class="h-3 w-3" />
      {{ countdown.label }}
    </span>
  </span>
</template>
