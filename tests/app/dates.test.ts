import { describe, expect, it } from 'vitest';
import {
  addDaysIso, formatDateEl, formatDayEl, formatDayMonth, formatDayMonthLongEl, formatStampEl, formatTimeEl, formatWeekRangeEl, formatWeekdayEl,
  isIsoDate, todayIso, weekStartIso,
} from '../../src/app/dates';

describe('dates', () => {
  it('todayIso uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 8, 28, 23, 59))).toBe('2026-09-28');
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  it('isIsoDate accepts real dates only', () => {
    expect(isIsoDate('2026-09-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('28/09/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('formats Greek day labels and full dates', () => {
    expect(formatDayEl('2026-09-28')).toBe('Δευ 28/09');
    expect(formatDayEl('2026-09-27')).toBe('Κυρ 27/09');
    expect(formatDateEl('2026-09-28')).toBe('28/09/2026');
    expect(formatDayEl('nonsense')).toBe('nonsense');
    expect(formatDayMonth('2026-11-07')).toBe('07/11');
    expect(formatDayMonth('nonsense')).toBe('nonsense');
  });

  it('formats a timestamp as shop time HH:MM (Europe/Athens)', () => {
    expect(formatTimeEl('2026-11-07T19:42:00.000Z')).toBe('21:42'); // EET, UTC+2
    expect(formatTimeEl('2026-07-07T06:05:00Z')).toBe('09:05'); // EEST, UTC+3
    expect(formatTimeEl('2026-11-07T22:30:00Z')).toBe('00:30');
    expect(formatTimeEl('nonsense')).toBe('nonsense');
  });
});

describe('formatStampEl', () => {
  it('formats weekday, day/month and time in Athens time', () => {
    expect(formatStampEl('2026-11-09T12:32:00Z')).toBe('Δευ 09/11 14:32');
  });
  it('returns unknown input unchanged', () => {
    expect(formatStampEl('x')).toBe('x');
  });
});

describe('week helpers', () => {
  it('addDaysIso moves by calendar days across months, years and leap days', () => {
    expect(addDaysIso('2026-11-09', 6)).toBe('2026-11-15');
    expect(addDaysIso('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysIso('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysIso('2026-11-11', 0)).toBe('2026-11-11');
    expect(addDaysIso('2026-11-11', -7)).toBe('2026-11-04');
  });

  it('addDaysIso is not moved by daylight-saving changes', () => {
    expect(addDaysIso('2026-03-28', 1)).toBe('2026-03-29'); // EET → EEST
    expect(addDaysIso('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDaysIso('2026-10-24', 2)).toBe('2026-10-26'); // EEST → EET on the 25th
    expect(addDaysIso('2026-10-26', -1)).toBe('2026-10-25');
  });

  it('weekStartIso is the Monday of the Monday–Sunday week', () => {
    expect(weekStartIso('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(weekStartIso('2026-11-11')).toBe('2026-11-09'); // Wednesday
    expect(weekStartIso('2026-11-15')).toBe('2026-11-09'); // Sunday
    expect(weekStartIso('2026-11-16')).toBe('2026-11-16');
    expect(weekStartIso('2026-01-01')).toBe('2025-12-29'); // across the year
    expect(weekStartIso('2026-03-29')).toBe('2026-03-23'); // DST day, a Sunday
  });

  it('formatWeekdayEl and formatDayMonthLongEl use full Greek names (genitive months)', () => {
    expect(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map(formatWeekdayEl)).toEqual([
      'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή',
    ]);
    const months = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
    months.forEach((m, i) => expect(formatDayMonthLongEl(`2026-${String(i + 1).padStart(2, '0')}-05`)).toBe(`5 ${m}`));
    expect(formatDayMonthLongEl('2026-11-09')).toBe('9 Νοεμβρίου');
    expect(formatDayMonthLongEl('2026-11-30')).toBe('30 Νοεμβρίου');
  });

  it('formatWeekRangeEl has three forms: one month, across months, across years', () => {
    expect(formatWeekRangeEl('2026-11-09')).toBe('9 – 15 Νοεμβρίου 2026');
    expect(formatWeekRangeEl('2026-11-30')).toBe('30 Νοεμβρίου – 6 Δεκεμβρίου 2026');
    expect(formatWeekRangeEl('2025-12-29')).toBe('29 Δεκεμβρίου 2025 – 4 Ιανουαρίου 2026');
  });

  it('returns unknown input unchanged and never throws', () => {
    for (const bad of ['nonsense', '', '2026-02-30', '09/11/2026']) {
      expect(addDaysIso(bad, 3)).toBe(bad);
      expect(weekStartIso(bad)).toBe(bad);
      expect(formatWeekdayEl(bad)).toBe(bad);
      expect(formatDayMonthLongEl(bad)).toBe(bad);
      expect(formatWeekRangeEl(bad)).toBe(bad);
    }
  });
});
