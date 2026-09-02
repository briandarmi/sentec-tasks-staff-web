<script setup lang="ts">
import { computed } from 'vue'
import { ClipboardListIcon, LayoutListIcon, PlusIcon, SquareKanbanIcon, UserRoundIcon } from '@lucide/vue'
import { useCaps } from '~/composables/useCaps'

const route = useRoute()
const { canCreateTask } = useCaps()

interface Tab { to: string, label: string, icon: unknown, match: (path: string) => boolean }

/**
 * Four tabs plus a centre action. Every target is at least 44px tall — this is
 * used one-handed, walking a corridor, so the hit areas matter more than the
 * density.
 */
const tabs: Tab[] = [
  { to: '/', label: 'My work', icon: ClipboardListIcon, match: path => path === '/' },
  { to: '/tasks', label: 'Tasks', icon: LayoutListIcon, match: path => path.startsWith('/tasks') && path !== '/tasks/new' },
  { to: '/board', label: 'Board', icon: SquareKanbanIcon, match: path => path === '/board' },
  { to: '/profile', label: 'Profile', icon: UserRoundIcon, match: path => path === '/profile' },
]

const leftTabs = tabs.slice(0, 2)
const rightTabs = tabs.slice(2)
const createActive = computed(() => route.path === '/tasks/new')
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur"
    style="padding-bottom: env(safe-area-inset-bottom)"
    aria-label="Main"
  >
    <div class="mx-auto flex max-w-lg items-stretch justify-around">
      <NuxtLink
        v-for="tab in leftTabs"
        :key="tab.to"
        :to="tab.to"
        class="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="tab.match(route.path) ? 'text-primary' : 'text-muted-foreground active:text-foreground'"
        :aria-current="tab.match(route.path) ? 'page' : undefined"
      >
        <component :is="tab.icon" class="h-5 w-5" />
        <span>{{ tab.label }}</span>
      </NuxtLink>

      <NuxtLink
        v-if="canCreateTask"
        to="/tasks/new"
        class="flex shrink-0 flex-col items-center justify-center rounded-full px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="New task"
      >
        <span
          class="-mt-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-background shadow-lg transition-colors"
          :class="createActive ? 'bg-primary-hover text-primary-foreground' : 'bg-primary text-primary-foreground active:bg-primary-active'"
        >
          <PlusIcon class="h-6 w-6" />
        </span>
      </NuxtLink>

      <NuxtLink
        v-for="tab in rightTabs"
        :key="tab.to"
        :to="tab.to"
        class="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="tab.match(route.path) ? 'text-primary' : 'text-muted-foreground active:text-foreground'"
        :aria-current="tab.match(route.path) ? 'page' : undefined"
      >
        <component :is="tab.icon" class="h-5 w-5" />
        <span>{{ tab.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
