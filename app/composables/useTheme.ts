import { useColorMode, useMediaQuery } from '@vueuse/core'

/**
 * What the user picked, as stored. `auto` defers to the device — whatever the
 * OS or browser reports through `prefers-color-scheme` — while `light` and
 * `dark` pin the theme regardless of it.
 *
 * The stored value stays VueUse's own `auto` rather than the word `device`,
 * because `useColorMode` special-cases that string internally. "Device" is a
 * UI label only.
 */
export type ThemePreference = 'auto' | 'light' | 'dark'

/**
 * The order the header toggle cycles through: device first, so the default sits
 * at the head of the rotation, then dark, then light.
 */
export const THEME_CYCLE: readonly ThemePreference[] = ['auto', 'dark', 'light']

/** UI slug for a stored preference — `auto` is shown to users as "device". */
export function themeSlug(preference: ThemePreference) {
  return preference === 'auto' ? 'device' : preference
}

/**
 * App-wide theme state: device / light / dark.
 *
 * Wraps VueUse `useColorMode`, which toggles the `dark`/`light` class on
 * `<html>` (matching the `@custom-variant dark (&:is(.dark *))` in tailwind.css)
 * and persists the choice to localStorage. Safe under `ssr: false`.
 *
 * The storage key MUST match the one read by app/spa-loading-template.html —
 * a mismatch makes the splash resolve the wrong theme and the page flashes on
 * reload.
 */
export function useTheme() {
  const mode = useColorMode({
    storageKey: 'sentec-tasks-theme',
    // Emit `light`/`dark` classes so the `.dark` Tailwind variant resolves.
    // `auto` never reaches the class list: it resolves to one of the two first.
    modes: { light: 'light', dark: 'dark' },
  })

  /**
   * The stored choice, which keeps `auto`. Reading `mode.value` resolves `auto`
   * away against the device, so the UI needs `store` to know that device mode
   * is what is actually selected.
   */
  const preference = mode.store
  /** Always `light` or `dark` — `auto` already resolved against the device. */
  const resolved = mode.state

  const isDark = computed(() => resolved.value === 'dark')
  const isDevice = computed(() => preference.value === 'auto')

  /**
   * A coarse pointer means a phone or tablet. It picks which icon device mode
   * shows, so the control points at the hardware the theme is being read from.
   */
  const isHandheld = useMediaQuery('(pointer: coarse)')

  const nextPreference = computed<ThemePreference>(
    () => THEME_CYCLE[(THEME_CYCLE.indexOf(preference.value) + 1) % THEME_CYCLE.length]!,
  )

  function setPreference(next: ThemePreference) {
    mode.value = next
  }

  function cycle() {
    setPreference(nextPreference.value)
  }

  return {
    mode,
    preference,
    resolved,
    nextPreference,
    isDark,
    isDevice,
    isHandheld,
    setPreference,
    cycle,
  }
}
