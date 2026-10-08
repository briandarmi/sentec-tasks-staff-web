<script setup lang="ts">
import { computed } from 'vue'
import type { SignalInput } from '~/utils/task-signals'
import { clockSignals } from '~/utils/task-signals'
import { useNow } from '~/composables/useNow'

/**
 * The clock chip: the live countdown while the work runs (and "Picked up
 * late" beside it when that already happened), or the stamped verdict once it
 * has stopped. Nothing at all when the task has no clock.
 */
const props = defineProps<{ task: SignalInput }>()

/** Shared ticking clock, so every chip counts down live and in step. */
const now = useNow()

const signals = computed(() => clockSignals(props.task, now.value))
</script>

<template>
  <span v-if="signals.length" class="inline-flex flex-wrap items-center justify-end gap-1.5">
    <SignalChip
      v-for="signal in signals"
      :key="signal.kind"
      :heat="signal.heat"
      :icon="signal.icon"
      :label="signal.label"
      :title="signal.detail"
      class="tabular-nums"
    />
  </span>
</template>
