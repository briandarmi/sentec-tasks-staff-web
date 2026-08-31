<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

/**
 * Sentinel Tech Design System dialog header.
 *
 * The kit (`components/overlay/Dialog.jsx`) separates the title from the body
 * with a full-bleed hairline. `DialogContent` carries the padding, so the rule
 * is pulled out to the panel edge with negative margins and the padding is
 * re-applied here — which is why this assumes the `p-6` that both
 * `DialogContent` and `DialogScrollContent` set.
 *
 * `divided` is an escape hatch for the occasional dialog whose header is a
 * graphic or an illustration rather than a title, where a rule reads as debris.
 */
const props = withDefaults(defineProps<{
  class?: HTMLAttributes["class"]
  divided?: boolean
}>(), {
  divided: true,
})
</script>

<template>
  <div
    data-slot="dialog-header"
    :class="cn(
      'flex flex-col gap-2 text-center sm:text-left',
      props.divided && 'border-border -mx-6 -mt-6 border-b px-6 pt-[18px] pb-4',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
