<script setup lang="ts">
import type { TabsTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsTrigger, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

/**
 * Sentinel Tech Design System tab trigger — see TabsList for the shape.
 *
 * The kit marks the active tab with Sentinel Blue text over a 2px Sentinel Blue
 * underline. The underline is kept at brand blue, but the label uses blue-700:
 * Sentinel Blue as text on white is 2.69:1, well under AA. That also means the
 * active state is never carried by the 2px rule alone — the label changes
 * colour and the inactive labels are muted, so the state survives for anyone
 * who cannot resolve a thin brand-blue line against white.
 */
const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <TabsTrigger
    data-slot="tabs-trigger"
    :class="cn(
      'text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary-tint-foreground focus-visible:ring-primary-tint focus-visible:outline-ring -mb-px inline-flex items-center justify-center gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-[color,border-color] duration-[120ms] ease-ds hover:text-foreground focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-transparent data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
      props.class,
    )"
    v-bind="forwardedProps"
  >
    <slot />
  </TabsTrigger>
</template>
