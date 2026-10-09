<script setup lang="ts">
import { computed } from 'vue'
import { CalendarClockIcon, CheckIcon, ClockAlertIcon, ClockIcon } from '@lucide/vue'
import type { SlaStatus, TaskDetail } from '~/utils/clientFakeApi'
import { formatClockTime, isOpen } from '~/utils/task-ui'
import { CLOCK_WORDS, statusSignal } from '~/utils/task-signals'
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
 * met, red missed, neutral still running — and each tick's legend entry
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
  ON_TIME: { tick: 'bg-success', text: 'text-success-tint-foreground' },
  BREACHED: { tick: 'bg-destructive', text: 'text-danger-tint-foreground' },
  EMPTY: { tick: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
}

function tickClass(marker: TimelineMarker) {
  if (marker.kind === 'now') return 'bg-foreground'
  if (marker.kind === 'due') return 'bg-muted-foreground/60'
  return VERDICT_TONE[marker.verdict ?? 'EMPTY'].tick
}

function markerLabel(marker: TimelineMarker) {
  switch (marker.kind) {
    case 'response': return CLOCK_WORDS.response
    case 'resolution': return CLOCK_WORDS.resolution
    case 'due': return 'Due'
    default: return 'Now'
  }
}

/**
 * What the clock did, in words: the actual time taken when it has stopped,
 * otherwise that it is still running. The verdict's tone colours the words.
 *
 * "Took" is the API's own measure (2026-09-02 SLA spec): open-hours minutes
 * from activation to the moment work started (response) or stopped
 * (resolution), stamped together with the verdict. The number is read only
 * when a verdict exists — while the resolution verdict is EMPTY after a review
 * bounce, `resolutionDuration` still holds the superseded attempt and must not
 * be shown as if it measured the rework in progress.
 */
function markerOutcome(marker: TimelineMarker) {
  if (marker.kind === 'now' || marker.kind === 'due') return null
  const minutes = marker.kind === 'response' ? props.task.responseDuration : props.task.resolutionDuration
  const tone = VERDICT_TONE[marker.verdict ?? 'EMPTY'].text
  switch (marker.verdict) {
    case 'ON_TIME': return { text: minutes === null ? 'met' : `met in ${formatDuration(minutes)}`, tone, icon: CheckIcon }
    case 'BREACHED': return { text: minutes === null ? 'missed' : `missed, took ${formatDuration(minutes)}`, tone, icon: ClockAlertIcon }
    default: {
      // A closed task whose clock never stamped (cancelled before claim, say)
      // has no verdict — saying "late" there would invent one.
      if (!isOpen(props.task.status)) return { text: 'not recorded', tone, icon: ClockIcon }
      const late = marker.at < now.value
      return { text: late ? 'late' : 'running', tone: late ? VERDICT_TONE.BREACHED.text : tone, icon: late ? ClockAlertIcon : ClockIcon }
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
  const phases = m.phases.map(p => `${statusSignal(p.status).label} ${formatDuration(p.minutes)}`).join(', ')
  const targets = targetMarkers.value.map(t => `${markerLabel(t)} ${formatClockTime(new Date(t.at).toISOString())}`).join(', ')
  return `Timeline from ${formatAxisTime(m.start, span.value)} to ${formatAxisTime(m.end, span.value)}. Phases: ${phases}. ${targets}.`
})
</script>

<template>
  <div v-if="model" class="space-y-2">
    <!-- The strip. Ticks sit above the track, the now line runs through it. -->
    <div class="relative pt-3 pb-1" role="img" :aria-label="summary">
      <div class="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        <span
          v-for="phase in model.phases"
          :key="`${phase.status}-${phase.from}`"
          class="absolute inset-y-0 rounded-full ring-2 ring-background"
          :class="statusSignal(phase.status).dot"
          :style="{ left: `${phase.left}%`, width: `${Math.max(phase.width, 0.75)}%` }"
          :title="`${statusSignal(phase.status).label} · ${formatDuration(phase.minutes)}`"
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
          class="absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full ring-2 ring-background"
          :class="tickClass(marker)"
          :style="{ left: `${marker.left}%` }"
          :title="`${markerLabel(marker)} ${formatClockTime(new Date(marker.at).toISOString())}`"
          aria-hidden="true"
        />
      </template>
    </div>

    <div class="flex justify-between text-xs font-bold tabular-nums text-muted-foreground" aria-hidden="true">
      <span>{{ formatAxisTime(model.start, span) }}</span>
      <span>{{ formatAxisTime(model.end, span) }}</span>
    </div>

    <p v-if="model.scheduled" class="flex items-center gap-1.5 text-sm text-muted-foreground">
      <CalendarClockIcon class="size-4" aria-hidden="true" />
      Starts at <span class="font-bold">{{ formatClockTime(task.activationDate) }}</span>. The clock has not started yet.
    </p>

    <!-- Legend: phases with their durations, then each target with its verdict. -->
    <ul v-if="model.phases.length" class="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-hidden="true">
      <li v-for="phase in model.phases" :key="`legend-${phase.status}-${phase.from}`" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" :class="statusSignal(phase.status).dot" />
        <span class="font-semibold text-foreground">{{ statusSignal(phase.status).label }}</span>
        <span class="font-bold tabular-nums text-muted-foreground">{{ formatDuration(phase.minutes) }}{{ phase.current ? ' so far' : '' }}</span>
      </li>
    </ul>

    <ul v-if="targetMarkers.length" class="space-y-1.5 text-sm" aria-hidden="true">
      <li v-for="marker in targetMarkers" :key="`target-${marker.kind}`" class="flex items-center gap-1.5">
        <span class="h-3.5 w-0.5 rounded-full" :class="tickClass(marker)" />
        <span class="text-muted-foreground">{{ markerLabel(marker) }}</span>
        <span class="font-bold tabular-nums text-foreground">{{ formatClockTime(new Date(marker.at).toISOString()) }}</span>
        <template v-if="markerOutcome(marker)">
          <component :is="markerOutcome(marker)!.icon" class="size-3.5" :class="markerOutcome(marker)!.tone" />
          <span class="font-medium" :class="markerOutcome(marker)!.tone">{{ markerOutcome(marker)!.text }}</span>
        </template>
      </li>
    </ul>
  </div>
</template>
