// Reka UI reserves the empty string as a Select's "no selection" signal — it is
// what clears the value and shows the placeholder — so a <SelectItem> may never
// carry `value=""`. Options that genuinely mean "none" or "any" (no department,
// no group) therefore need a stand-in value on the wire between the Select and
// our own state, where '' stays the natural representation.

/** Placeholder value for the "none"/"any" option in a Select. */
export const SELECT_EMPTY = '__empty'

/** Our '' → the value the Select can hold. */
export function toSelectValue(value: string | null | undefined) {
  return value || SELECT_EMPTY
}

/** The Select's value → our ''. */
export function fromSelectValue(value: unknown) {
  const text = String(value ?? '')
  return text === SELECT_EMPTY ? '' : text
}
