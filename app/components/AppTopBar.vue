<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronsUpDownIcon } from '@lucide/vue'
import { useSession } from '~/composables/useSession'

defineProps<{ title: string }>()

const session = useSession()

const activeProperty = computed(() => session.activeTenant.value)
const canSwitch = computed(() => session.tenants.value.length > 1)
const switcherOpen = ref(false)
</script>

<template>
  <header class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
    <AppLogo class="h-8 w-8 shrink-0 text-primary" />

    <div class="min-w-0 flex-1">
      <h1 class="truncate text-base font-bold leading-tight tracking-tight">{{ title }}</h1>
      <button
        v-if="activeProperty"
        type="button"
        class="flex max-w-full items-center gap-1 text-[11px] font-medium text-muted-foreground"
        :class="canSwitch ? 'active:text-foreground' : 'cursor-default'"
        :disabled="!canSwitch"
        @click="canSwitch && (switcherOpen = true)"
      >
        <span class="truncate">{{ activeProperty.name }}</span>
        <ChevronsUpDownIcon v-if="canSwitch" class="h-3 w-3 shrink-0" />
      </button>
    </div>

    <ThemeToggle />

    <PropertySwitcher v-if="canSwitch" v-model:open="switcherOpen" />
  </header>
</template>
