import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { callOpenAI } from './openai-helpers.js';
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
    `SELECT * FROM copy_intelligence WHERE workspace_id = ? AND frequency >= 3 ORDER BY frequency DESC`,
  ),
}));

// ── Row mapper ──

function rowToPattern(row: Record<string, unknown>): CopyIntelligencePattern {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    patternType: row.pattern_type as IntelligencePatternType,
    pattern: row.pattern as string,
    source: row.source as string | null,
    frequency: row.frequency as number,
    active: Boolean(row.active),
    createdAt: row.created_at as string,
  };
}

// ── Public API ──

export function getAllPatterns(wsId: string): CopyIntelligencePattern[] {
  const rows = stmts().getAllPatterns.all(wsId) as Record<string, unknown>[];
  return rows.map(rowToPattern);
}

export function getActivePatterns(wsId: string): CopyIntelligencePattern[] {
  const rows = stmts().getActivePatterns.all(wsId) as Record<string, unknown>[];
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
  const existing = stmts().findByPattern.get(wsId, data.pattern) as Record<string, unknown> | undefined;
  if (existing) {
    stmts().incrementFrequency.run(existing.id, wsId);
    return rowToPattern({ ...existing, frequency: (existing.frequency as number) + 1 });
  }

  const id = `ip_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  stmts().insertPattern.run(id, wsId, data.patternType, data.pattern, data.source ?? null, 1, 1, now);
  return rowToPattern(stmts().findByPattern.get(wsId, data.pattern) as Record<string, unknown>);
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

/** Returns patterns with frequency >= 3, candidates for promotion to persistent rules. */
export function getPatternsForPromotion(wsId: string): CopyIntelligencePattern[] {
  const rows = stmts().getPromotable.all(wsId) as Record<string, unknown>[];
  return rows.map(rowToPattern);
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

  const result = await callOpenAI({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1000,
    feature: 'copy-intelligence',
    workspaceId: wsId,
    responseFormat: { type: 'json_object' },
  });

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
