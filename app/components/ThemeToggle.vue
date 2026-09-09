<script setup lang="ts">
import { LaptopIcon, MoonIcon, SmartphoneIcon, SunIcon } from '@lucide/vue'
import { themeSlug, useTheme } from '~/composables/useTheme'

/**
 * Click-to-cycle theme control: device, then dark, then light.
 *
 * Device mode follows the OS/browser and is the default, so it leads the
 * rotation. Its icon is the hardware in use rather than a third abstract
 * symbol, which is what makes "this follows your machine" legible at a glance.
 */
const { preference, nextPreference, isDevice, isHandheld, cycle } = useTheme()

const LABEL = { device: 'Device', light: 'Light', dark: 'Dark' } as const

const icon = computed(() => {
  if (isDevice.value) return isHandheld.value ? SmartphoneIcon : LaptopIcon
  return preference.value === 'dark' ? MoonIcon : SunIcon
})

const label = computed(
  () => `Theme: ${LABEL[themeSlug(preference.value)]}. Switch to ${LABEL[themeSlug(nextPreference.value)]}.`,
)
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    class="text-muted-foreground hover:text-foreground"
    :title="label"
    :aria-label="label"
    @click="cycle"
  >
    <component :is="icon" class="h-4 w-4" />
  </Button>
</template>
