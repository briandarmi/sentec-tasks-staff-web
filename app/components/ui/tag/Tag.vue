<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

/**
 * Sentinel Tech Design System tag.
 *
 * Ported from the design system's React kit (`components/feedback/Tag.jsx`).
 * shadcn-vue has no equivalent: `badge` is a status pill with no affordance and
 * `tags-input` is an input control, whereas this is a removable chip — a pale
 * pill with a border and an optional round remove button.
 *
 * The kit hardcodes a white fill; this uses `bg-card` so the chip survives dark
 * mode, and `currentColor` on the glyph so the button's hover state carries it.
 */
const props = defineProps<{
  class?: HTMLAttributes["class"]
  removable?: boolean
  removeLabel?: string
}>()

const emit = defineEmits<{
  (e: "remove"): void
}>()
</script>

<template>
  <span
    data-slot="tag"
    :class="cn(
      'inline-flex w-fit items-center gap-1.5 rounded-full border bg-card py-1 pl-3 text-sm whitespace-nowrap text-foreground',
      props.removable ? 'pr-1.5' : 'pr-3',
      props.class,
    )"
  >
    <slot />
    <button
      v-if="props.removable"
      type="button"
      :aria-label="props.removeLabel ?? 'Remove'"
      class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground transition-colors duration-[120ms] ease-ds hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
      @click="emit('remove')"
    >
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
  </span>
</template>
