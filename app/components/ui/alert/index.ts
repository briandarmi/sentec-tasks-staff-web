import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Alert } from "./Alert.vue"
export { default as AlertDescription } from "./AlertDescription.vue"
export { default as AlertTitle } from "./AlertTitle.vue"

/**
 * Sentinel Tech Design System alert.
 *
 * Every variant is tonal: a tinted fill, a border in the same hue and text in
 * the tone's darkened foreground. This is the same tone language as Badge and
 * the toast stripe, so a danger alert, a danger badge and a danger toast all
 * read as one family.
 *
 * It replaces a set that was only half tonal — `default` was a plain card and
 * `destructive` was red text on a plain card, so an error banner carried no
 * fill at all and sat at the same visual weight as the surface behind it.
 *
 * Fills and foregrounds come from the shared `--*-tint` / `--*-tint-foreground`
 * pairs (4.8-6.9:1; see the note on those tokens in
 * `app/assets/css/tailwind.css`). Borders use the base status hue at low alpha,
 * which is the one part of the old `success` variant worth keeping. Tone is
 * never carried by colour alone — these alerts take an icon and a title.
 *
 * `default` is the design system's `info` tone. It resolves to the same blue as
 * `--primary` because that is how the system draws info — its semantic-colours
 * card shows info as the primary tint under blue-700, with no hue of its own —
 * but it is written as `--info-*` so the role is explicit and can diverge later.
 *
 * `neutral` is the old quiet default, kept for advisory notes that should not
 * claim attention. `warning` completes the set the toast already had.
 */
export const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default:
          "bg-info-tint text-info-tint-foreground border-info/25",
        destructive:
          "bg-danger-tint text-danger-tint-foreground border-destructive/25",
        success:
          "bg-success-tint text-success-tint-foreground border-success/30",
        warning:
          "bg-warning-tint text-warning-tint-foreground border-warning/30",
        neutral:
          "bg-neutral-tint text-foreground border-border *:data-[slot=alert-description]:text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
