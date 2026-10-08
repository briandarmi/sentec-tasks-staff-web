<script setup lang="ts">
import { APP_PRODUCT } from '~/utils/app-product'

/**
 * The app's own brand mark — for chrome that needs a mark and has no room for a
 * wordmark: the sidebar rail, the mobile top bar, the login card.
 *
 * This file is identical in every console; the one per-app fact it reads is
 * `APP_PRODUCT` in `utils/app-product.ts`. A console that is a Sentec product
 * wears that product's icon from the design system's Sentec suite (the Butler
 * consoles: Sentec Butler Service, the BTL tile). A console with no entry in
 * the product roster wears the SENTINEL TECH icon mark in the surrounding text
 * colour (the Tasks consoles, until the suite lists them). Call sites say
 * `<AppLogo />` and stay brand-agnostic either way.
 *
 * The class falls through to the inner `<svg>`, so size it with utilities:
 * `<AppLogo class="size-8" />`. Colour utilities only reach the company-mark
 * fallback — a product tile carries its own fixed colours in both themes, as
 * the design system draws it.
 *
 * No artwork lives here: the product tiles are in `utils/sentec-products.ts`
 * and the shield in `SentinelTechIcon.vue`. The favicon is a separate static
 * copy under `public/img/`, because a favicon cannot render a component.
 */
defineProps<{
  /** Accessible name. Omit when the mark sits beside a visible wordmark. */
  label?: string
}>()
</script>

<template>
  <ProductIcon v-if="APP_PRODUCT" :product="APP_PRODUCT" :label="label" />
  <SentinelTechIcon v-else variant="current-color" :label="label" />
</template>
