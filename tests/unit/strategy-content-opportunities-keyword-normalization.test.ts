import { describe, expect, it } from 'vitest';

import {
  findActiveContentRequestForKeyword,
  isContentGapAlreadyRequested,
} from '../../src/components/client/strategy/StrategyContentOpportunitiesSection';
import type { ClientContentRequest } from '../../src/components/client/types';

const baseRequest: ClientContentRequest = {
  id: 'req_1',
  workspaceId: 'ws_1',
  topic: 'Emergency Dental Services',
  targetKeyword: 'Emergency Dentist - Near-Me',
  serviceType: 'brief_only',
  status: 'requested',
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
};

describe('Strategy content opportunity keyword request matching', () => {
  it('matches active content requests across canonical keyword variants', () => {
    expect(findActiveContentRequestForKeyword(
      [baseRequest],
      'emergency dentist near me',
    )).toEqual(baseRequest);
  });

  it('ignores declined request matches but honors canonical requested-topic seeds', () => {
    const declined = { ...baseRequest, status: 'declined' as const };
    expect(isContentGapAlreadyRequested(
      [declined],
      new Set(['emergency dentist near me']),
      'Emergency Dentist - Near-Me',
    )).toBe(true);
    expect(isContentGapAlreadyRequested(
      [declined],
      new Set(),
      'Emergency Dentist - Near-Me',
    )).toBe(false);
  });
});
