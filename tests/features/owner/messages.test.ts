import { describe, expect, it } from 'vitest';
import type { ConfigErrorCode } from '../../../src/core/config';
import { juiceBarPreset } from '../../../src/core/presets';
import type { OwnerError } from '../../../src/data/remote/errors';
import { configErrorMessage, configErrorSection, nameProblemMessage, ownerErrorMessage } from '../../../src/features/owner/model/messages';

// Record<…, true> makes the compiler fail if a code is added without a message test.
const CONFIG_CODES: Record<ConfigErrorCode, true> = {
  bad_shape: true, bad_float: true, bad_denomination: true, bad_max_expenses: true, bad_id: true, bad_label: true,
  duplicate_id: true, unknown_channel: true, unknown_total: true, cycle: true, missing_envelope_total: true, bad_tare: true,
};
const OWNER_ERRORS: Record<OwnerError['code'], OwnerError> = {
  not_owner: { code: 'not_owner' }, version_conflict: { code: 'version_conflict', currentVersion: 3 },
  staff_name_taken: { code: 'staff_name_taken' }, bad_pin_format: { code: 'bad_pin_format' }, bad_config: { code: 'bad_config' },
  bad_field: { code: 'bad_field' }, too_many_expenses: { code: 'too_many_expenses' }, wrong_day: { code: 'wrong_day' },
  bad_name: { code: 'bad_name' }, invalid_credentials: { code: 'invalid_credentials' }, email_not_confirmed: { code: 'email_not_confirmed' },
  email_taken: { code: 'email_taken' }, weak_password: { code: 'weak_password' }, rate_limited: { code: 'rate_limited' },
  link_invalid: { code: 'link_invalid' }, session_expired: { code: 'session_expired' }, network: { code: 'network' },
  closing_changed: { code: 'closing_changed', currentId: null }, bad_inputs: { code: 'bad_inputs' },
  config_mismatch: { code: 'config_mismatch' }, no_closing_day: { code: 'no_closing_day' },
  idempotency_conflict: { code: 'idempotency_conflict' }, bad_range: { code: 'bad_range' },
  draft_changed: { code: 'draft_changed' }, bad_closing_plan: { code: 'bad_closing_plan' }, wrong_closing: { code: 'wrong_closing' },
  too_many_shops: { code: 'too_many_shops' }, too_many_staff: { code: 'too_many_staff' }, too_many_versions: { code: 'too_many_versions' },
  confirm_mismatch: { code: 'confirm_mismatch' },
  unknown: { code: 'unknown', detail: 'x' },
};
const greek = /[Ͱ-Ͽ]/;

describe('messages', () => {
  it('has a Greek message for every config error code', () => {
    for (const code of Object.keys(CONFIG_CODES) as ConfigErrorCode[]) {
      expect(configErrorMessage({ code, detail: 'channel: ch_1' }, juiceBarPreset)).toMatch(greek);
    }
  });

  it('names totals in a cycle by label', () => {
    expect(configErrorMessage({ code: 'cycle', detail: 'cash → tameio → cash' }, juiceBarPreset)).toContain('ΜΕΤΡΗΤΑ → ΤΑΜΕΙΟ → ΜΕΤΡΗΤΑ');
  });

  it('places errors in their section', () => {
    expect(configErrorSection({ code: 'bad_label', detail: 'channel: ch_1' })).toBe('channels');
    expect(configErrorSection({ code: 'bad_label', detail: 'total: t_1' })).toBe('totals');
    expect(configErrorSection({ code: 'cycle', detail: '' })).toBe('totals');
    expect(configErrorSection({ code: 'bad_tare', detail: '' })).toBe('tare');
    expect(configErrorSection({ code: 'bad_float', detail: '' })).toBe('general');
  });

  it('words the cap errors', () => {
    expect(ownerErrorMessage({ code: 'too_many_shops' })).toBe('Έφτασες το όριο των 20 καταστημάτων.');
    expect(ownerErrorMessage({ code: 'too_many_staff' })).toBe('Έφτασες το όριο των 100 ατόμων σε αυτό το κατάστημα.');
    expect(ownerErrorMessage({ code: 'too_many_versions' })).toBe('Πάρα πολλές αλλαγές ρυθμίσεων σήμερα. Δοκίμασε ξανά αύριο.');
  });

  it('words the closing plan errors', () => {
    expect(ownerErrorMessage({ code: 'bad_closing_plan' })).toBe('Τα κλεισίματα ανά ημέρα πρέπει να είναι από 1 έως 6.');
    expect(ownerErrorMessage({ code: 'wrong_closing' })).toBe('Ξεκίνησε νέο κλείσιμο. Η οθόνη ανανεώθηκε.');
  });

  it('words the deletion confirmation error', () => {
    expect(ownerErrorMessage({ code: 'confirm_mismatch' })).toBe('Το όνομα δεν ταιριάζει. Γράψε το ακριβώς όπως φαίνεται.');
  });

  it('has a Greek message for every owner error', () => {
    for (const e of Object.values(OWNER_ERRORS)) expect(ownerErrorMessage(e)).toMatch(greek);
    expect(ownerErrorMessage({ code: 'version_conflict', currentVersion: 3 })).toContain('3');
  });

  it('explains name problems', () => {
    expect(nameProblemMessage('empty', 40)).toMatch(greek);
    expect(nameProblemMessage('too_long', 40)).toContain('40');
  });
});
