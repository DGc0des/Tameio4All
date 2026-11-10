import { describe, expect, it } from 'vitest';
import { formatDateEl, formatDayEl, formatDayMonth, isIsoDate, todayIso, formatTimeEl } from '../../src/app/dates';

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
