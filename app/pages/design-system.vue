<script setup lang="ts">
import { ref } from 'vue'
import { CircleCheckIcon, InfoIcon, OctagonXIcon, PencilIcon, PlusIcon, TrashIcon, TriangleAlertIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { APP_PRODUCT } from '~/utils/app-product'
import { SENTEC_PRODUCTS } from '~/utils/sentec-products'

/**
 * Sentinel Tech Design System — living reference.
 *
 * Follows the design system project's own running order: brand, then colour,
 * then the copy and type rules, then the component groups (core, feedback,
 * forms, navigation, overlay, product), then the layout scales and the remaining type
 * specimens.
 *
 * Renders no data and touches no session — the route is deliberately public.
 * The layout is disabled so console chrome does not colour the surfaces being
 * judged.
 */
definePageMeta({ layout: false })

const dark = ref(false)
function toggleDark() {
  dark.value = !dark.value
  document.documentElement.classList.toggle('dark', dark.value)
}

/* ── Brand ─────────────────────────────────────────────────────────────── */
const iconMarkSizes = [16, 24, 32, 48, 64]

/* The Sentec suite's product icons, and this console's place in it. */
const coreProducts = SENTEC_PRODUCTS.filter(p => p.tier === 'core')
const appProduct = APP_PRODUCT ? (SENTEC_PRODUCTS.find(p => p.code === APP_PRODUCT) ?? null) : null
/** The product the component specimens use: this console's own, or PMS as the design system's card does. */
const demoProduct = APP_PRODUCT ?? 'PMS'
/** The tile sizes the icon set names, largest first. */
const productSizes = [64, 40, 34, 24]
/** The size rules from the icon set's README: the mark changes shape at 20px, and again below it. */
const productSizeRules = [
  { size: '64px', mark: 'Tile + pictogram', use: 'Hero, app launcher' },
  { size: '40px', mark: 'Tile + pictogram', use: 'Product grid' },
  { size: '34px', mark: 'Tile + pictogram', use: 'Card, list row, nav' },
  { size: '24px', mark: 'Tile + pictogram', use: 'Dense table' },
  { size: '20px', mark: 'Tile + three-letter code', use: 'Not shipped yet — the code is set in Geist, which this system does not carry' },
  { size: 'Under 20px', mark: 'Sentinel shield in the product hue', use: "The icon set's favicon rule. Not followed here: the consoles use the tile" },
]

const namingRules = [
  { context: 'The company, corporate brand, GSM identity', use: 'Sentinel Tech', domain: 'sentineltech.com' },
  { context: 'The product trademark, used for the software', use: 'Sentec', domain: 'sentec.io' },
  { context: 'Products carry the trademark, not the company name', use: 'Sentec PMS, Sentec EMS, Sentec Booking Engine', domain: '' },
]

/* ── Colour ────────────────────────────────────────────────────────────── */
const neutralScale = [
  { token: 'grey-900', hex: '#2B2D31', note: 'Sentinel Grey — wordmark and body text' },
  { token: 'grey-800', hex: '#3A3D43', note: '' },
  { token: 'grey-700', hex: '#4B4E56', note: '' },
  { token: 'grey-600', hex: '#63666F', note: '' },
  { token: 'grey-500', hex: '#7D818A', note: 'Muted text' },
  { token: 'grey-400', hex: '#A2A5AC', note: '' },
  { token: 'grey-300', hex: '#C3C5CA', note: 'Strong border' },
  { token: 'grey-200', hex: '#DCDEE1', note: 'Default border' },
  { token: 'grey-100', hex: '#ECEEF0', note: '' },
  { token: 'grey-50', hex: '#F6F7F8', note: 'Sunken surface' },
]

const primaryScale = [
  { token: 'blue-700', hex: '#0F5F96', note: 'Pressed. The compliant blue under white text' },
  { token: 'blue-600', hex: '#1483CC', note: 'Hover' },
  { token: 'blue-500', hex: '#27A5F7', note: 'Sentinel Blue — the primary' },
  { token: 'blue-400', hex: '#5CBDF9', note: '' },
  { token: 'blue-300', hex: '#94D3FB', note: '' },
  { token: 'blue-200', hex: '#C3E6FC', note: '' },
  { token: 'blue-100', hex: '#E6F5FE', note: 'Primary tint' },
]

const secondaryScale = [
  { token: 'grey-900', hex: '#2B2D31', note: 'Sentinel Grey — the wordmark and body text colour' },
  { token: 'magenta-500', hex: '#E027A6', note: 'Accent — tags and highlights only, never a base UI colour' },
  { token: 'magenta-600', hex: '#B81F85', note: '' },
  { token: 'magenta-100', hex: '#FCE3F3', note: '' },
  { token: 'black', hex: '#000000', note: 'Jet Black — mostly for one-colour logo prints' },
  { token: 'white', hex: '#FFFFFF', note: '' },
]

const semanticColors = [
  { name: 'Success', base: '#1C9D6B', tint: '#E2F6EE', text: '#157952', own: true },
  { name: 'Warning', base: '#D98C1F', tint: '#FBF0DD', text: '#8A5A10', own: true },
  { name: 'Danger', base: '#D93A3A', tint: '#FBE4E4', text: '#B02525', own: true },
  { name: 'Info', base: '#27A5F7', tint: '#E6F5FE', text: '#0F5F96', own: false },
]

/* ── Copy and type ─────────────────────────────────────────────────────── */
const copyRules = [
  { rule: 'Headlines take no terminal punctuation', use: 'Smart Solutions for Modern Hospitality', avoid: 'Smart Solutions for Modern Hospitality.' },
  { rule: 'Nothing in the brand takes an exclamation mark', use: 'Your room is ready', avoid: 'Your room is ready!' },
  { rule: 'Time is capitalised, no periods, space before the suffix', use: '10 AM', avoid: '10a.m.' },
  { rule: 'A closed en dash denotes a span', use: '5–7 PM', avoid: '5 - 7 PM' },
  { rule: 'An open en dash is a mid-sentence pause', use: 'One platform – every property', avoid: 'One platform -- every property' },
  { rule: 'Phone above with no hyphens, URL below in lowercase', use: '+62 21 3000 3003', avoid: '+62-21-3000-3003' },
]

const typeScale = [
  { token: '5xl', rem: '4rem', tw: '3rem' },
  { token: '4xl', rem: '3rem', tw: '2.25rem' },
  { token: '3xl', rem: '2.25rem', tw: '1.875rem' },
  { token: '2xl', rem: '1.75rem', tw: '1.5rem' },
  { token: 'xl', rem: '1.375rem', tw: '1.25rem' },
  { token: 'lg', rem: '1.125rem', tw: '1.125rem' },
  { token: 'base', rem: '1rem', tw: '1rem' },
  { token: 'sm', rem: '0.875rem', tw: '0.875rem' },
  { token: 'xs', rem: '0.75rem', tw: '0.75rem' },
]

const typeWeights = [
  { weight: 300, name: 'Light' },
  { weight: 400, name: 'Regular' },
  { weight: 500, name: 'Medium' },
  { weight: 600, name: 'Semibold' },
  { weight: 700, name: 'Bold' },
]

const typeLeading = [
  { token: 'tight', value: '1.1' },
  { token: 'snug', value: '1.3' },
  { token: 'normal', value: '1.5' },
  { token: 'relaxed', value: '1.65' },
]

const typeStacks = [
  {
    channel: 'Product UI, marketing site, decks',
    face: 'Quicksand',
    stack: "'Quicksand', sans-serif",
    why: 'Self-hosted through @nuxt/fonts, weights 300 to 700. Full control via @font-face, so it renders anywhere the app\'s CSS loads.',
  },
  {
    channel: 'Email — signatures, newsletters, transactional',
    face: 'Arial',
    stack: 'Arial, Helvetica, sans-serif',
    why: 'Gmail strips @font-face outright. Quicksand can never render in an inbox, so email is designed as Arial from the start rather than degraded from a Quicksand layout.',
  },
  {
    channel: 'Internal documents — SOPs, contracts, proposals',
    face: 'Arial 12pt black',
    stack: 'Arial, Helvetica, sans-serif',
    why: 'Mandated by the GSM (p.20). Deliberately plain and non-branded — a separate register from the marketing voice.',
  },
]

/* ── Layout scales ─────────────────────────────────────────────────────── */
const radii = [
  { token: 'sm', value: '6px', note: 'Tooltips' },
  { token: 'md', value: '10px', note: 'Buttons, inputs, toasts' },
  { token: 'lg', value: '16px', note: 'Cards, dialogs' },
  { token: 'pill', value: '999px', note: 'Badges, tags, switches' },
]

const shadows = [
  { token: 'ds-sm', value: 'var(--ds-shadow-sm)', note: 'Resting cards' },
  { token: 'ds-md', value: 'var(--ds-shadow-md)', note: 'Hovered cards' },
  { token: 'ds-lg', value: 'var(--ds-shadow-lg)', note: 'Dialogs, toasts, menus' },
]

const spacing = [
  { token: '1', px: 4 }, { token: '2', px: 8 }, { token: '3', px: 12 },
  { token: '4', px: 16 }, { token: '5', px: 20 }, { token: '6', px: 24 },
  { token: '8', px: 32 }, { token: '10', px: 40 }, { token: '12', px: 48 },
  { token: '16', px: 64 }, { token: '20', px: 80 }, { token: '24', px: 96 },
]

/* ── Component state ───────────────────────────────────────────────────── */
const buttonVariants = ['default', 'secondary', 'field', 'tertiary', 'ghost', 'destructive', 'success', 'warning', 'link'] as const
/** What an unfilled button (secondary, tertiary, ghost) carries as its colour. */
const buttonTones = ['primary', 'neutral', 'destructive', 'success', 'warning'] as const
const badgeVariants = ['default', 'secondary', 'success', 'warning', 'destructive', 'outline'] as const
const alertVariants = [
  { variant: 'default', icon: InfoIcon, title: 'A group grant covers every property in the group', body: 'Anyone you add here can read and change work at all of them.' },
  { variant: 'success', icon: CircleCheckIcon, title: 'Saved', body: 'All setup values were saved successfully.' },
  { variant: 'warning', icon: TriangleAlertIcon, title: 'Two SLAs are close to breaching', body: 'Both are due within the hour and neither is assigned.' },
  { variant: 'destructive', icon: OctagonXIcon, title: 'Something went wrong', body: 'The property refused the change. Nothing was saved.' },
  { variant: 'neutral', icon: InfoIcon, title: 'Scoped to your hotel', body: 'As an admin you only see audit events for your active hotel.' },
] as const

const selected = ref('')
const tags = ref(['Housekeeping', 'Engineering', 'Front office'])
const dialogOpen = ref(false)
const checks = ref({ a: true, b: false, c: true })
const radioValue = ref('all')
const switches = ref({ a: true, b: false })
</script>

<template>
  <div class="bg-background text-foreground min-h-screen">
    <div class="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-10">
      <header class="flex items-start justify-between gap-4">
        <div class="flex flex-col gap-1">
          <h1 class="font-heading text-3xl font-bold">
            Sentinel Tech Design System
          </h1>
          <p class="text-muted-foreground text-sm">
            Brand foundations and the component kit, as built in this console
          </p>
        </div>
        <Button variant="secondary" size="sm" @click="toggleDark">
          {{ dark ? 'Light' : 'Dark' }}
        </Button>
      </header>

      <!-- ══ Brand ══════════════════════════════════════════════════════ -->
      <h2 class="text-muted-foreground border-border border-b pb-2 text-xs font-semibold tracking-[0.14em] uppercase">
        Brand
      </h2>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Logo — Full Color</h3>
        <p class="text-muted-foreground text-sm">
          The corporate lockup: a shield holding a negative-space “T”, with SENTINEL
          in bold caps and TECH tracked out beneath. Always one fixed unit — never
          recoloured beyond the three approved colorways, never stretched.
        </p>
        <div class="border-border flex items-center justify-center rounded-xl border bg-white p-10">
          <SentinelTechLogo variant="full-color" label="Sentinel Tech" class="w-64 max-w-full" />
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Logo — Reverse</h3>
        <p class="text-muted-foreground text-sm">
          The shield keeps Sentinel Blue and the wordmark goes white. This is the
          two-colour mark for dark grounds — it holds the brand colour where the
          full-colour lockup's Sentinel Grey wordmark would disappear.
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex items-center justify-center rounded-xl p-10" style="background:#2B2D31">
            <SentinelTechLogo variant="reverse" label="Sentinel Tech" class="w-56 max-w-full" />
          </div>
          <div class="flex items-center justify-center rounded-xl p-10" style="background:#000000">
            <SentinelTechLogo variant="reverse" label="Sentinel Tech" class="w-56 max-w-full" />
          </div>
        </div>
        <Alert variant="neutral">
          <InfoIcon />
          <AlertTitle>Use the all-white lockup on the brand gradient, not this one</AlertTitle>
          <AlertDescription>
            The reverse shield is Sentinel Blue, so it loses contrast against the
            blue-to-teal gradient photography the brand uses on covers and stationery.
            That ground calls for Single Color — White below.
          </AlertDescription>
        </Alert>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Logo — Single Color — White</h3>
        <p class="text-muted-foreground text-sm">
          The whole lockup in white, one ink. For the blue-to-teal gradient the brand
          uses on covers and stationery, for photography, and for any process that can
          lay down only a single colour — embossing, one-colour merch, cut vinyl.
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex items-center justify-center rounded-xl p-10" style="background:linear-gradient(135deg,#0F5F96,#27A5F7 60%,#5CBDF9)">
            <SentinelTechLogo variant="single-color-white" label="Sentinel Tech" class="w-56 max-w-full" />
          </div>
          <div class="flex items-center justify-center rounded-xl p-10" style="background:#2B2D31">
            <SentinelTechLogo variant="single-color-white" label="Sentinel Tech" class="w-56 max-w-full" />
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Logo — Single Color — Black</h3>
        <p class="text-muted-foreground text-sm">
          Jet Black, one ink. For one-colour prints — stamps, faxed forms, engraving and
          any process that cannot hold the full-colour mark.
        </p>
        <div class="border-border flex items-center justify-center rounded-xl border bg-white p-10">
          <SentinelTechLogo variant="single-color-black" label="Sentinel Tech" class="w-64 max-w-full" />
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Logo — Icon Mark</h3>
        <p class="text-muted-foreground text-sm">
          The shield on its own, for the places a lockup cannot go: favicons, app
          chrome, avatars, and anything under roughly 32px where SENTINEL TECH would
          be a grey smear. Three colorways rather than the lockup's four — with no
          wordmark left to protect, <code class="text-xs">reverse</code> collapses
          into full colour, because the shield is Sentinel Blue in both.
        </p>
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="border-border flex items-center justify-center rounded-xl border bg-white p-10">
            <SentinelTechIcon variant="full-color" label="Sentinel Tech" class="size-20" />
          </div>
          <div class="flex items-center justify-center rounded-xl p-10" style="background:#2B2D31">
            <SentinelTechIcon variant="single-color-white" label="Sentinel Tech" class="size-20" />
          </div>
          <div class="border-border flex items-center justify-center rounded-xl border bg-white p-10">
            <SentinelTechIcon variant="single-color-black" label="Sentinel Tech" class="size-20" />
          </div>
        </div>

        <h4 class="text-muted-foreground text-sm font-semibold">At the sizes it actually ships at</h4>
        <p class="text-muted-foreground text-sm">
          Worth checking rather than trusting: the mark at the sizes the browser tab
          and the console chrome really use. The favicon is cut at 16, 32 and 48.
        </p>
        <div class="border-border flex flex-wrap items-end gap-8 rounded-xl border bg-white p-10">
          <div v-for="px in iconMarkSizes" :key="px" class="flex flex-col items-center gap-2">
            <SentinelTechIcon variant="full-color" :style="{ width: `${px}px`, height: `${px}px` }" />
            <span class="text-muted-foreground text-xs">{{ px }}px</span>
          </div>
        </div>

        <Alert variant="neutral">
          <InfoIcon />
          <AlertTitle>Crop to the shield — never shrink the whole lockup</AlertTitle>
          <AlertDescription>
            The lockup is roughly 3:1, so squeezing it into a 16px square tab leaves a
            shield about 5px wide with an illegible wordmark beside it. That is why
            the icon mark is a separate asset: the same shield artwork on a square
            viewBox trimmed to the shield's own bounding box, so it fills the space
            it is given.
          </AlertDescription>
        </Alert>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Product Icons — Sentec suite</h3>
        <p class="text-muted-foreground text-sm">
          Twelve products, one hue each, in two tiles: the light tile on the deepened
          product hue, and the dark tile on the Sentinel Grey ground with a neon glyph
          and a per-product border. Imported into the design system from the
          <code class="text-xs">sentec-product-icons</code> set. A product hue reaches
          the icon and its accent bar only — headings, links and buttons stay Sentinel
          Blue — and a glyph is never recoloured outside its own two values. EMS and
          SLS carry an ink glyph because yellow cannot hold white; XD is deliberately
          unsaturated because it sits above the products, not beside them. These
          consoles follow the theme: the light tile on a light page, the dark tile on
          a dark one.
        </p>

        <h4 class="text-muted-foreground text-sm font-semibold">Light tile — deepened hue, white or ink glyph</h4>
        <div class="border-border grid grid-cols-4 gap-x-4 gap-y-5 rounded-xl border bg-white p-6 sm:grid-cols-6">
          <div v-for="p in SENTEC_PRODUCTS" :key="p.slug" class="flex flex-col items-center gap-2">
            <ProductIcon :product="p.code" mode="light" :size="48" :label="p.name" />
            <span class="text-xs font-semibold tracking-wider text-[#63666F]">{{ p.code }}</span>
          </div>
        </div>

        <h4 class="text-muted-foreground text-sm font-semibold">Dark tile — Sentinel Grey ground, neon glyph</h4>
        <div class="grid grid-cols-4 gap-x-4 gap-y-5 rounded-xl p-6 sm:grid-cols-6" style="background:#2B2D31">
          <div v-for="p in SENTEC_PRODUCTS" :key="p.slug" class="flex flex-col items-center gap-2">
            <ProductIcon :product="p.code" mode="dark" :size="48" :label="p.name" />
            <span class="text-xs font-semibold tracking-wider text-[#DCDEE1]">{{ p.code }}</span>
          </div>
        </div>

        <h4 class="text-muted-foreground text-sm font-semibold">Sizes, and where the mark changes shape</h4>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr class="border-border text-muted-foreground border-b text-xs">
                <th class="py-2 pr-4 font-semibold">Size</th>
                <th class="py-2 pr-4 font-semibold">Mark</th>
                <th class="py-2 font-semibold">Where</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in productSizeRules" :key="r.size" class="border-border border-b text-sm last:border-0">
                <td class="py-3 pr-4 font-semibold">{{ r.size }}</td>
                <td class="py-3 pr-4">{{ r.mark }}</td>
                <td class="text-muted-foreground py-3">{{ r.use }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="appProduct">
          <h4 class="text-muted-foreground text-sm font-semibold">This console — {{ appProduct.name }}</h4>
          <p class="text-muted-foreground text-sm">
            <code class="text-xs">{{ appProduct.code }}</code>, tier “{{ appProduct.tier }}”, hue
            <code class="text-xs">{{ appProduct.light }}</code> with
            <code class="text-xs">{{ appProduct.dark }}</code> as the dark-tile glyph.
            <code class="text-xs">AppLogo</code> renders the tile at every size the chrome
            uses and switches to the dark tile with the theme. The favicon is the light
            tile, cut at 16, 32 and 48 — a console decision over the icon set's under-20px
            shield rule.
          </p>
          <div class="border-border bg-card flex flex-wrap items-end gap-8 rounded-xl border p-10">
            <div v-for="px in productSizes" :key="px" class="flex flex-col items-center gap-2">
              <ProductIcon :product="appProduct.code" :size="px" />
              <span class="text-muted-foreground text-xs">{{ px }}px</span>
            </div>
            <div class="flex flex-col items-center gap-2">
              <ProductIcon :product="appProduct.code" :size="16" />
              <span class="text-muted-foreground text-xs">16px favicon</span>
            </div>
            <div class="flex flex-col items-center gap-2">
              <span class="inline-flex" :style="{ color: appProduct.light }">
                <ProductIcon :product="appProduct.code" variant="glyph" :size="28" />
              </span>
              <span class="text-muted-foreground text-xs">glyph</span>
            </div>
            <div class="flex flex-col items-center gap-2">
              <ProductIcon :product="appProduct.code" variant="mono" :size="28" />
              <span class="text-muted-foreground text-xs">mono</span>
            </div>
          </div>
        </template>
        <Alert v-else variant="neutral">
          <InfoIcon />
          <AlertTitle>This console has no product icon yet</AlertTitle>
          <AlertDescription>
            Sentec Tasks is not in the suite's roster, so there is no hue or glyph to
            wear. Until it is added, the console carries the SENTINEL TECH icon mark in
            Sentinel Blue — the company mark, not a product mark. Setting the code in
            <code class="text-xs">utils/app-product.ts</code> switches it over.
          </AlertDescription>
        </Alert>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Naming</h3>
        <p class="text-muted-foreground text-sm">
          Sentinel Tech is the company. Sentec is the product trademark. They are not
          interchangeable and neither is a nickname for the other.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr class="border-border text-muted-foreground border-b text-xs">
                <th class="py-2 pr-4 font-semibold">Context</th>
                <th class="py-2 pr-4 font-semibold">Correct</th>
                <th class="py-2 font-semibold">Domain</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in namingRules" :key="n.context" class="border-border border-b text-sm last:border-0">
                <td class="text-muted-foreground py-3 pr-4">{{ n.context }}</td>
                <td class="py-3 pr-4 font-semibold">{{ n.use }}</td>
                <td class="text-muted-foreground py-3">{{ n.domain }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Alert variant="destructive">
          <OctagonXIcon />
          <AlertTitle>“Sentech” is never correct</AlertTitle>
          <AlertDescription>
            It is a common misspelling of the product trademark. The product is Sentec.
          </AlertDescription>
        </Alert>
      </section>

      <h2 class="text-muted-foreground border-border mt-4 border-b pb-2 text-xs font-semibold tracking-[0.14em] uppercase">
        Colors
      </h2>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Neutral Scale</h3>
        <p class="text-muted-foreground text-sm">
          Sentinel Grey and its steps. Carries every surface, border and text colour
          that is not the primary.
        </p>
        <div class="flex flex-col gap-1">
          <div v-for="c in neutralScale" :key="c.token" class="flex items-center gap-3">
            <span class="border-border size-10 shrink-0 rounded-lg border" :style="{ background: c.hex }" />
            <span class="w-24 shrink-0 text-xs font-semibold">{{ c.token }}</span>
            <span class="text-muted-foreground w-20 shrink-0 font-mono text-xs">{{ c.hex }}</span>
            <span class="text-muted-foreground truncate text-xs">{{ c.note }}</span>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Primary — Sentinel Blue</h3>
        <p class="text-muted-foreground text-sm">
          CMYK 69/25/0/0 · RGB 39/165/247 · PANTONE 298C
        </p>
          <div class="flex flex-col gap-1">
            <div v-for="c in primaryScale" :key="c.token" class="flex items-center gap-3">
              <span class="border-border size-10 shrink-0 rounded-lg border" :style="{ background: c.hex }" />
              <span class="w-24 shrink-0 text-xs font-semibold">{{ c.token }}</span>
              <span class="text-muted-foreground w-20 shrink-0 font-mono text-xs">{{ c.hex }}</span>
              <span class="text-muted-foreground truncate text-xs">{{ c.note }}</span>
            </div>
          </div>
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>White on Sentinel Blue is a mandated brand pairing that fails AA</AlertTitle>
          <AlertDescription>
            White on #27A5F7 is 2.69:1, under both WCAG AA and the 3:1 UI floor. It is
            used anyway, by decision. Hover and press darken to blue-600 and blue-700,
            where white reaches 4.08:1 and 6.78:1. New surfaces that need a compliant
            blue fill under white should use blue-700 directly.
          </AlertDescription>
        </Alert>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Secondary Palette</h3>
        <p class="text-muted-foreground text-sm">
          Sentinel Grey · Magenta · Jet Black
        </p>
          <div class="flex flex-col gap-1">
            <div v-for="c in secondaryScale" :key="c.token" class="flex items-center gap-3">
              <span class="border-border size-10 shrink-0 rounded-lg border" :style="{ background: c.hex }" />
              <span class="w-24 shrink-0 text-xs font-semibold">{{ c.token }}</span>
              <span class="text-muted-foreground w-20 shrink-0 font-mono text-xs">{{ c.hex }}</span>
              <span class="text-muted-foreground truncate text-xs">{{ c.note }}</span>
            </div>
          </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Semantic Colors</h3>
        <p class="text-muted-foreground text-sm">
          Four tones, each three values: a base for solid fills under white text, a
          tint for surfaces, and a hue used only as text on that tint. For success,
          warning and danger the design system pairs its tint with the base, which
          lands at 2.4–3.8:1 — below AA — so the third value is darkened to carry the
          text instead. Info is the exception twice over: it has no hue of its own, and
          the pairing the design system gives it already passes at 6.16:1.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[38rem] border-collapse text-left">
            <thead>
              <tr class="border-border text-muted-foreground border-b text-xs">
                <th class="py-2 pr-4 font-semibold">Tone</th>
                <th class="py-2 pr-4 font-semibold">Base</th>
                <th class="py-2 pr-4 font-semibold">Tint</th>
                <th class="py-2 pr-4 font-semibold">Text on tint</th>
                <th class="py-2 font-semibold">Pairing</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in semanticColors" :key="c.name" class="border-border border-b text-sm last:border-0">
                <td class="py-3 pr-4 align-top">
                  <span class="font-semibold">{{ c.name }}</span>
                  <span v-if="!c.own" class="text-muted-foreground block text-xs font-normal">
                    Sentinel Blue — no hue of its own
                  </span>
                </td>
                <td class="py-3 pr-4">
                  <span class="flex items-center gap-2">
                    <span class="border-border size-6 rounded-md border" :style="{ background: c.base }" />
                    <span class="text-muted-foreground font-mono text-xs">{{ c.base }}</span>
                  </span>
                </td>
                <td class="py-3 pr-4">
                  <span class="flex items-center gap-2">
                    <span class="border-border size-6 rounded-md border" :style="{ background: c.tint }" />
                    <span class="text-muted-foreground font-mono text-xs">{{ c.tint }}</span>
                  </span>
                </td>
                <td class="py-3 pr-4">
                  <span class="flex items-center gap-2">
                    <span class="border-border size-6 rounded-md border" :style="{ background: c.text }" />
                    <span class="text-muted-foreground font-mono text-xs">{{ c.text }}</span>
                  </span>
                </td>
                <td class="py-3">
                  <span class="rounded-full px-2.5 py-[3px] text-xs font-semibold" :style="{ background: c.tint, color: c.text }">
                    {{ c.name }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <h2 class="text-muted-foreground border-border mt-4 border-b pb-2 text-xs font-semibold tracking-[0.14em] uppercase">
        Components
      </h2>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Core — Card</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Room 412</CardTitle>
              <CardDescription>Housekeeping · due 10 AM</CardDescription>
              <CardAction>
                <Badge variant="warning">Due soon</Badge>
              </CardAction>
            </CardHeader>
            <CardContent class="text-muted-foreground text-sm">
              A badge in the top-right corner uses CardAction, which the header grid
              reserves for it — the title and description keep the first column.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Room 118</CardTitle>
              <CardDescription>Engineering · due 5–7 PM</CardDescription>
              <CardAction>
                <div class="flex items-center gap-1.5">
                  <Badge variant="destructive">Blocked</Badge>
                  <Badge variant="secondary">P2</Badge>
                </div>
              </CardAction>
            </CardHeader>
            <CardContent class="text-muted-foreground text-sm">
              CardAction takes any content, so several badges stack horizontally
              without disturbing the header.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Static card</CardTitle>
              <CardDescription>Sits on the first shadow step</CardDescription>
            </CardHeader>
            <CardContent class="text-muted-foreground text-sm">
              A container, not a target — no hover affordance.
            </CardContent>
          </Card>
          <Card hoverable>
            <CardHeader>
              <CardTitle>Hoverable card</CardTitle>
              <CardDescription>Lifts 2px onto the next shadow step</CardDescription>
            </CardHeader>
            <CardContent class="text-muted-foreground text-sm">
              The kit's hoverable prop, for cards that are links.
            </CardContent>
          </Card>
        </div>
      </section>

      <section class="flex flex-col gap-6">
        <h3 class="font-heading text-xl font-bold">Feedback — Badge, Tag, Toast, Tooltip</h3>

        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Badge</h4>
          <div class="flex flex-wrap items-center gap-3">
            <Badge v-for="v in badgeVariants" :key="v" :variant="v">{{ v }}</Badge>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Tag</h4>
          <div class="flex flex-wrap items-center gap-2">
            <Tag>Read only</Tag>
            <Tag
              v-for="t in tags"
              :key="t"
              removable
              :remove-label="`Remove ${t}`"
              @remove="tags = tags.filter(x => x !== t)"
            >
              {{ t }}
            </Tag>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Toast</h4>
          <p class="text-muted-foreground text-sm">
            Each trigger wears the tone it fires, so the button and the stripe on the
            toast it raises are the same colour. Info is the primary button, because
            info has no hue of its own.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <Button variant="success" @click="toast.success('Task closed', { description: 'Room 412 marked clean' })">Success</Button>
            <Button variant="warning" @click="toast.warning('SLA at risk', { description: 'Due in 10 minutes' })">Warning</Button>
            <Button variant="destructive" @click="toast.error('Could not save', { description: 'The property refused the change' })">Error</Button>
            <Button @click="toast.info('Shift starts soon', { description: 'Handover at 3 PM' })">Info</Button>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Tooltip</h4>
          <TooltipProvider>
            <div class="flex flex-wrap items-center gap-3">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="secondary">Hover me</Button>
                </TooltipTrigger>
                <TooltipContent>Assigned 10 AM</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="secondary" size="icon" aria-label="Edit">
                    <PencilIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Edit this task</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>

        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">
            Alert <span class="font-normal">— beyond the kit, built on the same tone pairs</span>
          </h4>
          <div class="flex flex-col gap-3">
            <Alert v-for="a in alertVariants" :key="a.variant" :variant="a.variant">
              <component :is="a.icon" />
              <AlertTitle>{{ a.title }}</AlertTitle>
              <AlertDescription>{{ a.body }}</AlertDescription>
            </Alert>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-6">
        <h3 class="font-heading text-xl font-bold">Forms — Button, Input, Select, Checkbox, Radio, Switch</h3>

        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Button</h4>
          <div class="flex flex-wrap items-center gap-3">
            <template v-for="v in buttonVariants" :key="v">
              <Button v-if="v === 'ghost'" variant="ghost" size="icon" aria-label="ghost"><PencilIcon /></Button>
              <Button v-else :variant="v">{{ v }}</Button>
            </template>
          </div>
          <p class="text-muted-foreground text-xs">
            Secondary follows its tone — the tint under that tone's darkened text, the
            same pairs Badge and Alert use. Tertiary and ghost read the tone too; ghost
            is drawn as an icon button because that is the only place it is used.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <Button v-for="t in buttonTones" :key="t" variant="secondary" :tone="t">{{ t }}</Button>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Button v-for="t in buttonTones" :key="t" variant="tertiary" :tone="t">{{ t }}</Button>
            <Button v-for="t in buttonTones" :key="`ghost-${t}`" variant="ghost" :tone="t" size="icon" :aria-label="t"><PencilIcon /></Button>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </div>
          <Alert variant="neutral">
            <InfoIcon />
            <AlertTitle>No outlined action buttons</AlertTitle>
            <AlertDescription>
              The kit's bordered white button was retired from these consoles on
              2026-10-08: at rest it reads like a field or a card, not something to
              press. Secondary actions, cancels and icon buttons use
              <code class="text-xs">secondary</code>, which is tonal: its background is
              the tint of the colour the action carries — Sentinel Blue unless
              <code class="text-xs">tone</code> names destructive, success or warning —
              and it deepens toward that hue on hover rather than greying. Plain grey is
              <code class="text-xs">tone="neutral"</code>, for an action with no colour
              of its own. <code class="text-xs">ghost</code> is for icon-only buttons; a
              ghost action with a text label reads as plain text, so text actions are
              <code class="text-xs">secondary</code> too. The one bordered variant left is
              <code class="text-xs">field</code>,
              styled like a select trigger, for combobox and date-picker triggers only —
              those are inputs, and should look like the inputs beside them.
            </AlertDescription>
          </Alert>
        </div>

        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Icon button</h4>
          <div class="flex flex-wrap items-center gap-3">
            <Button size="icon" aria-label="Add"><PlusIcon /></Button>
            <Button size="icon" variant="secondary" aria-label="Edit"><PencilIcon /></Button>
            <Button size="icon" variant="ghost" aria-label="Edit"><PencilIcon /></Button>
            <Button size="icon" variant="destructive" aria-label="Delete"><TrashIcon /></Button>
            <Button size="icon-sm" variant="secondary" aria-label="Add"><PlusIcon /></Button>
            <Button size="icon-lg" variant="secondary" aria-label="Add"><PlusIcon /></Button>
          </div>
          <p class="text-muted-foreground text-xs">
            An icon button is Button at an icon size. Every one carries an aria-label —
            there is no visible text to name it.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-2">
            <Label for="ds-a">Input</Label>
            <Input id="ds-a" placeholder="Room number" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="ds-b">Input — invalid</Label>
            <Input id="ds-b" aria-invalid="true" placeholder="Room number" />
            <p class="text-destructive text-xs">That room is not on this property</p>
          </div>
          <div class="flex flex-col gap-2">
            <Label for="ds-c">Input — disabled</Label>
            <Input id="ds-c" disabled placeholder="Room number" />
          </div>
          <div class="flex flex-col gap-2">
            <Label>Select</Label>
            <Select v-model="selected">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Pick a department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hk">Housekeeping</SelectItem>
                <SelectItem value="eng">Engineering</SelectItem>
                <SelectItem value="fo">Front office</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="grid gap-6 sm:grid-cols-3">
          <div class="flex flex-col gap-3">
            <h4 class="text-muted-foreground text-sm font-semibold">Checkbox</h4>
            <label class="flex items-center gap-2.5 text-sm"><Checkbox v-model="checks.a" /> Housekeeping</label>
            <label class="flex items-center gap-2.5 text-sm"><Checkbox v-model="checks.b" /> Engineering</label>
            <label class="flex items-center gap-2.5 text-sm opacity-50"><Checkbox v-model="checks.c" disabled /> Front office</label>
          </div>

          <div class="flex flex-col gap-3">
            <h4 class="text-muted-foreground text-sm font-semibold">Radio</h4>
            <RadioGroup v-model="radioValue" class="flex flex-col gap-3">
              <label class="flex items-center gap-2.5 text-sm"><RadioGroupItem value="all" /> Every property</label>
              <label class="flex items-center gap-2.5 text-sm"><RadioGroupItem value="mine" /> Only mine</label>
              <label class="flex items-center gap-2.5 text-sm"><RadioGroupItem value="group" /> My group</label>
            </RadioGroup>
          </div>

          <div class="flex flex-col gap-3">
            <h4 class="text-muted-foreground text-sm font-semibold">Switch</h4>
            <label class="flex items-center gap-2.5 text-sm"><Switch v-model="switches.a" /> Email digest</label>
            <label class="flex items-center gap-2.5 text-sm"><Switch v-model="switches.b" /> Push alerts</label>
            <label class="flex items-center gap-2.5 text-sm opacity-50"><Switch disabled /> SMS</label>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Navigation — Tabs</h3>
        <p class="text-muted-foreground text-sm">
          An underlined rail, not a segmented pill. The active tab is marked by weight,
          colour and the rule beneath it, so the state survives without colour vision.
        </p>
        <Tabs default-value="open">
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="progress">In progress</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
          </TabsList>
          <TabsContent value="open" class="text-muted-foreground pt-4 text-sm">
            Tasks nobody has picked up yet.
          </TabsContent>
          <TabsContent value="progress" class="text-muted-foreground pt-4 text-sm">
            Tasks somebody is holding.
          </TabsContent>
          <TabsContent value="done" class="text-muted-foreground pt-4 text-sm">
            Tasks closed today.
          </TabsContent>
        </Tabs>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Overlay — Dialog</h3>
        <p class="text-muted-foreground text-sm">
          A 16px panel on the deepest shadow step over a Sentinel Grey scrim, with
          full-bleed rules separating the header and footer from the body.
        </p>
        <div>
          <Dialog v-model:open="dialogOpen">
            <DialogTrigger as-child>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Close this task</DialogTitle>
                <DialogDescription>
                  Room 412 will move to Finished and the SLA clock stops.
                </DialogDescription>
              </DialogHeader>
              <p class="text-muted-foreground text-sm">
                Body content sits between the two rules.
              </p>
              <DialogFooter>
                <Button variant="secondary" @click="dialogOpen = false">Cancel</Button>
                <Button @click="dialogOpen = false">Close task</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Product — ProductIcon</h3>
        <p class="text-muted-foreground text-sm">
          The kit's product mark, rendering the Sentec suite above by slug, code or
          name: a tile with the pictogram, the glyph alone in the current colour, or
          the glyph in the flat hue for print. Tiles follow the theme by default, which
          the kit's light-only component cannot do; <code class="text-xs">mode</code>
          pins one. Toggle the theme above to watch the unpinned tiles switch.
        </p>
        <div class="flex flex-col gap-5">
          <div class="flex flex-col gap-2">
            <h4 class="text-muted-foreground text-sm font-semibold">Sizes — 64 · 40 · 34 · 24</h4>
            <div class="flex items-end gap-3.5">
              <ProductIcon v-for="px in productSizes" :key="px" :product="demoProduct" :size="px" />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <h4 class="text-muted-foreground text-sm font-semibold">Light tiles — core products</h4>
            <div class="flex flex-wrap gap-3">
              <ProductIcon v-for="p in coreProducts" :key="p.slug" :product="p.code" mode="light" :size="40" :label="p.name" />
            </div>
          </div>
          <div class="flex flex-col gap-2 rounded-xl px-5 py-4" style="background:#2B2D31">
            <h4 class="text-sm font-semibold text-[#C3C5CA]">Dark tiles · glyph in currentColor · mono</h4>
            <div class="flex flex-wrap items-center gap-3">
              <ProductIcon v-for="p in coreProducts" :key="p.slug" :product="p.code" mode="dark" :size="40" :label="p.name" />
              <span class="text-product-pms-dark inline-flex">
                <ProductIcon product="PMS" variant="glyph" :size="28" />
              </span>
              <ProductIcon product="SLS" variant="mono" :size="28" />
            </div>
          </div>
        </div>
      </section>

      <h2 class="text-muted-foreground border-border mt-4 border-b pb-2 text-xs font-semibold tracking-[0.14em] uppercase">
        Spacing
      </h2>

      <section class="flex flex-col gap-6">
        <h3 class="font-heading text-xl font-bold">Radius &amp; Shadow</h3>
        <p class="text-muted-foreground text-sm">
          Both scales are inferred rather than sourced — the GSM is a print manual and
          never reaches software. They are deliberately restrained, and the design
          system asks to be overridden wherever a product has a real pattern.
        </p>
        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Radius</h4>
          <div class="flex flex-wrap gap-4">
            <div v-for="r in radii" :key="r.token" class="flex flex-col items-center gap-2">
              <span class="border-border bg-card size-20 border" :style="{ borderRadius: r.value }" />
              <span class="text-xs font-semibold">{{ r.token }} · {{ r.value }}</span>
              <span class="text-muted-foreground text-xs">{{ r.note }}</span>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-3">
          <h4 class="text-muted-foreground text-sm font-semibold">Shadow</h4>
          <div class="flex flex-wrap gap-6 pt-1">
            <div v-for="sh in shadows" :key="sh.token" class="flex flex-col items-center gap-2">
              <span class="bg-card size-20 rounded-2xl" :style="{ boxShadow: sh.value }" />
              <span class="text-xs font-semibold">{{ sh.token }}</span>
              <span class="text-muted-foreground text-xs">{{ sh.note }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Spacing Scale</h3>
        <p class="text-muted-foreground text-sm">
          A 4px base. Content maxes out at a 1200px container.
        </p>
        <div class="flex flex-col gap-1.5">
          <div v-for="sp in spacing" :key="sp.token" class="flex items-center gap-3">
            <span class="text-muted-foreground w-16 shrink-0 text-xs font-semibold">space-{{ sp.token }}</span>
            <span class="text-muted-foreground w-12 shrink-0 text-xs">{{ sp.px }}px</span>
            <span class="bg-primary h-3 rounded-sm" :style="{ width: sp.px + 'px' }" />
          </div>
        </div>
      </section>

      <h2 class="text-muted-foreground border-border mt-4 border-b pb-2 text-xs font-semibold tracking-[0.14em] uppercase">
        Type
      </h2>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Body — Quicksand Weights</h3>
        <p class="text-muted-foreground text-sm">
          Regular through Bold carry body copy, with a Light for large quiet text. All
          five are real webfont weights — none is synthesised.
        </p>
        <div class="flex flex-col gap-1">
          <div v-for="w in typeWeights" :key="w.weight" class="flex flex-wrap items-baseline gap-4">
            <span class="text-muted-foreground w-28 shrink-0 text-xs">{{ w.weight }} {{ w.name }}</span>
            <span class="text-xl" :style="{ fontWeight: w.weight }">Smart Solutions for Modern Hospitality</span>
          </div>
        </div>
        <h4 class="text-muted-foreground pt-2 text-sm font-semibold">Leading</h4>
        <div class="grid gap-4 sm:grid-cols-2">
          <div v-for="l in typeLeading" :key="l.token" class="border-border flex flex-col gap-1 rounded-lg border p-3">
            <span class="text-muted-foreground text-xs">{{ l.token }} · {{ l.value }}</span>
            <p class="text-sm" :style="{ lineHeight: l.value }">
              Leveraging 25 years of expertise in hospitality technology, Sentinel Tech
              is a trusted partner that simplifies hotel operations with
              state-of-the-art solutions.
            </p>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Display — Quicksand Bold</h3>
        <p class="text-muted-foreground text-sm">
          Headlines are Quicksand Bold and take no terminal punctuation.
        </p>
        <div class="border-border flex flex-col gap-4 rounded-xl border p-6">
          <p class="font-bold leading-tight" style="font-size:3rem">Smart Solutions for Modern Hospitality</p>
          <p class="font-bold leading-tight" style="font-size:2.25rem">All in one place</p>
          <p class="font-bold leading-tight" style="font-size:1.75rem">We simplify hotel operations</p>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Document Font — Arial 12pt</h3>
        <p class="text-muted-foreground text-sm">
          Every SOP, contract and proposal is Arial 12pt black by GSM mandate (p.20).
          Deliberately plain and non-branded — a separate register from the marketing
          voice, and never Quicksand.
        </p>
        <div class="rounded-xl border border-[#c3c5ca] bg-white p-8" style="font-family:Arial,Helvetica,sans-serif;color:#000">
          <p style="font-size:12pt;font-weight:700;margin-bottom:12px">STANDARD OPERATING PROCEDURE</p>
          <p style="font-size:12pt;line-height:1.5">
            This document sets out the handover process between shifts. Outgoing staff
            record open tasks in the console before 10 AM. Incoming staff confirm receipt
            within the first hour of the shift, between 5–7 PM where the evening handover
            applies.
          </p>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Fonts by Channel</h3>
        <p class="text-muted-foreground text-sm">
          Three stacks on purpose. Using the wrong one is not a style slip — it can make
          the brand fail to render at all.
        </p>
        <div class="flex flex-col gap-3">
          <div v-for="t in typeStacks" :key="t.channel" class="border-border flex flex-col gap-1 rounded-lg border p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <span class="text-2xl" :style="{ fontFamily: t.stack }">{{ t.face }}</span>
              <span class="text-muted-foreground text-xs">{{ t.channel }}</span>
            </div>
            <p class="text-lg" :style="{ fontFamily: t.stack }">
              We simplify hotel operations, turning complexity into simplicity
            </p>
            <p class="text-muted-foreground text-sm">{{ t.why }}</p>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Punctuation &amp; Character Styling</h3>
        <p class="text-muted-foreground text-sm">
          The brand does not shout. Body copy takes correct punctuation; headlines take
          none; nothing anywhere takes an exclamation mark. No emoji appears in any
          sourced material.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr class="border-border text-muted-foreground border-b text-xs">
                <th class="py-2 pr-4 font-semibold">Rule</th>
                <th class="py-2 pr-4 font-semibold">Use</th>
                <th class="py-2 font-semibold">Avoid</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in copyRules" :key="c.rule" class="border-border border-b text-sm last:border-0">
                <td class="text-muted-foreground py-3 pr-4">{{ c.rule }}</td>
                <td class="py-3 pr-4 font-medium">{{ c.use }}</td>
                <td class="text-muted-foreground py-3 line-through">{{ c.avoid }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="flex flex-col gap-4">
        <h3 class="font-heading text-xl font-bold">Type Scale</h3>
        <p class="text-muted-foreground text-sm">
          Specimens are sized from the design system's own values. Where Tailwind's
          same-named utility differs, both are shown — these apps have not adopted the
          design system scale into <code class="text-xs">@theme</code>, so
          <code class="text-xs">text-3xl</code> is still 1.875rem, not 2.25rem.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr class="border-border text-muted-foreground border-b text-xs">
                <th class="py-2 pr-4 font-semibold">Token</th>
                <th class="py-2 pr-4 font-semibold">Design system</th>
                <th class="py-2 pr-4 font-semibold">Tailwind utility</th>
                <th class="py-2 font-semibold">Specimen</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in typeScale" :key="t.token" class="border-border border-b last:border-0">
                <td class="text-muted-foreground py-3 pr-4 align-middle text-xs">{{ t.token }}</td>
                <td class="py-3 pr-4 align-middle text-xs">{{ t.rem }}</td>
                <td class="py-3 pr-4 align-middle text-xs" :class="t.rem === t.tw ? 'text-muted-foreground' : 'text-warning-tint-foreground'">
                  {{ t.rem === t.tw ? 'same' : t.tw }}
                </td>
                <td class="py-3 align-middle">
                  <span class="block truncate leading-tight" :style="{ fontSize: t.rem }">Sentinel Tech</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <Toaster position="bottom-right" close-button />
    </div>
  </div>
</template>
