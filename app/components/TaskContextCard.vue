<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PuzzleIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSourceApps } from '~/composables/useSourceApps'
import type { TaskContextEntry } from '~/utils/clientFakeApi'

/**
 * Structured, system-supplied context (GET /v1/tasks/{id}/context): facts a
 * partner app attached — "Loyalty tier: Platinum" from the PMS — kept apart
 * from human-authored notes. Renders nothing when there is none, and a load
 * failure costs only this card, never the task page.
 */
const props = defineProps<{ taskId: string }>()

const api = useTasksApi()
const sourceApps = useSourceApps()

const entries = ref<TaskContextEntry[]>([])

onMounted(async () => {
  void sourceApps.ensureLoaded()
  try {
    entries.value = await api.getTaskContext(props.taskId)
  }
  catch {
    entries.value = []
  }
})
</script>

<template>
  <Card v-if="entries.length">
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-sm">
        <PuzzleIcon class="h-4 w-4" /> From connected apps
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-2 text-sm">
      <div v-for="entry in entries" :key="entry.id" class="flex items-center gap-2">
        <span
          v-if="sourceApps.badge(entry.sourceAppCode)?.color"
          class="h-1.5 w-1.5 shrink-0 rounded-full"
          :style="{ backgroundColor: sourceApps.badge(entry.sourceAppCode)!.color! }"
          aria-hidden="true"
        />
        <span class="text-muted-foreground">{{ entry.label }}</span>
        <span class="ml-auto min-w-0 truncate text-right font-medium">
          <a v-if="entry.url" :href="entry.url" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">{{ entry.value }}</a>
          <template v-else>{{ entry.value }}</template>
        </span>
      </div>
    </CardContent>
  </Card>
</template>
