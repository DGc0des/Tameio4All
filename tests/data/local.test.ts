import { describe, expect, it } from 'vitest';
import { loadTheme, saveTheme } from '../../src/data/local/prefs';
import {
  memoryStore, readJson, removeKey, shopKey, writeJson, type KeyValueStore,
} from '../../src/data/local/storage';

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

describe('storage', () => {
  it('namespaces keys per shop', () => {
    expect(shopKey('local', 'draft')).toBe('tameio4all:v1:local:draft');
  });

  it('round-trips JSON and treats garbage as missing', () => {
    const s = memoryStore();
    expect(writeJson(s, 'k', { a: 1 })).toBe(true);
    expect(readJson(s, 'k')).toEqual({ a: 1 });
    s.setItem('bad', '{{{');
    expect(readJson(s, 'bad')).toBeNull();
    expect(readJson(s, 'missing')).toBeNull();
  });

  it('never throws when the browser store fails', () => {
    expect(readJson(throwing, 'k')).toBeNull();
    expect(writeJson(throwing, 'k', 1)).toBe(false);
    expect(() => removeKey(throwing, 'k')).not.toThrow();
  });
});

describe('prefs', () => {
  it('defaults to system and persists light/dark', () => {
    const s = memoryStore();
    expect(loadTheme(s)).toBe('system');
    expect(saveTheme(s, 'dark')).toBe(true);
    expect(loadTheme(s)).toBe('dark');
    s.setItem('tameio4all:v1:prefs:theme', '"purple"');
    expect(loadTheme(s)).toBe('system');
  });
});
