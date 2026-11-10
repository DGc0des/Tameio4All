import { describe, expect, it } from 'vitest';
import {
  amountValue, channelKey, denomKey, denomValue, expenseAmountKey, expenseMetaValue, textValue, expenseDescKey, expenseKey, isFieldKey, isFieldValue, KEY_RE, parseKey,
} from '../../../../src/features/register/live/fields';

describe('key builders', () => {
  it('build keys that match the regex and parse back', () => {
    expect(denomKey(5000)).toBe('d:5000');
    expect(channelKey('wolt')).toBe('c:wolt');
    expect(expenseKey('abc-1')).toBe('e:abc-1');
    expect(expenseDescKey('abc-1')).toBe('e:abc-1:d');
    expect(expenseAmountKey('abc-1')).toBe('e:abc-1:a');
    for (const k of [denomKey(5), channelKey('a_b-C'), expenseKey('x'), expenseDescKey('x'), expenseAmountKey('x')]) expect(KEY_RE.test(k)).toBe(true);
    expect(parseKey('d:5000')).toEqual({ kind: 'denom', denom: 5000 });
    expect(parseKey('c:wolt')).toEqual({ kind: 'channel', id: 'wolt' });
    expect(parseKey('e:abc-1')).toEqual({ kind: 'expense', id: 'abc-1' });
    expect(parseKey('e:abc-1:d')).toEqual({ kind: 'expenseDesc', id: 'abc-1' });
    expect(parseKey('e:abc-1:a')).toEqual({ kind: 'expenseAmount', id: 'abc-1' });
  });

  it('rejects keys that do not match', () => {
    for (const k of ['', 'd:', 'd:1234567', 'd:-5', 'd:1.5', 'c:', 'c:a b', `c:${'a'.repeat(41)}`, 'e:', 'e:a_b', `e:${'a'.repeat(65)}`, 'e:a:x', 'e:a:d:d', 'x:1', ' d:5', 'd:5\n']) {
      expect(isFieldKey(k), JSON.stringify(k)).toBe(false);
      expect(parseKey(k)).toBeNull();
    }
    expect(isFieldKey(5)).toBe(false);
  });
});

describe('isFieldValue (mirrors closing_field_ok)', () => {
  const author = { kind: 'owner' };
  it('checks the value shape per key', () => {
    expect(isFieldValue('d:5000', { text: '1', mode: 'count' })).toBe(true);
    expect(isFieldValue('d:5000', { text: '1' })).toBe(false);
    expect(isFieldValue('d:5000', { text: '1', mode: 'x' })).toBe(false);
    expect(isFieldValue('c:wolt', { text: '1' })).toBe(true);
    expect(isFieldValue('c:wolt', { text: 1 })).toBe(false);
    expect(isFieldValue('c:wolt', { text: 'a'.repeat(201) })).toBe(false);
    expect(isFieldValue('c:wolt', { text: 'a'.repeat(200) })).toBe(true);
    expect(isFieldValue('c:wolt', null)).toBe(false);
    expect(isFieldValue('c:wolt', 'x')).toBe(false);
    expect(isFieldValue('e:1:a', { text: '' })).toBe(true);
    expect(isFieldValue('e:1', { addedBy: author, removed: false, order: 5 })).toBe(true);
    expect(isFieldValue('e:1', { addedBy: author, removed: 'no', order: 5 })).toBe(false);
    expect(isFieldValue('e:1', { addedBy: author, removed: false, order: '5' })).toBe(false);
    expect(isFieldValue('e:1', { addedBy: 'me', removed: false, order: 5 })).toBe(false);
    expect(isFieldValue('bad', { text: '' })).toBe(false);
  });
});

describe('R11 twin-of-SQL strictness', () => {
  const author = { kind: 'owner' };
  it('rejects extra properties (exact key sets)', () => {
    expect(isFieldValue('c:w', { text: '1', extra: 1 })).toBe(false);
    expect(isFieldValue('e:1:a', { text: '1', mode: 'count' })).toBe(false);
    expect(isFieldValue('d:5', { text: '1', mode: 'count', extra: 1 })).toBe(false);
    expect(isFieldValue('e:1', { addedBy: author, removed: false, order: 5, extra: 1 })).toBe(false);
    expect(isFieldValue('e:1', { addedBy: author, removed: false })).toBe(false);
  });
  it('counts code points like char_length', () => {
    expect(isFieldValue('c:w', { text: '😀'.repeat(200) })).toBe(true);
    expect(isFieldValue('c:w', { text: '😀'.repeat(201) })).toBe(false);
  });
  it('parseKey rejects d: keys with a leading zero (and zero denom)', () => {
    expect(parseKey('d:0100')).toBeNull();
    expect(parseKey('d:05')).toBeNull();
    expect(parseKey('d:0')).toBeNull();
    expect(parseKey('d:100')).toEqual({ kind: 'denom', denom: 100 });
    expect(isFieldValue('d:0100', { text: '', mode: 'amount' })).toBe(false);
  });
});

describe('value builders', () => {
  it('build exactly the shapes the server accepts', () => {
    expect(denomValue('1,5a', 'amount')).toEqual({ text: '1.5', mode: 'amount' });
    expect(isFieldValue('d:100', denomValue('3', 'count'))).toBe(true);
    expect(amountValue('45,60')).toEqual({ text: '45.60' });
    expect(textValue(' Nice ')).toEqual({ text: ' Nice ' });
    const meta = expenseMetaValue({ kind: 'staff', id: 's1' }, 42, true);
    expect(meta).toEqual({ addedBy: { kind: 'staff', id: 's1' }, order: 42, removed: true });
    expect(isFieldValue('e:x1', meta)).toBe(true);
  });

  it('cut text to 200 code points so a long description is never silently refused', () => {
    const long = 'α'.repeat(250);
    expect([...textValue(long).text]).toHaveLength(200);
    expect(isFieldValue('e:x1:d', textValue(long))).toBe(true);
  });
});
