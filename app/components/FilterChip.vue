<script setup lang="ts">
import type { Component } from 'vue'

/**
 * A pill in a scrolling filter strip: 44px tall so it is a real thumb target,
 * with an icon or a status dot, the label, and an optional count. Pass
 * `role`, `aria-pressed` or `aria-checked` through from the call site.
 */
defineProps<{
  label: string
  active?: boolean
  icon?: Component
  /** A solid dot's classes, when there is no icon (board columns). */
  dot?: string
  count?: number | string | null
  disabled?: boolean
}>()
</script>

<template>
  <button
    type="button"
    class="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint disabled:opacity-50"
    :class="active
      ? 'border-primary/40 bg-primary-tint text-primary-tint-foreground'
      : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent'"
    :disabled="disabled"
  >
    <component :is="icon" v-if="icon" class="size-4 shrink-0" aria-hidden="true" />
    <span v-else-if="dot" class="size-2.5 shrink-0 rounded-full" :class="dot" aria-hidden="true" />
    {{ label }}
    <span
      v-if="count !== undefined && count !== null"
      class="rounded-full px-1.5 py-0.5 text-xs tabular-nums"
      :class="active ? 'bg-background/70' : 'bg-muted'"
    >{{ count }}</span>
  </button>
</template>
