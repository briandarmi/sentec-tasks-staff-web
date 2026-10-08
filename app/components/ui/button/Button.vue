<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "."
import { Primitive } from "reka-ui"
import { cn } from "@/lib/utils"
import { buttonVariants } from "."

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  /** Colour carried by an unfilled variant (secondary, tertiary, ghost). */
  tone?: ButtonVariants["tone"]
  class?: HTMLAttributes["class"]
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
})
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :data-tone="tone"
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size, tone }), props.class)"
  >
    <slot />
  </Primitive>
</template>
