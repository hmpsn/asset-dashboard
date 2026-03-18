/**
 * Cannibalization Detection — identifies keyword overlap between:
 * 1. Matrix cells and existing pages (from keyword strategy pageMap)
 * 2. Cells within the same matrix
 * 3. Cells across different matrices in the same workspace
 *
 * Returns conflict objects with severity (high/medium/low) based on
 * how closely the keywords match.
 */
import { getWorkspace } from './workspaces.js';
import { listMatrices } from './content-matrices.js';
import { createLogger } from './logger.js';

const log = createLogger('cannibalization');

// ── Types ──

export interface CannibalizationConflict {
  /** The keyword being checked */
  keyword: string;
  /** ID of the cell or source being checked */
  sourceId: string;
  /** What the keyword conflicts with */
  conflictsWith: {
    type: 'existing_page' | 'same_matrix' | 'other_matrix';
    keyword: string;
    /** Page path or cell ID or matrix name */
    identifier: string;
    /** Additional context */
    label?: string;
  };
  /** How severe the overlap is */
  severity: 'high' | 'medium' | 'low';
  /** Human-readable description */
  reason: string;
}

export interface CannibalizationReport {
  workspaceId: string;
  matrixId?: string;
  conflicts: CannibalizationConflict[];
  checkedAt: string;
  summary: {
    high: number;
    medium: number;
    low: number;
    total: number;
  };
}

// ── Matching helpers ──

/**
 * Normalize a keyword for comparison: lowercase, collapse whitespace, strip punctuation.
 */
function normalize(kw: string): string {
  return kw.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Check if two keywords are an exact match (after normalization).
 */
function isExactMatch(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/**
 * Check if one keyword contains all words of the other (subset match).
 * "plumbing austin" is a subset of "emergency plumbing austin tx"
 */
function isSubsetMatch(shorter: string, longer: string): boolean {
  const shortWords = new Set(normalize(shorter).split(' '));
  const longWords = normalize(longer).split(' ');
  if (shortWords.size === 0) return false;
  let matched = 0;
  for (const w of shortWords) {
    if (longWords.includes(w)) matched++;
  }
  return matched / shortWords.size >= 0.8;
}

/**
 * Calculate word overlap ratio between two keywords.
 * Returns 0-1 where 1 = identical word sets.
 */
function wordOverlap(a: string, b: string): number {
  const aWords = new Set(normalize(a).split(' '));
  const bWords = new Set(normalize(b).split(' '));
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let intersection = 0;
  for (const w of aWords) {
    if (bWords.has(w)) intersection++;
  }
  const union = new Set([...aWords, ...bWords]).size;
  return intersection / union;
}

// ── Core detection ──

/**
 * Detect cannibalization conflicts for a single keyword against a set of existing targets.
 */
function detectConflicts(
  keyword: string,
  sourceId: string,
  targets: Array<{ keyword: string; type: CannibalizationConflict['conflictsWith']['type']; identifier: string; label?: string }>,
): CannibalizationConflict[] {
  const conflicts: CannibalizationConflict[] = [];

  for (const target of targets) {
    // Skip self-comparison
    if (sourceId === target.identifier) continue;

    if (isExactMatch(keyword, target.keyword)) {
      conflicts.push({
        keyword,
        sourceId,
        conflictsWith: target,
        severity: 'high',
        reason: `Exact keyword match with ${target.type === 'existing_page' ? 'existing page' : 'another cell'}: "${target.keyword}"`,
      });
    } else if (isSubsetMatch(keyword, target.keyword) || isSubsetMatch(target.keyword, keyword)) {
      conflicts.push({
        keyword,
        sourceId,
        conflictsWith: target,
        severity: 'medium',
        reason: `Keyword subset overlap with "${target.keyword}" — may compete for same SERP`,
      });
    } else {
      const overlap = wordOverlap(keyword, target.keyword);
      if (overlap >= 0.6) {
        conflicts.push({
          keyword,
          sourceId,
          conflictsWith: target,
          severity: 'low',
          reason: `${Math.round(overlap * 100)}% word overlap with "${target.keyword}" — potential partial cannibalization`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Run full cannibalization detection for a matrix.
 * Checks each cell's keyword against:
 * 1. Existing pages from the workspace's keyword strategy pageMap
 * 2. Other cells in the same matrix
 * 3. Cells in other matrices in the same workspace
 */
export function detectMatrixCannibalization(
  workspaceId: string,
  matrixId: string,
): CannibalizationReport {
  const allConflicts: CannibalizationConflict[] = [];

  // Get the target matrix
  const matrices = listMatrices(workspaceId);
  const targetMatrix = matrices.find(m => m.id === matrixId);
  if (!targetMatrix) {
    return {
      workspaceId,
      matrixId,
      conflicts: [],
      checkedAt: new Date().toISOString(),
      summary: { high: 0, medium: 0, low: 0, total: 0 },
    };
  }

  // Build target sets
  const existingPageTargets: Array<{ keyword: string; type: 'existing_page'; identifier: string; label?: string }> = [];
  const ws = getWorkspace(workspaceId);
  const pageMap = ws?.keywordStrategy?.pageMap;
  if (pageMap?.length) {
    for (const p of pageMap) {
      if (p.primaryKeyword) {
        existingPageTargets.push({
          keyword: p.primaryKeyword,
          type: 'existing_page',
          identifier: p.pagePath,
          label: p.pagePath,
        });
      }
      if (p.secondaryKeywords?.length) {
        for (const sk of p.secondaryKeywords) {
          existingPageTargets.push({
            keyword: sk,
            type: 'existing_page',
            identifier: p.pagePath,
            label: `${p.pagePath} (secondary)`,
          });
        }
      }
    }
  }

  // Same-matrix targets
  const sameMatrixTargets = targetMatrix.cells.map(c => ({
    keyword: c.targetKeyword,
    type: 'same_matrix' as const,
    identifier: c.id,
    label: `Cell: ${c.variableValues ? Object.values(c.variableValues).join(' × ') : c.targetKeyword}`,
  }));

  // Other-matrix targets
  const otherMatrixTargets: Array<{ keyword: string; type: 'other_matrix'; identifier: string; label?: string }> = [];
  for (const m of matrices) {
    if (m.id === matrixId) continue;
    for (const c of m.cells) {
      otherMatrixTargets.push({
        keyword: c.targetKeyword,
        type: 'other_matrix',
        identifier: c.id,
        label: `${m.name}: ${c.targetKeyword}`,
      });
    }
  }

  // Check each cell against all target sets
  for (const cell of targetMatrix.cells) {
    const cellConflicts = [
      ...detectConflicts(cell.targetKeyword, cell.id, existingPageTargets),
      ...detectConflicts(cell.targetKeyword, cell.id, sameMatrixTargets),
      ...detectConflicts(cell.targetKeyword, cell.id, otherMatrixTargets),
    ];
    allConflicts.push(...cellConflicts);
  }

  // Deduplicate symmetric conflicts (A conflicts with B = B conflicts with A)
  const seen = new Set<string>();
  const deduped = allConflicts.filter(c => {
    const key = [c.sourceId, c.conflictsWith.identifier].sort().join('::') + '::' + c.severity;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = {
    high: deduped.filter(c => c.severity === 'high').length,
    medium: deduped.filter(c => c.severity === 'medium').length,
    low: deduped.filter(c => c.severity === 'low').length,
    total: deduped.length,
  };

  log.info({ workspaceId, matrixId, ...summary }, 'Cannibalization check complete');

  return {
    workspaceId,
    matrixId,
    conflicts: deduped,
    checkedAt: new Date().toISOString(),
    summary,
  };
}

/**
 * Check a single keyword for cannibalization against existing pages and all matrices.
 * Useful for validating a keyword before adding it to a cell.
 */
export function checkKeywordCannibalization(
  workspaceId: string,
  keyword: string,
): CannibalizationConflict[] {
  const targets: Array<{ keyword: string; type: CannibalizationConflict['conflictsWith']['type']; identifier: string; label?: string }> = [];

  // Existing pages
  const ws = getWorkspace(workspaceId);
  const pageMap = ws?.keywordStrategy?.pageMap;
  if (pageMap?.length) {
    for (const p of pageMap) {
      if (p.primaryKeyword) {
        targets.push({ keyword: p.primaryKeyword, type: 'existing_page', identifier: p.pagePath, label: p.pagePath });
      }
      for (const sk of (p.secondaryKeywords || [])) {
        targets.push({ keyword: sk, type: 'existing_page', identifier: p.pagePath, label: `${p.pagePath} (secondary)` });
      }
    }
  }

  // All matrix cells
  const matrices = listMatrices(workspaceId);
  for (const m of matrices) {
    for (const c of m.cells) {
      targets.push({ keyword: c.targetKeyword, type: 'other_matrix', identifier: c.id, label: `${m.name}: ${c.targetKeyword}` });
    }
  }

  return detectConflicts(keyword, 'check', targets);
}
