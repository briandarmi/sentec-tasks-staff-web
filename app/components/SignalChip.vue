<script setup lang="ts">
import type { Component } from 'vue'
import type { Heat } from '~/utils/task-signals'
import { HEAT_TONE } from '~/utils/task-signals'

/**
 * One signal as a chip: an icon that says why, a tint that says how much.
 * Not a tap target, so 28px tall is enough; the text is never under 12px.
 */
withDefaults(defineProps<{
  label: string
  heat?: Heat
  icon?: Component
  /** The plain sentence behind the chip, for hover and assistive tech. */
  title?: string
}>(), { heat: 'none' })
</script>

<template>
  <span
    class="inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold leading-none"
    :class="HEAT_TONE[heat].chip"
    :title="title"
  >
    <component :is="icon" v-if="icon" class="size-3.5 shrink-0" aria-hidden="true" />
    {{ label }}
  </span>
</template>
