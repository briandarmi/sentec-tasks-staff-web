<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDaysIcon, ChevronRightIcon } from '@lucide/vue'
import type { Project } from '~/utils/clientFakeApi'
import { formatLocalDate } from '~/utils/recurrence'
import { projectLevelLabel, projectStatusMeta } from '~/utils/project-ui'

const props = defineProps<{ project: Project }>()

const status = computed(() => projectStatusMeta(props.project.status))
const dates = computed(() => {
  const from = props.project.startDate ? formatLocalDate(props.project.startDate) : ''
  const until = props.project.endDate ? formatLocalDate(props.project.endDate) : ''
  if (from && until) return `${from} – ${until}`
  if (from) return `From ${from}`
  if (until) return `Until ${until}`
  return ''
})
const progress = computed(() => props.project.progress)
</script>

<template>
  <NuxtLink
    :to="`/projects/${project.id}`"
    class="block rounded-xl border border-l-[3px] bg-card p-3.5 shadow-sm transition-colors active:bg-accent/50 hover:bg-accent/30"
    :class="project.late ? 'border-l-destructive' : project.status === 'ACTIVE' ? 'border-l-primary' : 'border-l-transparent'"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">{{ project.name }}</p>
      <ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </div>
    <p v-if="project.description" class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{{ project.description }}</p>

    <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
      <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="status.badge">
        <span class="h-1.5 w-1.5 rounded-full" :class="status.dot" />
        {{ status.label }}
      </span>
      <!-- Late is the one red thing here: past its end date with work still open. -->
      <Badge v-if="project.late" variant="destructive" class="text-[10px]">Late</Badge>
      <Badge v-if="project.needsManager" variant="outline" class="border-warning/50 text-[10px] text-warning-tint-foreground">Needs manager</Badge>
      <Badge v-if="project.myLevel" variant="secondary" class="ml-auto text-[10px]">{{ projectLevelLabel(project.myLevel) }}</Badge>
    </div>

    <div class="mt-3 space-y-1.5">
      <div class="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
        <span class="tabular-nums">{{ progress.percent }}% · {{ progress.done }} of {{ progress.total }} done</span>
        <span class="flex items-center gap-2 tabular-nums">
          <span v-if="progress.overdue" class="text-destructive">{{ progress.overdue }} overdue</span>
          <span v-if="progress.unassigned">{{ progress.unassigned }} unassigned</span>
        </span>
      </div>
      <Progress :model-value="progress.percent" :aria-label="`${progress.percent}% done`" />
    </div>

    <p v-if="dates" class="mt-2.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <CalendarDaysIcon class="h-3 w-3" aria-hidden="true" /> {{ dates }}
    </p>
  </NuxtLink>
</template>
