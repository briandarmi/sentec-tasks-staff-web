<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDaysIcon, ChevronRightIcon, ClockAlertIcon, UserRoundXIcon } from '@lucide/vue'
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
    class="block rounded-2xl border border-l-4 bg-card p-4 shadow-sm transition-colors hover:bg-accent/30 active:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
    :class="project.late ? 'border-l-destructive' : project.status === 'ACTIVE' ? 'border-l-primary' : 'border-l-transparent'"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="min-w-0 flex-1 text-base font-semibold leading-snug text-foreground">{{ project.name }}</p>
      <ChevronRightIcon class="size-5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
    </div>
    <p v-if="project.description" class="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{{ project.description }}</p>

    <div class="mt-3 flex flex-wrap items-center gap-1.5">
      <!-- Late is the one red thing here: past its end date with work still open. -->
      <SignalChip v-if="project.late" heat="late" :icon="ClockAlertIcon" label="Late" title="Past its end date with work still open." />
      <SignalChip v-if="project.needsManager" heat="soon" :icon="UserRoundXIcon" label="Needs a manager" title="Nobody manages this project right now." />
      <span class="inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold leading-none" :class="status.badge">
        <component :is="status.icon" class="size-3.5 shrink-0" aria-hidden="true" />
        {{ status.label }}
      </span>
      <Badge v-if="project.myLevel" variant="secondary" class="ml-auto min-h-7">{{ projectLevelLabel(project.myLevel) }}</Badge>
    </div>

    <div class="mt-3 space-y-1.5">
      <div class="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span class="tabular-nums">{{ progress.percent }}% · {{ progress.done }} of {{ progress.total }} done</span>
        <span class="flex items-center gap-2 tabular-nums">
          <span v-if="progress.overdue" class="font-bold text-danger-tint-foreground">{{ progress.overdue }} late</span>
          <span v-if="progress.unassigned">{{ progress.unassigned }} unassigned</span>
        </span>
      </div>
      <Progress :model-value="progress.percent" :aria-label="`${progress.percent}% done`" />
    </div>

    <p v-if="dates" class="mt-3 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
      <CalendarDaysIcon class="size-3.5" aria-hidden="true" /> {{ dates }}
    </p>
  </NuxtLink>
</template>
