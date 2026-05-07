import { describe, expect, it } from 'vitest';
import { appendUniqueListValue, appendUniqueRequiredTerminology } from '../../src/components/brand/voice-tab/voiceTabModel';

describe('voiceTabModel helpers', () => {
  it('dedupes list values with trim/whitespace/case normalization', () => {
    const start = ['Never condescending'];

    const duplicate = appendUniqueListValue(start, '  never    condescending  ');
    expect(duplicate.added).toBe(false);
    expect(duplicate.next).toEqual(start);

    const unique = appendUniqueListValue(start, 'Clear and direct');
    expect(unique.added).toBe(true);
    expect(unique.next).toEqual(['Never condescending', 'Clear and direct']);
  });

  it('rejects empty or whitespace-only list values', () => {
    const start = ['Never condescending'];
    const empty = appendUniqueListValue(start, '   ');

    expect(empty.added).toBe(false);
    expect(empty.next).toEqual(start);
  });

  it('normalizes and dedupes required terminology pairs', () => {
    const start = [{ use: 'clients', insteadOf: 'customers' }];

    const duplicate = appendUniqueRequiredTerminology(start, '  Clients ', '  Customers   ');
    expect(duplicate.added).toBe(false);
    expect(duplicate.next).toEqual(start);

    const unique = appendUniqueRequiredTerminology(start, 'engagement', 'interaction');
    expect(unique.added).toBe(true);
    expect(unique.next).toEqual([
      { use: 'clients', insteadOf: 'customers' },
      { use: 'engagement', insteadOf: 'interaction' },
    ]);
  });

  it('rejects partial-empty required terminology entries', () => {
    const start = [{ use: 'clients', insteadOf: 'customers' }];
    const missingInsteadOf = appendUniqueRequiredTerminology(start, 'engagement', '  ');
    const missingUse = appendUniqueRequiredTerminology(start, '  ', 'interaction');

    expect(missingInsteadOf.added).toBe(false);
    expect(missingInsteadOf.next).toEqual(start);
    expect(missingUse.added).toBe(false);
    expect(missingUse.next).toEqual(start);
  });
});
