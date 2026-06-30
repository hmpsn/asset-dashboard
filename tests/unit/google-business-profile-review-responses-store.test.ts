import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import {
  beginGbpReviewResponsePublish,
  completeGbpReviewResponsePublish,
  getGbpReviewContextForDraft,
  recordGbpReviewResponseDecision,
  updateGbpReviewResponseDraft,
  upsertGbpReviewResponseDraft,
} from '../../server/google-business-profile-review-responses-store.js';
import { createJob } from '../../server/jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

interface SeededGbpReviewGraph {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  googleLocationId: string;
  clientLocationId: string;
  reviewResourceName: string;
  cleanup: () => void;
}

let seededWorkspace: SeededFullWorkspace | null = null;
let seededGraph: SeededGbpReviewGraph | null = null;

function seedGbpReviewGraph(options: { replied?: boolean } = {}): SeededGbpReviewGraph {
  seededWorkspace = seedWorkspace();
  const suffix = seededWorkspace.workspaceId.replace('test-ws-', '');
  const workspaceId = seededWorkspace.workspaceId;
  const connectionId = `gbp-response-connection-${suffix}`;
  const accountId = `accounts/response-${suffix}`;
  const googleLocationId = `locations/response-${suffix}`;
  const clientLocationId = `client-location-response-${suffix}`;
  const reviewId = `review-response-${suffix}`;
  const reviewResourceName = `${accountId}/${googleLocationId}/reviews/${reviewId}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO client_locations (
      id, workspace_id, name, city, state_or_region, country, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(clientLocationId, workspaceId, 'Austin Office', 'Austin', 'TX', 'US', 'confirmed', now, now);
  db.prepare(`
    INSERT INTO google_oauth_connections (
      id, encrypted_access_token, encrypted_refresh_token, expires_at, scopes, status,
      last_refresh_at, last_synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    connectionId,
    'encrypted-access-token-placeholder',
    'encrypted-refresh-token-placeholder',
    Date.now() + 3600_000,
    'https://www.googleapis.com/auth/business.manage',
    'connected',
    now,
    now,
    now,
    now,
  );
  db.prepare(`
    INSERT INTO google_business_accounts (
      id, connection_id, account_resource_name, display_name, permission_level,
      synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, connectionId, accountId, 'Response Test Account', 'OWNER_LEVEL', now, now, now);
  db.prepare(`
    INSERT INTO google_business_locations (
      id, connection_id, account_id, account_resource_name, location_resource_name,
      title, place_id, address_line1, locality, administrative_area, region_code,
      sync_status, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    googleLocationId,
    connectionId,
    accountId,
    accountId,
    googleLocationId,
    'Austin Office',
    `place-${suffix}`,
    '100 Congress Ave',
    'Austin',
    'TX',
    'US',
    'available',
    now,
    now,
    now,
  );
  db.prepare(`
    INSERT INTO workspace_google_business_locations (
      workspace_id, client_location_id, google_location_id, is_primary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspaceId, clientLocationId, googleLocationId, 1, now, now);
  db.prepare(`
    INSERT INTO google_business_reviews (
      id, workspace_id, google_location_id, client_location_id, review_resource_name,
      review_id, star_rating, rating_value, comment, reviewer_display_name,
      reviewer_is_anonymous, create_time, update_time, reply_comment, reply_update_time,
      reply_state, synced_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `gbp-review-${suffix}`,
    workspaceId,
    googleLocationId,
    clientLocationId,
    reviewResourceName,
    reviewId,
    'FIVE',
    5,
    'Fantastic local service and fast follow-up.',
    'Jane Reviewer',
    0,
    '2026-06-29T12:00:00.000Z',
    '2026-06-29T12:30:00.000Z',
    options.replied ? 'Already replied.' : null,
    options.replied ? '2026-06-29T12:45:00.000Z' : null,
    options.replied ? 'PUBLISHED' : null,
    now,
    now,
    now,
  );

  return {
    workspaceId,
    connectionId,
    accountId,
    googleLocationId,
    clientLocationId,
    reviewResourceName,
    cleanup: () => {
      db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM google_business_review_reply_publish_attempts WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM google_business_review_response_events WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM google_business_review_responses WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM google_business_reviews WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM workspace_google_business_locations WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM google_business_locations WHERE id = ?').run(googleLocationId);
      db.prepare('DELETE FROM google_business_accounts WHERE id = ?').run(accountId);
      db.prepare('DELETE FROM google_oauth_connections WHERE id = ?').run(connectionId);
      db.prepare('DELETE FROM client_locations WHERE id = ?').run(clientLocationId);
      seededWorkspace?.cleanup();
      seededWorkspace = null;
    },
  };
}

beforeEach(() => {
  seededGraph = null;
  seededWorkspace = null;
});

afterEach(() => {
  seededGraph?.cleanup();
  seededGraph = null;
});

describe('GBP review response workflow store', () => {
  it('requires explicit approval before publishing and mirrors published reply onto the synced review', () => {
    seededGraph = seedGbpReviewGraph();

    const draft = upsertGbpReviewResponseDraft({
      workspaceId: seededGraph.workspaceId,
      reviewResourceName: seededGraph.reviewResourceName,
      draftText: 'Thank you for the kind words. We appreciate the chance to help.',
      actor: { type: 'admin' },
    });
    expect(draft.status).toBe('draft');
    const blockedJob = createJob(BACKGROUND_JOB_TYPES.GBP_REVIEW_REPLY_PUBLISH, {
      workspaceId: seededGraph.workspaceId,
    });
    expect(() => beginGbpReviewResponsePublish({
      workspaceId: seededGraph!.workspaceId,
      responseId: draft.id,
      jobId: blockedJob.id,
    })).toThrow(/explicitly approved/);

    const approved = recordGbpReviewResponseDecision({
      workspaceId: seededGraph.workspaceId,
      responseId: draft.id,
      status: 'approved',
      actor: { type: 'admin' },
    });
    expect(approved.approvedAt).toBeTruthy();
    expect(() => updateGbpReviewResponseDraft({
      workspaceId: seededGraph!.workspaceId,
      responseId: draft.id,
      draftText: 'Changed after approval without another approval.',
      actor: { type: 'admin' },
    })).toThrow(/Only draft or changes-requested/);

    const job = createJob(BACKGROUND_JOB_TYPES.GBP_REVIEW_REPLY_PUBLISH, {
      workspaceId: seededGraph.workspaceId,
    });
    const started = beginGbpReviewResponsePublish({
      workspaceId: seededGraph.workspaceId,
      responseId: draft.id,
      jobId: job.id,
    });
    expect(started.response.status).toBe('publishing');
    expect(started.replyText).toBe('Thank you for the kind words. We appreciate the chance to help.');

    const published = completeGbpReviewResponsePublish({
      workspaceId: seededGraph.workspaceId,
      responseId: draft.id,
      attemptId: started.attemptId,
      replyText: started.replyText,
      googleReplyUpdateTime: '2026-06-29T13:00:00.000Z',
    });
    expect(published.status).toBe('published');

    const reviewRow = db.prepare(`
      SELECT reply_comment, reply_update_time, reply_state
      FROM google_business_reviews
      WHERE workspace_id = ? AND review_resource_name = ?
    `).get(seededGraph.workspaceId, seededGraph.reviewResourceName) as {
      reply_comment: string;
      reply_update_time: string;
      reply_state: string;
    };
    expect(reviewRow.reply_comment).toBe('Thank you for the kind words. We appreciate the chance to help.');
    expect(reviewRow.reply_update_time).toBe('2026-06-29T13:00:00.000Z');
    expect(reviewRow.reply_state).toBe('PUBLISHED');
  });

  it('keeps existing Google replies read-only in this phase', () => {
    seededGraph = seedGbpReviewGraph({ replied: true });

    expect(() => getGbpReviewContextForDraft(
      seededGraph!.workspaceId,
      seededGraph!.reviewResourceName,
    )).toThrow(/read-only/);
    expect(() => upsertGbpReviewResponseDraft({
      workspaceId: seededGraph!.workspaceId,
      reviewResourceName: seededGraph!.reviewResourceName,
      draftText: 'Thanks again.',
      actor: { type: 'admin' },
    })).toThrow(/read-only/);
  });
});
