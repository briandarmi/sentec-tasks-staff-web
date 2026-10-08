import type { SentecProductCode } from '~/utils/sentec-products'

/**
 * Which Sentec product this console is — the one per-app brand fact.
 *
 * Everything that wears the product mark reads this: `AppLogo.vue` picks the
 * product tile over the company shield, and the design-system page's product
 * section shows this console's own icon and hue. The static copies that cannot
 * read it — `public/img/logo.svg`, `favicon.ico`, `logo.png` and the splash in
 * `spa-loading-template.html` — carry the same mark by hand; change them
 * together.
 *
 * Sentec Tasks has no entry in the design system's Sentec suite as of
 * 2026-10-08 (twelve products: PMS, POS, FIN, SBE, EMS, BQT, CRM, XD, SRI, SAM,
 * BTL, SLS), so it has no product hue or icon to wear. Until the suite lists
 * it, this console carries the SENTINEL TECH icon mark in Sentinel Blue. When
 * it is added, set the code here and refresh the static copies above.
 */
export const APP_PRODUCT: SentecProductCode | null = null
