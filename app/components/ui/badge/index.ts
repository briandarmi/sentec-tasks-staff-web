import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

/**
 * Sentinel Tech Design System badge.
 *
 * Ported from the design system's React kit (`components/feedback/Badge.jsx`):
 * a pill of tinted fill with tone-matched text, 3/10px padding, 12px semibold
 * with 0.02em tracking. This replaces shadcn's solid fills — the kit's tone
 * pairs ARE the badge's design language, not a colour swap on top of it.
 *
 * Variant names keep their shadcn meaning so existing call sites read the same;
 * only the visual language changes. `warning` is new (the kit has the tone, the
 * shadcn set had no variant for it). `outline` has no kit equivalent and stays
 * as the bordered form — for a removable chip, use Tag instead.
 *
 * Each tone's foreground is the darkened `--st-*-700` hue rather than the kit's
 * base status colour: at 12px the kit's own pairs land at 2.4-3.8:1, below AA.
 * See the note on those tokens in `app/assets/css/tailwind.css`.
 */
export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-transparent px-2.5 py-[3px] text-xs font-semibold tracking-[0.02em] transition-[color,background-color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3 focus-visible:border-ring focus-visible:ring-primary-tint focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-danger-tint",
  {
    variants: {
      variant: {
        default:
          "bg-primary-tint text-primary-tint-foreground [a&]:hover:bg-primary-tint/70",
        secondary:
          "bg-neutral-tint text-neutral-tint-foreground [a&]:hover:bg-neutral-tint/70",
        destructive:
          "bg-danger-tint text-danger-tint-foreground [a&]:hover:bg-danger-tint/70 focus-visible:ring-danger-tint",
        success:
          "bg-success-tint text-success-tint-foreground [a&]:hover:bg-success-tint/70",
        warning:
          "bg-warning-tint text-warning-tint-foreground [a&]:hover:bg-warning-tint/70",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
