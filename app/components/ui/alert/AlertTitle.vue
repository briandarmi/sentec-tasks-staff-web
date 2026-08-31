<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

/**
 * Alert titles are bold, matching DialogTitle — the standard for a title that
 * heads a surface. shadcn ships `font-medium` here, which left the alert title
 * lighter than the dialog title beside it and barely separated from its own
 * description, since the description inherits the alert's tone colour rather
 * than being greyed down.
 */
const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="alert-title"
    :class="cn('col-start-2 line-clamp-1 min-h-4 font-bold tracking-tight', props.class)"
  >
    <slot />
  </div>
</template>
