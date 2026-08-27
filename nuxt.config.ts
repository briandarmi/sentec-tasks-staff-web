import tailwindcss from '@tailwindcss/vite'
import { externalizeInlineScripts } from './build/externalize-inline-scripts'

export default defineNuxtConfig({
  // Single-page app: no server rendering, no per-route HTML.
  ssr: false,
  css: ['~/assets/css/tailwind.css'],
  compatibilityDate: '2025-01-01',
  /**
   * `nuxt generate` would otherwise crawl every <NuxtLink> and emit one shell
   * per route. This app is served from S3 behind CloudFront, which rewrites
   * 403/404 to /index.html, so a single shell serves every path.
   */
  nitro: {
    preset: 'static',
    prerender: {
      crawlLinks: false,
      routes: ['/'],
      failOnError: true,
    },
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
        { rel: 'icon', type: 'image/svg+xml', href: '/img/logo.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
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
