import { describe, expect, it, vi } from 'vitest';
import { createTodayWriter } from '../../../src/features/owner/todayWriter';
import { ownerErrorMessage } from '../../../src/features/owner/model/messages';
import type { LiveHandlers } from '../../../src/data/remote/live';
import type { Snapshot } from '../../../src/features/register/live/fields';
import { fail, fakeApi, ok } from './fakeApi';

const EDIT = { author: 'owner', key: 'c:wolt', value: { text: '5' }, businessDate: '2026-11-07', baseVersion: 3, queuedOffline: false, seq: 1 };
const STALE = { key: 'c:wolt', value: { text: '9' }, version: 4, updatedByName: 'ΜΑΡΙΑ', updatedAt: '2026-11-07T20:00:00Z' };

describe('createTodayWriter', () => {
  it('load goes to todayClosing', async () => {
    const api = fakeApi();
    const r = await createTodayWriter(api, 'shop-1').load();
    expect(r.ok).toBe(true);
    expect(api.todayClosing).toHaveBeenCalledWith('shop-1');
  });

  it('write passes the business date it was typed on, key, value and base version', async () => {
    const api = fakeApi();
    const r = await createTodayWriter(api, 'shop-1').write(EDIT);
    expect(api.setTodayField).toHaveBeenCalledWith('shop-1', '2026-11-07', 'c:wolt', { text: '5' }, 3);
    expect(r).toEqual({ ok: true, data: { version: 1, revision: 1 } });
  });

  it('maps stale data to a stale error carrying the current field', async () => {
    const api = fakeApi({ setTodayField: vi.fn(() => ok<{ version: number; revision: number } | { stale: typeof STALE }>({ stale: STALE })) });
    expect(await createTodayWriter(api, 's').write(EDIT)).toEqual({ ok: false, error: { code: 'stale', current: STALE } });
  });

  it('passes on the stored value of the ack', async () => {
    const stored = { addedBy: { kind: 'owner' }, removed: false, order: 1 };
    const api = fakeApi({ setTodayField: vi.fn(() => ok({ version: 2, revision: 5, value: stored })) });
    expect(await createTodayWriter(api, 's').write(EDIT)).toEqual({ ok: true, data: { version: 2, revision: 5, value: stored } });
  });

  it('keeps network, bad_field, too_many_expenses and wrong_day (M1: the engine drops + resyncs)', async () => {
    for (const code of ['network', 'bad_field', 'too_many_expenses', 'wrong_day'] as const) {
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
