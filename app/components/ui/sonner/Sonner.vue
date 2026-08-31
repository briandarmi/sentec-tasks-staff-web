<script lang="ts" setup>
import type { ToasterProps } from "vue-sonner"
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon, XIcon } from "@lucide/vue"
import { Toaster as Sonner } from "vue-sonner"
// vue-sonner ships its layout as a separate stylesheet and nothing was loading
// it. Without this import the toast has no flex layout, no radius and no
// shadow — the icon, title and description simply stack — and every CSS
// variable set below is inert, because the rules that read them don't exist.
import "vue-sonner/style.css"
import { cn } from "@/lib/utils"

/**
 * Sentinel Tech Design System toast.
 *
 * The kit (`components/feedback/Toast.jsx`) is a 340px panel on the deepest
 * shadow step, marked by a 4px left border in the tone's colour, with a
 * semibold title over a muted description.
 *
 * Two things make this component look the way it does:
 *
 *  - **Inline `style` for anything sonner exposes as a variable.** Inline wins
 *    over every stylesheet, so width, radius and the surface colours are set
 *    there and can't be lost to load order.
 *  - **A plain stylesheet for everything it doesn't.** Sonner styles the toast
 *    at `[data-sonner-toast][data-styled='true']` — specificity 0,2,0 — and its
 *    description at 0,3,0. A Tailwind utility class is 0,1,0 and loses to both,
 *    which is why this is CSS with a leading `[data-sonner-toaster]` rather
 *    than classes passed through `toastOptions`. Caller-supplied `toastOptions`
 *    still pass straight through, untouched.
 *
 * Sonner also hardcodes `#3f3f3f` on the description and a `system-ui` font
 * stack on the container; both are overridden below so the toast follows the
 * theme and renders in Quicksand.
 *
 * Tone is never carried by the stripe alone — every type keeps its leading
 * icon — so the toast still reads without colour vision. The info stripe uses
 * `--info`, the design system's fourth semantic tone, which resolves to Sentinel
 * Blue because that is how the system draws info.
 */
// `closeButtonPosition` is deliberately not set: it only feeds the
// --toast-close-button-* offsets, which no longer apply now that dismiss is a
// static row item rather than an absolutely positioned corner chip.
const props = defineProps<ToasterProps>()
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      'fontFamily': 'inherit',
      '--width': '340px',
      '--border-radius': 'var(--radius)',
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--toast-icon-margin-end': '0px',
      '--toast-svg-margin-end': '0px',
    }"
    v-bind="props"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>

<!--
  Deliberately unscoped: sonner renders the toast list in its own subtree, so a
  scoped attribute would never reach these elements. Every selector is
  sonner-specific, so nothing here leaks into the rest of the app.
-->
<style>
/* The kit's panel: 14/16 padding, a 12px gutter, and content aligned to the top
   so a two-line description doesn't drag the icon down the panel. */
[data-sonner-toaster] [data-sonner-toast][data-styled='true'] {
  padding: 14px 16px;
  gap: 12px;
  align-items: flex-start;
  font-size: 0.875rem;
  border-left-width: 4px;
  border-left-style: solid;
  border-left-color: var(--info);
  box-shadow: var(--ds-shadow-lg);
}

/* The tone stripe. These tie with the rule above on specificity and win on
   source order, so they must stay below it. `loading` has no kit tone and
   takes a neutral stripe rather than losing the border. */
[data-sonner-toaster] [data-sonner-toast][data-type='info'],
[data-sonner-toaster] [data-sonner-toast][data-type='default'] {
  border-left-color: var(--info);
}
[data-sonner-toaster] [data-sonner-toast][data-type='success'] {
  border-left-color: var(--success);
}
[data-sonner-toaster] [data-sonner-toast][data-type='warning'] {
  border-left-color: var(--warning);
}
[data-sonner-toaster] [data-sonner-toast][data-type='error'] {
  border-left-color: var(--destructive);
}
[data-sonner-toaster] [data-sonner-toast][data-type='loading'] {
  border-left-color: var(--muted-foreground);
}

[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-title] {
  font-weight: 600;
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--popover-foreground);
}

/* Overrides sonner's hardcoded #3f3f3f, which ignores the theme entirely. */
[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-description] {
  margin-top: 2px;
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--muted-foreground);
}

[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-icon] {
  margin-top: 1px;
}

/* Dismiss sits INSIDE the panel, as a row item — the kit renders it as a flex
   sibling after the text, not as a chip straddling the border. Sonner instead
   positions it absolutely in a corner and pushes it 35% back out over the edge,
   so both the absolute positioning and that transform are undone here.

   `order` is needed because sonner renders the close button as the FIRST child,
   ahead of the icon and the content; without it, going static would drop the ×
   on the left. Tab order is unchanged by this — it already reached the button
   first, since sonner's DOM order was always ahead of the visual position. */
[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-content] {
  flex: 1;
  min-width: 0;
}

[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-close-button] {
  position: static;
  order: 1;
  transform: none;
  align-self: flex-start;
  flex-shrink: 0;
  margin: 0;
  height: 20px;
  width: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  transition: color 120ms var(--ease-ds), background-color 120ms var(--ease-ds);
}

/* Sonner's own hover rule is 0,5,0; this has to clear it, hence the extra step. */
[data-sonner-toaster] [data-sonner-toast][data-styled='true']:hover [data-close-button]:hover {
  background: var(--accent);
  border-color: transparent;
  color: var(--foreground);
}
</style>
