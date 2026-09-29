import { describe, expect, it } from 'vitest'
import {
  draftToRecurrence,
  emptyRecurrenceDraft,
  formatLocalDate,
  hhmmToMinutes,
  minutesToHHMM,
  ordinal,
  recurrenceSummary,
  recurrenceToDraft,
  recurrenceWindowLabel,
  weekdaysLabel,
} from '~/utils/recurrence'

// Staff-only helpers behind the "Repeat" editor and the /recurring cards.
// Pinned so the wire shape (timeMinutes, weekdays 0 = Sunday, dayOfMonth
// 1–28, hotel-local dates) cannot drift under a copy change.

describe('time of day', () => {
  it('renders minutes after midnight as HH:MM', () => {
    expect(minutesToHHMM(0)).toBe('00:00')
    expect(minutesToHHMM(7 * 60)).toBe('07:00')
    expect(minutesToHHMM(21 * 60 + 5)).toBe('21:05')
    expect(minutesToHHMM(1439)).toBe('23:59')
  })

  it('clamps out-of-range wire values instead of throwing', () => {
    expect(minutesToHHMM(-5)).toBe('00:00')
    expect(minutesToHHMM(5000)).toBe('23:59')
    expect(minutesToHHMM(Number.NaN)).toBe('00:00')
  })

  it('parses what <input type="time"> yields, seconds included', () => {
    expect(hhmmToMinutes('07:00')).toBe(420)
    expect(hhmmToMinutes('7:30')).toBe(450)
    expect(hhmmToMinutes('23:59:00')).toBe(1439)
  })

  it('refuses non-times', () => {
    expect(hhmmToMinutes('')).toBeNull()
    expect(hhmmToMinutes(null)).toBeNull()
    expect(hhmmToMinutes('24:00')).toBeNull()
    expect(hhmmToMinutes('12:60')).toBeNull()
    expect(hhmmToMinutes('noon')).toBeNull()
  })

  it('round-trips every minute of the day', () => {
    for (const minutes of [0, 1, 59, 60, 719, 720, 1438, 1439]) expect(hhmmToMinutes(minutesToHHMM(minutes))).toBe(minutes)
  })
})

describe('weekday labels', () => {
  it('names the working week and the weekend', () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(weekdaysLabel([0, 6])).toBe('Weekends')
    expect(weekdaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
  })

  it('collapses runs of three or more and lists the rest', () => {
    expect(weekdaysLabel([1])).toBe('Mon')
    expect(weekdaysLabel([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(weekdaysLabel([1, 2, 3])).toBe('Mon–Wed')
    expect(weekdaysLabel([1, 2])).toBe('Mon, Tue')
    expect(weekdaysLabel([2, 3, 4, 6])).toBe('Tue–Thu, Sat')
  })

  it('reads a wrap around Sunday in picker order, not numeric order', () => {
    // 0 = Sunday sits at the END of the picker, so Fri–Sun is one run.
    expect(weekdaysLabel([5, 6, 0])).toBe('Fri–Sun')
  })

  it('is empty for nothing and ignores junk', () => {
    expect(weekdaysLabel(null)).toBe('')
    expect(weekdaysLabel([])).toBe('')
    expect(weekdaysLabel([9, -1, 1])).toBe('Mon')
  })
})

describe('summary lines', () => {
  it('reads the way the seed templates are described', () => {
    expect(recurrenceSummary({ kind: 'DAILY', timeMinutes: 21 * 60, weekdays: null, dayOfMonth: null })).toBe('Daily · 21:00')
    expect(recurrenceSummary({ kind: 'WEEKLY', timeMinutes: 7 * 60, weekdays: [1, 2, 3, 4, 5], dayOfMonth: null })).toBe('Weekly · Mon–Fri · 07:00')
    expect(recurrenceSummary({ kind: 'WEEKLY', timeMinutes: 8 * 60 + 30, weekdays: [1], dayOfMonth: null })).toBe('Weekly · Mon · 08:30')
    expect(recurrenceSummary({ kind: 'MONTHLY', timeMinutes: 9 * 60, weekdays: null, dayOfMonth: 1 })).toBe('Monthly · 1st · 09:00')
    expect(recurrenceSummary({ kind: 'MONTHLY', timeMinutes: 9 * 60, weekdays: null, dayOfMonth: 22 })).toBe('Monthly · 22nd · 09:00')
  })

  it('says so when there is no schedule (a shared template without one)', () => {
    expect(recurrenceSummary(null)).toBe('No schedule')
  })

  it('gets English ordinals right, teens included', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '28th'])
  })

  it('formats a hotel-local date without going through Date', () => {
    expect(formatLocalDate('2026-08-20')).toBe('20 Aug 2026')
    expect(formatLocalDate('2026-01-01')).toBe('1 Jan 2026')
    expect(formatLocalDate('not-a-date')).toBe('not-a-date')
  })

  it('words the window by which ends are set', () => {
    expect(recurrenceWindowLabel({ startsOn: '2026-08-20', endsOn: null })).toBe('From 20 Aug 2026')
    expect(recurrenceWindowLabel({ startsOn: null, endsOn: '2026-09-30' })).toBe('Until 30 Sep 2026')
    expect(recurrenceWindowLabel({ startsOn: '2026-08-20', endsOn: '2026-09-30' })).toBe('20 Aug 2026 – 30 Sep 2026')
    expect(recurrenceWindowLabel({ startsOn: null, endsOn: null })).toBe('')
    expect(recurrenceWindowLabel(null)).toBe('')
  })
})

describe('editor draft ↔ wire', () => {
  it('starts on a sensible default', () => {
    const draft = emptyRecurrenceDraft()
    expect(draft.kind).toBe('DAILY')
    expect(hhmmToMinutes(draft.time)).not.toBeNull()
    expect(draft.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(draft.dayOfMonth).toBe(1)
  })

  it('round-trips a weekly schedule', () => {
    const wire = { kind: 'WEEKLY' as const, timeMinutes: 7 * 60, weekdays: [5, 1, 3], dayOfMonth: null, startsOn: '2026-08-20', endsOn: null }
    const draft = recurrenceToDraft(wire)
    expect(draft).toEqual({ kind: 'WEEKLY', time: '07:00', weekdays: [1, 3, 5], dayOfMonth: 1, startsOn: '2026-08-20', endsOn: '' })
    const back = draftToRecurrence(draft)
    expect(back).toEqual({ ok: true, recurrence: { kind: 'WEEKLY', timeMinutes: 420, weekdays: [1, 3, 5], dayOfMonth: null, startsOn: '2026-08-20', endsOn: null } })
  })

  it('sends null for the fields the kind does not use', () => {
    const daily = draftToRecurrence({ ...emptyRecurrenceDraft(), kind: 'DAILY', weekdays: [1], dayOfMonth: 5 })
    expect(daily.ok && daily.recurrence.weekdays).toBeNull()
    expect(daily.ok && daily.recurrence.dayOfMonth).toBeNull()
    const monthly = draftToRecurrence({ ...emptyRecurrenceDraft(), kind: 'MONTHLY', dayOfMonth: 28 })
    expect(monthly.ok && monthly.recurrence.weekdays).toBeNull()
    expect(monthly.ok && monthly.recurrence.dayOfMonth).toBe(28)
  })

  it('applies the API\'s rules before any request is made', () => {
    expect(draftToRecurrence({ ...emptyRecurrenceDraft(), time: '' })).toEqual({ ok: false, error: 'Pick a time of day.' })
    expect(draftToRecurrence({ ...emptyRecurrenceDraft(), kind: 'WEEKLY', weekdays: [] })).toEqual({ ok: false, error: 'Pick at least one weekday.' })
    expect(draftToRecurrence({ ...emptyRecurrenceDraft(), kind: 'MONTHLY', dayOfMonth: 29 })).toEqual({ ok: false, error: 'Day of month must be between 1 and 28.' })
    expect(draftToRecurrence({ ...emptyRecurrenceDraft(), kind: 'MONTHLY', dayOfMonth: 0 })).toEqual({ ok: false, error: 'Day of month must be between 1 and 28.' })
    expect(draftToRecurrence({ ...emptyRecurrenceDraft(), startsOn: '2026-09-30', endsOn: '2026-09-01' })).toEqual({ ok: false, error: 'The end date is before the start date.' })
    expect(draftToRecurrence({ ...emptyRecurrenceDraft(), startsOn: '30/09/2026' })).toEqual({ ok: false, error: 'The start date is not a date.' })
  })

  it('dedupes and sorts weekdays and drops junk', () => {
    const result = draftToRecurrence({ ...emptyRecurrenceDraft(), kind: 'WEEKLY', weekdays: [5, 5, 1, 9, -2] })
    expect(result.ok && result.recurrence.weekdays).toEqual([1, 5])
  })

  it('treats blank dates as no window', () => {
    const result = draftToRecurrence({ ...emptyRecurrenceDraft(), startsOn: '  ', endsOn: '' })
    expect(result.ok && result.recurrence.startsOn).toBeNull()
    expect(result.ok && result.recurrence.endsOn).toBeNull()
  })
})
