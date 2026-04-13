import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { callOpenAI } from './openai-helpers.js';
import { getVoiceProfile, updateVoiceProfile } from './voice-calibration.js';
import type { VoiceGuardrails } from '../shared/types/brand-engine.js';
import type { CopyIntelligencePattern, IntelligencePatternType } from '../shared/types/copy-pipeline.js';

const log = createLogger('copy-intelligence');

// ── Statement cache ──

const stmts = createStmtCache(() => ({
  getAllPatterns: db.prepare(
    `SELECT * FROM copy_intelligence WHERE workspace_id = ? ORDER BY frequency DESC`,
  ),
  getActivePatterns: db.prepare(
    `SELECT * FROM copy_intelligence WHERE workspace_id = ? AND active = 1 ORDER BY frequency DESC`,
  ),
  findByPattern: db.prepare(
    `SELECT * FROM copy_intelligence WHERE workspace_id = ? AND pattern = ?`,
  ),
  insertPattern: db.prepare(
    `INSERT INTO copy_intelligence (id, workspace_id, pattern_type, pattern, source, frequency, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  incrementFrequency: db.prepare(
    `UPDATE copy_intelligence SET frequency = frequency + 1 WHERE id = ? AND workspace_id = ?`,
  ),
  togglePattern: db.prepare(
    `UPDATE copy_intelligence SET active = ? WHERE id = ? AND workspace_id = ?`,
  ),
  removePattern: db.prepare(
    `DELETE FROM copy_intelligence WHERE id = ? AND workspace_id = ?`,
  ),
  updatePattern: db.prepare(
    `UPDATE copy_intelligence SET pattern = ?, pattern_type = ? WHERE id = ? AND workspace_id = ?`,
  ),
  getPromotable: db.prepare(
    `SELECT * FROM copy_intelligence WHERE workspace_id = ? AND active = 1 AND frequency >= 3 ORDER BY frequency DESC`,
  ),
  getPatternById: db.prepare(
    `SELECT * FROM copy_intelligence WHERE id = ? AND workspace_id = ?`,
  ),
}));

// ── Row mapper ──

interface CopyIntelligenceRow {
  id: string;
  workspace_id: string;
  pattern_type: string;
  pattern: string;
  source: string | null;
  frequency: number;
  active: number;
  created_at: string;
}

function rowToPattern(row: CopyIntelligenceRow): CopyIntelligencePattern {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    patternType: row.pattern_type as IntelligencePatternType,
    pattern: row.pattern,
    source: row.source,
    frequency: row.frequency,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

// ── Public API ──

export function getAllPatterns(wsId: string): CopyIntelligencePattern[] {
  const rows = stmts().getAllPatterns.all(wsId) as CopyIntelligenceRow[];
  return rows.map(rowToPattern);
}

export function getActivePatterns(wsId: string): CopyIntelligencePattern[] {
  const rows = stmts().getActivePatterns.all(wsId) as CopyIntelligenceRow[];
  return rows.map(rowToPattern);
}

/**
 * Add a pattern for the given workspace.
 * Dedup: if the pattern text already exists for this workspace, increment frequency instead of inserting.
 */
export function addPattern(
  wsId: string,
  data: { patternType: IntelligencePatternType; pattern: string; source?: string },
): CopyIntelligencePattern {
  // Wrap in transaction to eliminate TOCTOU race between SELECT and INSERT
  return db.transaction(() => {
    const existing = stmts().findByPattern.get(wsId, data.pattern) as CopyIntelligenceRow | undefined;
    if (existing) {
      stmts().incrementFrequency.run(existing.id, wsId);
      return rowToPattern(stmts().findByPattern.get(wsId, data.pattern) as CopyIntelligenceRow);
    }

    const id = `ip_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    stmts().insertPattern.run(id, wsId, data.patternType, data.pattern, data.source ?? null, 1, 1, now);
    return rowToPattern(stmts().findByPattern.get(wsId, data.pattern) as CopyIntelligenceRow);
  })();
}

export function togglePattern(patternId: string, wsId: string, active: boolean): void {
  stmts().togglePattern.run(active ? 1 : 0, patternId, wsId);
}

export function removePattern(patternId: string, wsId: string): void {
  stmts().removePattern.run(patternId, wsId);
}

export function updatePatternText(
  patternId: string,
  wsId: string,
  pattern: string,
  patternType: IntelligencePatternType,
): void {
  stmts().updatePattern.run(pattern, patternType, patternId, wsId);
}

/** Returns active patterns with frequency >= 3, candidates for promotion to persistent rules. */
export function getPatternsForPromotion(wsId: string): CopyIntelligencePattern[] {
  const rows = stmts().getPromotable.all(wsId) as CopyIntelligenceRow[];
  return rows.map(rowToPattern);
}

// ── Guardrail promotion ──

const MISSING_SCHEMA_RE = /no such (table|column)/i;

/**
 * Safe wrapper for voice-calibration reads — tables may not exist in test envs
 * or before brand-engine migrations have run. Mirrors the pattern in seo-context.ts.
 */
function safeVoiceRead<T>(context: string, wsId: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!MISSING_SCHEMA_RE.test(message)) {
      // Real error — re-throw so callers see it
      throw err;
    }
    log.debug({ wsId, context, error: message }, 'voice table missing, returning fallback');
    return fallback;
  }
}

/**
 * Map pattern type → guardrails field.
 * - tone → toneBoundaries
 * - terminology / structure / keyword_usage → antiPatterns (general rules)
 */
function guardrailFieldForType(type: IntelligencePatternType): keyof Pick<VoiceGuardrails, 'toneBoundaries' | 'antiPatterns'> {
  return type === 'tone' ? 'toneBoundaries' : 'antiPatterns';
}

/**
 * Promote a high-frequency intelligence pattern into the workspace's voice guardrails.
 *
 * Validates: pattern exists, belongs to workspace, is active, has frequency >= 3,
 * and a calibrated voice profile exists. Appends the pattern text to the appropriate
 * guardrails array, then deactivates the pattern so it no longer appears as promotable.
 */
export function promoteToGuardrail(
  patternId: string,
  wsId: string,
): { success: boolean; guardrailText?: string; error?: string } {
  // 1. Load and validate the pattern
  const row = stmts().getPatternById.get(patternId, wsId) as CopyIntelligenceRow | undefined;
  if (!row) {
    return { success: false, error: 'Pattern not found' };
  }
  const pattern = rowToPattern(row);

  if (!pattern.active) {
    return { success: false, error: 'Pattern is already inactive (may have been promoted previously)' };
  }
  if (pattern.frequency < 3) {
    return { success: false, error: `Pattern frequency (${pattern.frequency}) is below the promotion threshold of 3` };
  }

  // 2. Load voice profile — wrapped in safe read for missing-table resilience
  const profile = safeVoiceRead('promoteToGuardrail.getVoiceProfile', wsId, () => getVoiceProfile(wsId), null);
  if (!profile) {
    return { success: false, error: 'No voice profile exists for this workspace' };
  }
  if (profile.status !== 'calibrated') {
    return { success: false, error: `Voice profile must be calibrated to accept guardrails (current status: ${profile.status})` };
  }

  // 3. Build updated guardrails — append pattern text to the appropriate array
  const field = guardrailFieldForType(pattern.patternType);
  const existing: VoiceGuardrails = profile.guardrails ?? {
    forbiddenWords: [],
    requiredTerminology: [],
    toneBoundaries: [],
    antiPatterns: [],
  };

  // Avoid duplicates — check if this exact text is already present
  if (existing[field].includes(pattern.pattern)) {
    // Still deactivate the pattern (it's already in guardrails)
    stmts().togglePattern.run(0, patternId, wsId);
    return { success: true, guardrailText: pattern.pattern };
  }

  const updatedGuardrails: VoiceGuardrails = {
    ...existing,
    [field]: [...existing[field], pattern.pattern],
  };

  // 4. Persist: update guardrails + deactivate pattern in a transaction.
  // Do NOT wrap updateVoiceProfile in safeVoiceRead — if the write fails,
  // the transaction must roll back so the pattern is not deactivated without
  // the guardrail being saved (silent data loss).
  try {
    db.transaction(() => {
      updateVoiceProfile(wsId, { guardrails: updatedGuardrails });
      stmts().togglePattern.run(0, patternId, wsId);
    })();
  } catch (err) {
    log.error({ err, wsId, patternId }, 'Failed to promote pattern to guardrail');
    return { success: false, error: 'Could not update voice profile guardrails' };
  }

  log.info(
    { wsId, patternId, patternType: pattern.patternType, field, frequency: pattern.frequency },
    'promoted intelligence pattern to voice guardrail',
  );

  return { success: true, guardrailText: pattern.pattern };
}

/**
 * Use GPT-4.1-mini to classify steering notes into reusable intelligence patterns,
 * then persist them via addPattern() (with dedup/frequency increment).
 */
export async function extractPatterns(
  wsId: string,
  steeringNotes: string[],
): Promise<CopyIntelligencePattern[]> {
  if (steeringNotes.length === 0) return [];

  const prompt = `You are a copywriting pattern extractor. Analyze these steering notes and extract reusable patterns.

Steering notes:
${steeringNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Extract patterns into these categories:
- terminology: specific words or phrases to use/avoid
- tone: tone or style requirements
- structure: content structure requirements
- keyword_usage: keyword placement or density rules

Return JSON array: [{"patternType": "terminology|tone|structure|keyword_usage", "pattern": "concise rule description"}]
Return only valid JSON, no markdown.`;

  let result;
  try {
    result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1000,
      feature: 'copy-intelligence',
      workspaceId: wsId,
      responseFormat: { type: 'json_object' },
    });
  } catch (err) {
    log.error({ err, wsId, noteCount: steeringNotes.length }, 'Pattern extraction AI call failed');
    return [];
  }

  let extracted: Array<{ patternType: IntelligencePatternType; pattern: string }> = [];
  // The model may return a bare array or wrap it in { patterns: [...] } / { items: [...] }
  const parsedRaw = parseJsonFallback<unknown[] | Record<string, unknown>>(result.text, []);
  if (Array.isArray(parsedRaw)) {
    extracted = parsedRaw as Array<{ patternType: IntelligencePatternType; pattern: string }>;
  } else if (parsedRaw && typeof parsedRaw === 'object') {
    const wrapped = parsedRaw as Record<string, unknown>;
    const inner = wrapped.patterns ?? wrapped.items ?? [];
    extracted = Array.isArray(inner)
      ? (inner as Array<{ patternType: IntelligencePatternType; pattern: string }>)
      : [];
  }
  if (extracted.length === 0) {
    log.warn({ wsId, noteCount: steeringNotes.length }, 'Pattern extraction returned no usable patterns');
  }

  return extracted
    .filter(p => p.patternType && p.pattern)
    .map(p => addPattern(wsId, { patternType: p.patternType, pattern: p.pattern, source: 'extracted' }));
}
