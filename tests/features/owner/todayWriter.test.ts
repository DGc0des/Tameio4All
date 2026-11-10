import { describe, expect, it, vi } from 'vitest';
import { createTodayWriter } from '../../../src/features/owner/todayWriter';
import { ownerErrorMessage } from '../../../src/features/owner/model/messages';
import type { LiveHandlers } from '../../../src/data/remote/live';
import type { Snapshot } from '../../../src/features/register/live/fields';
import { fail, fakeApi, ok } from './fakeApi';

const EDIT = { key: 'c:wolt', value: { text: '5' }, businessDate: '2026-11-07', baseVersion: 3, queuedOffline: false, seq: 1 };
const STALE = { key: 'c:wolt', value: { text: '9' }, version: 4, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T20:00:00Z' };

describe('createTodayWriter', () => {
  it('load goes to todayClosing', async () => {
    const api = fakeApi();
    const r = await createTodayWriter(api, 'shop-1').load();
    expect(r.ok).toBe(true);
    expect(api.todayClosing).toHaveBeenCalledWith('shop-1');
  });

  it('write ignores the business date and passes key, value and base version', async () => {
    const api = fakeApi();
    const r = await createTodayWriter(api, 'shop-1').write(EDIT);
    expect(api.setTodayField).toHaveBeenCalledWith('shop-1', 'c:wolt', { text: '5' }, 3);
    expect(r).toEqual({ ok: true, data: { version: 1, revision: 1 } });
  });

  it('maps stale data to a stale error carrying the current field', async () => {
    const api = fakeApi({ setTodayField: vi.fn(() => ok<{ version: number; revision: number } | { stale: typeof STALE }>({ stale: STALE })) });
    expect(await createTodayWriter(api, 's').write(EDIT)).toEqual({ ok: false, error: { code: 'stale', current: STALE } });
  });

  it('keeps network, bad_field and too_many_expenses', async () => {
    for (const code of ['network', 'bad_field', 'too_many_expenses'] as const) {
      const api = fakeApi({ setTodayField: vi.fn(() => fail<{ version: number; revision: number }>({ code })) });
      expect(await createTodayWriter(api, 's').write(EDIT)).toEqual({ ok: false, error: { code } });
    }
  });

  it('turns every other owner error into a fatal unknown carrying the Greek message', async () => {
    const api = fakeApi({ setTodayField: vi.fn(() => fail<{ version: number; revision: number }>({ code: 'not_owner' })), todayClosing: vi.fn(() => fail<Snapshot>({ code: 'session_expired' })) });
    const w = createTodayWriter(api, 's');
    expect(await w.write(EDIT)).toEqual({ ok: false, error: { code: 'unknown', detail: ownerErrorMessage({ code: 'not_owner' }) } });
    expect(await w.load()).toEqual({ ok: false, error: { code: 'unknown', detail: ownerErrorMessage({ code: 'session_expired' }) } });
  });

  it('live joins as «Ιδιοκτήτης»', () => {
    const api = fakeApi();
    const h = {} as LiveHandlers;
    createTodayWriter(api, 'shop-1').live(h);
    expect(api.live).toHaveBeenCalledWith('shop-1', { name: 'Ιδιοκτήτης' }, h);
  });
});
