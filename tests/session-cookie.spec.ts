import { describe, expect, it } from 'vitest'
import { COOKIE_MAX_BYTES, cookiePathFor, parseCookieValue, secondsUntil, serializeCookie } from '~/utils/session-cookie'

// The credential cookie (2026-09-17): the pure halves of reading and writing
// it. `readCookie` / `writeCookie` are one-line wrappers over document.cookie
// and need a browser; the attributes they emit are pinned here instead.

describe('cookiePathFor', () => {
  it('scopes to the app base without a trailing slash, root stays root', () => {
    expect(cookiePathFor('/')).toBe('/')
    expect(cookiePathFor('')).toBe('/')
    expect(cookiePathFor(undefined)).toBe('/')
    expect(cookiePathFor('/sentec-tasks-staff-web/')).toBe('/sentec-tasks-staff-web')
    expect(cookiePathFor('/sentec-tasks-staff-web')).toBe('/sentec-tasks-staff-web')
  })
})

describe('serializeCookie', () => {
  const opts = { path: '/app', maxAgeSeconds: 43200, secure: true }

  it('emits the value encoded with Path, SameSite=Strict, Secure and Max-Age', () => {
    expect(serializeCookie('sentec-tasks-session', 'abc def', opts))
      .toBe('sentec-tasks-session=abc%20def; Path=/app; SameSite=Strict; Secure; Max-Age=43200')
  })

  it('drops Secure on plain http and Max-Age for a browser-session cookie', () => {
    expect(serializeCookie('k', 'v', { path: '/', maxAgeSeconds: null, secure: false }))
      .toBe('k=v; Path=/; SameSite=Strict')
  })

  it('floors Max-Age at zero and to whole seconds', () => {
    expect(serializeCookie('k', 'v', { ...opts, maxAgeSeconds: 12.9 })).toContain('Max-Age=12')
    expect(serializeCookie('k', 'v', { ...opts, maxAgeSeconds: -5 })).toContain('Max-Age=0')
  })

  it('writes a deletion as an empty value with Max-Age=0', () => {
    expect(serializeCookie('k', null, opts)).toBe('k=; Path=/app; SameSite=Strict; Secure; Max-Age=0')
  })

  it('refuses a value that would exceed the browser cap instead of truncating a credential', () => {
    expect(() => serializeCookie('k', 'x'.repeat(COOKIE_MAX_BYTES), opts)).toThrow(/caps a cookie/)
    expect(() => serializeCookie('k', 'x'.repeat(1000), opts)).not.toThrow()
  })

  it('round-trips through parseCookieValue, JSON included', () => {
    const value = JSON.stringify({ accessToken: 'eyJ.a.b', token: 'ASTON-4021' })
    const header = `theme=dark; ${serializeCookie('sentec-butler-guest-token', value, opts).split(';')[0]}; other=1`
    expect(parseCookieValue(header, 'sentec-butler-guest-token')).toBe(value)
  })
})

describe('parseCookieValue', () => {
  it('finds the named cookie among others and decodes it', () => {
    expect(parseCookieValue('a=1; sentec-tasks-session=ab%3Dc; b=2', 'sentec-tasks-session')).toBe('ab=c')
  })

  it('is null when absent, for a prefix match, or for a broken encoding', () => {
    expect(parseCookieValue('a=1; b=2', 'c')).toBeNull()
    expect(parseCookieValue('sentec-tasks-session-old=1', 'sentec-tasks-session')).toBeNull()
    expect(parseCookieValue('k=%E0%A4%A', 'k')).toBeNull()
    expect(parseCookieValue('', 'k')).toBeNull()
  })
})

describe('secondsUntil', () => {
  it('counts whole seconds forward from now, never negative, null for no date', () => {
    const now = 1_000_000_000_000
    expect(secondsUntil(new Date(now + 90_500), now)).toBe(90)
    expect(secondsUntil(new Date(now - 1), now)).toBe(0)
    expect(secondsUntil(null, now)).toBeNull()
  })
})
