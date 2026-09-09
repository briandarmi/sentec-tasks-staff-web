<script setup lang="ts">
import { LaptopIcon, MoonIcon, SmartphoneIcon, SunIcon } from '@lucide/vue'
import { THEME_CYCLE, themeSlug, useTheme } from '~/composables/useTheme'

/**
 * Three-way theme picker for the Profile page. The header toggle cycles through
 * the same modes, but a settings row has space for labels, so the current mode
 * does not have to be inferred from an icon.
 *
 * Options follow THEME_CYCLE so both controls order the modes identically.
 */
const { preference, isHandheld, setPreference } = useTheme()

const LABEL = { device: 'Device', light: 'Light', dark: 'Dark' } as const

const options = computed(() =>
  THEME_CYCLE.map((value) => {
    const slug = themeSlug(value)
    return {
      value,
      label: LABEL[slug],
      icon: slug === 'device' ? (isHandheld.value ? SmartphoneIcon : LaptopIcon) : slug === 'dark' ? MoonIcon : SunIcon,
    }
  }),
)
</script>

<template>
  <div
    role="radiogroup"
    aria-label="Theme"
    class="inline-flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="option.value === preference"
      class="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors"
      :class="
        option.value === preference
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground'
      "
      @click="setPreference(option.value)"
    >
      <component :is="option.icon" class="h-3.5 w-3.5" />
      {{ option.label }}
    </button>
  </div>
</template>
