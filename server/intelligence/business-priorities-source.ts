import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';
import { parseJsonSafeArray } from '../db/json-validation.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { clientBusinessPrioritySchema, type ClientBusinessPriorityInput } from '../schemas/client-business-priorities.js';

const log = createLogger('workspace-intelligence/business-priorities-source');

const stmts = createStmtCache(() => ({
  clientBusinessPriorities: db.prepare(
    'SELECT priorities FROM client_business_priorities WHERE workspace_id = ?',
  ),
}));

/**
 * Format a single client-entered business priority into a prompt-safe string.
 *
 * Client priorities are stored as either a bare string (legacy) or a
 * `{ text, category }` object (current). The category, when present, is rendered
 * as a `[category]` prefix so downstream prompts can see the client's framing.
 *
 * This is the ONLY business-priority formatting site. Per the authority-layered-fields
 * rule (CLAUDE.md), formatting lives inside the resolver — there is no separate
 * `format*BusinessPriorities` helper a caller could grab and thereby bypass the
 * client→admin precedence + de-dup applied below. The pre-resolved
 * `ClientSignalsSlice.effectiveBusinessPriorities` is the single blessed representation.
 */
function formatClientBusinessPriority(priority: ClientBusinessPriorityInput): string {
  if (typeof priority === 'string') return priority.trim();
  const text = priority.text.trim();
  if (!text) return '';
  const category = priority.category?.trim();
  return category ? `[${category}] ${text}` : text;
}

/**
 * Read + format ONLY the CLIENT store (client_business_priorities, migration 021).
 *
 * Exposed as the RAW, read-only client-side field (`ClientSignalsSlice.businessPriorities`)
 * for legacy consumers that specifically need the client's own list. Prompt/ranking
 * callers MUST use `buildEffectiveBusinessPriorities()` instead, which also merges the
 * admin store. Mirrors `getRawBrandVoice` living alongside `buildEffectiveBrandVoiceBlock`
 * in seo-context-source.ts — both the raw read and the resolved read live in this one
 * module so there is no external format helper to bypass the authority chain.
 */
export function getRawClientBusinessPriorities(workspaceId: string): string[] {
  return readClientPriorities(workspaceId);
}

/** Read + format the CLIENT store (client_business_priorities, migration 021). */
function readClientPriorities(workspaceId: string): string[] {
  try {
    const row = stmts().clientBusinessPriorities.get(workspaceId) as { priorities: string } | undefined;
    if (!row) return [];
    const parsed = parseJsonSafeArray(
      row.priorities,
      clientBusinessPrioritySchema,
      { workspaceId, field: 'priorities', table: 'client_business_priorities' },
    );
    return parsed
      .map(formatClientBusinessPriority)
      .filter((priority): priority is string => priority.length > 0);
  } catch (err) {
    log.debug({ err, workspaceId }, 'readClientPriorities: client_business_priorities optional, degrading gracefully');
    return [];
  }
}

/** Read the ADMIN store (workspaces.business_priorities, migration 048). */
function readAdminPriorities(workspaceId: string): string[] {
  const ws = getWorkspace(workspaceId);
  if (!ws?.businessPriorities?.length) return [];
  return ws.businessPriorities.map(p => p.trim()).filter(p => p.length > 0);
}

/**
 * Resolve the two siloed business-priority stores into ONE representation.
 *
 * Authority layers (mirrors `buildEffectiveBrandVoiceBlock` in seo-context-source.ts):
 *   1. CLIENT store — `client_business_priorities` (migration 021), entered by the
 *      customer via the portal questionnaire.
 *   2. ADMIN store — `workspaces.business_priorities` (migration 048), set by the
 *      admin for AI context. The 048 migration explicitly notes it is distinct from
 *      the client table; this resolver is the only place the two ever merge.
 *
 * PRECEDENCE: client-entered priorities come FIRST — they are the customer's own
 * stated goals and outrank an admin's interpretation of them. Admin-set priorities
 * are appended as a SUPPLEMENT, and any admin entry that merely restates a client
 * priority (case-insensitive, whitespace-trimmed) is dropped so the resolved list
 * never double-counts the same intent.
 */
export function buildEffectiveBusinessPriorities(workspaceId: string): string[] {
  const clientPriorities = readClientPriorities(workspaceId);
  const adminPriorities = readAdminPriorities(workspaceId);

  const resolved: string[] = [];
  const seen = new Set<string>();
  // Client first (higher authority), admin second (supplement).
  for (const priority of [...clientPriorities, ...adminPriorities]) {
    const key = priority.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    resolved.push(priority);
  }
  return resolved;
}
