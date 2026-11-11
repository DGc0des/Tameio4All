import type { DeviceContext, StaffSession } from '../remote/deviceApi';
import { readJson, removeKey, writeJson, type KeyValueStore } from './storage';

const SESSION_KEY = 'tameio4all:v1:phone:session';
const CONTEXT_KEY = 'tameio4all:v1:phone:context';
const JOIN_KEY = 'tameio4all:v1:phone:joinKey';
/** Same format as parseJoinKey (src/app/joinKey.ts) and the shop_join_keys CHECK. */
const JOIN_KEY_RE = /^[A-HJ-NP-Z2-9]{16}$/;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const allStrings = (o: Obj, keys: readonly string[]): boolean => keys.every((k) => typeof o[k] === 'string');

function isStaffSession(x: unknown): x is StaffSession {
  return isObj(x) && allStrings(x, ['token', 'staffId', 'name', 'businessDate', 'shopId']);
}

function isDeviceContext(x: unknown): x is DeviceContext {
  return isObj(x) && allStrings(x, ['shopId', 'shopName', 'configId', 'businessDate']) && Object.hasOwn(x, 'config');
}

/** The signed-in cashier on this phone (token, never the PIN). null when absent or unreadable. */
export function loadStaffSession(store: KeyValueStore): StaffSession | null {
  const s = readJson(store, SESSION_KEY);
  return isStaffSession(s) ? s : null;
}

export function saveStaffSession(store: KeyValueStore, s: StaffSession): boolean {
  return writeJson(store, SESSION_KEY, s);
}

export function clearStaffSession(store: KeyValueStore): void {
  removeKey(store, SESSION_KEY);
}

/** The last device context the server returned, for opening the register offline. */
export function loadCachedContext(store: KeyValueStore): DeviceContext | null {
  const c = readJson(store, CONTEXT_KEY);
  return isDeviceContext(c) ? c : null;
}

export function saveCachedContext(store: KeyValueStore, c: DeviceContext): boolean {
  return writeJson(store, CONTEXT_KEY, c);
}

/** Forgets the cached context (the phone is no longer paired). */
export function clearCachedContext(store: KeyValueStore): void {
  removeKey(store, CONTEXT_KEY);
}

/** The store key of the last successful join, for the silent return. null when absent or not a key. */
export function loadJoinKey(store: KeyValueStore): string | null {
  const k = readJson(store, JOIN_KEY);
  return typeof k === 'string' && JOIN_KEY_RE.test(k) ? k : null;
}

export function saveJoinKey(store: KeyValueStore, key: string): boolean {
  return writeJson(store, JOIN_KEY, key);
}

export function clearJoinKey(store: KeyValueStore): void {
  removeKey(store, JOIN_KEY);
}
