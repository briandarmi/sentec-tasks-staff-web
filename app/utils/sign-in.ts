import type { AuthErrorCode } from '~/utils/clientFakeApi'

/**
 * The redirect-based sign-in legs (Google Sign-In, the emailed link) end with
 * the API 302ing the browser back to this app, carrying either the st_session
 * cookie or `?authError=<code>` — never a token, never a CSRF token. This
 * module owns both ends of that round trip: the `returnTo` the app hands the
 * API, and the closed set of codes it renders on the way back.
 *
 * Shared by the staff workspace and the admin console; each login screen
 * decides layout, this decides words and URLs.
 */

export interface AuthNotice {
  title: string
  message: string
  /** The user chose to stop — worth a calmer tone than a failure. */
  cancelled: boolean
}

/**
 * Copy per AuthErrorCode. The keys ARE the closed set: anything else in the
 * query string gets the generic line, and the raw value is never rendered —
 * it is attacker-controlled text on a page that says "sign in".
 *
 * Two codes are deliberately coarse and the copy keeps them so: no_account
 * also covers a deactivated account, link_invalid also covers expired and
 * already-used. Wording that distinguished them would turn the query string
 * into the account-existence oracle the always-202 request endpoint avoids.
 */
export const AUTH_ERROR_COPY: Record<AuthErrorCode, { title: string, message: string, cancelled?: true }> = {
  google_denied: {
    title: 'Sign-in cancelled',
    message: 'You closed the Google sign-in before it finished. Nothing changed — try again when you are ready.',
    cancelled: true,
  },
  invalid_state: {
    title: 'Couldn\'t sign in',
    message: 'That sign-in did not start from this browser tab, so it was refused. Start again from here.',
  },
  expired_flow: {
    title: 'Couldn\'t sign in',
    message: 'The Google sign-in was left open too long. Start again.',
  },
  exchange_failed: {
    title: 'Couldn\'t sign in',
    message: 'Google did not complete the sign-in. Try again in a moment.',
  },
  id_token_invalid: {
    title: 'Couldn\'t sign in',
    message: 'Google returned something we could not verify. Try again.',
  },
  email_unverified: {
    title: 'Couldn\'t sign in',
    message: 'Google reports that address as unverified. Verify it with Google first, or sign in another way.',
  },
  link_invalid: {
    title: 'That link no longer works',
    message: 'Sign-in links work once and expire after 15 minutes. Request a new one below.',
  },
  no_account: {
    title: 'No account for that address',
    message: 'That address does not belong to an active staff account here. Ask your property admin to add you.',
  },
  invalid_return_to: {
    title: 'Couldn\'t sign in',
    message: 'The sign-in tried to send you somewhere this app does not allow. Start again from here.',
  },
  unavailable: {
    title: 'Not available here',
    message: 'That way of signing in is not switched on for this deployment. Use another.',
  },
}

export const GENERIC_AUTH_NOTICE: AuthNotice = {
  title: 'Couldn\'t sign in',
  message: 'Something went wrong on the way back from signing in. Start again from here.',
  cancelled: false,
}

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUTH_ERROR_COPY, value)
}

/** The notice for the `?authError=` a redirect landed with; null when there is none. */
export function authErrorNotice(raw: unknown): AuthNotice | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === null || value === '') return null
  if (!isAuthErrorCode(value)) return GENERIC_AUTH_NOTICE
  const copy = AUTH_ERROR_COPY[value]
  return { title: copy.title, message: copy.message, cancelled: copy.cancelled === true }
}

/**
 * Only an in-app path may be a post-sign-in destination. `?redirect=` is
 * attacker-writable, and a scheme-relative or absolute URL there would make
 * the login screen an open redirect.
 */
export function safeRedirectPath(value: unknown): string | null {
  const s = Array.isArray(value) ? value[0] : value
  if (typeof s !== 'string' || !s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return null
  return s
}

/**
 * The `returnTo` handed to the API: this app's own login screen, on this
 * origin, with the deep link in its query. It rides the whole round trip
 * untouched (the API seals it into the flow cookie or the emailed link and
 * re-validates its origin against CORS_ALLOWED_ORIGINS), and both outcomes
 * then land on the one screen that has copy for them.
 */
export function buildReturnTo(origin: string, baseURL: string, redirect?: string | null): string {
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  const url = new URL(`${base}login`, origin)
  const safe = safeRedirectPath(redirect)
  if (safe && safe !== '/') url.searchParams.set('redirect', safe)
  return url.toString()
}

/**
 * Turn a 302's Location back into a router path. Only the mock needs this —
 * in production the browser performs the navigation and the app cold-boots —
 * but the rule is the same either way: another origin is not ours to follow.
 */
export function appPathFromLocation(location: string, origin: string, baseURL: string): string | null {
  let url: URL
  try {
    url = new URL(location)
  }
  catch {
    return null
  }
  if (url.origin !== origin) return null
  const base = baseURL.replace(/\/$/, '')
  const path = base && url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname
  return `${path || '/'}${url.search}`
}
