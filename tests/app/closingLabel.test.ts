import { describe, expect, it } from 'vitest';
import { closingLabel, closingOfLabel, closingsDoneLabel, missingClosingsLabel } from '../../src/app/closingLabel';

describe('closing labels', () => {
  it('closingLabel names the closing by its ordinal', () => {
    expect(closingLabel(2)).toBe('2ο κλείσιμο');
    expect(closingLabel(1)).toBe('1ο κλείσιμο');
  });
  it('closingOfLabel adds the planned number; a 1-closing plan has no «από»', () => {
    expect(closingOfLabel(2, 3)).toBe('2ο κλείσιμο από 3');
    expect(closingOfLabel(1, 1)).toBe('1ο κλείσιμο');
  });
  it('closingsDoneLabel counts the done closings', () => {
    expect(closingsDoneLabel(2, 3)).toBe('2 από 3 κλεισίματα');
  });
  it('missingClosingsLabel uses the singular for one', () => {
    expect(missingClosingsLabel(1)).toBe('Λείπει 1 κλείσιμο');
    expect(missingClosingsLabel(2)).toBe('Λείπουν 2 κλεισίματα');
  });
});
