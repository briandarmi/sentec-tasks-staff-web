<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  /** Optional illustrative icon. */
  icon?: Component
  /** Headline (e.g. "No hotels yet"). */
  title: string
  /** Optional supporting sentence. */
  description?: string
  /** Render as a plain block (no dashed border / card surface). */
  bare?: boolean
}>()
</script>

<template>
  <div
    class="flex flex-col items-center justify-center px-6 py-12 text-center"
    :class="bare ? '' : 'rounded-2xl border border-dashed bg-card/40'"
  >
    <div
      v-if="icon"
      class="mb-4 flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
    >
      <component :is="icon" class="size-7" aria-hidden="true" />
    </div>
    <h3 class="text-lg font-bold text-foreground">
      {{ title }}
    </h3>
    <p v-if="description" class="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-5">
      <slot />
    </div>
  </div>
</template>
