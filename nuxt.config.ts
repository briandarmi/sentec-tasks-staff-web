import tailwindcss from '@tailwindcss/vite'
import { externalizeInlineScripts } from './build/externalize-inline-scripts'

/**
 * Where the shell is mounted. `/` on S3 + CloudFront; a GitHub Pages project
 * site lives under `/<repo>/`, which the Pages workflow passes in as
 * `NUXT_APP_BASE_URL` at build time. Every URL Nuxt emits — router, `_nuxt/`
 * chunks, the externalised bootstrap scripts — honours `app.baseURL`; the
 * `<head>` links below are the one place we have to prefix by hand.
 */
const baseURL = process.env.NUXT_APP_BASE_URL || '/'
const withBase = (path: string) => `${baseURL.replace(/\/$/, '')}${path}`

/**
 * The dev copy of sentec-tasks-api on AWS Lambda (ap-southeast-3). `nuxt dev`
 * talks to it BY DEFAULT: /v1 is proxied there so the browser sees one origin
 * and the API's SameSite=Lax `st_session` cookie is stored on localhost.
 *
 *   pnpm dev                    → live data from the dev API through the proxy
 *   NUXT_USE_MOCK=1 pnpm dev    → the in-browser mock (tests always use it)
 *   NUXT_DEV_API_PROXY=<url>    → a different API behind /v1 (e.g. a local go run ./cmd/server)
 *   NUXT_PUBLIC_API_BASE=<url>  → this app's OWN dev server; never the Function URL itself
 *
 * Static builds (`nuxt generate`: GitHub Pages, CloudFront) have no dev proxy
 * and stay on the mock unless NUXT_PUBLIC_API_BASE names a same-site API.
 */
const DEV_API_URL = 'https://cy2ori3ybex2n5ibpa3j2kxq3e0zyzjo.lambda-url.ap-southeast-3.on.aws'
/** The port the dev API's CORS and sign-in redirects expect this app on. */
const DEV_PORT = 3000
const useMock = ['1', 'true', 'yes'].includes(String(process.env.NUXT_USE_MOCK ?? '').toLowerCase())
const devProxyTarget = useMock ? '' : (process.env.NUXT_DEV_API_PROXY ?? DEV_API_URL).replace(/\/+$/, '')
const devApiBase = useMock ? '' : (process.env.NUXT_PUBLIC_API_BASE ?? `http://localhost:${DEV_PORT}`)

export default defineNuxtConfig({
  // Single-page app: no server rendering, no per-route HTML.
  ssr: false,
  devServer: { port: DEV_PORT },
  css: ['~/assets/css/tailwind.css'],
  compatibilityDate: '2025-01-01',
  /**
   * `nuxt generate` would otherwise crawl every <NuxtLink> and emit one shell
   * per route. A single shell serves every path on both hosts: CloudFront
   * rewrites 403/404 to /index.html, and GitHub Pages serves the `404.html`
   * copy the static preset emits alongside it (status 404, same shell).
   */
  nitro: {
    preset: 'static',
    prerender: {
      crawlLinks: false,
      routes: ['/'],
      failOnError: true,
    },
    /**
     * `nuxt dev` only; a build ignores it. Forwards /v1/* to the dev API so
     * the browser sees ONE origin and the API's SameSite=Lax `st_session`
     * cookie is stored on localhost — calling a Lambda Function URL directly
     * signs in and then 401s on every following call. The target keeps /v1
     * because h3 strips the mount prefix; changeOrigin is required because a
     * Function URL routes on the Host header. See README, "Running against the dev API".
     */
    devProxy: devProxyTarget
      ? { '/v1': { target: `${devProxyTarget}/v1`, changeOrigin: true } }
      : {},
  },
  runtimeConfig: {
    public: {
      /**
       * Where the API is. Empty keeps the app on the in-browser mock — the
       * right answer for a static build, which has no proxy. `nuxt dev`
       * overrides it below with this app's own dev server so the devProxy
       * carries /v1 across; never point it at the Function URL itself.
       */
      apiBase: process.env.NUXT_PUBLIC_API_BASE || '',
    },
  },
  /** `nuxt dev` only (Nuxt's per-environment override): live by default. */
  $development: {
    runtimeConfig: { public: { apiBase: devApiBase } },
  },
  /**
   * Moves Nuxt's inline bootstrap scripts into external files at prerender time,
   * so CloudFront's `script-src` can stay on plain `'self'` — no
   * `'unsafe-inline'`, no per-build hashes.
   *
   * See build/externalize-inline-scripts.ts.
   */
  hooks: {
    'nitro:init': externalizeInlineScripts,
  },
  app: {
    baseURL,
    head: {
      meta: [
        /**
         * Internal workspace — nothing here belongs in a search index. Emitted
         * into the prerendered shell, so a crawler sees it without running any
         * JavaScript. This is the directive that actually removes a URL from an
         * index; `public/robots.txt` only stops the fetch, and a blocked page
         * can still be listed as a bare URL.
         */
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [
        /**
         * SVG first — supporting browsers prefer it and get a crisp mark at any
         * density. logo.svg hardcodes the brand blue rather than using
         * `currentColor`, which is required here: a favicon has nothing to
         * inherit from, so `currentColor` would resolve to black.
         * favicon.ico stays as the fallback for browsers that ignore SVG icons.
         */
        { rel: 'icon', type: 'image/svg+xml', href: withBase('/img/logo.svg') },
        { rel: 'icon', type: 'image/x-icon', href: withBase('/favicon.ico') },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  modules: ['shadcn-nuxt', '@nuxt/fonts'],
  fonts: {
    families: [
      {
        name: 'Quicksand',
        provider: 'google',
        /**
         * The design system uses the full Quicksand family: Bold for headlines
         * and regular/medium/semibold/bold plus a Light for body copy. Without
         * this list @nuxt/fonts fetches weight 400 only, and the browser fakes
         * the rest — synthetic bold on a rounded geometric like Quicksand
         * smears the terminals and reads as a different typeface, which is
         * exactly what the brand mandates against.
         */
        weights: [300, 400, 500, 600, 700],
      },
    ],
  },
  shadcn: {
    /**
     * Prefix for all the imported component.
     * @default "Ui"
     */
    prefix: '',
    /**
     * Directory that the component lives in.
     * Will respect the Nuxt aliases.
     * @link https://nuxt.com/docs/api/nuxt-config#alias
     * @default "@/components/ui"
     */
    componentDir: '@/components/ui',
  },
})
