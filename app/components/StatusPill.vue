<script setup lang="ts">
import { computed } from 'vue'
import type { TaskStatus } from '~/utils/clientFakeApi'
import { statusSignal } from '~/utils/task-signals'

/** Lifecycle status: its own icon and tone, never the traffic light. */
const props = defineProps<{ status: TaskStatus }>()

const meta = computed(() => statusSignal(props.status))
</script>

<template>
  <span
    class="inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold leading-none"
    :class="meta.chip"
    :title="meta.term !== meta.label ? meta.term : undefined"
  >
    <component :is="meta.icon" class="size-3.5 shrink-0" aria-hidden="true" />
    {{ meta.label }}
  </span>
</template>
