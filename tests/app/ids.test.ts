import { expect, it } from 'vitest';
import { randomId } from '../../src/app/ids';

it('returns distinct non-empty ids', () => {
  const a = randomId();
  const b = randomId();
  expect(a).not.toBe('');
  expect(a).not.toBe(b);
});
