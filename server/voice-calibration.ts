import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { callCreativeAI } from './content-posts-ai.js';
import { buildIntelPrompt } from './workspace-intelligence.js';
import { buildSystemPrompt, guardrailsToPromptInstructions } from './prompt-assembly.js';
import { renderVoiceDNAForPrompt } from './voice-dna-render.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { randomUUID } from 'crypto';
import type {
  VoiceProfile, VoiceSample, CalibrationSession, CalibrationVariation,
  VoiceDNA, VoiceGuardrails, ContextModifier, VoiceProfileStatus,
  VoiceSampleContext, VoiceSampleSource,
} from '../shared/types/brand-engine.js';

const log = createLogger('voice-calibration');

interface ProfileRow {
  id: string; workspace_id: string; status: string;
  voice_dna_json: string | null; guardrails_json: string | null;
  context_modifiers_json: string | null; created_at: string; updated_at: string;
}
interface SampleRow {
  id: string; voice_profile_id: string; content: string;
  context_tag: string | null; source: string | null;
  sort_order: number | null; created_at: string;
}
interface SessionRow {
  id: string; voice_profile_id: string; prompt_type: string;
  variations_json: string; steering_notes: string | null; created_at: string;
}

const stmts = createStmtCache(() => ({
  getProfileByWorkspace: db.prepare(`SELECT * FROM voice_profiles WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1`),
  // INSERT OR IGNORE so concurrent getOrCreateVoiceProfile() calls don't trip the
  // UNIQUE(workspace_id) constraint — whichever inserts first wins, the loser falls
  // through and re-selects the committed row.
  insertProfile: db.prepare(`INSERT OR IGNORE INTO voice_profiles (id, workspace_id, status, voice_dna_json, guardrails_json, context_modifiers_json, created_at, updated_at) VALUES (@id, @workspace_id, @status, @voice_dna_json, @guardrails_json, @context_modifiers_json, @created_at, @updated_at)`),
  updateProfile: db.prepare(`UPDATE voice_profiles SET status = @status, voice_dna_json = @voice_dna_json, guardrails_json = @guardrails_json, context_modifiers_json = @context_modifiers_json, updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`), // status-ok: voice profile status is not a platform state machine column
  listSamples: db.prepare(`SELECT * FROM voice_samples WHERE voice_profile_id = ? ORDER BY sort_order`),
  // Compute next sort_order atomically inside the transaction. Reading
  // profile.samples.length from an in-memory snapshot races: two concurrent
  // addVoiceSample() calls both see length=N and both assign sort_order=N.
  // COALESCE handles the empty-table case where SQLite's MAX() returns NULL.
  maxSampleSortOrder: db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS max FROM voice_samples WHERE voice_profile_id = ?`),
  insertSample: db.prepare(`INSERT INTO voice_samples (id, voice_profile_id, content, context_tag, source, sort_order, created_at) VALUES (@id, @voice_profile_id, @content, @context_tag, @source, @sort_order, @created_at)`),
  deleteSampleById: db.prepare(`DELETE FROM voice_samples WHERE id = ? AND voice_profile_id = ?`),
  listSessions: db.prepare(`SELECT * FROM voice_calibration_sessions WHERE voice_profile_id = ? ORDER BY created_at DESC`),
  getSession: db.prepare(`SELECT * FROM voice_calibration_sessions WHERE id = ? AND voice_profile_id = ?`),
  insertSession: db.prepare(`INSERT INTO voice_calibration_sessions (id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at) VALUES (@id, @voice_profile_id, @prompt_type, @variations_json, @steering_notes, @created_at)`),
  // Scope the UPDATE by voice_profile_id (not just session id) so a compromised
  // or misrouted session id from another workspace can't clobber state in this
  // one. The calling function already re-verifies ownership via getSession, but
  // defense in depth — every write gets the scope in its WHERE clause.
  updateSession: db.prepare(`UPDATE voice_calibration_sessions SET variations_json = @variations_json, steering_notes = @steering_notes WHERE id = @id AND voice_profile_id = @voice_profile_id`),
}));

function rowToProfile(row: ProfileRow): Omit<VoiceProfile, 'samples'> {
  return {
    id: row.id, workspaceId: row.workspace_id,
    status: row.status as VoiceProfileStatus,
    voiceDNA: row.voice_dna_json ? parseJsonFallback<VoiceDNA | null>(row.voice_dna_json, null) ?? undefined : undefined,
    guardrails: row.guardrails_json ? parseJsonFallback<VoiceGuardrails | null>(row.guardrails_json, null) ?? undefined : undefined,
    contextModifiers: row.context_modifiers_json ? parseJsonFallback<ContextModifier[] | null>(row.context_modifiers_json, null) ?? undefined : undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToSample(row: SampleRow): VoiceSample {
  return {
    id: row.id, voiceProfileId: row.voice_profile_id, content: row.content,
    contextTag: (row.context_tag ?? undefined) as VoiceSampleContext | undefined,
    source: (row.source ?? undefined) as VoiceSampleSource | undefined,
    sortOrder: row.sort_order ?? undefined, createdAt: row.created_at,
  };
}

function rowToSession(row: SessionRow): CalibrationSession {
  return {
    id: row.id, voiceProfileId: row.voice_profile_id,
    promptType: row.prompt_type,
    variations: parseJsonFallback<CalibrationVariation[]>(row.variations_json, []),
    steeringNotes: row.steering_notes ?? undefined,
    createdAt: row.created_at,
  };
}

// Returns profile with samples included
export function getVoiceProfile(workspaceId: string): (VoiceProfile & { samples: VoiceSample[] }) | null {
  const row = stmts().getProfileByWorkspace.get(workspaceId) as ProfileRow | undefined;
  if (!row) return null;
  const profile = rowToProfile(row);
  const samples = (stmts().listSamples.all(row.id) as SampleRow[]).map(rowToSample);
  return { ...profile, samples };
}

// Gets or creates the voice profile for a workspace, always includes samples
export function getOrCreateVoiceProfile(workspaceId: string): VoiceProfile & { samples: VoiceSample[] } {
  const existing = getVoiceProfile(workspaceId);
  if (existing) return existing;

  const id = `vp_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const defaultModifiers: ContextModifier[] = [
    { context: 'Headlines & CTAs', description: 'Maximum personality. Punchy. Humor welcome.' },
    { context: 'Service descriptions', description: 'Clear and warm. Less humor, more reassurance.' },
    { context: 'SEO meta titles/descriptions', description: 'Brand voice balanced with keyword requirements. Personality in the description, precision in the title.' },
    { context: 'Blog / long-form', description: 'Full voice. Narrative rhythm. Room for extended personality.' },
    { context: 'FAQ / educational', description: 'Accessible, helpful. Expertise without condescension.' },
  ];

  const result = stmts().insertProfile.run({
    id, workspace_id: workspaceId, status: 'draft',
    voice_dna_json: null, guardrails_json: null,
    context_modifiers_json: JSON.stringify(defaultModifiers),
    created_at: now, updated_at: now,
  });

  // If another request inserted first, IGNORE returns 0 changes — re-read the committed row.
  if (result.changes === 0) {
    const winner = getVoiceProfile(workspaceId);
    if (winner) return winner;
    // Re-read after a lost race also returned null — the row we expected to
    // exist is gone. Something external (manual delete, test teardown, FK
    // cascade) is modifying the table. Throw rather than returning a ghost
    // in-memory object that was never persisted — CLAUDE.md requires
    // getOrCreate* to return a non-nullable value or throw.
    throw new Error(`getOrCreateVoiceProfile: lost race and re-read also failed for workspace ${workspaceId}`);
  }

  log.info({ workspaceId, profileId: id }, 'created voice profile');
  return { id, workspaceId, status: 'draft', contextModifiers: defaultModifiers, samples: [], createdAt: now, updatedAt: now };
}

// Always returns a profile — `getOrCreateVoiceProfile` creates one if missing,
// so there is no null path. Typed as non-nullable so callers don't need a
// dead-code guard.
export function updateVoiceProfile(
  workspaceId: string,
  updates: { status?: VoiceProfileStatus; voiceDNA?: VoiceDNA; guardrails?: VoiceGuardrails; contextModifiers?: ContextModifier[] },
): VoiceProfile & { samples: VoiceSample[] } {
  const profile = getOrCreateVoiceProfile(workspaceId);
  const now = new Date().toISOString();
  stmts().updateProfile.run({
    id: profile.id,
    workspace_id: workspaceId,
    status: updates.status ?? profile.status,
    voice_dna_json: updates.voiceDNA !== undefined ? JSON.stringify(updates.voiceDNA) : (profile.voiceDNA ? JSON.stringify(profile.voiceDNA) : null),
    guardrails_json: updates.guardrails !== undefined ? JSON.stringify(updates.guardrails) : (profile.guardrails ? JSON.stringify(profile.guardrails) : null),
    context_modifiers_json: updates.contextModifiers !== undefined ? JSON.stringify(updates.contextModifiers) : (profile.contextModifiers ? JSON.stringify(profile.contextModifiers) : null),
    updated_at: now,
  });
  return { ...profile, ...updates, updatedAt: now };
}

// Takes workspaceId (not profile.id) — resolves profile internally.
// getOrCreateVoiceProfile may INSERT a voice_profiles row, and we then INSERT
// a voice_samples row. Wrapping the two writes in a single transaction means a
// failed sample insert rolls back the just-created profile (no orphaned empty
// profile left behind) and satisfies CLAUDE.md's multi-step-mutation rule.
export function addVoiceSample(
  workspaceId: string, content: string,
  contextTag?: VoiceSampleContext, source?: VoiceSampleSource,
): VoiceSample {
  const id = `vs_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const effectiveSource = source ?? 'manual';

  const doAdd = db.transaction((): { voiceProfileId: string; sortOrder: number } => {
    const profile = getOrCreateVoiceProfile(workspaceId);
    // Read MAX(sort_order)+1 inside the transaction so concurrent adds can't
    // assign duplicate sort_orders. `profile.samples.length` from the in-memory
    // snapshot is stale as soon as another request commits between read and write.
    const { max } = stmts().maxSampleSortOrder.get(profile.id) as { max: number };
    const sortOrder = max + 1;
    stmts().insertSample.run({
      id, voice_profile_id: profile.id, content,
      context_tag: contextTag ?? null, source: effectiveSource,
      sort_order: sortOrder, created_at: now,
    });
    return { voiceProfileId: profile.id, sortOrder };
  });

  const { voiceProfileId, sortOrder } = doAdd();
  return { id, voiceProfileId, content, contextTag, source: effectiveSource, sortOrder, createdAt: now };
}

export function deleteVoiceSample(workspaceId: string, sampleId: string): boolean {
  const profile = getVoiceProfile(workspaceId);
  if (!profile) return false;
  return stmts().deleteSampleById.run(sampleId, profile.id).changes > 0;
}

export function listCalibrationSessions(workspaceId: string): CalibrationSession[] {
  const profile = getVoiceProfile(workspaceId);
  if (!profile) return [];
  return (stmts().listSessions.all(profile.id) as SessionRow[]).map(rowToSession);
}

/**
 * Assemble voice calibration context strings for inclusion in AI prompts.
 *
 * Guards on `profile.status !== 'calibrated'`: when calibrated, buildSystemPrompt's
 * Layer 2 already injects DNA + guardrails into the system message — re-injecting
 * them in the user prompt would duplicate instructions and waste tokens.
 *
 * Phase 2 (blueprint-generator.ts) and Phase 3 (copy-generation.ts) should import
 * and call this helper rather than building their own inline voice context injection.
 */
export function buildVoiceCalibrationContext(profile: VoiceProfile & { samples: VoiceSample[] }): {
  samplesText: string;
  dnaText: string;
  guardrailsText: string;
} {
  const isCalibrated = profile.status === 'calibrated';

  const samplesText = profile.samples.length > 0
    ? `\nVOICE SAMPLES (write like these):\n${profile.samples.map(s => `  [${s.contextTag || 'general'}] "${s.content}"`).join('\n')}`
    : '';

  // Once calibrated, Layer 2 of buildSystemPrompt injects DNA + guardrails into
  // the system message. Only inline them when still draft/calibrating.
  // Shared renderer — see server/voice-dna-render.ts for the single source of
  // truth. Every field in VoiceDNA is rendered here; adding a new field is a
  // compile error in voice-dna-render.ts until handled.
  const dnaText = !isCalibrated && profile.voiceDNA
    ? `\nVOICE DNA:\n${renderVoiceDNAForPrompt(profile.voiceDNA)}`
    : '';

  const guardrailsText = !isCalibrated && profile.guardrails
    ? `\n${guardrailsToPromptInstructions(profile.guardrails)}`
    : '';

  return { samplesText, dnaText, guardrailsText };
}

export async function generateCalibrationVariations(
  workspaceId: string, promptType: string, steeringNotes?: string,
): Promise<CalibrationSession> {
  const profile = getOrCreateVoiceProfile(workspaceId);
  const fullContext = await buildIntelPrompt(workspaceId, ['seoContext']);

  const { samplesText, dnaText, guardrailsText } = buildVoiceCalibrationContext(profile);

  const modifierText = profile.contextModifiers
    ? (() => {
        const key = promptType.split('_')[0];
        const mod = profile.contextModifiers!.find(m => m.context.toLowerCase().includes(key));
        return mod ? `\nCONTEXT MODIFIER for ${promptType}: ${mod.description}` : '';
      })()
    : '';

  const userPrompt = `Generate exactly 3 variations of ${promptType.replace(/_/g, ' ')} copy for this brand.
${fullContext}${samplesText}${dnaText}${guardrailsText}${modifierText}
${steeringNotes ? `\nSTEERING DIRECTION: ${steeringNotes}` : ''}

Each variation should be meaningfully different in approach while staying on-brand. Be specific to this business.

Return valid JSON: { "variations": ["variation 1 text", "variation 2 text", "variation 3 text"] }`;

  const system = buildSystemPrompt(workspaceId, 'You are a copywriter matching a specific brand voice. Generate copy that sounds like this brand, not generic marketing language.');

  // This handler is provably single-writer per request. Each call
  // generates a fresh `cal_<randomUUID>` primary key AFTER the AI
  // returns, with no existence check beforehand. Two concurrent requests
  // create two distinct sessions (different random IDs) — there is no
  // shared natural-key INSERT to race on, so the AI-race pattern doesn't
  // apply. Sessions are intentionally append-only per call.
  log.info({ workspaceId, promptType }, 'generating calibration variations');
  // ai-race-ok: see rationale above — single-writer per request via randomUUID PK.
  const text = await callCreativeAI({
    systemPrompt: system,
    userPrompt,
    maxTokens: 2000,
    temperature: 0.85,
    feature: 'voice-calibration',
    workspaceId,
    json: true,
  });

  const parsed = parseJsonFallback<{ variations: string[] }>(text, { variations: [] });
  const variations: CalibrationVariation[] = (parsed.variations || []).map(variation => ({ text: variation }));

  const id = `cal_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  stmts().insertSession.run({
    id, voice_profile_id: profile.id, prompt_type: promptType,
    variations_json: JSON.stringify(variations),
    steering_notes: steeringNotes ?? null, created_at: now,
  });

  return { id, voiceProfileId: profile.id, promptType, variations, steeringNotes, createdAt: now };
}

export async function refineVariation(
  workspaceId: string, sessionId: string, variationIndex: number, direction: string,
): Promise<CalibrationSession | null> {
  // Preload (outside the tx) only to feed the AI call with the original variation text.
  const profile = getVoiceProfile(workspaceId);
  if (!profile) return null;
  const preload = stmts().getSession.get(sessionId, profile.id) as SessionRow | undefined;
  if (!preload) return null;
  const preloadSession = rowToSession(preload);
  const original = preloadSession.variations[variationIndex];
  if (!original) return null;

  const userPrompt = `Refine this copy based on the direction given. Keep the same general idea but adjust as directed.

ORIGINAL: "${original.text}"
DIRECTION: ${direction}

Return valid JSON: { "refined": "the refined text" }`;

  const system = buildSystemPrompt(workspaceId, 'You are a copywriter refining copy based on feedback. Adjust precisely as directed.');

  const text = await callCreativeAI({
    systemPrompt: system,
    userPrompt,
    maxTokens: 1000,
    temperature: 0.75,
    feature: 'voice-refinement',
    workspaceId,
    json: true,
  });

  const parsed = parseJsonFallback<{ refined: string }>(text, { refined: original.text });

  // Re-read the session INSIDE the transaction and mutate against the fresh
  // state — a concurrent refine on the same session during our AI call would
  // otherwise be lost (classic lost-update anomaly). SQLite serialises writes
  // so only one transaction runs at a time, guaranteeing the append is atomic.
  const doRefine = db.transaction((): CalibrationSession | null => {
    const freshRow = stmts().getSession.get(sessionId, profile.id) as SessionRow | undefined;
    if (!freshRow) return null;
    const freshSession = rowToSession(freshRow);
    freshSession.variations.push({ text: parsed.refined });
    const newNotes = `${freshSession.steeringNotes || ''}\n[Refined #${variationIndex}]: ${direction}`.trim();
    stmts().updateSession.run({
      id: sessionId,
      voice_profile_id: profile.id,
      variations_json: JSON.stringify(freshSession.variations),
      steering_notes: newNotes,
    });
    return { ...freshSession, steeringNotes: newNotes };
  });

  return doRefine();
}
