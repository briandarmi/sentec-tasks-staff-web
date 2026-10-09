<script setup lang="ts">
import { ClipboardListIcon, FolderKanbanIcon, LayoutListIcon } from '@lucide/vue'

const route = useRoute()

interface Tab { to: string, label: string, icon: unknown, match: (path: string) => boolean }

/**
 * Three tabs, evenly spread. Every target is at least 44px tall — this is
 * used one-handed, walking a corridor, so the hit areas matter more than the
 * density. Profile is not a tab (a settings screen, reached from the top bar)
 * and the Board is no longer one either: since 2026-10-09 its columns are the
 * status strip of the Tasks page. The create action left the bar the same day
 * for a floating button (`CreateTaskFab`): the bar is for places, not verbs.
 *
 * The active tab wears a tinted pill behind its icon, not just a colour
 * change: a shape reads at a glance where a hue alone does not.
 */
const tabs: Tab[] = [
  { to: '/', label: 'My work', icon: ClipboardListIcon, match: path => path === '/' },
  { to: '/tasks', label: 'Tasks', icon: LayoutListIcon, match: path => (path.startsWith('/tasks') || path === '/board') && path !== '/tasks/new' },
  { to: '/projects', label: 'Projects', icon: FolderKanbanIcon, match: path => path.startsWith('/projects') },
]
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur"
    style="padding-bottom: env(safe-area-inset-bottom)"
    aria-label="Main"
  >
    <div class="mx-auto flex max-w-lg items-stretch justify-around">
      <NuxtLink
        v-for="tab in tabs"
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
