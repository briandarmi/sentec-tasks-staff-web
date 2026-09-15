<script setup lang="ts">
import { computed } from 'vue'
import { CalendarClockIcon, CheckIcon, ClockIcon, TriangleAlertIcon } from '@lucide/vue'
import type { SlaStatus, TaskDetail } from '~/utils/clientFakeApi'
import { formatClockTime, isOpen, statusMeta } from '~/utils/task-ui'
import { buildTaskTimeline, formatAxisTime, formatDuration } from '~/utils/task-timeline'
import type { TimelineMarker } from '~/utils/task-timeline'
import { useNow } from '~/composables/useNow'

/**
 * The task's life on one horizontal axis: a strip of status phases (coloured
 * the way the pills and the list are), the two SLA targets and any hard due
 * date as ticks above it, and a "now" line while work is open.
 *
 * Colour means one thing per layer. Phase colours are lifecycle identity, the
 * same tokens as everywhere else. Tick colours are the clock's verdict — green
 * met, red breached, neutral still running — and each tick's legend entry
 * carries an icon and words, so the verdict never rests on colour alone.
 *
 * Every number lives in the legend beneath the strip, not on the strip, so
 * nothing collides on a phone-width track and touch users lose nothing to the
 * absence of hover.
 */
const props = defineProps<{ task: TaskDetail }>()

const now = useNow()
const model = computed(() => buildTaskTimeline(props.task, now.value))
const span = computed(() => (model.value ? model.value.end - model.value.start : 0))

const VERDICT_TONE: Record<SlaStatus, { tick: string, text: string }> = {
  ON_TIME: { tick: 'bg-success', text: 'text-success' },
  BREACHED: { tick: 'bg-destructive', text: 'text-destructive' },
  EMPTY: { tick: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
}

function tickClass(marker: TimelineMarker) {
  if (marker.kind === 'now') return 'bg-foreground'
  if (marker.kind === 'due') return 'bg-muted-foreground/60'
  return VERDICT_TONE[marker.verdict ?? 'EMPTY'].tick
}

function markerLabel(marker: TimelineMarker) {
  switch (marker.kind) {
    case 'response': return 'Respond by'
    case 'resolution': return 'Resolve by'
    case 'due': return 'Due'
    default: return 'Now'
  }
}

/**
 * What the clock did, in words: the actual time taken when it has stopped,
 * otherwise that it is still running. The verdict's tone colours the words.
 */
function markerOutcome(marker: TimelineMarker) {
  if (marker.kind === 'now' || marker.kind === 'due') return null
  const minutes = marker.kind === 'response' ? props.task.responseDuration : props.task.resolutionDuration
  const tone = VERDICT_TONE[marker.verdict ?? 'EMPTY'].text
  switch (marker.verdict) {
    case 'ON_TIME': return { text: minutes === null ? 'met' : `met in ${formatDuration(minutes)}`, tone, icon: CheckIcon }
    case 'BREACHED': return { text: minutes === null ? 'missed' : `missed, took ${formatDuration(minutes)}`, tone, icon: TriangleAlertIcon }
    default: {
      // A closed task whose clock never stamped (cancelled before claim, say)
      // has no verdict — saying "overdue" there would invent one.
      if (!isOpen(props.task.status)) return { text: 'not recorded', tone, icon: ClockIcon }
      const late = marker.at < now.value
      return { text: late ? 'overdue' : 'running', tone: late ? VERDICT_TONE.BREACHED.text : tone, icon: ClockIcon }
    }
  }
}

/** Legend rows for the targets only; "now" is self-evident on the strip. */
const targetMarkers = computed(() => model.value?.markers.filter(m => m.kind !== 'now') ?? [])

/** One sentence for screen readers, covering what the strip shows visually. */
const summary = computed(() => {
  const m = model.value
  if (!m) return ''
  if (m.scheduled) return `Timeline: activates at ${formatClockTime(props.task.activationDate)}.`
  const phases = m.phases.map(p => `${statusMeta(p.status).label} ${formatDuration(p.minutes)}`).join(', ')
  const targets = targetMarkers.value.map(t => `${markerLabel(t)} ${formatClockTime(new Date(t.at).toISOString())}`).join(', ')
  return `Timeline from ${formatAxisTime(m.start, span.value)} to ${formatAxisTime(m.end, span.value)}. Phases: ${phases}. ${targets}.`
})
</script>

<template>
  <div v-if="model" class="space-y-2">
    <!-- The strip. Ticks sit above the track, the now line runs through it. -->
    <div class="relative pt-3 pb-1" role="img" :aria-label="summary">
      <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          v-for="phase in model.phases"
          :key="`${phase.status}-${phase.from}`"
          class="absolute inset-y-0 rounded-full ring-2 ring-background"
          :class="statusMeta(phase.status).dot"
          :style="{ left: `${phase.left}%`, width: `${Math.max(phase.width, 0.75)}%` }"
          :title="`${statusMeta(phase.status).label} · ${formatDuration(phase.minutes)}`"
        />
      </div>

      <template v-for="marker in model.markers" :key="marker.kind">
        <span
          v-if="marker.kind === 'now'"
          class="absolute top-1.5 bottom-0 w-0.5 -translate-x-1/2 rounded-full"
          :class="tickClass(marker)"
          :style="{ left: `${marker.left}%` }"
          aria-hidden="true"
        />
        <span
          v-else
          class="absolute top-0 h-3.5 w-0.5 -translate-x-1/2 rounded-full ring-2 ring-background"
          :class="tickClass(marker)"
          :style="{ left: `${marker.left}%` }"
          :title="`${markerLabel(marker)} ${formatClockTime(new Date(marker.at).toISOString())}`"
          aria-hidden="true"
        />
      </template>
    </div>

    <div class="flex justify-between text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
      <span>{{ formatAxisTime(model.start, span) }}</span>
      <span>{{ formatAxisTime(model.end, span) }}</span>
    </div>

    <p v-if="model.scheduled" class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CalendarClockIcon class="h-3.5 w-3.5" />
      Activates at {{ formatClockTime(task.activationDate) }} — the SLA clock has not started.
    </p>

    <!-- Legend: phases with their durations, then each target with its verdict. -->
    <ul v-if="model.phases.length" class="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-hidden="true">
      <li v-for="phase in model.phases" :key="`legend-${phase.status}-${phase.from}`" class="flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-full" :class="statusMeta(phase.status).dot" />
        <span class="font-medium text-foreground">{{ statusMeta(phase.status).label }}</span>
        <span class="tabular-nums text-muted-foreground">{{ formatDuration(phase.minutes) }}{{ phase.current ? ' so far' : '' }}</span>
      </li>
    </ul>

    <ul v-if="targetMarkers.length" class="space-y-1 text-xs" aria-hidden="true">
      <li v-for="marker in targetMarkers" :key="`target-${marker.kind}`" class="flex items-center gap-1.5">
        <span class="h-3 w-0.5 rounded-full" :class="tickClass(marker)" />
        <span class="text-muted-foreground">{{ markerLabel(marker) }}</span>
        <span class="font-medium tabular-nums text-foreground">{{ formatClockTime(new Date(marker.at).toISOString()) }}</span>
        <template v-if="markerOutcome(marker)">
          <component :is="markerOutcome(marker)!.icon" class="h-3 w-3" :class="markerOutcome(marker)!.tone" />
          <span :class="markerOutcome(marker)!.tone">{{ markerOutcome(marker)!.text }}</span>
        </template>
      </li>
    </ul>
  </div>
</template>
