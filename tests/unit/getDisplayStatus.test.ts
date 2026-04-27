/**
 * Unit tests for getDisplayStatus() in src/components/client/types.ts
 *
 * Verifies the disambiguator correctly maps dual-purpose `changes_requested`
 * based on whether postId is set (post-flow) or absent (brief-flow).
 */
import { describe, it, expect } from 'vitest';
import { getDisplayStatus } from '../../src/components/client/types.js';
import type { ClientContentRequest } from '../../src/components/client/types.js';

function makeReq(status: ClientContentRequest['status'], postId?: string): ClientContentRequest {
  return {
    id: 'req_test', topic: 'Test Topic', targetKeyword: 'test-kw',
    intent: 'informational', priority: 'medium', status, postId,
    requestedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

describe('getDisplayStatus', () => {
  it('changes_requested + no postId → stays changes_requested (brief-flow)', () => {
    const req = makeReq('changes_requested', undefined);
    expect(getDisplayStatus(req)).toBe('changes_requested');
  });

  it('changes_requested + postId set → returns post_review (post-flow)', () => {
    const req = makeReq('changes_requested', 'post_abc123');
    expect(getDisplayStatus(req)).toBe('post_review');
  });

  it('post_review raw status → returns post_review unchanged', () => {
    const req = makeReq('post_review');
    expect(getDisplayStatus(req)).toBe('post_review');
  });

  it('client_review raw status → returns client_review unchanged', () => {
    const req = makeReq('client_review');
    expect(getDisplayStatus(req)).toBe('client_review');
  });

  it('in_progress → returns in_progress unchanged', () => {
    expect(getDisplayStatus(makeReq('in_progress'))).toBe('in_progress');
  });

  it('approved → returns approved unchanged', () => {
    expect(getDisplayStatus(makeReq('approved'))).toBe('approved');
  });

  it('delivered → returns delivered unchanged', () => {
    expect(getDisplayStatus(makeReq('delivered'))).toBe('delivered');
  });

  it('pending_payment → returns pending_payment unchanged', () => {
    expect(getDisplayStatus(makeReq('pending_payment'))).toBe('pending_payment');
  });

  it('requested → returns requested unchanged', () => {
    expect(getDisplayStatus(makeReq('requested'))).toBe('requested');
  });

  it('declined → returns declined unchanged', () => {
    expect(getDisplayStatus(makeReq('declined'))).toBe('declined');
  });
});
