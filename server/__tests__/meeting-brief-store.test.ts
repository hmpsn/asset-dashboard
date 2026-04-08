// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { getMeetingBrief, upsertMeetingBrief, getMeetingBriefHash } from '../meeting-brief-store.js';
import type { MeetingBrief } from '../../shared/types/meeting-brief.js';

import db from '../db/index.js';

// FK enforcement is disabled in the test environment (tests/db-setup.ts:11 — `PRAGMA foreign_keys = OFF`).
// Inserting with an ad-hoc workspace ID without a matching workspaces row is intentional
// and consistent with how all other store tests operate since migration 019.
const WS_ID = 'test-workspace-store';

const SAMPLE_BRIEF: MeetingBrief = {
  workspaceId: WS_ID,
  generatedAt: '2026-04-07T12:00:00.000Z',
  situationSummary: 'Your site is gaining momentum.',
  wins: ['Ranking improved for /services', 'CTR up 12% for "seo agency"'],
  attention: ['Content decay detected on /blog/old-post'],
  recommendations: [{ action: 'Refresh /blog/old-post', rationale: 'Losing 30% of its traffic YoY' }],
  blueprintProgress: null,
  metrics: {
    siteHealthScore: 87,
    openRankingOpportunities: 4,
    contentInPipeline: 3,
    overallWinRate: 72,
    criticalIssues: 2,
  },
};

describe('meeting-brief-store', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM meeting_briefs WHERE workspace_id = ?').run(WS_ID);
  });

  it('returns null when no brief exists', () => {
    expect(getMeetingBrief(WS_ID)).toBeNull();
  });

  it('upserts and retrieves a brief', () => {
    upsertMeetingBrief(SAMPLE_BRIEF);
    const result = getMeetingBrief(WS_ID);
    expect(result).not.toBeNull();
    expect(result!.situationSummary).toBe('Your site is gaining momentum.');
    expect(result!.wins).toHaveLength(2);
    expect(result!.recommendations[0].action).toBe('Refresh /blog/old-post');
    expect(result!.metrics.siteHealthScore).toBe(87);
  });

  it('retrieves the stored prompt hash', () => {
    upsertMeetingBrief(SAMPLE_BRIEF, 'abc123');
    expect(getMeetingBriefHash(WS_ID)).toBe('abc123');
  });

  it('overwrites existing brief on second upsert', () => {
    upsertMeetingBrief(SAMPLE_BRIEF);
    const updated = { ...SAMPLE_BRIEF, situationSummary: 'Updated summary.' };
    upsertMeetingBrief(updated);
    const result = getMeetingBrief(WS_ID);
    expect(result!.situationSummary).toBe('Updated summary.');
  });
});
