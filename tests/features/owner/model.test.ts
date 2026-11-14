import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../../src/core/config';
import { evaluateTotals, type ClosingInputs } from '../../../src/core/formula';
import { joinJuicePreset } from '../../../src/core/presets';
import { buildFirstConfig } from '../../../src/features/owner/model/firstSetup';
import { checkLabel, checkName, isEmail, isPin, STAFF_NAME_MAX } from '../../../src/features/owner/model/limits';
import { formatClock, formatDate, isLocked } from '../../../src/features/owner/model/time';

describe('limits', () => {
  it('trims names and enforces the limit in characters (Greek, emoji)', () => {
    expect(checkName('  ΜΑΡΙΑ  ', STAFF_NAME_MAX)).toEqual({ ok: true, value: 'ΜΑΡΙΑ' });
    expect(checkName('α'.repeat(40), 40)).toEqual({ ok: true, value: 'α'.repeat(40) });
    expect(checkName('α'.repeat(41), 40)).toEqual({ ok: false, problem: 'too_long' });
    expect(checkName('😀'.repeat(40), 40).ok).toBe(true);
    expect(checkName('   ', 40)).toEqual({ ok: false, problem: 'empty' });
  });

  it('allows empty labels but not long ones', () => {
    expect(checkLabel('  ', 60)).toEqual({ ok: true, value: '' });
    expect(checkLabel('x'.repeat(61), 60)).toEqual({ ok: false, problem: 'too_long' });
  });

  it('checks PINs and emails', () => {
    expect(isPin('012345')).toBe(true);
    expect(isPin('123456')).toBe(true);
    expect(isPin('1234')).toBe(false);
    expect(isPin('12345')).toBe(false);
    expect(isPin('1234567')).toBe(false);
    expect(isPin('12a456')).toBe(false);
    expect(isPin('١٢٣٤٥٦')).toBe(false);
    expect(isPin('123456\n')).toBe(false);
    expect(isEmail('owner@shop.gr')).toBe(true);
    expect(isEmail('owner@shop')).toBe(false);
    expect(isEmail(' owner@shop.gr')).toBe(false);
  });
});

describe('time', () => {
  it('knows when a lock is still active', () => {
    const now = Date.parse('2026-09-29T10:00:00Z');
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked('2026-09-29T10:05:00Z', now)).toBe(true);
    expect(isLocked('2026-09-29T09:55:00Z', now)).toBe(false);
    expect(isLocked('garbage', now)).toBe(false);
  });

  it('formats clock and date in shop time (Europe/Athens), whatever the machine zone', () => {
    expect(formatClock('2026-11-11T22:30:00Z')).toBe('00:30');     // EET, UTC+2
    expect(formatDate('2026-11-11T22:30:00Z')).toBe('12/11/2026');
    expect(formatClock('2026-07-01T21:30:00Z')).toBe('00:30');     // EEST, UTC+3
    expect(formatDate('2026-07-01T21:30:00Z')).toBe('02/07/2026');
    expect(formatDate('2026-09-29T06:05:00Z')).toBe('29/09/2026');
  });
  it('returns unparseable input unchanged', () => {
    expect(formatClock('nope')).toBe('nope');
    expect(formatDate('nope')).toBe('nope');
  });
});

describe('buildFirstConfig', () => {
  it('builds a valid config whose ΤΑΜΕΙΟ/ΜΕΤΡΗΤΑ match the Join Juice preset', () => {
    const config = buildFirstConfig({
      floatCents: joinJuicePreset.floatCents,
      channels: joinJuicePreset.channels.map((c) => ({ label: `  ${c.label} `, type: c.type })),
    });
    expect(validateConfig(config)).toEqual([]);
    expect(config.channels.map((c) => c.label)).toEqual(joinJuicePreset.channels.map((c) => c.label));

    const amounts = [15000, 4560, 2310, 31025, 8840];
    const inputsFor = (ids: string[]): ClosingInputs => ({
      schema: 1,
      counts: { '10000': 5, '5000': 6, '500': 7 },
      channelCents: Object.fromEntries(ids.map((id, i) => [id, amounts[i] ?? 0])),
      expenses: [{ description: 'x', cents: 1250 }],
    });
    const mine = evaluateTotals(config, inputsFor(config.channels.map((c) => c.id)));
    const preset = evaluateTotals(joinJuicePreset, inputsFor(joinJuicePreset.channels.map((c) => c.id)));
    expect(mine.tameio).toBe(preset.tameio);
    expect(mine.cash).toBe(preset.cash);
  });
});
