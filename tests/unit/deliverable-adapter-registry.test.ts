import { describe, it, expect, afterEach } from 'vitest';
import {
  registerAdapter,
  getAdapter,
  tryGetAdapter,
  listAdapterTypes,
  __resetAdapterRegistryForTests,
  type DeliverableAdapter,
} from '../../server/domains/inbox/deliverable-adapters/types.js';
import type { DeliverableType } from '../../shared/types/client-deliverable.js';

// A throwaway adapter for a real DeliverableType not registered by any production
// adapter in Phase 0 (the registry barrel is empty in Phase 0).
function makeFakeAdapter(type: DeliverableType): DeliverableAdapter {
  return {
    type,
    validateSendable: () => ({ ok: true }),
    buildPayload: () => ({ title: 'fake', kind: 'decision', payload: {} }),
    sourceRef: () => null,
  };
}

afterEach(() => {
  __resetAdapterRegistryForTests();
});

describe('deliverable adapter registry', () => {
  it('registers an adapter and resolves it by type', () => {
    const adapter = makeFakeAdapter('redirect');
    registerAdapter(adapter);
    expect(getAdapter('redirect')).toBe(adapter);
    expect(listAdapterTypes()).toContain('redirect');
  });

  it('getAdapter throws for an unregistered type', () => {
    expect(() => getAdapter('aeo_change')).toThrow();
  });

  it('tryGetAdapter returns undefined for an unregistered type (no throw)', () => {
    expect(tryGetAdapter('aeo_change')).toBeUndefined();
  });

  it('appliesOnApprove defaults to opt-out (apply is opt-in, default no-op)', () => {
    const adapter = makeFakeAdapter('internal_link');
    registerAdapter(adapter);
    // An adapter that does not set appliesOnApprove must NOT apply on approve (D-apply).
    expect(getAdapter('internal_link').appliesOnApprove).toBeFalsy();
  });

  it('re-registering the same type throws (prevents silent double-registration)', () => {
    registerAdapter(makeFakeAdapter('redirect'));
    expect(() => registerAdapter(makeFakeAdapter('redirect'))).toThrow();
  });
});
