import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { callCreativeAI } from './content-posts-ai.js';
import { buildIntelPrompt } from './workspace-intelligence.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { randomUUID } from 'crypto';
import { addVoiceSample, getVoiceProfile, buildVoiceCalibrationContext } from './voice-calibration.js';
import { listBrandscripts } from './brandscript.js';
import { listExtractions } from './discovery-ingestion.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import type {
  BrandDeliverable, DeliverableVersion, DeliverableType, DeliverableTier, DeliverableStatus,
  VoiceSampleContext,
} from '../shared/types/brand-engine.js';
import { DEFAULT_TIER_MAP } from '../shared/types/brand-engine.js';

const log = createLogger('brand-identity');

interface DeliverableRow {
  id: string; workspace_id: string; deliverable_type: string;
  content: string; status: string; version: number; tier: string;
  created_at: string; updated_at: string;
}
interface VersionRow {
  id: string; deliverable_id: string; content: string;
  steering_notes: string | null; version: number; created_at: string;
}

const stmts = createStmtCache(() => ({
  listByWorkspace: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? ORDER BY tier, deliverable_type`),
  listByTier: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? AND tier = ? ORDER BY deliverable_type`),
  getById: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE id = ? AND workspace_id = ?`),
  getByType: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? AND deliverable_type = ? ORDER BY updated_at DESC LIMIT 1`),
  insert: db.prepare(`INSERT INTO brand_identity_deliverables (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at) VALUES (@id, @workspace_id, @deliverable_type, @content, @status, @version, @tier, @created_at, @updated_at)`),
  updateContent: db.prepare(`UPDATE brand_identity_deliverables SET content = @content, status = @status, version = @version, tier = @tier, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`),
  updateStatus: db.prepare(`UPDATE brand_identity_deliverables SET status = @status, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`), // status-ok: brand deliverable status is not a platform state machine column
  // Defense in depth: scope by workspace via a join on the parent deliverable
  // even though `deliverable_id` is already a scoped FK. A bug in getDeliverable
  // (or a future caller) that leaks a cross-workspace id shouldn't yield version
  // rows. `brand_identity_versions` has no `workspace_id` column of its own.
  listVersions: db.prepare(`SELECT v.* FROM brand_identity_versions v INNER JOIN brand_identity_deliverables d ON v.deliverable_id = d.id WHERE v.deliverable_id = ? AND d.workspace_id = ? ORDER BY v.version DESC`),
  insertVersion: db.prepare(`INSERT INTO brand_identity_versions (id, deliverable_id, content, steering_notes, version, created_at) VALUES (@id, @deliverable_id, @content, @steering_notes, @version, @created_at)`),
}));

function rowToDeliverable(row: DeliverableRow): BrandDeliverable {
  return {
    id: row.id, workspaceId: row.workspace_id,
    deliverableType: row.deliverable_type as DeliverableType,
    content: row.content,
    status: row.status as DeliverableStatus,
    version: row.version,
    tier: row.tier as DeliverableTier,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToVersion(row: VersionRow): DeliverableVersion {
  return {
    id: row.id, deliverableId: row.deliverable_id,
    content: row.content, steeringNotes: row.steering_notes ?? undefined,
    version: row.version, createdAt: row.created_at,
  };
}

// ── Public API

export function listDeliverables(workspaceId: string, tier?: DeliverableTier): BrandDeliverable[] {
  const rows = tier
    ? stmts().listByTier.all(workspaceId, tier) as DeliverableRow[]
    : stmts().listByWorkspace.all(workspaceId) as DeliverableRow[];
  return rows.map(rowToDeliverable);
}

export function getDeliverable(workspaceId: string, id: string): (BrandDeliverable & { versions: DeliverableVersion[] }) | null {
  const row = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
  if (!row) return null;
  const deliverable = rowToDeliverable(row);
  const versions = (stmts().listVersions.all(id, workspaceId) as VersionRow[]).map(rowToVersion);
  return { ...deliverable, versions };
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
  } catch { /* brandscript not yet available */ }

  // Voice profile context — use buildVoiceCalibrationContext so DNA/guardrails are
  // only injected here when profile.status !== 'calibrated'. When calibrated,
  // buildSystemPrompt() (Layer 2) already injects them via prompt-assembly.ts;
  // duplicating them wastes tokens and over-weights voice constraints.
  try {
    const profile = getVoiceProfile(workspaceId);
    if (profile) {
      const { samplesText, dnaText, guardrailsText } = buildVoiceCalibrationContext(profile);
      if (dnaText) parts.push(dnaText.trim());
      if (samplesText) parts.push(samplesText.trim());
      if (guardrailsText) parts.push(guardrailsText.trim());
    }
  } catch { /* voice profile not yet available */ }

  // Discovery extractions
  try {
    const extractions = listExtractions(workspaceId).filter(e => e.status === 'accepted');
    if (extractions.length > 0) {
      const storyElements = extractions.filter(e => e.extractionType === 'story_element').slice(0, 5);
      if (storyElements.length > 0) {
        parts.push(`STORY ELEMENTS:\n${storyElements.map(e => `${e.category}: ${e.content}`).join('\n')}`);
      }
    }
  } catch { /* extractions not yet available */ }

  return parts.join('\n\n');
}

function getDeliverableInstructions(type: DeliverableType): string {
  const instructions: Partial<Record<DeliverableType, string>> = {
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
  };
  return instructions[type] || `Write a ${type.replace(/_/g, ' ')} for this brand. Be specific, not generic.`;
}

export async function generateDeliverable(workspaceId: string, deliverableType: DeliverableType): Promise<BrandDeliverable> {
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
    temperature: 0.7,
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
    return upsert();
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
    return retryAsUpdate();
  }
}

export async function refineDeliverable(workspaceId: string, id: string, direction: string): Promise<BrandDeliverable | null> {
  // Initial read (outside transaction) is only used to feed the AI call with
  // the current content. The authoritative read that drives version numbering
  // and the content snapshot happens *inside* the transaction below, to close
  // the stale-read race where a concurrent generate/refine could bump the
  // version between the AI call and our write.
  const preload = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
  if (!preload) return null;

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
    temperature: 0.6,
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
  return doRefine();
}

export function approveDeliverable(workspaceId: string, id: string): BrandDeliverable | null {
  const row = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
  if (!row) return null;

  const now = new Date().toISOString();
  stmts().updateStatus.run({ id, workspace_id: workspaceId, status: 'approved', updated_at: now });
  log.info({ workspaceId, deliverableType: row.deliverable_type }, 'deliverable approved');

  // Spec Addendum §5: auto-create voice sample for approved identity deliverables.
  //
  // Intentionally decoupled from the updateStatus write above — approval is the
  // user-visible primary effect and must succeed even if the downstream sample
  // insert fails (e.g. voice_profiles FK issues, unexpected table state). The
  // per-call atomicity that CLAUDE.md wants lives inside `addVoiceSample`, which
  // wraps its own profile-upsert + sample-insert in db.transaction(). If that
  // fails we log and move on; the admin can manually seed the sample later.
  const type = row.deliverable_type as DeliverableType;
  const voiceSampleMap: Partial<Record<DeliverableType, VoiceSampleContext>> = {
    tagline: 'headline',
    elevator_pitch: 'body',
    tone_examples: 'body',
  };
  const contextTag = voiceSampleMap[type];
  if (contextTag) {
    try {
      addVoiceSample(workspaceId, row.content.slice(0, 500), contextTag, 'identity_approved');
      log.info({ workspaceId, deliverableType: type }, 'auto-created voice sample from approved deliverable');
      // Tell any mounted VoiceTab to refetch — the auto-created sample would
      // otherwise only appear after a manual reload.
      broadcastToWorkspace(workspaceId, WS_EVENTS.VOICE_PROFILE_UPDATED, { autoSampleFrom: type });
    } catch (err) {
      log.error({ err, workspaceId, deliverableType: type }, 'failed to auto-create voice sample');
    }
  }

  return { ...rowToDeliverable(row), status: 'approved', updatedAt: now };
}

export function exportDeliverables(workspaceId: string, tier?: DeliverableTier): string {
  const deliverables = listDeliverables(workspaceId, tier).filter(d => d.status === 'approved');
  if (deliverables.length === 0) return '# Brand Identity\n\nNo approved deliverables yet.';

  const sections = deliverables.map(d =>
    `## ${d.deliverableType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n${d.content}`
  );

  return `# Brand Identity Deliverables\n\n${sections.join('\n\n---\n\n')}`;
}
