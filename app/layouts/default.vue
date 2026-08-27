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

/** Re-key on property change so property-scoped data refetches on switch. */
const pageKey = computed(() => `${route.fullPath}:${session.tenantId.value ?? 'none'}`)
const title = computed(() => (route.meta.title as string | undefined) ?? 'Sentec Tasks')
</script>

<template>
  <div class="flex min-h-svh flex-col bg-muted/20">
    <AppTopBar :title="title" />

    <main class="mx-auto w-full max-w-lg flex-1 px-4 pb-24 pt-4">
      <NuxtPage :key="pageKey" />
    </main>

    <BottomNav />
  </div>
</template>
