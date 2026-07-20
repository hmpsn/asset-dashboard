import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { callCreativeAI } from './content-posts-ai.js';
import { buildIntelPrompt } from './workspace-intelligence.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { createLogger } from './logger.js';
import { randomUUID } from 'crypto';
import { addVoiceSample, getVoiceProfile, buildVoiceCalibrationContext } from './voice-calibration.js';
import { listBrandscripts } from './brandscript.js';
import { listExtractions } from './discovery-ingestion.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { BRAND_DELIVERABLE_TRANSITIONS, validateTransition } from './state-machines.js';
import type {
  BrandDeliverable, BrandDeliverableType, DeliverableTier,
  ReleasedBrandDeliverableType,
  VoiceSampleContext,
} from '../shared/types/brand-engine.js';
import {
  DEFAULT_TIER_MAP,
  isReleasedBrandDeliverableType,
} from '../shared/types/brand-engine.js';
import { rowToDeliverable, listDeliverables, getDeliverable, type DeliverableRow } from './brand-deliverable-read-model.js';
import { isProgrammingError } from './errors.js';

export { listDeliverables, getDeliverable };

const log = createLogger('brand-identity');

const stmts = createStmtCache(() => ({
  getById: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE id = ? AND workspace_id = ?`),
  getByType: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? AND deliverable_type = ? ORDER BY updated_at DESC LIMIT 1`),
  insert: db.prepare(`INSERT INTO brand_identity_deliverables (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at) VALUES (@id, @workspace_id, @deliverable_type, @content, @status, @version, @tier, @created_at, @updated_at)`),
  updateContent: db.prepare(`UPDATE brand_identity_deliverables SET content = @content, status = @status, version = @version, tier = @tier, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`), // status-ok: content-edit always resets to 'draft' (a content-reset side-effect, not a lifecycle transition); the guarded lifecycle write is setDeliverableStatus()
  updateContentIfVersion: db.prepare(`UPDATE brand_identity_deliverables SET content = @content, status = @status, version = @version, tier = @tier, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id AND version = @expected_version`), // status-ok: content-edit always resets to 'draft'; expected_version is the atomic optimistic-concurrency guard
  updateStatusIfVersionAndStatus: db.prepare(`UPDATE brand_identity_deliverables SET status = @status, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id AND version = @expected_version AND status = @expected_status`), // status-ok: BRAND_DELIVERABLE_TRANSITIONS guard runs in setDeliverableStatusCasInTransaction() before this CAS write
  insertVersion: db.prepare(`INSERT INTO brand_identity_versions (id, deliverable_id, content, steering_notes, version, created_at) VALUES (@id, @deliverable_id, @content, @steering_notes, @version, @created_at)`),
}));

/**
 * A caller attempted to update a deliverable from a stale durable version.
 *
 * Keep this domain error transport-neutral: HTTP/MCP adapters decide how to
 * project the conflict while the write path carries the exact expected and
 * actual versions needed for a safe re-read/retry.
 */
export class BrandDeliverableVersionConflictError extends Error {
  readonly code = 'conflict' as const;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(
    expectedVersion: number,
    actualVersion: number,
  ) {
    super(`Brand deliverable version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = 'BrandDeliverableVersionConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class BrandDeliverableStatusConflictError extends Error {
  readonly code = 'conflict' as const;
  readonly expectedStatus: BrandDeliverable['status'];
  readonly actualStatus: BrandDeliverable['status'];

  constructor(
    expectedStatus: BrandDeliverable['status'],
    actualStatus: BrandDeliverable['status'],
  ) {
    super(`Brand deliverable status conflict: expected ${expectedStatus}, actual ${actualStatus}`);
    this.name = 'BrandDeliverableStatusConflictError';
    this.expectedStatus = expectedStatus;
    this.actualStatus = actualStatus;
  }
}

export class BrandDeliverableAlreadyExistsError extends Error {
  readonly code = 'conflict' as const;
  readonly existing: BrandDeliverable;

  constructor(existing: BrandDeliverable) {
    super(`A ${existing.deliverableType} brand deliverable already exists in this workspace`);
    this.name = 'BrandDeliverableAlreadyExistsError';
    this.existing = existing;
  }
}

function buildBrandContext(workspaceId: string): string {
  const parts: string[] = [];

  // Brandscript context
  try {
    const scripts = listBrandscripts(workspaceId);
    if (scripts.length > 0) {
      const bs = scripts[0];
      const filled = bs.sections.filter(s => s.content?.trim());
      if (filled.length > 0) {
        parts.push(`BRANDSCRIPT (${bs.frameworkType}):\n${filled.map(s => `${s.title}: ${s.content}`).join('\n')}`);
      }
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'brand-identity/buildBrandContext: programming error'); /* brandscript not yet available */ }

  // Voice profile context — use buildVoiceCalibrationContext so DNA/guardrails are
  // only injected here when profile.status !== 'calibrated'. When calibrated,
  // buildSystemPrompt() (Layer 2) already injects them via prompt-assembly.ts;
  // duplicating them wastes tokens and over-weights voice constraints.
  //
  // IMPORTANT: samplesText is DELIBERATELY dropped here — `buildIntelPrompt(['seoContext'])`
  // in `generateDeliverable` (below) already emits a VOICE SAMPLES block via
  // the SEO context intelligence source, which runs for every status including
  // calibrated. Pushing samplesText a second time would duplicate every sample in the
  // prompt, burning tokens and over-weighting the sample distribution. See PR #168
  // scaled-review finding I4.
  try {
    const profile = getVoiceProfile(workspaceId);
    if (profile) {
      const { dnaText, guardrailsText } = buildVoiceCalibrationContext(profile);
      if (dnaText) parts.push(dnaText.trim());
      if (guardrailsText) parts.push(guardrailsText.trim());
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'brand-identity: programming error'); /* voice profile not yet available */ }

  // Discovery extractions
  try {
    const extractions = listExtractions(workspaceId).filter(e => e.status === 'accepted');
    if (extractions.length > 0) {
      const storyElements = extractions.filter(e => e.extractionType === 'story_element').slice(0, 5);
      if (storyElements.length > 0) {
        parts.push(`STORY ELEMENTS:\n${storyElements.map(e => `${e.category}: ${e.content}`).join('\n')}`);
      }
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'brand-identity: programming error'); /* extractions not yet available */ }

  return parts.join('\n\n');
}

export function getDeliverableInstructions(type: BrandDeliverableType): string {
  const instructions: Record<BrandDeliverableType, string> = {
    mission: 'Write a mission statement: 1-2 sentences explaining why this business exists. Start with an action verb. Specific to this business.',
    vision: 'Write a vision statement: 1-2 sentences describing where this business is headed in 5-10 years. Aspirational but grounded.',
    values: 'Write 3-5 core values. For each: value name (2-3 words), one sentence description that shows it in action. Format as a numbered list.',
    tagline: 'Write 3 tagline options. Each under 8 words, memorable, captures the brand positioning. List all 3.',
    elevator_pitch: 'Write three elevator pitches: 30 seconds (~75 words), 60 seconds (~150 words), 90 seconds (~225 words). Use the brandscript structure.',
    archetypes: 'Identify the primary and secondary brand archetype (Hero, Sage, Explorer, Rebel, Lover, Creator, Caregiver, Jester, Everyman, Ruler, Magician, Innocent). Explain why each fits this brand in 2-3 sentences.',
    personality_traits: 'Write 5-7 personality traits using "this, not that" framing. Example: "Direct, not blunt. Warm, not gushing." One per line.',
    voice_guidelines: 'Write brand voice guidelines covering: tone description, what the brand sounds like, what it never sounds like, 3 do examples, 3 don\'t examples.',
    messaging_pillars: 'Identify 3-4 core messaging pillars — the themes all copy should reinforce. For each: pillar name, 1-sentence description, why it matters to the audience.',
    differentiators: 'Write 3-5 key differentiators as copy-ready statements (not bullet points). Each should be a sentence the brand can actually say.',
    brand_story: 'Write the full brand story in narrative form using the brandscript structure. 300-500 words, in the calibrated voice. This is the hero\'s journey of the customer.',
    positioning_matrix: 'Describe where this brand sits vs. the competitive landscape on 3 key dimensions. Format as: Dimension, This Brand\'s Position, Typical Competitor Position.',
    personas: 'Describe 2-3 audience personas. For each: name, demographics, primary desire, biggest fear, how they make decisions, what they need to hear from this brand.',
    customer_journey: 'Map the customer journey: Awareness (how they find us), Consideration (what they evaluate), Decision (what converts them). Include recommended messaging at each stage.',
    objection_handling: 'List the top 5 objections prospects raise and on-brand responses to each. Keep responses conversational, not defensive.',
    emotional_triggers: 'Identify the primary emotional triggers for each persona: what motivates them to act, what fears hold them back, what outcomes they truly want.',
    tone_examples: 'Write tone of voice examples: 3 "do this" examples and 3 "not this" examples for each of these contexts: headlines, body copy, CTAs.',
    naming: 'Develop 3-5 brand name directions as creative proposals grounded only in verified business facts, approved positioning, audience evidence, and the finalized voice. For each, provide the candidate, a concise rationale, and any evidence gap as [NEEDS CLIENT INPUT: ...]. Do not invent availability. Do not claim or imply trademark, domain, legal, cultural, or linguistic clearance; those require separate verified review.',
  };
  return instructions[type] || `Write a ${type.replace(/_/g, ' ')} for this brand. Be specific, not generic.`;
}

export async function generateDeliverable(
  workspaceId: string,
  deliverableType: ReleasedBrandDeliverableType,
): Promise<BrandDeliverable> {
  // Runtime defense for untyped/JavaScript callers. The MCP-owned `naming`
  // target must not leak into this legacy paid path before B2 owns its gates.
  if (!isReleasedBrandDeliverableType(deliverableType)) {
    throw new Error(`Unsupported legacy brand deliverable type: ${deliverableType}`);
  }
  const fullContext = await buildIntelPrompt(workspaceId, ['seoContext']);
  const brandContext = buildBrandContext(workspaceId);
  const instructions = getDeliverableInstructions(deliverableType);

  const userPrompt = `${instructions}

BUSINESS CONTEXT:
${fullContext}

${brandContext ? `BRAND CONTEXT:\n${brandContext}` : ''}

Write in the brand's calibrated voice. Be specific to this business. Do not write generic placeholder content.`;

  const system = buildSystemPrompt(workspaceId, `You are a senior brand strategist writing a ${deliverableType.replace(/_/g, ' ')} deliverable. Write in the brand's voice. Return only the deliverable content — no preamble, no "here's your X:" framing.`);

  log.info({ workspaceId, deliverableType }, 'generating brand identity deliverable');

  const content = (await callCreativeAI({
    systemPrompt: system,
    userPrompt,
    maxTokens: 2000,
    feature: 'brand-identity-generate',
    workspaceId,
  })).trim();
  const tier = DEFAULT_TIER_MAP[deliverableType] || 'professional';
  const now = new Date().toISOString();

  // Concurrent-safe upsert: re-read the existing row INSIDE the transaction so
  // two parallel generateDeliverable() calls for the same (workspaceId, type)
  // can't both observe "no existing row" at check time and both INSERT. The
  // AI call above is ~5s long — plenty of time for a racing request to land in
  // that window. Migration 056 adds a UNIQUE index on (workspace_id, deliverable_type)
  // that would hard-fail the second INSERT anyway; this transaction takes a
  // write lock on the row-to-be so the loser retries as an update cleanly.
  //
  // If the UNIQUE index fires despite the in-transaction re-read (e.g. migration
  // not yet applied on a legacy DB), we catch the SQLITE_CONSTRAINT_UNIQUE error
  // and retry once via the update path — the committed row is guaranteed visible
  // after the failed INSERT returns.
  const upsert = db.transaction((): BrandDeliverable => {
    const existing = stmts().getByType.get(workspaceId, deliverableType) as DeliverableRow | undefined;
    if (existing) {
      const newVersion = existing.version + 1;
      stmts().insertVersion.run({
        id: `biv_${randomUUID().slice(0, 8)}`,
        deliverable_id: existing.id, content: existing.content,
        steering_notes: null, version: existing.version, created_at: now,
      });
      stmts().updateContent.run({ id: existing.id, workspace_id: workspaceId, content, status: 'draft', version: newVersion, tier, updated_at: now });
      // Use fresh `tier` from DEFAULT_TIER_MAP — map values may have shifted since the row was created.
      return { ...rowToDeliverable(existing), content, status: 'draft', version: newVersion, tier, updatedAt: now };
    }

    const id = `bid_${randomUUID().slice(0, 8)}`;
    stmts().insert.run({ id, workspace_id: workspaceId, deliverable_type: deliverableType, content, status: 'draft', version: 1, tier, created_at: now, updated_at: now });
    return { id, workspaceId, deliverableType, content, status: 'draft', version: 1, tier, createdAt: now, updatedAt: now };
  });

  try {
    return upsert.immediate();
  } catch (err) {
    // SQLITE_CONSTRAINT_UNIQUE — another request inserted between our existence
    // check and our INSERT. Re-read the winner and apply our generated content
    // as an update so the user still gets the fresh AI output they waited for.
    const code = (err as { code?: string } | null)?.code;
    if (code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
    log.warn({ workspaceId, deliverableType }, 'brand identity UNIQUE race — retrying as update');
    const retryAsUpdate = db.transaction((): BrandDeliverable => {
      const winner = stmts().getByType.get(workspaceId, deliverableType) as DeliverableRow | undefined;
      if (!winner) throw new Error(`UNIQUE violation on brand_identity_deliverables but no row found for ${workspaceId}/${deliverableType}`);
      const retryNow = new Date().toISOString();
      const newVersion = winner.version + 1;
      stmts().insertVersion.run({
        id: `biv_${randomUUID().slice(0, 8)}`,
        deliverable_id: winner.id, content: winner.content,
        steering_notes: null, version: winner.version, created_at: retryNow,
      });
      stmts().updateContent.run({ id: winner.id, workspace_id: workspaceId, content, status: 'draft', version: newVersion, tier, updated_at: retryNow });
      return { ...rowToDeliverable(winner), content, status: 'draft', version: newVersion, tier, updatedAt: retryNow };
    });
    return retryAsUpdate.immediate();
  }
}

/**
 * Create operator-authored brand identity without invoking generation.
 *
 * The row deliberately starts in `draft`; only the existing human approval
 * mutation may move it to `approved`. The workspace/type unique constraint is
 * treated as an explicit conflict so this path can never overwrite prior work.
 */
export function createOperatorAuthoredDeliverable(
  workspaceId: string,
  deliverableType: BrandDeliverableType,
  content: string,
): BrandDeliverable {
  const create = db.transaction((): BrandDeliverable => {
    const existing = stmts().getByType.get(
      workspaceId,
      deliverableType,
    ) as DeliverableRow | undefined;
    if (existing) {
      throw new BrandDeliverableAlreadyExistsError(rowToDeliverable(existing));
    }

    const id = `bid_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const tier = DEFAULT_TIER_MAP[deliverableType];
    stmts().insert.run({
      id,
      workspace_id: workspaceId,
      deliverable_type: deliverableType,
      content,
      status: 'draft',
      version: 1,
      tier,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      workspaceId,
      deliverableType,
      content,
      status: 'draft',
      version: 1,
      tier,
      createdAt: now,
      updatedAt: now,
    };
  });

  return create.immediate();
}

export async function refineDeliverable(workspaceId: string, id: string, direction: string): Promise<BrandDeliverable | null> {
  // Initial read (outside transaction) is only used to feed the AI call with
  // the current content. The authoritative read that drives version numbering
  // and the content snapshot happens *inside* the transaction below, to close
  // the stale-read race where a concurrent generate/refine could bump the
  // version between the AI call and our write.
  const preload = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
  if (!preload) return null;
  if (!isReleasedBrandDeliverableType(preload.deliverable_type)) {
    throw new Error(`Unsupported legacy brand deliverable type: ${preload.deliverable_type}`);
  }

  const userPrompt = `Refine this ${preload.deliverable_type.replace(/_/g, ' ')} based on the direction given.

CURRENT VERSION:
${preload.content}

REFINEMENT DIRECTION:
${direction}

Return only the refined content — no preamble.`;

  const system = buildSystemPrompt(workspaceId, `You are a brand strategist refining a deliverable based on feedback. Make the requested changes while preserving what's working.`);

  const content = (await callCreativeAI({
    systemPrompt: system,
    userPrompt,
    maxTokens: 2000,
    feature: 'brand-identity-refine',
    workspaceId,
  })).trim();

  // Re-read existing inside the transaction so the version snapshot and
  // newVersion computation reflect any concurrent writes during the AI call.
  const doRefine = db.transaction((): BrandDeliverable | null => {
    const existing = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
    if (!existing) return null;
    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    stmts().insertVersion.run({
      id: `biv_${randomUUID().slice(0, 8)}`,
      deliverable_id: id, content: existing.content,
      steering_notes: direction, version: existing.version, created_at: now,
    });
    stmts().updateContent.run({ id, workspace_id: workspaceId, content, status: 'draft', version: newVersion, tier: existing.tier, updated_at: now });
    return { ...rowToDeliverable(existing), content, status: 'draft', version: newVersion, updatedAt: now };
  });
  return doRefine.immediate();
}

export function updateDeliverableContent(
  workspaceId: string,
  id: string,
  content: string,
  expectedVersion?: number,
): BrandDeliverable | null {
  const doUpdate = db.transaction((): BrandDeliverable | null => {
    const existing = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
    if (!existing) return null;

    // The authoritative version check belongs inside the same IMMEDIATE
    // transaction as the snapshot + write. An adapter-level pre-read cannot
    // protect against an operator edit landing between that read and this
    // mutation.
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new BrandDeliverableVersionConflictError(expectedVersion, existing.version);
    }

    if (existing.content === content) {
      return rowToDeliverable(existing);
    }

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    stmts().insertVersion.run({
      id: `biv_${randomUUID().slice(0, 8)}`,
      deliverable_id: id,
      content: existing.content,
      steering_notes: 'Manual edit',
      version: existing.version,
      created_at: now,
    });
    const updateParams = {
      id,
      workspace_id: workspaceId,
      content,
      status: 'draft',
      version: newVersion,
      tier: existing.tier,
      updated_at: now,
    };
    const updateResult = expectedVersion === undefined
      ? stmts().updateContent.run(updateParams)
      : stmts().updateContentIfVersion.run({
          ...updateParams,
          expected_version: expectedVersion,
        });

    // The IMMEDIATE transaction serializes writers, so this is defensive
    // against future trigger/statement changes rather than an expected race.
    // Throwing rolls back the version snapshot above as well as the update.
    if (updateResult.changes !== 1) {
      throw new Error('Brand deliverable update did not affect exactly one workspace-scoped row');
    }
    return { ...rowToDeliverable(existing), content, status: 'draft', version: newVersion, updatedAt: now };
  });

  return doUpdate.immediate();
}

export function approveDeliverable(workspaceId: string, id: string): BrandDeliverable | null {
  return setDeliverableStatus(workspaceId, id, 'approved');
}

export interface BrandDeliverableStatusCasResult {
  deliverable: BrandDeliverable;
  autoSampleFrom: BrandDeliverableType | null;
}

/**
 * Version/status-conditional brand status mutation for a caller-owned transaction.
 *
 * This deliberately performs no broadcast or cache invalidation. Review workflows
 * compose it with their other source/mirror writes inside one outer IMMEDIATE
 * transaction, then publish effects only after that transaction commits.
 */
export function setDeliverableStatusCasInTransaction(
  workspaceId: string,
  id: string,
  expectedVersion: number,
  expectedStatus: BrandDeliverable['status'],
  status: 'approved' | 'draft',
): BrandDeliverableStatusCasResult | null {
  const row = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
  if (!row) return null;
  const priorStatus = row.status as BrandDeliverable['status'];
  if (row.version !== expectedVersion) {
    throw new BrandDeliverableVersionConflictError(expectedVersion, row.version);
  }
  if (priorStatus !== expectedStatus) {
    throw new BrandDeliverableStatusConflictError(expectedStatus, priorStatus);
  }

  if (priorStatus !== status) {
    validateTransition('brand_deliverable', BRAND_DELIVERABLE_TRANSITIONS, priorStatus, status);
  }
  const now = new Date().toISOString();
  const updated = stmts().updateStatusIfVersionAndStatus.run({
    id,
    workspace_id: workspaceId,
    status,
    expected_version: expectedVersion,
    expected_status: expectedStatus,
    updated_at: now,
  });
  if (updated.changes !== 1) {
    throw new BrandDeliverableVersionConflictError(expectedVersion, row.version);
  }
  log.info({ workspaceId, deliverableType: row.deliverable_type, status }, 'deliverable status updated');

  let autoSampleFrom: BrandDeliverableType | null = null;
  if (status === 'approved' && priorStatus !== 'approved') {
    const type = row.deliverable_type as BrandDeliverableType;
    const voiceSampleMap: Partial<Record<BrandDeliverableType, VoiceSampleContext>> = {
      tagline: 'headline',
      elevator_pitch: 'body',
      tone_examples: 'body',
    };
    const contextTag = voiceSampleMap[type];
    if (contextTag) {
      try {
        addVoiceSample(workspaceId, row.content.slice(0, 500), contextTag, 'identity_approved');
        log.info({ workspaceId, deliverableType: type }, 'auto-created voice sample from approved deliverable');
        autoSampleFrom = type;
      } catch (err) {
        log.error({ err, workspaceId, deliverableType: type }, 'failed to auto-create voice sample');
      }
    }
  }

  return {
    deliverable: { ...rowToDeliverable(row), status, updatedAt: now },
    autoSampleFrom,
  };
}

/**
 * Set a deliverable's status to either `approved` or `draft`.
 *
 * When transitioning to `approved`, auto-creates a voice sample for certain
 * deliverable types (tagline/elevator_pitch/tone_examples) and broadcasts
 * VOICE_PROFILE_UPDATED. Reverting to `draft` simply flips the status — it
 * does NOT delete the auto-created voice sample, since the sample may have
 * been manually edited since approval.
 */
export function setDeliverableStatus(
  workspaceId: string,
  id: string,
  status: 'approved' | 'draft',
  expectedVersion?: number,
): BrandDeliverable | null {
  // Read + write + side-effect decision MUST be atomic. Two concurrent
  // `setDeliverableStatus(wsId, id, 'approved')` calls without a transaction
  // can both observe `priorStatus = 'draft'`, both pass the re-approval
  // short-circuit, and both insert a duplicate voice sample. SQLite serializes
  // writes — wrapping this in `db.transaction()` means the second caller sees
  // `priorStatus = 'approved'` and short-circuits correctly.
  //
  // `addVoiceSample` wraps its own writes in a transaction; better-sqlite3
  // promotes nested transactions to SAVEPOINTs, so this composes cleanly.
  //
  // The broadcast is deliberately deferred to AFTER the transaction commits —
  // a broadcast inside a transaction would fire even if a later statement
  // rolled back, and WebSocket delivery is a visible side effect we cannot undo.
  const txResult = db.transaction(() => {
    const row = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
    if (!row) return null;
    return setDeliverableStatusCasInTransaction(
      workspaceId,
      id,
      expectedVersion ?? row.version,
      row.status as BrandDeliverable['status'],
      status,
    );
  }).immediate();

  if (!txResult) return null;

  // Post-commit side effect — a mounted VoiceTab refetches its sample list.
  // Must be outside the transaction so we never broadcast a sample that got
  // rolled back, and never hold the write lock across I/O.
  if (txResult.autoSampleFrom) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { autoSampleFrom: txResult.autoSampleFrom });
  }

  return txResult.deliverable;
}

export function exportDeliverables(workspaceId: string, tier?: DeliverableTier): string {
  const deliverables = listDeliverables(workspaceId, tier).filter(d => d.status === 'approved');
  if (deliverables.length === 0) return '# Brand Identity\n\nNo approved deliverables yet.';

  const sections = deliverables.map(d =>
    `## ${d.deliverableType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n${d.content}`
  );

  return `# Brand Identity Deliverables\n\n${sections.join('\n\n---\n\n')}`;
}
