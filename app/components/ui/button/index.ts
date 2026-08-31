import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

/**
 * Sentinel Tech Design System button.
 *
 * Ported from the design system's React kit (`components/forms/Button.jsx`):
 * its 10px radius, semibold Quicksand, 8px icon gap, 120ms eased transition and
 * scale(0.97) press. Its size scale is carried over verbatim — sm 6/14px at
 * 14px type, md 10/18px at 16px type, lg 13/24px at 18px type — which makes the
 * default button taller than the shadcn 36px default it replaces. Call sites
 * that need the old density should ask for `size="sm"`.
 *
 * `default` carries white on Sentinel Blue, matching the kit — a brand decision
 * taken on 2026-08-27 in full knowledge that the resting pair is 2.69:1, below
 * AA. See the note on --primary-foreground in `app/assets/css/tailwind.css`.
 * Hover and press therefore darken (blue-600, then blue-700), which is both the
 * kit's behaviour and the direction that lifts white text: 4.08:1 and 6.78:1.
 *
 * Every filled variant carries a white label and darkens on hover, darkening
 * further on press — the kit's rule, with `destructive` using its exact
 * #c53434 / #b82f2f and `warning` tuned to primary's own contrast steps so the
 * two feel identical under the pointer. Contrast against the label therefore
 * improves as the pointer arrives.
 *
 * shadcn's stock opacity-blend hover (a /90 modifier) blended toward the page
 * instead, which on a light ground made the button paler as the pointer
 * approached and cost contrast against the white label.
 *
 * The transition names `scale`, NOT `transform`: Tailwind 4 compiles
 * `scale-[0.97]` to the standalone `scale` property, so transitioning
 * `transform` would animate nothing and the press would snap.
 *
 * One departure remains: `tertiary` is the kit's `ghost` — a blue text-only
 * action — but at blue-700 rather than Sentinel Blue, which is 2.69:1 as text
 * on white and has no fill to darken on hover. shadcn's own `ghost` is a
 * different role (a neutral subtle button, used here for icon buttons) and
 * keeps its neutral treatment.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold outline-none transition-[background-color,border-color,color,box-shadow,scale] duration-[120ms] ease-ds active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-primary-tint focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-danger-tint",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        destructive:
          "bg-destructive text-white hover:bg-destructive-hover active:bg-destructive-active focus-visible:ring-danger-tint",
        outline:
          "border border-[var(--st-grey-300)] bg-background text-foreground shadow-ds-sm hover:bg-muted active:bg-accent dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover active:bg-secondary-active",
        success:
          "bg-success text-success-foreground hover:bg-success-hover active:bg-success-active",
        warning:
          "bg-warning text-warning-foreground hover:bg-warning-hover active:bg-warning-active focus-visible:ring-warning-tint",
        tertiary:
          "bg-transparent text-primary-tint-foreground hover:bg-primary-tint active:bg-primary-tint",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary-tint-foreground underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        "default": "px-[18px] py-2.5 text-base has-[>svg]:px-4",
        "sm": "px-3.5 py-1.5 text-sm has-[>svg]:px-3",
        "lg": "px-6 py-[13px] text-lg has-[>svg]:px-5",
        "icon": "size-11 p-0",
        "icon-sm": "size-9 p-0",
        "icon-lg": "size-12 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
