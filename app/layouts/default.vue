<script setup lang="ts">
import { computed } from 'vue'
import { useSession } from '~/composables/useSession'

/**
 * Staff workspace shell: mobile-first, single column, bottom navigation.
 *
 * Sized for a phone held in one hand while walking. The desktop case is handled
 * by capping the column width rather than growing into a second pane, so the
 * layout that gets tested on a phone is the same one seen on a laptop.
 */
const route = useRoute()
const session = useSession()

/** Re-key on property change so hotel-scoped data refetches on switch. */
const pageKey = computed(() => `${route.fullPath}:${session.hotelId.value ?? 'none'}`)
const title = computed(() => (route.meta.title as string | undefined) ?? 'Sentec Tasks')
</script>

<template>
  <div class="flex min-h-svh flex-col bg-muted/20">
    <AppTopBar :title="title" />

    <!-- pb-36: room for the bottom bar (56px) plus the floating New-task
         button above it (16px gap, 56px tall, 16px clearance), so the last
         card and the Load-more button scroll clear of both. -->
    <main class="mx-auto w-full max-w-lg flex-1 px-4 pb-36 pt-4">
      <NuxtPage :key="pageKey" />
    </main>

    <BottomNav />
    <CreateTaskFab />
  </div>
</template>
