<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

/**
 * The description inherits the alert's tone rather than forcing
 * `text-muted-foreground`, which would fight the tonal fill and leave a grey
 * paragraph inside a coloured panel. Hierarchy against AlertTitle comes from
 * weight, not colour. The `neutral` variant restores the muted treatment.
 */
const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="alert-description"
    :class="cn('col-start-2 text-sm [&_p]:leading-relaxed', props.class)"
  >
    <slot />
  </div>
</template>
