<script setup lang="ts">
import { computed } from 'vue'
import { ClockIcon } from '@lucide/vue'
import type { SlaStatus, TaskStatus } from '~/utils/clientFakeApi'
import { dueLabel, runningDueAt, slaState } from '~/utils/task-ui'
import { useNow } from '~/composables/useNow'

const props = defineProps<{
  task: {
    responseSlaStatus: SlaStatus
    resolutionSlaStatus: SlaStatus
    responseDueAt?: string | null
    resolutionDueAt?: string | null
  }
  /** The task's status, which decides which SLA clock is still running. */
  status?: TaskStatus
  /** Show the live countdown alongside the state. Off on dense cards. */
  showCountdown?: boolean
}>()

const state = computed(() => slaState(props.task))

/** Shared ticking clock, so every badge counts down live and in step. */
const now = useNow()

/**
 * Only the clock that is actually running: the response target until the task
 * is picked up, the resolution target after that. Submitted or closed work
 * shows no countdown at all — its clock stopped and the verdict badge says how
 * it went. Once breached the label says when it was due as well as by how much.
 */
const countdown = computed(() => {
  if (!props.showCountdown) return null
  const due = props.status ? runningDueAt({ status: props.status, ...props.task }) : props.task.resolutionDueAt ?? null
  return dueLabel(due, now.value)
})

/**
 * SLA urgency is the ONE thing these colours mean here: red for breached,
 * amber for due within the half hour, neutral otherwise. Lifecycle status has
 * its own pill and never borrows them.
 */
const COUNTDOWN_TONE = {
  ok: 'bg-muted text-muted-foreground',
  soon: 'bg-warning-tint text-warning-tint-foreground',
  breached: 'bg-destructive/10 text-destructive',
} as const

const meta = computed(() => {
  switch (state.value) {
    case 'BREACHED': return { label: 'SLA breached', cls: 'bg-destructive/10 text-destructive' }
    case 'ON_TIME': return { label: 'On time', cls: 'bg-success/10 text-success' }
    default: return null
  }
})
</script>

<template>
  <span v-if="meta || countdown" class="inline-flex flex-wrap items-center justify-end gap-1.5">
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
      class="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
      :class="COUNTDOWN_TONE[countdown.tone]"
    >
      <ClockIcon v-if="!meta" class="h-3 w-3" />
      {{ countdown.label }}
    </span>
  </span>
</template>
