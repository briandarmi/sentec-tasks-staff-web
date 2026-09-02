<script setup lang="ts">
/**
 * The app's own brand mark — for chrome that needs a mark and has no room for a
 * wordmark: the sidebar rail, the mobile top bar, the login card.
 *
 * In the Tasks consoles this is the SENTINEL TECH icon mark. Tasks is not a
 * Butler console, so it does not carry the Butler bow tie; the Butler apps point
 * their own `AppLogo` at the Butler mark instead. That difference is the whole
 * reason this indirection exists — call sites say `<AppLogo />` and stay
 * brand-agnostic, and only this file knows which mark an app wears.
 *
 * `current-color` makes the mark inherit the surrounding text colour, so size and
 * tint it with utilities: `<AppLogo class="size-5 text-primary" />`. The class
 * falls through to the inner `<svg>`.
 *
 * The artwork lives in `SentinelTechIcon.vue`, not here — the shield path is
 * already in two other places (that component and `public/img/logo.svg`, which
 * the favicon needs because a favicon cannot render a component) and a third
 * copy would be one more thing to keep in step.
 */
defineProps<{
  /** Accessible name. Omit when the mark sits beside a visible wordmark. */
  label?: string
}>()
</script>

<template>
  <SentinelTechIcon variant="current-color" :label="label" />
</template>
