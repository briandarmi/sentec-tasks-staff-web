import { describe, expect, it } from 'vitest'
import { AUTH_ERROR_COPY, GENERIC_AUTH_NOTICE, SESSION_EXPIRED_NOTICE, appPathFromLocation, authErrorNotice, buildReturnTo, isSessionInvalidError, safeRedirectPath, sessionEndedNotice } from '~/utils/sign-in'
import { ApiError, handleFakeApiRequest } from '~/utils/clientFakeApi'

// The app's side of the redirect-based sign-in round trip: the returnTo it
// hands the API and the closed set of ?authError= codes it renders. Pinned so
// a code added to the API's AuthErrorCode enum without copy here, or a URL
// shape that would open-redirect, fails a test rather than a user.

/** openapi.yaml's AuthErrorCode enum on feat/google-and-magic-link-auth @ 48756a3, in its order. */
const AUTH_ERROR_CODES = [
  'google_denied',
  'invalid_state',
  'expired_flow',
  'exchange_failed',
  'id_token_invalid',
  'email_unverified',
  'link_invalid',
  'no_account',
  'invalid_return_to',
  'unavailable',
]

describe('authErrorNotice', () => {
  it('has copy for exactly the enum, and never renders the raw value', () => {
    expect(Object.keys(AUTH_ERROR_COPY).sort()).toEqual([...AUTH_ERROR_CODES].sort())
    for (const code of AUTH_ERROR_CODES) {
      const notice = authErrorNotice(code)!
      expect(notice.title.length).toBeGreaterThan(0)
      expect(notice.message).not.toContain(code)
    }
    // Only cancellation reads as the user's own choice.
    expect(authErrorNotice('google_denied')!.cancelled).toBe(true)
    expect(authErrorNotice('no_account')!.cancelled).toBe(false)
  })

  it('keeps the deliberately coarse codes coarse in the copy', () => {
    // Wording that told "no account" from "deactivated", or "expired" from
    // "already used", would move the account oracle into the query string.
    expect(authErrorNotice('no_account')!.message).not.toMatch(/deactivat/i)
    expect(authErrorNotice('link_invalid')!.message).toMatch(/once/)
  })

  it('falls back to the generic notice for anything outside the set, and to null for nothing', () => {
    expect(authErrorNotice('<script>alert(1)</script>')).toEqual(GENERIC_AUTH_NOTICE)
    expect(authErrorNotice('NO_ACCOUNT')).toEqual(GENERIC_AUTH_NOTICE)
    expect(authErrorNotice(['link_invalid', 'no_account'])!.title).toBe('That link no longer works')
    expect(authErrorNotice(undefined)).toBeNull()
    expect(authErrorNotice('')).toBeNull()
  })
})

describe('safeRedirectPath', () => {
  it('admits in-app paths only', () => {
    expect(safeRedirectPath('/tasks/abc?tab=history')).toBe('/tasks/abc?tab=history')
    expect(safeRedirectPath('/')).toBe('/')
    expect(safeRedirectPath('//evil.example/x')).toBeNull()
    expect(safeRedirectPath('/\\evil.example')).toBeNull()
    expect(safeRedirectPath('https://evil.example/')).toBeNull()
    expect(safeRedirectPath('tasks/abc')).toBeNull()
    expect(safeRedirectPath(undefined)).toBeNull()
    expect(safeRedirectPath(['/first', '/second'])).toBe('/first')
  })
})

describe('buildReturnTo', () => {
  it('points at this app\'s login screen on this origin, deep link in the query', () => {
    expect(buildReturnTo('http://localhost:3000', '/', '/tasks/abc')).toBe('http://localhost:3000/login?redirect=%2Ftasks%2Fabc')
    expect(buildReturnTo('http://localhost:3000', '/', '/')).toBe('http://localhost:3000/login')
    expect(buildReturnTo('http://localhost:3000', '/', null)).toBe('http://localhost:3000/login')
  })

  it('honours a GitHub Pages base path', () => {
    expect(buildReturnTo('https://briandarmi.github.io', '/sentec-tasks-staff-web/', '/offers'))
      .toBe('https://briandarmi.github.io/sentec-tasks-staff-web/login?redirect=%2Foffers')
    expect(buildReturnTo('https://briandarmi.github.io', '/sentec-tasks-staff-web', null))
      .toBe('https://briandarmi.github.io/sentec-tasks-staff-web/login')
  })

  it('drops an unsafe deep link rather than carrying it round the trip', () => {
    expect(buildReturnTo('http://localhost:3000', '/', '//evil.example')).toBe('http://localhost:3000/login')
  })
})

describe('appPathFromLocation', () => {
  it('turns the 302 Location back into a router path, base stripped', () => {
    expect(appPathFromLocation('http://localhost:3000/login?redirect=%2Ftasks%2Fabc&authError=no_account', 'http://localhost:3000', '/'))
      .toBe('/login?redirect=%2Ftasks%2Fabc&authError=no_account')
    expect(appPathFromLocation('http://localhost:3000/?authError=google_denied', 'http://localhost:3000', '/'))
      .toBe('/?authError=google_denied')
    expect(appPathFromLocation('https://briandarmi.github.io/sentec-tasks-staff-web/login', 'https://briandarmi.github.io', '/sentec-tasks-staff-web/'))
      .toBe('/login')
  })

  it('refuses another origin', () => {
    expect(appPathFromLocation('https://evil.example/login', 'http://localhost:3000', '/')).toBeNull()
    expect(appPathFromLocation('not a url', 'http://localhost:3000', '/')).toBeNull()
  })
})

// The forced sign-out (2026-09-17): what counts as a dead session, and the
// login screen's notice for it. The teardown + redirect in useSession.request
// needs the Nuxt runtime and is reviewed by hand — see README.
describe('isSessionInvalidError', () => {
  it('matches a 401 by status or by code, and nothing else', () => {
    expect(isSessionInvalidError({ status: 401 })).toBe(true)
    expect(isSessionInvalidError({ code: 'UNAUTHORIZED' })).toBe(true)
    // A 403 is a live session lacking a permission — the user stays signed in.
    expect(isSessionInvalidError({ status: 403, code: 'FORBIDDEN' })).toBe(false)
    expect(isSessionInvalidError({ status: 400, code: 'BAD_REQUEST' })).toBe(false)
    expect(isSessionInvalidError(null)).toBe(false)
    expect(isSessionInvalidError(new Error('network'))).toBe(false)
  })

  it('recognises what the mock throws for a cookie it no longer knows', () => {
    let thrown: unknown
    try {
      handleFakeApiRequest('/v1/auth/session', { headers: { cookie: 'st_session=00000000-0000-4000-8000-000000000000' } })
    }
    catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ApiError)
    expect((thrown as ApiError).status).toBe(401)
    expect(isSessionInvalidError(thrown)).toBe(true)
  })
})

describe('sessionEndedNotice', () => {
  it('knows only ?reason=expired, and never renders the raw value', () => {
    expect(sessionEndedNotice('expired')).toEqual(SESSION_EXPIRED_NOTICE)
    expect(sessionEndedNotice(['expired'])).toEqual(SESSION_EXPIRED_NOTICE)
    expect(SESSION_EXPIRED_NOTICE.cancelled).toBe(true)
    expect(sessionEndedNotice('<script>')).toBeNull()
    expect(sessionEndedNotice(undefined)).toBeNull()
    expect(sessionEndedNotice('')).toBeNull()
  })
})
