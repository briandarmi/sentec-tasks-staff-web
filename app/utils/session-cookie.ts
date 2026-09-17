/**
 * The credential cookie: where a signed-in session's secret lives on this
 * device since 2026-09-17, in place of Web Storage.
 *
 * Only the secret goes here — a bearer token, or the mock's session id — never
 * the profile that rides with it, because a cookie is capped at 4 KB per name
 * and a hotel record with its logo URLs can pass that. The profile stays in
 * localStorage as a cache that is meaningless without the cookie.
 *
 * What the move buys, plainly: an expiry the browser enforces (`Max-Age`),
 * `Secure` so the value never rides on plain http in a deployed build, and
 * `SameSite=Strict` scoped to this app's base path so a sibling app on the
 * same origin cannot read it by name. What it does NOT buy: a cookie written
 * by script cannot be `HttpOnly`, so a script injected into this page could
 * read it exactly as it could read localStorage. That protection would need
 * the API to set the cookie itself — which the Butler API does (same-origin
 * only) and the Tasks API does (`st_session`); these static SPAs are served
 * cross-origin from GitHub Pages, so the bearer stays with the app.
 *
 * Shared verbatim by sentec-butler-admin-web, sentec-butler-guest-web,
 * sentec-tasks-admin-web and sentec-tasks-staff-web.
 */

export interface CookieWriteOptions {
  /** Cookie `Path`. Use `cookiePathFor(useRuntimeConfig().app.baseURL)`. */
  path: string
  /** Seconds until the browser drops it; null for a browser-session cookie. */
  maxAgeSeconds: number | null
  /** Add `Secure`. True on https; on plain http the browser would refuse the cookie. */
  secure: boolean
}

/** Browsers cap a single cookie at 4096 bytes including attributes. */
export const COOKIE_MAX_BYTES = 4096

/** Cookie `Path` for an app served at `baseURL` (`/` or `/repo-name/`). No trailing slash except root. */
export function cookiePathFor(baseURL: string | undefined): string {
  const trimmed = (baseURL ?? '/').replace(/\/+$/, '')
  return trimmed || '/'
}

/** The value of `name` in a `Cookie` header / `document.cookie` string, decoded; null when absent. */
export function parseCookieValue(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
    catch {
      return null
    }
  }
  return null
}

/**
 * One `Set-Cookie`-shaped string for `document.cookie`. A null value is a
 * deletion (`Max-Age=0`). Throws when the result would exceed the browser's
 * per-cookie cap — silently truncated credentials are worse than a loud
 * failure at sign-in.
 */
export function serializeCookie(name: string, value: string | null, opts: CookieWriteOptions): string {
  const attrs = [`Path=${opts.path}`, 'SameSite=Strict']
  if (opts.secure) attrs.push('Secure')
  if (value === null) attrs.push('Max-Age=0')
  else if (opts.maxAgeSeconds !== null) attrs.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`)
  const out = `${name}=${value === null ? '' : encodeURIComponent(value)}; ${attrs.join('; ')}`
  if (out.length > COOKIE_MAX_BYTES) throw new Error(`Cookie ${name} would be ${out.length} bytes; the browser caps a cookie at ${COOKIE_MAX_BYTES}`)
  return out
}

/** `document.cookie` lookup; null outside the browser or when absent. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  return parseCookieValue(document.cookie, name)
}

/** Write (or with null, delete) a cookie. No-op outside the browser. */
export function writeCookie(name: string, value: string | null, opts: CookieWriteOptions): void {
  if (typeof document === 'undefined') return
  document.cookie = serializeCookie(name, value, opts)
}

/** Whether this page is served over https, so the cookie may carry `Secure`. */
export function isSecureOrigin(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:'
}

/** Whole seconds from now until `at`, floored at 0; null when `at` is null. */
export function secondsUntil(at: Date | null, now: number = Date.now()): number | null {
  if (!at) return null
  return Math.max(0, Math.floor((at.getTime() - now) / 1000))
}
