<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

/**
 * Sentinel Tech Design System card.
 *
 * Ported from the design system's React kit (`components/core/Card.jsx`): a
 * 16px radius, a 1px neutral border and the kit's own soft shadow scale rather
 * than Tailwind's. `hoverable` is the kit's prop of the same name — a 2px lift
 * onto the next shadow step over 200ms. It stays opt-in because most cards in
 * these consoles are containers, not targets, and a lift on a non-interactive
 * surface reads as a false affordance.
 *
 * The transition names `translate`, NOT `transform`. Tailwind 4 moved
 * translate/scale/rotate off the `transform` shorthand onto their own CSS
 * properties, so `-translate-y-0.5` compiles to `translate: …`. Transitioning
 * `transform` here animates a property that never changes, which leaves the
 * lift snapping instantly and the hover reading as no effect at all.
 */
const props = defineProps<{
  class?: HTMLAttributes["class"]
  hoverable?: boolean
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'bg-card text-card-foreground flex flex-col gap-6 rounded-2xl border py-6 shadow-ds-sm',
        props.hoverable && 'transition-[box-shadow,translate] duration-200 ease-ds hover:-translate-y-0.5 hover:shadow-ds-md',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
