import type { RecurrenceKind, TaskTemplateRecurrence } from '~/utils/clientFakeApi'

// Pure helpers for the recurring-task editor and the "Repeats" screen. The
// wire shape is TaskTemplateRecurrence (feat/projects): `timeMinutes` after
// hotel-local midnight, `weekdays` with 0 = Sunday for WEEKLY, `dayOfMonth`
// 1–28 for MONTHLY, and hotel-local `startsOn` / `endsOn` dates. Nothing here
// touches the device clock: every value is what the hotel's calendar says.

export const RECURRENCE_KINDS: RecurrenceKind[] = ['DAILY', 'WEEKLY', 'MONTHLY']

export const RECURRENCE_KIND_LABEL: Record<RecurrenceKind, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
}

/** Index = the API's weekday number (0 = Sunday). */
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Picker order: the working week first, the way a roster reads. */
export const WEEKDAY_PICKER_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/** 0–1439 → "HH:MM". Out-of-range input is clamped rather than thrown: it only ever comes from the wire. */
export function minutesToHHMM(minutes: number): string {
  const clamped = Math.min(1439, Math.max(0, Math.trunc(Number.isFinite(minutes) ? minutes : 0)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "HH:MM" (what <input type="time"> yields) → 0–1439, or null when it is not a time. */
export function hhmmToMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((value ?? '').trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/**
 * The weekday set as people say it: consecutive runs collapse to a range
 * ("Mon–Fri"), the rest are listed ("Mon, Wed, Fri"), and the two common
 * whole sets get their names. Order is the picker's, so a set that wraps
 * around Sunday still reads left to right.
 */
export function weekdaysLabel(weekdays: number[] | null | undefined): string {
  const set = new Set((weekdays ?? []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))
  if (set.size === 0) return ''
  if (set.size === 7) return 'Every day'
  const ordered = WEEKDAY_PICKER_ORDER.filter(d => set.has(d))
  if (ordered.length === 5 && ordered.every(d => d >= 1 && d <= 5)) return 'Mon–Fri'
  if (ordered.length === 2 && set.has(6) && set.has(0)) return 'Weekends'
  const runs: number[][] = []
  for (const day of ordered) {
    const last = runs[runs.length - 1]
    const previous = last?.[last.length - 1]
    if (last && previous !== undefined && WEEKDAY_PICKER_ORDER.indexOf(day as typeof WEEKDAY_PICKER_ORDER[number]) === WEEKDAY_PICKER_ORDER.indexOf(previous as typeof WEEKDAY_PICKER_ORDER[number]) + 1) last.push(day)
    else runs.push([day])
  }
  return runs
    .map(run => (run.length >= 3 ? `${WEEKDAY_SHORT[run[0]!]}–${WEEKDAY_SHORT[run[run.length - 1]!]}` : run.map(d => WEEKDAY_SHORT[d]).join(', ')))
    .join(', ')
}

/** "3rd", "21st", "12th" — for the monthly line. */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/**
 * One line for a card: "Weekly · Mon–Fri · 07:00", "Daily · 21:00",
 * "Monthly · 1st · 08:30". The window (startsOn/endsOn) is left to a second
 * line by the caller — it is the exception, not the rule.
 */
export function recurrenceSummary(recurrence: Pick<TaskTemplateRecurrence, 'kind' | 'timeMinutes' | 'weekdays' | 'dayOfMonth'> | null | undefined): string {
  if (!recurrence) return 'No schedule'
  const time = minutesToHHMM(recurrence.timeMinutes)
  switch (recurrence.kind) {
    case 'WEEKLY': {
      const days = weekdaysLabel(recurrence.weekdays)
      return days ? `Weekly · ${days} · ${time}` : `Weekly · ${time}`
    }
    case 'MONTHLY':
      return recurrence.dayOfMonth ? `Monthly · ${ordinal(recurrence.dayOfMonth)} · ${time}` : `Monthly · ${time}`
    default:
      return `Daily · ${time}`
  }
}

/** "From 20 Aug 2026", "Until 30 Sep 2026", "20 Aug 2026 – 30 Sep 2026", or '' with no window. */
export function recurrenceWindowLabel(recurrence: Pick<TaskTemplateRecurrence, 'startsOn' | 'endsOn'> | null | undefined): string {
  const from = recurrence?.startsOn ? formatLocalDate(recurrence.startsOn) : ''
  const until = recurrence?.endsOn ? formatLocalDate(recurrence.endsOn) : ''
  if (from && until) return `${from} – ${until}`
  if (from) return `From ${from}`
  if (until) return `Until ${until}`
  return ''
}

/**
 * A hotel-local YYYY-MM-DD as "20 Aug 2026". Deliberately NOT through Date:
 * a calendar date has no instant, and parsing it would shift it a day in
 * zones west of UTC.
 */
export function formatLocalDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return ymd
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month} ${match[1]}` : ymd
}

// ── Editor draft ─────────────────────────────────────────────────────────────

/** What the editor binds to: strings the inputs can hold, converted at the edge. */
export interface RecurrenceDraft {
  kind: RecurrenceKind
  /** "HH:MM" as <input type="time"> yields it. */
  time: string
  weekdays: number[]
  dayOfMonth: number
  startsOn: string
  endsOn: string
}

export function emptyRecurrenceDraft(): RecurrenceDraft {
  return { kind: 'DAILY', time: '08:00', weekdays: [1, 2, 3, 4, 5], dayOfMonth: 1, startsOn: '', endsOn: '' }
}

export function recurrenceToDraft(recurrence: TaskTemplateRecurrence | null | undefined): RecurrenceDraft {
  const draft = emptyRecurrenceDraft()
  if (!recurrence) return draft
  return {
    kind: recurrence.kind,
    time: minutesToHHMM(recurrence.timeMinutes),
    weekdays: recurrence.weekdays?.length ? [...recurrence.weekdays].sort((a, b) => a - b) : draft.weekdays,
    dayOfMonth: recurrence.dayOfMonth ?? draft.dayOfMonth,
    startsOn: recurrence.startsOn ?? '',
    endsOn: recurrence.endsOn ?? '',
  }
}

export type RecurrenceDraftResult = { ok: true, recurrence: TaskTemplateRecurrence } | { ok: false, error: string }

/**
 * Draft → wire, with the API's own rules applied first so a bad form never
 * makes a request: time 0–1439, weekdays required for WEEKLY, dayOfMonth
 * 1–28 for MONTHLY, endsOn not before startsOn. Fields the kind does not use
 * are sent as null, which is what the API stores for them.
 */
export function draftToRecurrence(draft: RecurrenceDraft): RecurrenceDraftResult {
  const timeMinutes = hhmmToMinutes(draft.time)
  if (timeMinutes === null) return { ok: false, error: 'Pick a time of day.' }
  const weekdays = [...new Set(draft.weekdays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
  if (draft.kind === 'WEEKLY' && weekdays.length === 0) return { ok: false, error: 'Pick at least one weekday.' }
  const dayOfMonth = Math.trunc(Number(draft.dayOfMonth))
  if (draft.kind === 'MONTHLY' && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28)) return { ok: false, error: 'Day of month must be between 1 and 28.' }
  const startsOn = draft.startsOn.trim() || null
  const endsOn = draft.endsOn.trim() || null
  if (startsOn && !isYmd(startsOn)) return { ok: false, error: 'The start date is not a date.' }
  if (endsOn && !isYmd(endsOn)) return { ok: false, error: 'The end date is not a date.' }
  if (startsOn && endsOn && endsOn < startsOn) return { ok: false, error: 'The end date is before the start date.' }
  return {
    ok: true,
    recurrence: {
      kind: draft.kind,
      timeMinutes,
      weekdays: draft.kind === 'WEEKLY' ? weekdays : null,
      dayOfMonth: draft.kind === 'MONTHLY' ? dayOfMonth : null,
      startsOn,
      endsOn,
    },
  }
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}
