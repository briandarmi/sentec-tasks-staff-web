<script setup lang="ts">
import type { TabsListProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsList } from "reka-ui"
import { cn } from "@/lib/utils"

/**
 * Sentinel Tech Design System tab list.
 *
 * Ported from the design system's React kit (`components/navigation/Tabs.jsx`),
 * which is an underlined rail — a hairline rule the full width of the strip,
 * with the active trigger sitting on it — not shadcn's segmented pill. The two
 * are different components wearing the same name, so this replaces the pill
 * outright. Nothing in these consoles used Tabs yet, so nothing regresses.
 */
const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="cn(
      'border-border inline-flex h-auto w-full items-center justify-start gap-1 border-b bg-transparent p-0',
      props.class,
    )"
  >
    <slot />
  </TabsList>
</template>
