import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Everything tested here — the mock API contract, the presentation helpers,
    // the access rule — is pure TypeScript with no DOM dependency, so the node
    // environment is enough and keeps the suite fast.
    //
    // Component- and browser-level tests are deliberately absent: this
    // environment has no working headless browser (Chromium is cached but
    // libnss3 is missing and installing it needs root), and a Nuxt-runtime
    // component environment could not be brought up either. Touch-target sizes
    // and screen-reader behaviour are therefore reviewed in CSS, not measured.
    // See README — "Not verified yet".
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      // Nuxt resolves `~` for app code; vitest runs outside Nuxt, so the specs
      // need it spelled out to import the same modules by the same specifier.
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
})
