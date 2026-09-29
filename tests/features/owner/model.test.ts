import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../../src/core/config';
import { evaluateTotals, type ClosingInputs } from '../../../src/core/formula';
import { joinJuicePreset } from '../../../src/core/presets';
import { buildFirstConfig } from '../../../src/features/owner/model/firstSetup';
import { checkLabel, checkName, isEmail, isPin, STAFF_NAME_MAX } from '../../../src/features/owner/model/limits';
import { formatCountdown, formatPairingCode, secondsLeft } from '../../../src/features/owner/model/pairing';
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
    expect(isPin('0123')).toBe(true);
    expect(isPin('123')).toBe(false);
    expect(isPin('12a4')).toBe(false);
    expect(isPin('١٢٣٤')).toBe(false);
    expect(isEmail('owner@shop.gr')).toBe(true);
    expect(isEmail('owner@shop')).toBe(false);
    expect(isEmail(' owner@shop.gr')).toBe(false);
  });
});

describe('pairing', () => {
  it('groups the code and counts down', () => {
    expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(formatPairingCode('ABC')).toBe('ABC');
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 20_000)).toBe(0);
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(5)).toBe('0:05');
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

  it('formats clock and date in Greek style', () => {
    const iso = new Date(2026, 8, 29, 9, 5).toISOString();
    expect(formatClock(iso)).toBe('09:05');
    expect(formatDate(iso)).toBe('29/09/2026');
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
