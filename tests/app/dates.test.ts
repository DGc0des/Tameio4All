import { describe, expect, it } from 'vitest';
import { formatDateEl, formatDayEl, isIsoDate, todayIso } from '../../src/app/dates';

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
  });
});
