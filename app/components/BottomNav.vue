<script setup lang="ts">
import { computed } from 'vue'
import { ClipboardListIcon, FolderKanbanIcon, LayoutListIcon, PlusIcon, SquareKanbanIcon } from '@lucide/vue'
import { useCaps } from '~/composables/useCaps'

const route = useRoute()
const { canCreateTask } = useCaps()

interface Tab { to: string, label: string, icon: unknown, match: (path: string) => boolean }

/**
 * Four tabs plus the create action. Every target is at least 44px tall — this
 * is used one-handed, walking a corridor, so the hit areas matter more than the
 * density. The action sits dead centre between the two pairs, where either
 * thumb reaches it. Profile is not a tab: it is a settings screen, not a work
 * surface, and lives as an icon button in the top bar beside the theme toggle.
 *
 * The active tab wears a tinted pill behind its icon, not just a colour
 * change: a shape reads at a glance where a hue alone does not.
 */
const tabs: Tab[] = [
  { to: '/', label: 'My work', icon: ClipboardListIcon, match: path => path === '/' },
  { to: '/tasks', label: 'Tasks', icon: LayoutListIcon, match: path => path.startsWith('/tasks') && path !== '/tasks/new' },
  { to: '/board', label: 'Board', icon: SquareKanbanIcon, match: path => path === '/board' },
  { to: '/projects', label: 'Projects', icon: FolderKanbanIcon, match: path => path.startsWith('/projects') },
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
        class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
        :class="tab.match(route.path) ? 'text-primary-tint-foreground' : 'text-muted-foreground active:text-foreground'"
        :aria-current="tab.match(route.path) ? 'page' : undefined"
      >
        <span
          class="flex h-8 w-14 items-center justify-center rounded-full transition-colors"
          :class="tab.match(route.path) ? 'bg-primary-tint' : ''"
        >
          <component :is="tab.icon" class="size-6" aria-hidden="true" />
        </span>
        <span>{{ tab.label }}</span>
      </NuxtLink>

      <NuxtLink
        v-if="canCreateTask"
        to="/tasks/new"
        class="flex shrink-0 flex-col items-center justify-center rounded-full px-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
        aria-label="New task"
        title="New task"
      >
        <span
          class="-mt-6 flex size-14 items-center justify-center rounded-full border-4 border-background shadow-lg transition-colors"
          :class="createActive ? 'bg-primary-hover text-primary-foreground' : 'bg-primary text-primary-foreground active:bg-primary-active'"
        >
          <PlusIcon class="size-7" aria-hidden="true" />
        </span>
      </NuxtLink>

      <NuxtLink
        v-for="tab in rightTabs"
        :key="tab.to"
        :to="tab.to"
        class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
        :class="tab.match(route.path) ? 'text-primary-tint-foreground' : 'text-muted-foreground active:text-foreground'"
        :aria-current="tab.match(route.path) ? 'page' : undefined"
      >
        <span
          class="flex h-8 w-14 items-center justify-center rounded-full transition-colors"
          :class="tab.match(route.path) ? 'bg-primary-tint' : ''"
        >
          <component :is="tab.icon" class="size-6" aria-hidden="true" />
        </span>
        <span>{{ tab.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
