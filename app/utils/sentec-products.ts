/**
 * The Sentec product roster and product-icon artwork.
 *
 * Mirrored from the Sentinel Tech Design System — `components/product/ProductIcon.jsx`
 * and `tokens/product-colors.css` — which imports github.com/SentinelTech-com/
 * sentec-product-icons (master, synced into the design system on 2026-09-03). The
 * design system is the authority when the two disagree, and since 2026-10-08 it
 * does: its dark tile moved from a navy ink ground onto the Sentinel Grey scale
 * (grey-800 to grey-900) with new per-product borders drawn at 2px, and the
 * pictogram grew from scale 1.4583 to 1.75 inside the tile. The data here was
 * generated from the icon set's SVGs, checked against its `tokens.json`, then
 * diffed field by field against the design system's component — only those
 * fields differ — so every hue, gradient stop and path is verbatim, not retyped.
 *
 * Twelve products, one hue each, four marks per product:
 *
 *  - tile, light   a 64px rounded square on the deepened hue, white (or ink,
 *                  for EMS and SLS — yellow cannot hold white) glyph
 *  - tile, dark    the Sentinel Grey ground with a 2px per-product border and
 *                  a neon glyph, for dark surfaces
 *  - glyph         the 24px pictogram alone, in `currentColor`
 *  - mono          the pictogram in the flat hue, no gradient — print, invoices,
 *                  embroidery
 *
 * The rules that travel with the set: colour reaches the icon and its accent
 * bar only — headings, links and buttons stay Sentinel Blue; never recolour a
 * glyph outside its own two values; below 20px the mark is the Sentinel shield
 * in the product hue (that is the favicon rule); XD is deliberately
 * unsaturated because it sits above the products, not beside them; SLS is the
 * only metallic tile and collapses to flat gold in mono.
 *
 * Rendered by `ProductIcon.vue`. `SENTEC_PRODUCTS` is the roster for grids and
 * pickers; `resolveSentecProduct` accepts a slug ("sentec-pms"), a code ("PMS")
 * or a bare name ("pms"), as the design system's component does.
 */

export type SentecProductTier = 'core' | 'support' | 'upcoming'

export type SentecProductCode =
  | 'PMS'
  | 'POS'
  | 'FIN'
  | 'SBE'
  | 'EMS'
  | 'BQT'
  | 'CRM'
  | 'XD'
  | 'SRI'
  | 'SAM'
  | 'BTL'
  | 'SLS'

export interface SentecProduct {
  /** `sentec-<kebab-name>`, also the asset file name in the icon set. */
  slug: string
  code: SentecProductCode
  name: string
  tier: SentecProductTier
  /** The product hue — the light tile's base and the mono glyph colour. */
  light: string
  /** The neon glyph colour on the dark tile. */
  dark: string
}

/** A linear gradient as the icon set draws it: the vector is x1, y1, x2, y2 in objectBoundingBox units. */
export interface SentecGradient {
  vector: readonly [string, string, string, string]
  stops: ReadonlyArray<readonly [offset: string, color: string]>
}

export interface SentecProductArtwork {
  /** The 24px pictogram path, drawn as a 1.7 round-capped stroke. */
  d: string
  /** The light tile's fill. All products but SLS run top to bottom from a lifted hue down to the base. */
  lightTile: SentecGradient
  /** Glyph colour over the light tile — white, or ink for the two yellows. */
  onTile: string
  /** Glyph colour over the dark tile. */
  darkGlyph: string
  /** The dark tile's 2px inner border, which is what separates it from a dark page. */
  darkBorder: string
  /** The flat hue for the mono variant. */
  mono: string
}

/**
 * The dark tile ground, shared by every product: Sentinel Grey 800 down to 900,
 * the same two greys the consoles' dark surfaces are built from (the design
 * system writes them as `--st-grey-800` and `--surface-dark`).
 */
export const SENTEC_INK_TILE: SentecGradient = {
  vector: ['0', '0', '.6', '1'],
  stops: [['0', '#3A3D43'], ['1', '#2B2D31']],
}

/** Corner radius of the 64px tile, as the design system's `--product-tile-radius`. */
export const SENTEC_TILE_RADIUS = 16

/** How much the 24px pictogram is scaled up when centred on the 64px tile. */
export const SENTEC_GLYPH_SCALE = 1.75

/** The dark tile's border: a 2px stroke inset by 1px, so it sits fully inside the tile. */
export const SENTEC_DARK_BORDER = { inset: 1, width: 2 } as const

export const SENTEC_PRODUCTS: readonly SentecProduct[] = [
  { slug: 'sentec-pms', code: 'PMS', name: 'Sentec PMS', tier: 'core', light: '#0A6DE0', dark: '#4CC2FF' },
  { slug: 'sentec-pos', code: 'POS', name: 'Sentec POS', tier: 'core', light: '#D9491A', dark: '#FF8A3D' },
  { slug: 'sentec-finance', code: 'FIN', name: 'Sentec Finance', tier: 'core', light: '#00875A', dark: '#2FE0A0' },
  { slug: 'sentec-booking-engine', code: 'SBE', name: 'Sentec Booking Engine', tier: 'core', light: '#7B2BE8', dark: '#C084FF' },
  { slug: 'sentec-ems', code: 'EMS', name: 'Sentec EMS', tier: 'core', light: '#FFD016', dark: '#FFE04D' },
  { slug: 'sentec-banqueting', code: 'BQT', name: 'Sentec Banqueting', tier: 'support', light: '#5566DC', dark: '#A9B6FF' },
  { slug: 'sentec-crm', code: 'CRM', name: 'Sentec CRM', tier: 'support', light: '#D01E7D', dark: '#FF5FB0' },
  { slug: 'sentec-xd', code: 'XD', name: 'Sentec XD', tier: 'support', light: '#12304A', dark: '#9FB6CC' },
  { slug: 'sentec-reputation-intelligence', code: 'SRI', name: 'Sentec Reputation Intelligence', tier: 'upcoming', light: '#7A2E9E', dark: '#C98BFF' },
  { slug: 'sentec-asset-management', code: 'SAM', name: 'Sentec Asset Management', tier: 'upcoming', light: '#4F8A14', dark: '#9FE05A' },
  { slug: 'sentec-butler-service', code: 'BTL', name: 'Sentec Butler Service', tier: 'upcoming', light: '#B0234F', dark: '#FF7A96' },
  { slug: 'sentec-loyalty-system', code: 'SLS', name: 'Sentec Loyalty System', tier: 'upcoming', light: '#E2A106', dark: '#FFC94D' },
]

export const SENTEC_PRODUCT_ARTWORK: Readonly<Record<SentecProductCode, SentecProductArtwork>> = {
  PMS: {
    d: 'M3.5 18.4v-4.1a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4.1M3.5 16h17M7.2 12.3V9.6a1.1 1.1 0 0 1 1.1-1.1h3a1.1 1.1 0 0 1 1.1 1.1v2.7M4.6 18.4v1.7M19.4 18.4v1.7',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#3486e5'], ['1', '#0A6DE0']] },
    onTile: '#FFFFFF',
    darkGlyph: '#4CC2FF',
    darkBorder: '#355a6f',
    mono: '#0A6DE0',
  },
  POS: {
    d: 'M6 3.6h12v15.3l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4zM9 8.2h6M9 11.6h6M9 15h3',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#df6841'], ['1', '#D9491A']] },
    onTile: '#FFFFFF',
    darkGlyph: '#FF8A3D',
    darkBorder: '#6b4935',
    mono: '#D9491A',
  },
  FIN: {
    d: 'M4 7.4c0-1.4 3.6-2.4 8-2.4s8 1 8 2.4-3.6 2.4-8 2.4-8-1-8-2.4zM4 7.4v9.2c0 1.4 3.6 2.4 8 2.4s8-1 8-2.4V7.4M4 12c0 1.4 3.6 2.4 8 2.4s8-1 8-2.4',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#2b9b76'], ['1', '#00875A']] },
    onTile: '#FFFFFF',
    darkGlyph: '#2FE0A0',
    darkBorder: '#2c6352',
    mono: '#00875A',
  },
  SBE: {
    d: 'M12 3.6a8.4 8.4 0 1 0 0 16.8a8.4 8.4 0 1 0 0-16.8M3.6 12h16.8M12 3.6c-3.1 3.4-3.1 13.4 0 16.8M12 3.6c3.1 3.4 3.1 13.4 0 16.8',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#914fec'], ['1', '#7B2BE8']] },
    onTile: '#FFFFFF',
    darkGlyph: '#C084FF',
    darkBorder: '#58476f',
    mono: '#7B2BE8',
  },
  EMS: {
    d: 'M9 8.2a3.1 3.1 0 1 0 0 6.2a3.1 3.1 0 1 0 0-6.2M3.3 20.2a5.7 5.7 0 0 1 11.4 0M16.3 8.7a3 3 0 0 1 0 5.2M20.7 20.2a5.7 5.7 0 0 0-3.5-5.2',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#ffd52d'], ['1', '#FFD016']] },
    onTile: '#101A24',
    darkGlyph: '#FFE04D',
    darkBorder: '#6b6339',
    mono: '#FFD016',
  },
  BQT: {
    d: 'M3.6 6.6h16.8v13.8H3.6zM3.6 10.4h16.8M8 3.6v4M16 3.6v4M9.6 13.8h1.7v1.7H9.6zM12.8 13.8h1.7v1.7h-1.7z',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#7280e2'], ['1', '#5566DC']] },
    onTile: '#FFFFFF',
    darkGlyph: '#A9B6FF',
    darkBorder: '#51566f',
    mono: '#5566DC',
  },
  CRM: {
    d: 'M12 20.2s-7-4.6-7-10.1A4 4 0 0 1 12 7.6a4 4 0 0 1 7 2.5c0 5.5-7 10.1-7 10.1z',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#d84493'], ['1', '#D01E7D']] },
    onTile: '#FFFFFF',
    darkGlyph: '#FF5FB0',
    darkBorder: '#6b3c57',
    mono: '#D01E7D',
  },
  XD: {
    d: 'M4 16.2a8 8 0 0 1 16 0M12 16.2l4.2-5.2M11 16.2a1 1 0 1 0 2 0a1 1 0 1 0-2 0M3 20.2h18',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#3a5369'], ['1', '#12304A']] },
    onTile: '#FFFFFF',
    darkGlyph: '#9FB6CC',
    darkBorder: '#4e5660',
    mono: '#12304A',
  },
  SRI: {
    d: 'M12 3.4l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#9152ae'], ['1', '#7A2E9E']] },
    onTile: '#FFFFFF',
    darkGlyph: '#C98BFF',
    darkBorder: '#5a496f',
    mono: '#7A2E9E',
  },
  SAM: {
    d: 'M12 3.4l8.2 4.6v8.9L12 21.5l-8.2-4.6V8zM3.8 8l8.2 4.6L20.2 8M12 12.6v8.9',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#6d9e3c'], ['1', '#4F8A14']] },
    onTile: '#FFFFFF',
    darkGlyph: '#9FE05A',
    darkBorder: '#4e633d',
    mono: '#4F8A14',
  },
  BTL: {
    d: 'M3.4 18.6h17.2M5.2 18.6a6.8 6.8 0 0 1 13.6 0M12 6.9V4.6M10.4 4.6h3.2',
    lightTile: { vector: ['0', '0', '0', '1'], stops: [['0', '#bd486d'], ['1', '#B0234F']] },
    onTile: '#FFFFFF',
    darkGlyph: '#FF7A96',
    darkBorder: '#6b444f',
    mono: '#B0234F',
  },
  SLS: {
    d: 'M3.6 9.4h16.8v4.2H3.6zM5 13.6h14v6.8H5zM12 9.4v11M8.7 9.4a2.2 2.2 0 0 1 0-4.4c2.3 0 3.3 4.4 3.3 4.4M15.3 9.4a2.2 2.2 0 0 0 0-4.4c-2.3 0-3.3 4.4-3.3 4.4',
    lightTile: { vector: ['0', '0', '1', '1'], stops: [['0', '#f1d287'], ['.38', '#e5ac24'], ['.62', '#E2A106'], ['1', '#a77704']] },
    onTile: '#101A24',
    darkGlyph: '#FFC94D',
    darkBorder: '#6b5c39',
    mono: '#E2A106',
  },
}

const BY_SLUG = new Map(SENTEC_PRODUCTS.map(p => [p.slug, p]))
const BY_CODE = new Map(SENTEC_PRODUCTS.map(p => [p.code, p]))

/**
 * Finds a product by slug ("sentec-pms"), code ("PMS", any case) or bare name
 * ("pms", "booking engine"). Returns null for anything else — the caller
 * decides whether an unknown product is an error or just renders nothing.
 */
export function resolveSentecProduct(product: string | null | undefined): SentecProduct | null {
  if (!product) return null
  const key = String(product).trim()
  if (!key) return null
  return (
    BY_SLUG.get(key)
    ?? BY_CODE.get(key.toUpperCase() as SentecProductCode)
    ?? BY_SLUG.get('sentec-' + key.toLowerCase().replace(/\s+/g, '-'))
    ?? null
  )
}
