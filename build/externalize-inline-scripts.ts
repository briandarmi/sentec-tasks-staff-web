import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Rewrites every executable inline <script> in the prerendered shells into an
 * external file under the build assets dir, so the CSP `script-src` needs
 * neither `'unsafe-inline'` nor per-build `'sha256-…'` hashes — plain `'self'`
 * covers everything.
 *
 * Nuxt emits three executable inline scripts into the SPA shell:
 *
 *   1. `type="importmap"`  — maps `#entry` to the hashed entry chunk.
 *   2. a classic script    — the theme resolver inlined verbatim from
 *                            `app/spa-loading-template.html`.
 *   3. a classic script    — `window.__NUXT__.config = {…}`, the runtime config.
 *
 * (3) is what breaks under a strict CSP: the entry chunk calls `baseURL()` at
 * module-evaluation time, which reads `window.__NUXT__.config.app`. If the
 * bootstrap is blocked that read throws
 * `Cannot read properties of undefined (reading 'app')` and nothing mounts.
 *
 * ## Why the importmap is inlined into the chunks rather than externalised
 *
 * Import maps cannot be external — `<script type="importmap" src="…">` is
 * rejected by every browser, and the external-import-maps proposal was never
 * shipped. So the map has to go. But it cannot simply be deleted: whether
 * anything consumes it depends on how Rollup chose to chunk this particular
 * build. On 2026-08-26 `sentec-butler-admin-web` shipped 15 chunks containing
 * `import{…}from"#entry"` with the map removed, and every one of them failed in
 * the browser with
 *
 *     Failed to resolve module specifier "#entry"
 *
 * — a blank page behind a CloudFront 500. The two Sentec Tasks apps emitted no
 * such import from the same Nuxt version and the same hook, so the old
 * "nothing consumes it" assumption held there by luck, and the assertion that
 * was supposed to catch this only checked the map's *keys*, never whether any
 * chunk imported them.
 *
 * So: before dropping the map, every specifier it declares is resolved to its
 * real URL directly in the emitted chunks. Afterwards the map is genuinely
 * unused, and a final pass asserts no `#`-prefixed specifier survives anywhere
 * in `_nuxt/` — an unresolvable virtual specifier now fails the build instead of
 * the browser.
 *
 * ## Why the externalised scripts must stay render-blocking
 *
 * They are emitted WITHOUT `defer`/`async` on purpose. A classic blocking
 * script runs the moment the parser reaches it; module scripts are deferred and
 * run only after parsing. That ordering is what guarantees the config bootstrap
 * has already executed by the time the entry chunk evaluates.
 *
 * Adding `defer` would invert this and reintroduce the exact crash: deferred
 * classic scripts and module scripts share one queue ordered by document
 * position, and Nuxt emits the config script *after* the entry module tag.
 *
 * The cost is one extra same-origin request before first paint. Both files are
 * content-hashed and served from `_nuxt/`, so they inherit the immutable
 * cache-control the deploy already applies to that prefix.
 */

/** Script `type` values the browser executes. Anything else is a data block. */
const EXECUTABLE_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module'])

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi

function readAttr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1]
}

/** Short, stable, filename-safe digest of the script body. */
function digest(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex').slice(0, 12)
}

export interface ExternalizeResult {
  /** Files to write into the public dir, keyed by path relative to it. */
  assets: Map<string, string>
  html: string
  externalized: number
  droppedImportMaps: number
  /**
   * Specifier → URL from every import map that was dropped. The caller has to
   * resolve these in the emitted chunks, or the browser cannot.
   */
  importMap: Record<string, string>
}

/**
 * Pure transform: takes shell HTML, returns rewritten HTML plus the asset files
 * it now depends on. Kept side-effect free so it is directly unit-testable.
 */
export function externalizeHtml(
  html: string,
  opts: { baseURL: string, buildAssetsDir: string },
): ExternalizeResult {
  const assets = new Map<string, string>()
  const importMap: Record<string, string> = {}
  let externalized = 0
  let droppedImportMaps = 0

  // `buildAssetsDir` is normalised by Nuxt to a leading+trailing slash form
  // ("/_nuxt/"), and baseURL likewise ("/" or "/admin/"). Join without
  // doubling the separator.
  const urlPrefix = `${opts.baseURL.replace(/\/$/, '')}${opts.buildAssetsDir}`
  const dirInPublic = opts.buildAssetsDir.replace(/^\/|\/$/g, '')

  const out = html.replace(SCRIPT_RE, (tag, attrs: string, body: string) => {
    // Already external — `'self'` covers it.
    if (readAttr(attrs, 'src') !== undefined) return tag

    const type = (readAttr(attrs, 'type') ?? '').trim().toLowerCase()

    if (type === 'importmap') {
      let parsed: { imports?: Record<string, string> }
      try {
        parsed = JSON.parse(body)
      }
      catch {
        throw new Error(
          '[externalize-inline-scripts] Found an inline import map that is not valid JSON. '
          + 'Import maps cannot be made external, so this cannot be fixed automatically.',
        )
      }
      // Every specifier is carried out for the caller to resolve in the chunks.
      // No key is assumed to be unused — that assumption is what shipped a
      // broken bundle once already.
      for (const [spec, url] of Object.entries(parsed.imports ?? {})) {
        if (importMap[spec] !== undefined && importMap[spec] !== url) {
          throw new Error(
            `[externalize-inline-scripts] Import map specifier "${spec}" maps to two different URLs `
            + `across shells ("${importMap[spec]}" and "${url}"). Cannot rewrite chunks unambiguously.`,
          )
        }
        importMap[spec] = url
      }
      droppedImportMaps++
      return ''
    }

    // Data blocks (application/json, application/ld+json, text/template, …) are
    // never executed, so CSP script-src does not apply to them. Leave as-is.
    if (!EXECUTABLE_TYPES.has(type)) return tag

    // Whitespace-only script — nothing to extract.
    if (!body.trim()) return tag

    const name = `inline-${digest(body)}.js`
    assets.set(join(dirInPublic, name), body)
    externalized++

    // Preserve `type="module"` when present; deliberately no defer/async.
    const typeAttr = type === 'module' ? ' type="module"' : ''
    return `<script${typeAttr} src="${urlPrefix}${name}"></script>`
  })

  return { assets, html: out, externalized, droppedImportMaps, importMap }
}

/** Escape a string for literal use inside a RegExp. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace bare module specifiers with real URLs inside the emitted chunks.
 *
 * Only a *quoted, exact* specifier is rewritten — `"#entry"`, not `"#entryfoo"`
 * and not `#entry` appearing inside a longer string — so this cannot corrupt an
 * unrelated string literal that happens to share the prefix.
 */
async function resolveInChunks(assetsDir: string, imports: Record<string, string>) {
  let entries: string[]
  try {
    entries = await readdir(assetsDir)
  }
  catch (cause) {
    throw new Error(
      `[externalize-inline-scripts] Cannot read the build assets dir (${assetsDir}) to resolve `
      + `${Object.keys(imports).join(', ')}. Without this the bundle ships unresolvable specifiers.`,
      { cause },
    )
  }
  const files = entries.filter(f => f.endsWith('.js'))
  const patterns = Object.entries(imports).map(([spec, url]) => ({
    re: new RegExp(`(["'\`])${escapeRe(spec)}\\1`, 'g'),
    url,
    spec,
  }))

  let rewrites = 0
  const touched: string[] = []
  for (const file of files) {
    const path = join(assetsDir, file)
    const before = await readFile(path, 'utf8')
    let after = before
    for (const { re, url } of patterns) {
      after = after.replace(re, (_match, quote: string) => {
        rewrites++
        return `${quote}${url}${quote}`
      })
    }
    if (after !== before) {
      await writeFile(path, after, 'utf8')
      touched.push(file)
    }
  }
  return { rewrites, touched }
}

/**
 * Fail the build if any `#`-prefixed module specifier survives in the shipped
 * chunks. Those are Vite/Nuxt virtual aliases; with no import map left to
 * resolve them the browser throws `Failed to resolve module specifier` and
 * nothing mounts. Better a red build than a blank page.
 */
async function assertNoVirtualSpecifiers(assetsDir: string) {
  const files = (await readdir(assetsDir).catch(() => [] as string[])).filter(f => f.endsWith('.js'))
  const offenders: string[] = []
  for (const file of files) {
    const code = await readFile(join(assetsDir, file), 'utf8')
    const found = new Set<string>()
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*(["'`])(#[^"'`]+)\1/g)) found.add(match[2])
    if (found.size) offenders.push(`${file}: ${[...found].join(', ')}`)
  }
  if (offenders.length) {
    throw new Error(
      '[externalize-inline-scripts] Unresolvable virtual module specifier(s) left in the bundle:\n  '
      + offenders.join('\n  ')
      + '\nThe import map that resolved them has been removed and cannot be made external. '
      + 'Add the mapping to the shell\'s import map, or stop the entry from being imported by bare specifier.',
    )
  }
}

/**
 * Wire into `nuxt.config.ts`:
 *
 *   hooks: { 'nitro:init': externalizeInlineScripts }
 *
 * Runs during `nuxt generate` (and `nuxt build`, which prerenders under the
 * static preset) — every prerendered HTML route passes through here before it
 * is written to disk.
 */
export function externalizeInlineScripts(nitro: any): void {
  const publicDir: string = nitro.options.output.publicDir
  const baseURL: string = nitro.options.runtimeConfig?.app?.baseURL ?? '/'
  const buildAssetsDir: string = nitro.options.runtimeConfig?.app?.buildAssetsDir ?? '/_nuxt/'

  const assetsDir = join(publicDir, buildAssetsDir.replace(/^\/|\/$/g, ''))

  let totalExternalized = 0
  let totalDropped = 0
  let totalRewrites = 0
  let rewrittenChunks = 0
  const written = new Set<string>()
  /** Specifier → URL, merged across shells (they carry the same map). */
  const collectedImports: Record<string, string> = {}

  nitro.hooks.hook('prerender:generate', async (route: { contents?: string, fileName?: string }) => {
    if (!route.contents || !route.fileName?.endsWith('.html')) return

    const result = externalizeHtml(route.contents, { baseURL, buildAssetsDir })
    if (!result.externalized && !result.droppedImportMaps) return

    for (const [relPath, code] of result.assets) {
      // The three shells are byte-identical, so they yield identical digests;
      // write each file once.
      if (written.has(relPath)) continue
      const dest = join(publicDir, relPath)
      await mkdir(join(dest, '..'), { recursive: true })
      await writeFile(dest, code, 'utf8')
      written.add(relPath)
    }

    // Only collected here. The rewrite happens in `close`: during prerendering
    // the client chunks are not in `publicDir` yet, so rewriting now would find
    // an empty directory and silently do nothing — which is exactly how the
    // broken bundle shipped.
    Object.assign(collectedImports, result.importMap)

    route.contents = result.html
    totalExternalized += result.externalized
    totalDropped += result.droppedImportMaps
  })

  nitro.hooks.hook('close', async () => {
    // By now the client build's chunks are in place, so the specifiers the
    // dropped import maps declared can be resolved in them.
    if (Object.keys(collectedImports).length) {
      const { rewrites, touched } = await resolveInChunks(assetsDir, collectedImports)
      totalRewrites += rewrites
      rewrittenChunks += touched.length
    }

    // Runs whether or not anything was rewritten: a chunk importing a virtual
    // specifier with no map to resolve it is exactly the failure this guards.
    await assertNoVirtualSpecifiers(assetsDir)

    if (totalExternalized || totalDropped) {
      nitro.logger.success(
        `Externalized ${totalExternalized} inline script(s) into ${written.size} file(s)`
        + `${totalDropped ? `, dropped ${totalDropped} import map(s)` : ''}`
        + `${totalRewrites ? `, resolved ${totalRewrites} bare specifier(s) across ${rewrittenChunks} chunk(s)` : ''}`
        + ' — script-src needs no \'unsafe-inline\'',
      )
    }
  })
}
