import { describe, it, expect } from 'vitest';
import { eventDisplayConfigSchema } from '../../server/schemas/workspace-schemas.js';
import type { EventDisplayConfig } from '../../shared/types/workspace.js';

describe('EventDisplayConfig.outcomeType (P1a)', () => {
  it('accepts an optional outcome-type classification', () => {
    const c: EventDisplayConfig = { eventName: 'phone_call', displayName: 'Calls', pinned: true, outcomeType: 'call' };
    const parsed = eventDisplayConfigSchema.safeParse(c);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.outcomeType).toBe('call');
  });
  it('still accepts a P0 config with no outcomeType (byte-compatible)', () => {
    expect(eventDisplayConfigSchema.safeParse({ eventName: 'form_submit', displayName: 'Form fills', pinned: true }).success).toBe(true);
  });
  it('rejects an unknown outcomeType value', () => {
    expect(eventDisplayConfigSchema.safeParse({ eventName: 'x', displayName: 'X', pinned: true, outcomeType: 'teleport' }).success).toBe(false);
  });
});
