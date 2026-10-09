<script setup lang="ts">
import { computed } from 'vue'
import { PlusIcon } from '@lucide/vue'
import { useCaps } from '~/composables/useCaps'

/**
 * The one global action — raise a task — as a floating button above the
 * bottom bar, bottom-right where the thumb rests (2026-10-09). It used to be
 * a slot in the bar itself; the bar is for places and this is a verb, and a
 * fourth item there pushed three tabs off centre. It follows the layout's
 * column on wide screens rather than the viewport edge, so on a laptop it
 * stays beside the content it acts on (`100%` of the fixed containing
 * block, not `100vw`, so a classic scrollbar does not push it off by half
 * its width).
 *
 * Gone on the new-task page, where it would only point at the screen already
 * open, and for anyone without the create-task permission at this property.
 */
const route = useRoute()
const { canCreateTask } = useCaps()
const visible = computed(() => canCreateTask.value && route.path !== '/tasks/new')
</script>

<template>
  <NuxtLink
    v-if="visible"
    to="/tasks/new"
    class="fixed right-[max(1rem,calc((100%-32rem)/2+1rem))] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary-hover active:bg-primary-active focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
    style="bottom: calc(3.5rem + env(safe-area-inset-bottom) + 1rem)"
    aria-label="New task"
    title="New task"
  >
    <PlusIcon class="size-7" aria-hidden="true" />
  </NuxtLink>
</template>
