<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

/**
 * Sentinel Tech Design System text input.
 *
 * Ported from the design system's React kit (`components/forms/Input.jsx`):
 * 10/12px padding, a 10px radius, 16px type at every breakpoint, and the kit's
 * focus treatment — the border goes to Sentinel Blue under a solid 3px tint
 * halo, with the error state swapping both for their danger equivalents. The
 * kit carries no shadow on the field, so shadcn's `shadow-xs` is dropped.
 *
 * The kit renders its own label and help text; here those stay the caller's job
 * (this project pairs inputs with `Label`/`FormField`), so only the field
 * itself is ported.
 */
const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes["class"]
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="cn(
      'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-lg border bg-transparent px-3 py-2.5 text-base outline-none transition-[color,border-color,box-shadow] duration-[120ms] ease-ds file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50',
      'focus-visible:border-ring focus-visible:ring-primary-tint focus-visible:ring-[3px]',
      'aria-invalid:border-destructive aria-invalid:ring-danger-tint aria-invalid:ring-[3px]',
      props.class,
    )"
  >
</template>
