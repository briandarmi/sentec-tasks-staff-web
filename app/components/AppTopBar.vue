<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronsUpDownIcon, UserRoundIcon } from '@lucide/vue'
import { useSession } from '~/composables/useSession'

defineProps<{ title: string }>()

const route = useRoute()
const session = useSession()

const activeProperty = computed(() => session.activeHotel.value)
const canSwitch = computed(() => session.hotels.value.length > 1)
const switcherOpen = ref(false)

/**
 * Profile lives up here as an icon beside the theme toggle rather than as a
 * bottom tab: it is a settings screen visited a few times a shift, not a
 * work surface, and the bottom bar is reserved for the places work happens.
 */
const profileActive = computed(() => route.path === '/profile')
</script>

<template>
  <!-- min-h + safe-area padding, not a fixed height: on a notched phone the
       system status bar must not sit on top of the title. -->
  <header
    class="sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur"
    style="padding-top: env(safe-area-inset-top)"
  >
    <AppLogo class="h-8 w-8 shrink-0 text-primary" />

    <div class="min-w-0 flex-1">
      <h1 class="truncate text-base font-bold leading-tight tracking-tight">{{ title }}</h1>
      <button
        v-if="activeProperty"
        type="button"
        class="flex max-w-full items-center gap-1 rounded text-[11px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="canSwitch ? 'active:text-foreground' : 'cursor-default'"
        :disabled="!canSwitch"
        @click="canSwitch && (switcherOpen = true)"
      >
        <span class="truncate">{{ activeProperty.name }}</span>
        <ChevronsUpDownIcon v-if="canSwitch" class="h-3 w-3 shrink-0" />
      </button>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <ThemeToggle />

      <Button
        as-child
        variant="ghost"
        size="icon"
        :class="profileActive ? 'text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'"
      >
        <NuxtLink
          to="/profile"
          title="Profile"
          aria-label="Profile"
          :aria-current="profileActive ? 'page' : undefined"
        >
          <UserRoundIcon class="h-4 w-4" />
        </NuxtLink>
      </Button>
    </div>

    <PropertySwitcher v-if="canSwitch" v-model:open="switcherOpen" />
  </header>
</template>
