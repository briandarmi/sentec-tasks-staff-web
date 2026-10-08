<script setup lang="ts">
import { computed } from 'vue'
import type { RecurrenceKind } from '~/utils/clientFakeApi'
import { RECURRENCE_KINDS, RECURRENCE_KIND_LABEL, WEEKDAY_PICKER_ORDER, WEEKDAY_SHORT, draftToRecurrence, recurrenceSummary } from '~/utils/recurrence'
import type { RecurrenceDraft } from '~/utils/recurrence'

/**
 * The schedule half of a recurring task: kind, time of day, weekdays (0 =
 * Sunday on the wire, working week first on screen), day of month 1–28, and
 * an optional hotel-local window. Binds to a `RecurrenceDraft`; the parent
 * converts with `draftToRecurrence` at submit time and gets the API's rules
 * applied for free. `timezone` is only for the caption — the API interprets
 * every value in the hotel's zone whatever the device says.
 */
const props = defineProps<{
  modelValue: RecurrenceDraft
  timezone?: string | null
  /** Prefix for the input ids, so two editors on one page do not collide. */
  idPrefix?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [RecurrenceDraft] }>()

const prefix = computed(() => props.idPrefix ?? 'recurrence')

function patch(partial: Partial<RecurrenceDraft>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

function toggleWeekday(day: number) {
  const set = new Set(props.modelValue.weekdays)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  patch({ weekdays: [...set].sort((a, b) => a - b) })
}

/** The live wording of what is set, or the rule the draft breaks. */
const preview = computed(() => {
  const result = draftToRecurrence(props.modelValue)
  return result.ok ? { text: recurrenceSummary(result.recurrence), problem: false } : { text: result.error, problem: true }
})
</script>

<template>
  <div class="space-y-3">
    <div class="space-y-2">
      <Label>Repeats</Label>
      <div role="radiogroup" aria-label="How often" class="grid grid-cols-3 gap-1.5">
        <button
          v-for="kind in RECURRENCE_KINDS"
          :key="kind"
          type="button"
          role="radio"
          :aria-checked="modelValue.kind === kind"
          class="min-h-11 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
          :class="modelValue.kind === kind ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
          @click="patch({ kind: kind as RecurrenceKind })"
        >
          {{ RECURRENCE_KIND_LABEL[kind] }}
        </button>
      </div>
    </div>

    <div v-if="modelValue.kind === 'WEEKLY'" class="space-y-2">
      <Label>On</Label>
      <div class="grid grid-cols-7 gap-1" role="group" aria-label="Weekdays">
        <button
          v-for="day in WEEKDAY_PICKER_ORDER"
          :key="day"
          type="button"
          :aria-pressed="modelValue.weekdays.includes(day)"
          class="min-h-11 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
          :class="modelValue.weekdays.includes(day) ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
          @click="toggleWeekday(day)"
        >
          {{ WEEKDAY_SHORT[day] }}
        </button>
      </div>
    </div>

    <div class="grid gap-3" :class="modelValue.kind === 'MONTHLY' ? 'grid-cols-2' : 'grid-cols-1'">
      <div v-if="modelValue.kind === 'MONTHLY'" class="space-y-2">
        <Label :for="`${prefix}-day`">Day of month</Label>
        <Input
          :id="`${prefix}-day`"
          type="number"
          inputmode="numeric"
          min="1"
          max="28"
          class="min-h-11"
          :model-value="modelValue.dayOfMonth"
          @update:model-value="value => patch({ dayOfMonth: Number(value) })"
        />
      </div>
      <div class="space-y-2">
        <Label :for="`${prefix}-time`">At</Label>
        <Input
          :id="`${prefix}-time`"
          type="time"
          class="min-h-11"
          :model-value="modelValue.time"
          @update:model-value="value => patch({ time: String(value ?? '') })"
        />
      </div>
    </div>
    <p v-if="modelValue.kind === 'MONTHLY'" class="text-xs text-muted-foreground">1 to 28, so every month has the day.</p>

    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-2">
        <Label :for="`${prefix}-starts`">From (optional)</Label>
        <Input
          :id="`${prefix}-starts`"
          type="date"
          class="min-h-11"
          :model-value="modelValue.startsOn"
          @update:model-value="value => patch({ startsOn: String(value ?? '') })"
        />
      </div>
      <div class="space-y-2">
        <Label :for="`${prefix}-ends`">Until (optional)</Label>
        <Input
          :id="`${prefix}-ends`"
          type="date"
          class="min-h-11"
          :model-value="modelValue.endsOn"
          @update:model-value="value => patch({ endsOn: String(value ?? '') })"
        />
      </div>
    </div>

    <p class="text-xs" :class="preview.problem ? 'text-destructive' : 'text-muted-foreground'" aria-live="polite">
      {{ preview.text }}<template v-if="!preview.problem"> · {{ timezone ? `${timezone} time` : 'hotel time' }}</template>
    </p>
  </div>
</template>
