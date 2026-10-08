<script setup lang="ts">
import { computed, useId } from 'vue'
import {
  SENTEC_DARK_BORDER,
  SENTEC_GLYPH_SCALE,
  SENTEC_INK_TILE,
  SENTEC_PRODUCT_ARTWORK,
  SENTEC_TILE_RADIUS,
  resolveSentecProduct,
} from '~/utils/sentec-products'

/**
 * Product mark for the twelve Sentec products — the design system's
 * `ProductIcon`, ported from its React kit (`components/product/ProductIcon.jsx`)
 * to render the artwork in `utils/sentec-products.ts`.
 *
 * Three variants, as the kit has them:
 *
 *  - tile   the 64px rounded square with the pictogram over it — the mark the
 *           product is known by. 64 for a hero or launcher, 40 in a product
 *           grid, 34 in a card, list row or nav, 24 in a dense table.
 *  - glyph  the 24px pictogram alone in `currentColor`, for places that set
 *           their own ink.
 *  - mono   the pictogram in the flat product hue, no gradient — print,
 *           invoices, embroidery.
 *
 * `mode` picks the tile's ground. The kit's own modes are `light` (the
 * deepened product hue) and `dark` (the Sentinel Grey ground, grey-800 to
 * grey-900, with a 2px per-product border and a neon glyph), and both are
 * drawn here exactly as the kit draws them. `auto`, the default and this
 * port's one addition, renders both and lets the `.dark` class choose — the
 * kit is light-only and has no theme to follow, these consoles do. The two
 * tiles are switched with `hidden` / `dark:block`, the same `dark` variant the
 * rest of the kit uses, so the swap happens in CSS with no flash.
 *
 * Favicons are the light tile, as static copies under `public/img/` (the icon
 * set's own rule below 20px is the Sentinel shield in the product hue; the
 * consoles override it, decided 2026-10-08).
 *
 * Sizing: `size` sets width and height in px when given; otherwise the SVG is
 * sized by the caller's utilities, like every other mark here
 * (`<ProductIcon product="BTL" class="size-9" />`). Unknown products render
 * nothing, as the kit's component returns null.
 *
 * Accessibility follows the other marks rather than the kit (which always
 * labels the SVG with the product name): a `label` makes it `role="img"` with
 * a title; without one it is hidden, for the common case of a mark beside a
 * visible wordmark.
 */
const props = withDefaults(defineProps<{
  /** Slug ("sentec-pms"), code ("PMS") or bare name ("pms"). */
  product: string
  /** Tile ground. `auto` follows the `.dark` class. */
  mode?: 'light' | 'dark' | 'auto'
  variant?: 'tile' | 'glyph' | 'mono'
  /** Rendered px. Omit to size with utilities. */
  size?: number
  /** Accessible name. Omit when the mark sits beside a visible wordmark. */
  label?: string
}>(), {
  mode: 'auto',
  variant: 'tile',
})

const entry = computed(() => resolveSentecProduct(props.product))
const art = computed(() => (entry.value ? SENTEC_PRODUCT_ARTWORK[entry.value.code] : null))

/* Gradient ids must be unique per instance, or a page with two tiles would
   paint both from whichever <linearGradient> the browser finds first. */
const uid = useId()
const lightId = `${uid}-tile-light`
const darkId = `${uid}-tile-dark`

const showLight = computed(() => props.mode !== 'dark')
const showDark = computed(() => props.mode !== 'light')
const auto = computed(() => props.mode === 'auto')

/* The kit nests `translate(32 32) scale(1.75)` on a group around a path at
   `translate(-12 -12)`; the same three transforms, flattened onto the path. */
const glyphTransform = `translate(32 32) scale(${SENTEC_GLYPH_SCALE}) translate(-12 -12)`
const strokeProps = { 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const
const borderInset = SENTEC_DARK_BORDER.inset
const borderSide = 64 - 2 * SENTEC_DARK_BORDER.inset
const borderRadius = SENTEC_TILE_RADIUS - SENTEC_DARK_BORDER.inset
</script>

<template>
  <svg
    v-if="entry && art && variant !== 'tile'"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    :width="size"
    :height="size"
    :role="label ? 'img' : undefined"
    :aria-hidden="label ? undefined : true"
  >
    <title v-if="label">{{ label }}</title>
    <path :d="art.d" fill="none" :stroke="variant === 'mono' ? art.mono : 'currentColor'" v-bind="strokeProps" />
  </svg>

  <svg
    v-else-if="entry && art"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    fill="none"
    :width="size"
    :height="size"
    :role="label ? 'img' : undefined"
    :aria-hidden="label ? undefined : true"
  >
    <title v-if="label">{{ label }}</title>
    <defs>
      <linearGradient
        v-if="showLight"
        :id="lightId"
        :x1="art.lightTile.vector[0]"
        :y1="art.lightTile.vector[1]"
        :x2="art.lightTile.vector[2]"
        :y2="art.lightTile.vector[3]"
      >
        <stop v-for="[offset, color] in art.lightTile.stops" :key="offset" :offset="offset" :stop-color="color" />
      </linearGradient>
      <linearGradient
        v-if="showDark"
        :id="darkId"
        :x1="SENTEC_INK_TILE.vector[0]"
        :y1="SENTEC_INK_TILE.vector[1]"
        :x2="SENTEC_INK_TILE.vector[2]"
        :y2="SENTEC_INK_TILE.vector[3]"
      >
        <stop v-for="[offset, color] in SENTEC_INK_TILE.stops" :key="offset" :offset="offset" :stop-color="color" />
      </linearGradient>
    </defs>

    <g v-if="showLight" :class="auto ? 'dark:hidden' : undefined">
      <rect width="64" height="64" :rx="SENTEC_TILE_RADIUS" :fill="`url(#${lightId})`" />
      <path :d="art.d" :transform="glyphTransform" fill="none" :stroke="art.onTile" v-bind="strokeProps" />
    </g>

    <g v-if="showDark" :class="auto ? 'hidden dark:block' : undefined">
      <rect width="64" height="64" :rx="SENTEC_TILE_RADIUS" :fill="`url(#${darkId})`" />
      <rect
        :x="borderInset"
        :y="borderInset"
        :width="borderSide"
        :height="borderSide"
        :rx="borderRadius"
        fill="none"
        :stroke="art.darkBorder"
        :stroke-width="SENTEC_DARK_BORDER.width"
      />
      <path :d="art.d" :transform="glyphTransform" fill="none" :stroke="art.darkGlyph" v-bind="strokeProps" />
    </g>
  </svg>
</template>
