<script setup lang="ts">
import { MoonIcon, SunIcon } from '@lucide/vue'
import { useTheme } from '~/composables/useTheme'

const { isDark, toggle } = useTheme()
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    class="text-muted-foreground hover:text-foreground"
    :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="toggle"
  >
    <SunIcon v-if="isDark" class="h-4 w-4" />
    <MoonIcon v-else class="h-4 w-4" />
  </Button>
</template>
