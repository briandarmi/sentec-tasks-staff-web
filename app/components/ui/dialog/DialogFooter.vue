<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { DialogClose } from "reka-ui"
import { cn } from "@/lib/utils"
import { Button } from '@/components/ui/button'

/**
 * Sentinel Tech Design System dialog footer — the closing counterpart to
 * DialogHeader's rule. Same full-bleed technique, same `divided` escape hatch.
 */
const props = withDefaults(defineProps<{
  class?: HTMLAttributes["class"]
  showCloseButton?: boolean
  divided?: boolean
}>(), {
  showCloseButton: false,
  divided: true,
})
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn(
      'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
      props.divided && 'border-border -mx-6 -mb-6 border-t px-6 py-4',
      props.class,
    )"
  >
    <slot />
    <DialogClose v-if="props.showCloseButton" as-child>
      <Button variant="outline">
        Close
      </Button>
    </DialogClose>
  </div>
</template>
