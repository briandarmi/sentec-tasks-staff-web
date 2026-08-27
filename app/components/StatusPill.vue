<script setup lang="ts">
import { computed } from 'vue'
import type { TaskStatus } from '~/utils/clientFakeApi'
import { statusMeta } from '~/utils/task-ui'

const props = defineProps<{ status: TaskStatus }>()

const meta = computed(() => statusMeta(props.status))
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
    :class="meta.badge"
  >
    <span class="h-1.5 w-1.5 rounded-full" :class="meta.dot" />
    {{ meta.label }}
  </span>
</template>
