import { useColorMode } from '@vueuse/core'

/**
 * App-wide light/dark theme state.
 *
 * Wraps VueUse `useColorMode`, which toggles the `dark`/`light` class on
 * `<html>` (matching the `@custom-variant dark (&:is(.dark *))` in tailwind.css)
 * and persists the choice to localStorage. Safe under `ssr: false`.
 */
export function useTheme() {
  const mode = useColorMode({
    storageKey: 'sentec-tasks-theme',
    // Emit `light`/`dark` classes so the `.dark` Tailwind variant resolves.
    modes: { light: 'light', dark: 'dark' },
  })

  const isDark = computed(() => mode.value === 'dark')

  function toggle() {
    mode.value = isDark.value ? 'light' : 'dark'
  }

  return { mode, isDark, toggle }
}
