<script setup lang="ts">
/**
 * Everything above a page's list — heading, actions, search, filters, tabs —
 * as one block that sticks under the top bar (its 56px plus the notch inset)
 * and ends in a rule, so the controls stay in reach however far the list
 * scrolls. Full-bleed against the layout's 16px page padding and pulled up
 * flush under the top bar, so it reads as part of the chrome rather than a
 * card that happens to float.
 *
 * The fill is the page's own colour: the layout lays muted at 20% over the
 * body background, and this is that composite as one opaque colour, so cards
 * slide under the block without showing through and the block never reads
 * lighter than the page around it.
 *
 * Keep it to the controls. Error alerts, notices and skeletons belong below
 * it, scrolling with the content — on a phone the block must leave most of
 * the screen to the list it serves. Rows inside sit 8px apart; 44px rows,
 * never stacked labels.
 *
 * `flush` is for a block whose last row is a tab rail (`Tabs`): the bottom
 * padding goes, and the rail's own hairline is pulled down one pixel to sit on
 * the block's rule, so the tabs end exactly where the block does and the two
 * lines read as one. The active trigger's 2px underline already overhangs the
 * rail by a pixel, so it lands on the rule too.
 *
 * Assumes the default layout (`px-4 pt-4` on main, `min-h-14` top bar at
 * z-30); z-20 keeps it under the top bar and the bottom nav and over cards.
 */
defineProps<{ flush?: boolean }>()
</script>

<template>
  <div
    class="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 -mt-4 space-y-2 border-b bg-[color-mix(in_srgb,var(--color-muted)_20%,var(--color-background))] px-4 pt-3"
    :class="flush ? 'pb-0 [&>[data-slot=tabs]:last-child]:-mb-px' : 'pb-3'"
  >
    <slot />
  </div>
</template>
