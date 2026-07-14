import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const teamNotifications = vi.hoisted(() => ({
  approved: vi.fn(),
  changesRequested: vi.fn(),
}));

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    isEmailConfigured: () => true,
    notifyTeamActionApproved: teamNotifications.approved,
    notifyTeamChangesRequested: teamNotifications.changesRequested,
  };
});

import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { initActivityBroadcast, listClientActivity } from '../../server/activity-log.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import {
  acceptBrandGenerationStartCommand,
  getBrandGenerationItem,
  getPersistedBrandGenerationRun,
  transitionBrandGenerationItem,
  transitionBrandGenerationRun,
  type AcceptBrandGenerationStartCommandInput,
  type BrandGenerationPreparedItem,
} from '../../server/domains/brand/generation/repository.js';
import { canonicalBrandGenerationFingerprint } from '../../server/domains/brand/generation/fingerprint.js';
import {
  applyBrandReviewDecision,
  BrandReviewServiceError,
  createBrandReviewDeliverable,
} from '../../server/domains/brand/review-service.js';
import { getDeliverable as getClientDeliverable } from '../../server/client-deliverables.js';
import { listClientFacingDeliverables } from '../../server/domains/inbox/unified-inbox-read.js';
import {
  brandReviewClientToken,
  parseBrandReviewItemPayload,
} from '../../server/domains/brand/review-contracts.js';
import { getDeliverable as getBrandDeliverable } from '../../server/brand-identity.js';
import {
  DEFAULT_TIER_MAP,
  type VoiceDNA,
  type VoiceGuardrails,
} from '../../shared/types/brand-engine.js';
import type {
  BrandGenerationTargetInputSnapshot,
  FinalizedVoiceSnapshotRef,
  StartBrandGenerationRequest,
} from '../../shared/types/brand-generation.js';
import type { BrandIntakeRevisionRef } from '../../shared/types/brand-intake.js';

const workspaces: string[] = [];
const clientUsers: Array<{ id: string; workspaceId: string }> = [];
const broadcast = vi.fn();
const FINGERPRINTS = Array.from({ length: 16 }, (_, index) =>
  (index + 1).toString(16).padStart(64, '0'));

let server: http.Server | undefined;
let baseUrl = '';
const originalAppPassword = process.env.APP_PASSWORD;

beforeAll(async () => {
  setBroadcast(vi.fn(), broadcast);
  initActivityBroadcast(broadcast);
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  broadcast.mockClear();
  teamNotifications.approved.mockClear();
  teamNotifications.changesRequested.mockClear();
  for (const user of clientUsers.splice(0)) {
    deleteClientUser(user.id, user.workspaceId);
  }
  for (const workspaceId of workspaces.splice(0)) {
    deleteWorkspace(workspaceId);
    db.prepare(`DELETE FROM client_deliverable_item WHERE deliverable_id IN (
      SELECT id FROM client_deliverable WHERE workspace_id = ?
    )`).run(workspaceId);
    db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
    db.prepare(`DELETE FROM brand_identity_versions WHERE deliverable_id IN (
      SELECT id FROM brand_identity_deliverables WHERE workspace_id = ?
    )`).run(workspaceId);
    db.prepare(`DELETE FROM brand_generation_attempts WHERE item_id IN (
      SELECT id FROM brand_generation_items WHERE workspace_id = ?
    )`).run(workspaceId);
    db.prepare('DELETE FROM brand_generation_effect_events WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_commands WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_items WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_runs WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_intake_revisions WHERE workspace_id = ?').run(workspaceId);
  }
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close(err => err ? reject(err) : resolve());
    });
  }
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  initActivityBroadcast(() => undefined);
});

const voiceDNA: VoiceDNA = {
  personalityTraits: ['Warm and exact'],
  toneSpectrum: { formal_casual: 6, serious_playful: 4, technical_accessible: 8 },
  sentenceStyle: 'Short, calm sentences with a clear point.',
  vocabularyLevel: 'Plain language that preserves expertise.',
};
const guardrails: VoiceGuardrails = {
  forbiddenWords: ['miracle'],
  requiredTerminology: [],
  toneBoundaries: ['Never pressure the reader.'],
  antiPatterns: ['Unsupported superlatives'],
};
const finalizedVoice: FinalizedVoiceSnapshotRef = {
  voiceProfileId: 'vp-review-test',
  voiceVersion: 3,
  finalizedBy: { actorType: 'operator', actorId: 'op-voice' },
  finalizedAt: '2026-07-14T00:00:00.000Z',
  fingerprint: FINGERPRINTS[2]!,
  anchorEvidenceRefs: [{
    sourceType: 'client_submission',
    sourceId: 'sample-1',
    capturedAt: '2026-07-13T00:00:00.000Z',
    selectedBy: { actorType: 'operator', actorId: 'op-voice' },
    selectedAt: '2026-07-14T00:00:00.000Z',
  }],
};
const budget = {
  maxProviderCalls: 114,
  maxInputTokens: 5_000_000,
  maxOutputTokens: 250_000,
  maxEstimatedCostMicros: 100_000_000,
  maxConcurrency: 3,
};

interface ReviewFixture {
  workspaceId: string;
  runId: string;
  runRevision: number;
  items: Array<{ id: string; target: string; sourceId: string | null; revision: number }>;
}

function seedWorkspaceAndIntake(label: string): { workspaceId: string; intake: BrandIntakeRevisionRef } {
  const workspaceId = createWorkspace(`${label} ${randomUUID()}`).id;
  workspaces.push(workspaceId);
  const intake: BrandIntakeRevisionRef = {
    intakeRevisionId: `bir_${randomUUID()}`,
    revision: 1,
    fingerprint: FINGERPRINTS[0]!,
  };
  db.prepare(`INSERT INTO brand_intake_revisions (
    id, workspace_id, revision, schema_version, payload_json,
    evidence_resolutions_json, projection_state_json, fingerprint, source,
    submitter_json, mutation_kind, mutation_fingerprint, idempotency_key,
    supersedes_revision_id, created_at
  ) VALUES (?, ?, 1, 1, '{}', '[]',
    '{"preservedCompetitorDomains":[],"intakeOwnedCompetitorDomains":[]}',
    ?, 'admin', '{"actorType":"operator","actorId":"op-test"}',
    'submission', ?, NULL, NULL, ?)`)
    .run(intake.intakeRevisionId, workspaceId, intake.fingerprint, FINGERPRINTS[1], new Date().toISOString());
  return { workspaceId, intake };
}

function preparedItem(
  intake: BrandIntakeRevisionRef,
  target: BrandGenerationPreparedItem['target'],
  artifactExpectation: BrandGenerationTargetInputSnapshot['artifactExpectation'],
): BrandGenerationPreparedItem {
  const core = {
    schemaVersion: 1 as const,
    target,
    intakeRevision: intake,
    voiceSnapshot: target === 'voice_foundation' ? null : finalizedVoice,
    approvedDeliverables: [],
    evidenceRequirementIds: [],
    artifactExpectation,
    capturedAt: '2026-07-14T01:00:00.000Z',
  };
  return { target, inputSnapshot: { ...core, fingerprint: canonicalBrandGenerationFingerprint(core) } };
}

function acceptedInput(
  workspaceId: string,
  intake: BrandIntakeRevisionRef,
  kind: 'suite' | 'foundation',
): AcceptBrandGenerationStartCommandInput {
  const targets = kind === 'foundation'
    ? ['voice_foundation'] as const
    : ['personas', 'customer_journey', 'objection_handling', 'emotional_triggers'] as const;
  const selection = kind === 'foundation'
    ? { kind: 'preset' as const, preset: 'full_brand_system' as const }
    : { kind: 'preset' as const, preset: 'audience' as const };
  const request: StartBrandGenerationRequest = {
    workspaceId,
    intakeRevisionId: intake.intakeRevisionId,
    expectedIntakeRevision: intake.revision,
    expectedIntakeFingerprint: intake.fingerprint,
    selection,
    ...(kind === 'suite' ? {
      expectedVoiceVersion: finalizedVoice.voiceVersion,
      expectedVoiceFingerprint: finalizedVoice.fingerprint,
    } : {}),
    budget,
    idempotencyKey: `review-${kind}-${randomUUID()}`,
    createdBy: { actorType: 'operator', actorId: 'op-test' },
    mcpExecutionContext: null,
  } as StartBrandGenerationRequest;
  const items = targets.map(target => preparedItem(
    intake,
    target,
    target === 'voice_foundation' ? null : { kind: 'create', deliverableId: null, expectedVersion: 0 },
  )) as [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]];
  return {
    request,
    items,
    voiceReadiness: kind === 'foundation'
      ? { state: 'missing', blockingReasons: ['Voice foundation must be finalized'] }
      : { state: 'finalized', snapshot: finalizedVoice, blockingReasons: [] },
    selectionFingerprint: canonicalBrandGenerationFingerprint({
      selection,
      initialTargets: items.map(item => item.target),
    }),
    effectiveInputFingerprint: canonicalBrandGenerationFingerprint(
      items.map(item => item.inputSnapshot.fingerprint),
    ),
    jobId: `job-${randomUUID()}`,
    estimate: {
      providerCalls: kind === 'foundation' ? 6 : 24,
      inputTokens: 100_000,
      outputTokens: 30_000,
      estimatedCostMicros: 2_000_000,
      maxConcurrency: kind === 'foundation' ? 1 : 3,
    },
    dashboardUrl: `/ws/${workspaceId}/brand`,
  };
}

function readyAudit() {
  return {
    verdict: 'ready_for_human_review' as const,
    deterministicChecks: [],
    unresolvedRequirementIds: [],
    modelFindings: [],
    humanRequiredChecks: [],
    revisionCount: 0 as const,
    auditedAt: '2026-07-14T02:00:00.000Z',
  };
}

function foundationDraft() {
  const draft = {
    schemaVersion: 1 as const,
    summary: 'A warm, exact voice that makes complex choices clear.',
    voiceDNA,
    guardrails,
    contextModifiers: [],
    evidenceRequirementIds: [],
  };
  return {
    ...draft,
    fingerprint: createHash('sha256').update(JSON.stringify(draft)).digest('hex'),
  };
}

function stageItemReady(
  workspaceId: string,
  runId: string,
  itemId: string,
  target: string,
): number {
  let item = transitionBrandGenerationItem({
    workspaceId, runId, itemId, expectedRevision: 0, nextStatus: 'preflighting',
  });
  item = transitionBrandGenerationItem({
    workspaceId, runId, itemId, expectedRevision: item.revision, nextStatus: 'generating',
  });
  item = transitionBrandGenerationItem({
    workspaceId, runId, itemId, expectedRevision: item.revision, nextStatus: 'auditing_deterministic',
  });
  item = transitionBrandGenerationItem({
    workspaceId,
    runId,
    itemId,
    expectedRevision: item.revision,
    nextStatus: 'ready_for_human_review',
    patch: target === 'voice_foundation'
      ? { foundationDraft: foundationDraft(), auditReport: readyAudit(), completedAt: new Date().toISOString() }
      : { content: `Grounded ${target} review content.`, auditReport: readyAudit(), completedAt: new Date().toISOString() },
  });
  return item.revision;
}

function seedReviewFixture(kind: 'suite' | 'foundation'): ReviewFixture {
  const { workspaceId, intake } = seedWorkspaceAndIntake(`brand review ${kind}`);
  const accepted = acceptBrandGenerationStartCommand(acceptedInput(workspaceId, intake, kind));
  const running = transitionBrandGenerationRun({
    workspaceId,
    runId: accepted.run.id,
    expectedRevision: accepted.run.revision,
    nextStatus: 'running',
    nextStage: kind === 'foundation' ? 'voice_foundation_generation' : 'dependent_generation',
  });
  const items = accepted.items.map(item => {
    let sourceId: string | null = null;
    if (item.target !== 'voice_foundation') {
      sourceId = `bid_${randomUUID()}`;
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO brand_identity_deliverables (
        id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?)`)
        .run(
          sourceId,
          workspaceId,
          item.target,
          `Grounded ${item.target} review content.`,
          DEFAULT_TIER_MAP[item.target],
          now,
          now,
        );
    }
    const revision = stageItemReady(workspaceId, accepted.run.id, item.id, item.target);
    if (sourceId) {
      db.prepare(`UPDATE brand_generation_items
        SET committed_deliverable_id = ?, committed_deliverable_version = 1
        WHERE id = ? AND workspace_id = ?`)
        .run(sourceId, item.id, workspaceId);
    }
    return { id: item.id, target: item.target, sourceId, revision };
  });
  expect(getPersistedBrandGenerationRun(workspaceId, accepted.run.id)?.revision).toBe(running.revision);
  return { workspaceId, runId: accepted.run.id, runRevision: running.revision, items };
}

function activityCount(workspaceId: string, type: string): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM activity_log WHERE workspace_id = ? AND type = ?')
    .get(workspaceId, type) as { count: number }).count;
}

function persistedReview(fixture: ReviewFixture, deliverableId: string) {
  const deliverable = getClientDeliverable(deliverableId);
  expect(deliverable?.workspaceId).toBe(fixture.workspaceId);
  if (!deliverable) throw new Error('Expected persisted review');
  return deliverable;
}

function clientReviewToken(
  review: ReturnType<typeof persistedReview>,
  deliverableItemId: string,
): string {
  const item = review.items?.find(candidate => candidate.id === deliverableItemId);
  if (!item) throw new Error('Expected review item for client token');
  return brandReviewClientToken(review, item, parseBrandReviewItemPayload(item.itemPayload));
}

async function clientToken(workspaceId: string): Promise<string> {
  const user = await createClientUser(
    `brand-review-${randomUUID()}@test.local`,
    'ClientPass1!',
    'Brand Review Client',
    workspaceId,
    'client_member',
  );
  clientUsers.push({ id: user.id, workspaceId });
  return signClientToken(user);
}

function patchBrandReview(
  workspaceId: string,
  token: string,
  reviewDeliverableId: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/public/deliverables/${workspaceId}/${reviewDeliverableId}/respond`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `client_user_token_${workspaceId}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

const clientReviewer = {
  actorType: 'client' as const,
  actorId: 'client-reviewer',
  actorLabel: 'Client reviewer',
};

const operatorReviewer = {
  actorType: 'operator' as const,
  actorId: 'operator-reviewer',
  actorLabel: 'Operator reviewer',
};

describe('brand deliverable review service', () => {
  it('enforces the safe item receipt, stale CAS, and workspace isolation over real HTTP', async () => {
    const successFixture = seedReviewFixture('foundation');
    const successSent = await createBrandReviewDeliverable(
      successFixture.workspaceId,
      successFixture.runId,
      successFixture.runRevision,
      'voice_foundation',
    );
    const successReview = persistedReview(successFixture, successSent.deliverableId);
    const successItem = successReview.items![0]!;
    const successToken = await clientToken(successFixture.workspaceId);
    const listResponse = await fetch(
      `${baseUrl}/api/public/deliverables/${successFixture.workspaceId}`,
      { headers: { Cookie: `client_user_token_${successFixture.workspaceId}=${successToken}` } },
    );
    expect(listResponse.status).toBe(200);
    const publicList = await listResponse.json() as { deliverables: Array<Record<string, unknown>> };
    const publicReview = publicList.deliverables.find(item => item.id === successReview.id);
    expect(publicReview).toBeDefined();
    expect(publicReview?.payload).toEqual({
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: 'voice_foundation',
    });
    expect(publicReview?.items).toEqual([
      expect.objectContaining({
        id: successItem.id,
        itemPayload: {
          schemaVersion: 1,
          family: 'brand_generation',
          reviewKind: 'voice_foundation',
          target: 'voice_foundation',
          reviewToken: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }),
    ]);
    expect(JSON.stringify(publicReview)).not.toMatch(
      new RegExp(`${successFixture.runId}|runId|runRevision|generationItemRevision|sourceDeliverable|decidedBy|actorId|requirements|provenance`),
    );
    const successResponse = await patchBrandReview(
      successFixture.workspaceId,
      successToken,
      successReview.id,
      {
        deliverableItemId: successItem.id,
        reviewToken: clientReviewToken(successReview, successItem.id),
        decision: 'approve',
      },
    );
    expect(successResponse.status).toBe(200);
    const publicReceipt = await successResponse.json();
    expect(publicReceipt).toEqual({
      reviewDeliverableId: successReview.id,
      deliverableItemId: successItem.id,
      itemStatus: 'approved',
      bundleStatus: 'approved',
    });
    expect(JSON.stringify(publicReceipt)).not.toMatch(
      /runId|runRevision|generationItemRevision|sourceDeliverable|decidedBy|actorId/,
    );

    const staleFixture = seedReviewFixture('foundation');
    const staleSent = await createBrandReviewDeliverable(
      staleFixture.workspaceId,
      staleFixture.runId,
      staleFixture.runRevision,
      'voice_foundation',
    );
    const staleReview = persistedReview(staleFixture, staleSent.deliverableId);
    const staleItem = staleReview.items![0]!;
    const staleReviewToken = clientReviewToken(staleReview, staleItem.id);
    db.prepare(`UPDATE brand_generation_items
      SET revision = revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), staleFixture.items[0]!.id, staleFixture.workspaceId);
    const staleResponse = await patchBrandReview(
      staleFixture.workspaceId,
      await clientToken(staleFixture.workspaceId),
      staleReview.id,
      { deliverableItemId: staleItem.id, reviewToken: staleReviewToken, decision: 'approve' },
    );
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toMatchObject({ code: 'conflict' });
    expect(persistedReview(staleFixture, staleReview.id).items![0]).toMatchObject({
      status: 'awaiting_client',
    });

    const otherFixture = seedReviewFixture('foundation');
    const otherSent = await createBrandReviewDeliverable(
      otherFixture.workspaceId,
      otherFixture.runId,
      otherFixture.runRevision,
      'voice_foundation',
    );
    const isolatedResponse = await patchBrandReview(
      staleFixture.workspaceId,
      await clientToken(staleFixture.workspaceId),
      otherSent.deliverableId,
      { deliverableItemId: 'cross-workspace-item', reviewToken: 'a'.repeat(64), decision: 'approve' },
    );
    expect(isolatedResponse.status).toBe(404);
  }, 30_000);

  it('conflicts on a stale run before send and blocks placeholders before client exposure', async () => {
    const stale = seedReviewFixture('suite');
    await expect(createBrandReviewDeliverable(
      stale.workspaceId,
      stale.runId,
      stale.runRevision + 1,
      'brand_suite',
    )).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM client_deliverable WHERE workspace_id = ?')
      .get(stale.workspaceId)).toEqual({ count: 0 });
    expect(activityCount(stale.workspaceId, 'deliverable_sent')).toBe(0);

    const blocked = seedReviewFixture('suite');
    const first = blocked.items[0]!;
    const requirement = {
      id: 'req-client-fact',
      fieldPath: 'business.location',
      claim: 'Client location',
      reason: 'A location must come from client evidence.',
      requirementStage: 'ready',
      claimKind: 'factual',
      status: 'missing',
      sourceRefs: [],
    };
    db.prepare(`UPDATE brand_generation_items
      SET content = ?, requirements_json = ?, placeholders_json = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(
        'Draft [NEEDS CLIENT INPUT: primary location]',
        JSON.stringify([requirement]),
        JSON.stringify([{
          requirementId: requirement.id,
          token: '[NEEDS CLIENT INPUT: primary location]',
          prompt: 'What is the primary location?',
        }]),
        first.id,
        blocked.workspaceId,
      );
    await expect(createBrandReviewDeliverable(
      blocked.workspaceId,
      blocked.runId,
      blocked.runRevision,
      'brand_suite',
    )).rejects.toMatchObject({ code: 'not_ready', status: 422 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM client_deliverable WHERE workspace_id = ?')
      .get(blocked.workspaceId)).toEqual({ count: 0 });

    const diverged = seedReviewFixture('suite');
    db.prepare(`UPDATE brand_identity_deliverables
      SET content = 'Source bytes changed without a version bump.', updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), diverged.items[0]!.sourceId, diverged.workspaceId);
    await expect(createBrandReviewDeliverable(
      diverged.workspaceId,
      diverged.runId,
      diverged.runRevision,
      'brand_suite',
    )).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM client_deliverable WHERE workspace_id = ?')
      .get(diverged.workspaceId)).toEqual({ count: 0 });
  });

  it('keeps a sent review successful and reconciles its activity without re-notifying', async () => {
    const fixture = seedReviewFixture('foundation');
    db.exec(`CREATE TEMP TRIGGER fail_brand_review_send_activity
      BEFORE INSERT ON activity_log
      WHEN NEW.workspace_id = '${fixture.workspaceId}' AND NEW.type = 'deliverable_sent'
      BEGIN SELECT RAISE(ABORT, 'forced send activity failure'); END`);
    let sent;
    try {
      sent = await createBrandReviewDeliverable(
        fixture.workspaceId,
        fixture.runId,
        fixture.runRevision,
        'voice_foundation',
      );
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_brand_review_send_activity');
    }
    expect(sent).toMatchObject({ status: 'awaiting_client', existing: false });
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(0);
    const sentBroadcastsBeforeRetry = broadcast.mock.calls.filter(
      ([, event]) => event === 'deliverable:sent',
    ).length;

    const replay = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision,
      'voice_foundation',
    );
    expect(replay).toEqual({ ...sent, existing: true });
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(1);
    expect(broadcast.mock.calls.filter(([, event]) => event === 'deliverable:sent')).toHaveLength(
      sentBroadcastsBeforeRetry,
    );
  });

  it('returns the committed review and continues later effects when the send broadcast fails', async () => {
    const fixture = seedReviewFixture('foundation');
    broadcast.mockImplementationOnce(() => {
      throw new Error('forced deliverable broadcast failure');
    });

    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision,
      'voice_foundation',
    );

    expect(sent).toMatchObject({ status: 'awaiting_client', existing: false });
    expect(persistedReview(fixture, sent.deliverableId)).toMatchObject({
      id: sent.deliverableId,
      status: 'awaiting_client',
    });
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(1);
    expect(broadcast.mock.calls.filter(([, event]) => event === 'deliverable:sent')).toHaveLength(1);
    expect(broadcast.mock.calls.some(([, event]) => event === 'activity:new')).toBe(true);

    const replay = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision,
      'voice_foundation',
    );
    expect(replay).toEqual({ ...sent, existing: true });
    expect(broadcast.mock.calls.filter(([, event]) => event === 'deliverable:sent')).toHaveLength(1);
  });

  it('sends through the canonical spine and projects only the client-safe payload', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision,
      'brand_suite',
      { note: 'Please review the system.', source: 'integration-test' },
    );
    expect(sent).toMatchObject({ status: 'awaiting_client', itemCount: 4, existing: false });
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(1);
    const activityBroadcast = broadcast.mock.calls.find(
      ([, event]) => event === 'activity:new',
    );
    const persistedBeforeReplay = persistedReview(fixture, sent.deliverableId);
    broadcast.mockClear();
    const replay = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision,
      'brand_suite',
      { note: 'Please review the system.', source: 'integration-test' },
    );
    expect(replay).toEqual({ ...sent, existing: true });
    expect(persistedReview(fixture, sent.deliverableId).sentAt).toBe(persistedBeforeReplay.sentAt);
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(1);
    expect(broadcast.mock.calls.filter(([, event]) => event === 'deliverable:sent')).toHaveLength(0);
    expect(broadcast.mock.calls.filter(([, event]) => event === 'activity:new')).toHaveLength(1);

    const safe = listClientFacingDeliverables(fixture.workspaceId)
      .find(deliverable => deliverable.id === sent.deliverableId);
    expect(safe?.payload).toEqual({ schemaVersion: 1, family: 'brand_generation', reviewKind: 'brand_suite' });
    expect(safe?.sourceRef).toBeNull();
    expect(safe?.source).toBeNull();
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(fixture.runId);
    expect(serialized).not.toContain('expectedDeliverableVersion');
    expect(serialized).not.toContain('generationItemRevision');
    expect(serialized).not.toContain('client-reviewer');

    const clientActivity = listClientActivity(fixture.workspaceId);
    expect(clientActivity).toHaveLength(1);
    expect(clientActivity[0]?.metadata).toEqual({
      deliverableId: sent.deliverableId,
      reviewKind: 'brand_suite',
      itemCount: 4,
    });
    expect(activityBroadcast).toBeDefined();
    expect(JSON.stringify(activityBroadcast?.[2])).not.toMatch(
      new RegExp(`${fixture.runId}|runRevision|brandGenerationReview`),
    );
  });

  it('applies approve and changes-requested decisions per item with honest partial state', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'brand_suite',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    const first = review.items![0]!;
    const second = review.items![1]!;
    const firstSource = fixture.items.find(item => item.target === first.field)!.sourceId!;
    const secondSource = fixture.items.find(item => item.target === second.field)!.sourceId!;

    const approved = applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      { deliverableItemId: first.id, reviewToken: clientReviewToken(review, first.id), decision: 'approve' },
      clientReviewer,
    );
    expect(approved).toMatchObject({ reviewKind: 'brand_suite', bundleStatus: 'partial' });
    expect(teamNotifications.approved).toHaveBeenCalledTimes(1);
    expect(getBrandDeliverable(fixture.workspaceId, firstSource)?.status).toBe('approved');
    expect(getBrandGenerationItem(
      fixture.workspaceId,
      fixture.runId,
      approved.decision.itemId,
    )).toMatchObject({ status: 'approved', revision: approved.generationItemRevision });

    const changes = applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      {
        deliverableItemId: second.id,
        reviewToken: clientReviewToken(review, second.id),
        decision: 'changes_requested',
        note: 'Make this more specific.',
      },
      clientReviewer,
    );
    expect(changes).toMatchObject({ bundleStatus: 'partial' });
    expect(teamNotifications.changesRequested).toHaveBeenCalledTimes(1);
    expect(changes.decision).toMatchObject({
      decision: 'changes_requested',
      note: 'Make this more specific.',
    });
    expect(getBrandDeliverable(fixture.workspaceId, secondSource)?.status).toBe('draft');
    expect(getBrandGenerationItem(
      fixture.workspaceId,
      fixture.runId,
      changes.decision.itemId,
    )).toMatchObject({ status: 'changes_requested' });
    expect(getPersistedBrandGenerationRun(fixture.workspaceId, fixture.runId)?.counts)
      .toMatchObject({ approved: 1, changesRequested: 1, readyForHumanReview: 2 });
    expect(persistedReview(fixture, review.id)).toMatchObject({ status: 'partial' });
    expect(activityCount(fixture.workspaceId, 'deliverable_responded')).toBe(2);
    const clientActivityJson = JSON.stringify(listClientActivity(fixture.workspaceId));
    expect(clientActivityJson).not.toContain(fixture.runId);
    expect(clientActivityJson).not.toContain(approved.decision.itemId);
    expect(clientActivityJson).not.toContain(changes.decision.itemId);
    expect(clientActivityJson).not.toContain('brandGenerationReview');
    expect(clientActivityJson).not.toContain(clientReviewer.actorId);
    expect(clientActivityJson).not.toContain(clientReviewer.actorLabel);
    const responseActivityBroadcasts = broadcast.mock.calls
      .filter(([, event, payload]) => (
        event === 'activity:new'
        && typeof payload === 'object'
        && payload != null
        && 'type' in payload
        && payload.type === 'deliverable_responded'
      ));
    expect(responseActivityBroadcasts).toHaveLength(2);
    for (const [, , payload] of responseActivityBroadcasts) {
      expect(payload).not.toHaveProperty('actorId');
      expect(payload).not.toHaveProperty('actorName');
      expect(JSON.stringify(payload)).not.toContain(clientReviewer.actorId);
    }

    const replay = applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      {
        deliverableItemId: second.id,
        reviewToken: clientReviewToken(review, second.id),
        decision: 'changes_requested',
        note: 'Make this more specific.',
      },
      clientReviewer,
    );
    expect(replay).toEqual(changes);
    expect(activityCount(fixture.workspaceId, 'deliverable_responded')).toBe(2);
    expect(teamNotifications.approved).toHaveBeenCalledTimes(1);
    expect(teamNotifications.changesRequested).toHaveBeenCalledTimes(1);
    expect(() => applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      { deliverableItemId: second.id, reviewToken: clientReviewToken(review, second.id), decision: 'approve' },
      clientReviewer,
    )).toThrow(BrandReviewServiceError);
  });

  it('marks the bundle approved only after every durable item is approved', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'brand_suite',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    let finalStatus = '';
    for (const [index, item] of review.items!.entries()) {
      const receipt = applyBrandReviewDecision(
        fixture.workspaceId,
        review.id,
        { deliverableItemId: item.id, reviewToken: clientReviewToken(review, item.id), decision: 'approve' },
        clientReviewer,
      );
      finalStatus = receipt.bundleStatus;
      expect(receipt.bundleStatus).toBe(index === review.items!.length - 1 ? 'approved' : 'partial');
    }
    expect(finalStatus).toBe('approved');
    expect(persistedReview(fixture, review.id).status).toBe('approved');
    expect(getPersistedBrandGenerationRun(fixture.workspaceId, fixture.runId)?.counts)
      .toMatchObject({ approved: 4, readyForHumanReview: 0 });
  });

  it('rolls back source, generation counts, and mirror when the final mirror write fails', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'brand_suite',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    const item = review.items![0]!;
    const sourceId = fixture.items.find(source => source.target === item.field)!.sourceId!;
    const generationBefore = getBrandGenerationItem(
      fixture.workspaceId,
      fixture.runId,
      fixture.items.find(source => source.target === item.field)!.id,
    )!;
    db.exec(`CREATE TEMP TRIGGER fail_brand_review_item_write
      BEFORE INSERT ON client_deliverable_item
      WHEN NEW.deliverable_id = '${review.id}'
      BEGIN SELECT RAISE(ABORT, 'forced mirror failure'); END`);
    try {
      expect(() => applyBrandReviewDecision(
        fixture.workspaceId,
        review.id,
        { deliverableItemId: item.id, reviewToken: clientReviewToken(review, item.id), decision: 'approve' },
        clientReviewer,
      )).toThrow(/forced mirror failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_brand_review_item_write');
    }
    expect(getBrandDeliverable(fixture.workspaceId, sourceId)?.status).toBe('draft');
    expect(getBrandGenerationItem(
      fixture.workspaceId,
      fixture.runId,
      generationBefore.id,
    )).toMatchObject({ status: 'ready_for_human_review', revision: generationBefore.revision });
    expect(getPersistedBrandGenerationRun(fixture.workspaceId, fixture.runId)?.counts)
      .toMatchObject({ approved: 0, readyForHumanReview: 4 });
    expect(persistedReview(fixture, review.id)).toMatchObject({ status: 'awaiting_client' });
    expect(activityCount(fixture.workspaceId, 'deliverable_responded')).toBe(0);
  });

  it('rejects mirror/source byte divergence without transitioning any authority row', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'brand_suite',
    );
    const originalReview = persistedReview(fixture, sent.deliverableId);
    const originalItem = originalReview.items![0]!;
    const generation = fixture.items.find(item => item.target === originalItem.field)!;
    const sourceBefore = getBrandDeliverable(fixture.workspaceId, generation.sourceId!)!;
    const generationBefore = getBrandGenerationItem(
      fixture.workspaceId,
      fixture.runId,
      generation.id,
    )!;
    db.prepare(`UPDATE client_deliverable_item
      SET proposed_value = 'Mirror-only tampered content.'
      WHERE id = ? AND deliverable_id = ?`)
      .run(originalItem.id, originalReview.id);
    const divergedReview = persistedReview(fixture, originalReview.id);

    expect(() => applyBrandReviewDecision(
      fixture.workspaceId,
      divergedReview.id,
      {
        deliverableItemId: originalItem.id,
        reviewToken: clientReviewToken(divergedReview, originalItem.id),
        decision: 'approve',
      },
      clientReviewer,
    )).toThrowError(expect.objectContaining({ code: 'conflict', status: 409 }));

    expect(getBrandDeliverable(fixture.workspaceId, generation.sourceId!)).toMatchObject({
      status: sourceBefore.status,
      version: sourceBefore.version,
      content: sourceBefore.content,
    });
    expect(getBrandGenerationItem(fixture.workspaceId, fixture.runId, generation.id)).toMatchObject({
      status: generationBefore.status,
      revision: generationBefore.revision,
    });
    expect(persistedReview(fixture, originalReview.id).items
      ?.find(item => item.id === originalItem.id)).toMatchObject({ status: 'awaiting_client' });
    expect(activityCount(fixture.workspaceId, 'deliverable_responded')).toBe(0);
  });

  it('keeps a committed decision successful and runs later effects when activity logging fails', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'brand_suite',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    const item = review.items![0]!;
    const sourceId = fixture.items.find(source => source.target === item.field)!.sourceId!;
    const request = {
      deliverableItemId: item.id,
      reviewToken: clientReviewToken(review, item.id),
      decision: 'approve' as const,
    };
    broadcast.mockClear();
    db.exec(`CREATE TEMP TRIGGER fail_brand_review_activity
      BEFORE INSERT ON activity_log
      WHEN NEW.workspace_id = '${fixture.workspaceId}' AND NEW.type = 'deliverable_responded'
      BEGIN SELECT RAISE(ABORT, 'forced activity failure'); END`);
    let receipt;
    try {
      receipt = applyBrandReviewDecision(
        fixture.workspaceId,
        review.id,
        request,
        clientReviewer,
      );
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_brand_review_activity');
    }

    expect(receipt).toMatchObject({ bundleStatus: 'partial' });
    expect(getBrandDeliverable(fixture.workspaceId, sourceId)?.status).toBe('approved');
    expect(activityCount(fixture.workspaceId, 'deliverable_responded')).toBe(0);
    expect(broadcast.mock.calls.some(([, event]) => event === 'deliverable:updated')).toBe(true);
    expect(broadcast.mock.calls.some(([, event]) => event === 'brand-identity:updated')).toBe(true);
    expect(broadcast.mock.calls.find(([, event]) => event === 'brand-identity:updated')?.[2]).toEqual({});
    expect(teamNotifications.approved).toHaveBeenCalledTimes(1);

    const replay = applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      request,
      clientReviewer,
    );
    expect(replay).toEqual(receipt);
    expect(activityCount(fixture.workspaceId, 'deliverable_responded')).toBe(1);
    expect(teamNotifications.approved).toHaveBeenCalledTimes(1);
  });

  it('records foundation feedback without mutating B2 or creating voice authority', async () => {
    const fixture = seedReviewFixture('foundation');
    const sourceItem = fixture.items[0]!;
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'voice_foundation',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    const before = getBrandGenerationItem(fixture.workspaceId, fixture.runId, sourceItem.id)!;
    const receipt = applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      {
        deliverableItemId: review.items![0]!.id,
        reviewToken: clientReviewToken(review, review.items![0]!.id),
        decision: 'approve',
        note: 'This direction fits.',
      },
      operatorReviewer,
    );
    expect(receipt).toMatchObject({
      reviewKind: 'voice_foundation',
      bundleStatus: 'approved',
      generationItemRevision: before.revision,
      sourceDeliverableVersion: null,
    });
    expect(getBrandGenerationItem(fixture.workspaceId, fixture.runId, sourceItem.id))
      .toMatchObject({ status: 'ready_for_human_review', revision: before.revision });
    expect(db.prepare('SELECT COUNT(*) AS count FROM brand_identity_deliverables WHERE workspace_id = ?')
      .get(fixture.workspaceId)).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM voice_profiles WHERE workspace_id = ?')
      .get(fixture.workspaceId)).toEqual({ count: 0 });
    expect(teamNotifications.approved).toHaveBeenCalledWith(expect.objectContaining({
      actionSummary: 'Operator reviewed the advisory voice foundation.',
    }));
  });

  it('reports the persisted review revision on a terminal replay after the run advances', async () => {
    const fixture = seedReviewFixture('foundation');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'voice_foundation',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    const item = review.items![0]!;
    applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      {
        deliverableItemId: item.id,
        reviewToken: clientReviewToken(review, item.id),
        decision: 'approve',
      },
      clientReviewer,
    );
    db.prepare(`UPDATE brand_generation_runs
      SET revision = revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), fixture.runId, fixture.workspaceId);

    const replay = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision + 1,
      'voice_foundation',
    );
    expect(replay).toMatchObject({
      deliverableId: sent.deliverableId,
      runRevision: fixture.runRevision,
      status: 'approved',
      existing: true,
    });
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(1);
  });

  it('preserves approved siblings and child chronology when a same-run revision is resent', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision,
      'brand_suite',
      { note: 'Keep the approved direction while revising the next piece.' },
    );
    const firstReview = persistedReview(fixture, sent.deliverableId);
    const approvedChild = firstReview.items![0]!;
    const revisedChild = firstReview.items![1]!;
    const staleRevisedChildToken = clientReviewToken(firstReview, revisedChild.id);
    applyBrandReviewDecision(
      fixture.workspaceId,
      firstReview.id,
      {
        deliverableItemId: approvedChild.id,
        reviewToken: clientReviewToken(firstReview, approvedChild.id),
        decision: 'approve',
      },
      clientReviewer,
    );
    const approvedAfterDecision = persistedReview(fixture, firstReview.id).items![0]!;
    const revisedSource = fixture.items.find(item => item.target === revisedChild.field)!;
    db.prepare(`UPDATE brand_identity_deliverables
      SET content = 'Revised grounded content.', version = 2, updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), revisedSource.sourceId, fixture.workspaceId);
    db.prepare(`UPDATE brand_generation_items
      SET content = 'Revised grounded content.', revision = revision + 1,
          committed_deliverable_version = 2, updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), revisedSource.id, fixture.workspaceId);
    db.prepare(`UPDATE brand_generation_runs
      SET revision = revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), fixture.runId, fixture.workspaceId);
    const nextRunRevision = fixture.runRevision + 1;

    const resent = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      nextRunRevision,
      'brand_suite',
    );
    expect(resent).toMatchObject({ deliverableId: firstReview.id, status: 'partial', existing: true });
    const after = persistedReview(fixture, firstReview.id);
    const approvedPreserved = after.items!.find(item => item.id === approvedChild.id)!;
    const revisedPreserved = after.items!.find(item => item.id === revisedChild.id)!;
    expect(approvedPreserved).toMatchObject({
      id: approvedChild.id,
      createdAt: approvedAfterDecision.createdAt,
      status: 'approved',
    });
    expect(approvedPreserved.itemPayload).toMatchObject({ decision: { decision: 'approve' } });
    expect(revisedPreserved).toMatchObject({
      id: revisedChild.id,
      createdAt: revisedChild.createdAt,
      status: 'awaiting_client',
      proposedValue: 'Revised grounded content.',
    });
    expect(revisedPreserved.itemPayload).toMatchObject({
      generationItemRevision: revisedSource.revision + 1,
      expectedDeliverableVersion: 2,
      decision: null,
    });
    expect(clientReviewToken(after, revisedChild.id)).not.toBe(staleRevisedChildToken);
    expect(after.note).toBe('Keep the approved direction while revising the next piece.');
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(2);

    const resentReplay = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      nextRunRevision,
      'brand_suite',
    );
    expect(resentReplay).toEqual({ ...resent, existing: true });
    expect(activityCount(fixture.workspaceId, 'deliverable_sent')).toBe(2);

    expect(() => applyBrandReviewDecision(
      fixture.workspaceId,
      firstReview.id,
      {
        deliverableItemId: revisedChild.id,
        reviewToken: staleRevisedChildToken,
        decision: 'approve',
      },
      clientReviewer,
    )).toThrowError(expect.objectContaining({ code: 'conflict', status: 409 }));
    expect(getBrandDeliverable(fixture.workspaceId, revisedSource.sourceId!)?.status).toBe('draft');
    expect(getBrandGenerationItem(fixture.workspaceId, fixture.runId, revisedSource.id))
      .toMatchObject({ status: 'ready_for_human_review', revision: revisedSource.revision + 1 });
    expect(persistedReview(fixture, firstReview.id).items
      ?.find(item => item.id === revisedChild.id)).toMatchObject({ status: 'awaiting_client' });
  });

  it('returns a partial bundle to awaiting review when its only terminal child is revised', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'brand_suite',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    const changedChild = review.items![0]!;
    const changedSource = fixture.items.find(item => item.target === changedChild.field)!;
    const changes = applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      {
        deliverableItemId: changedChild.id,
        reviewToken: clientReviewToken(review, changedChild.id),
        decision: 'changes_requested',
        note: 'Make this more specific.',
      },
      clientReviewer,
    );
    expect(changes.bundleStatus).toBe('partial');

    let revised = transitionBrandGenerationItem({
      workspaceId: fixture.workspaceId,
      runId: fixture.runId,
      itemId: changedSource.id,
      expectedRevision: changes.generationItemRevision,
      nextStatus: 'revising',
    });
    revised = transitionBrandGenerationItem({
      workspaceId: fixture.workspaceId,
      runId: fixture.runId,
      itemId: changedSource.id,
      expectedRevision: revised.revision,
      nextStatus: 'ready_for_human_review',
      patch: {
        content: 'Revised but still grounded content.',
        auditReport: readyAudit(),
        completedAt: new Date().toISOString(),
      },
    });
    db.prepare(`UPDATE brand_identity_deliverables
      SET content = ?, version = 2, updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run('Revised but still grounded content.', new Date().toISOString(), changedSource.sourceId, fixture.workspaceId);
    db.prepare(`UPDATE brand_generation_items
      SET committed_deliverable_version = 2
      WHERE id = ? AND workspace_id = ?`)
      .run(changedSource.id, fixture.workspaceId);
    db.prepare(`UPDATE brand_generation_runs
      SET revision = revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), fixture.runId, fixture.workspaceId);

    const resent = await createBrandReviewDeliverable(
      fixture.workspaceId,
      fixture.runId,
      fixture.runRevision + 1,
      'brand_suite',
      { note: 'The requested revision is ready.' },
    );
    expect(resent).toMatchObject({ deliverableId: review.id, status: 'awaiting_client', existing: true });
    const awaitingItems = persistedReview(fixture, review.id).items ?? [];
    expect(awaitingItems.length > 0 && awaitingItems.every(item => item.status === 'awaiting_client'))
      .toBe(true);
  });

  it('rejects stale source authority and fails closed on corrupt private review payloads', async () => {
    const fixture = seedReviewFixture('suite');
    const sent = await createBrandReviewDeliverable(
      fixture.workspaceId, fixture.runId, fixture.runRevision, 'brand_suite',
    );
    const review = persistedReview(fixture, sent.deliverableId);
    const child = review.items![0]!;
    const source = fixture.items.find(item => item.target === child.field)!;
    db.prepare(`UPDATE brand_identity_deliverables
      SET version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(new Date().toISOString(), source.sourceId, fixture.workspaceId);
    expect(() => applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      { deliverableItemId: child.id, reviewToken: clientReviewToken(review, child.id), decision: 'approve' },
      clientReviewer,
    )).toThrow(BrandReviewServiceError);
    expect(getBrandGenerationItem(fixture.workspaceId, fixture.runId, source.id))
      .toMatchObject({ status: 'ready_for_human_review', revision: source.revision });
    expect(persistedReview(fixture, review.id).items![0]).toMatchObject({ status: 'awaiting_client' });

    db.prepare(`UPDATE client_deliverable_item
      SET item_payload = '{"schemaVersion":999}' WHERE id = ?`)
      .run(review.items![1]!.id);
    expect(() => listClientFacingDeliverables(fixture.workspaceId)).toThrow();
    expect(() => applyBrandReviewDecision(
      fixture.workspaceId,
      review.id,
      {
        deliverableItemId: review.items![1]!.id,
        reviewToken: clientReviewToken(review, review.items![1]!.id),
        decision: 'approve',
      },
      clientReviewer,
    )).toThrowError(expect.objectContaining({ code: 'corrupt_review', status: 500 }));
  });
});
