<script setup lang="ts">
import { computed } from 'vue'
import type { Heat, Signal } from '~/utils/task-signals'
import { HEAT_TONE } from '~/utils/task-signals'

/**
 * The task's traffic light, spelled out: one band at the top of the detail
 * page, in the heat's tone, listing every reason in a plain sentence each.
 * Shown only when something is amber or red — a calm task gets no banner.
 */
const props = defineProps<{ heat: Heat, signals: Signal[] }>()

const visible = computed(() => props.heat === 'late' || props.heat === 'soon')
const reasons = computed(() => props.signals.filter(signal => signal.heat === 'late' || signal.heat === 'soon'))
const headline = computed(() => (props.heat === 'late' ? 'Needs attention now' : 'Due soon'))
const headIcon = computed(() => reasons.value[0]?.icon)
</script>

<template>
  <div
    v-if="visible"
    role="status"
    class="rounded-xl border px-4 py-3"
    :class="HEAT_TONE[heat].band"
  >
    <p class="flex items-center gap-2 text-base font-bold">
      <component :is="headIcon" v-if="headIcon" class="size-5 shrink-0" aria-hidden="true" />
      {{ headline }}
    </p>
    <ul class="mt-1.5 space-y-1 text-sm font-medium">
      <li v-for="signal in reasons" :key="signal.kind" class="flex items-start gap-2">
        <component :is="signal.icon" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{{ signal.detail }}</span>
      </li>
    </ul>
  </div>
</template>
