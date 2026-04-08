/**
 * Competitor brand name detection — shared between analytics-intelligence and keyword-strategy.
 *
 * Extracts brand tokens from competitor domains and checks if keywords contain them.
 * Used to filter out branded competitor keywords from strategy recommendations and
 * competitive gap insights. Defense-in-depth: prompt tells the AI not to suggest them,
 * this filter catches anything the AI still produces.
 */

import { createLogger } from './logger.js';

const log = createLogger('competitor-brand-filter');

/** Common SaaS domain prefixes that aren't part of the actual brand name.
 *  "getdx.com" → brand is "dx", not "getdx"
 *  "tryjira.com" → brand is "jira", not "tryjira"
 */
const DOMAIN_PREFIXES = ['get', 'try', 'use', 'go', 'my', 'the', 'hey', 'with', 'meet', 'join'];

/** Known ccSLDs — when domain ends in one of these + a ccTLD, strip both.
 *  "competitor.co.uk" → "competitor" (not "competitor.co")
 */
const CC_SLDS = ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'];

export interface BrandToken {
  token: string;
  /** High-confidence tokens come from prefix stripping (e.g., "dx" from "getdx").
   *  These are matched even at 2 chars because we know they're the actual brand. */
  highConfidence: boolean;
}

/**
 * Extract brand tokens from a competitor domain.
 *
 * Examples:
 *   "getdx.com"       → ["getdx", "dx" (high)]
 *   "acme.co.uk"      → ["acme"]
 *   "my-tool.io"      → ["tool" (high), "mytool"]
 *   "semrush.com"     → ["semrush"]
 *   "linear.app"      → ["linear"]
 *   "try-notion.com"  → ["notion" (high), "trynotion"]
 */
export function extractBrandTokens(domain: string): string[] {
  return extractBrandTokensWithConfidence(domain).map(t => t.token);
}

export function extractBrandTokensWithConfidence(domain: string): BrandToken[] {
  // Strip protocol and www
  let base = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');

  // Handle ccSLDs: "competitor.co.uk" → strip ".co.uk"
  const dotParts = base.split('.');
  if (dotParts.length >= 3) {
    const secondLast = dotParts[dotParts.length - 2];
    if (CC_SLDS.includes(secondLast.toLowerCase())) {
      base = dotParts.slice(0, -2).join('.');
    } else {
      base = dotParts.slice(0, -1).join('.');
    }
  } else {
    // Simple TLD strip: "acme.com" → "acme"
    base = base.replace(/\.(com|co|io|ai|org|net|dev|app|xyz|us|me|so|sh|tools|cloud|software|tech|digital|agency|solutions|services|design|studio|works|build|run|site|online|store|click|page|land|space|host|world|zone|live|pro|team|work|plus|one|top|gg|tv|fm|to|is|do|it|at|by|in)$/i, '');
  }

  const tokens: BrandToken[] = [];
  const seen = new Set<string>();
  // Split on dots and hyphens
  const parts = base.split(/[.\-_]/);

  for (const p of parts) {
    const lc = p.toLowerCase();
    if (lc.length >= 2 && !seen.has(lc)) {
      tokens.push({ token: lc, highConfidence: false });
      seen.add(lc);
    }
  }

  // Also add the joined form (e.g., "mytool" from "my-tool")
  if (parts.length > 1) {
    const joined = parts.join('').toLowerCase();
    if (!seen.has(joined)) {
      tokens.push({ token: joined, highConfidence: false });
      seen.add(joined);
    }
  }

  // Extract core brand by stripping common prefixes — these are HIGH confidence
  // "getdx" → "dx", "trynotion" → "notion"
  for (const { token } of [...tokens]) {
    for (const prefix of DOMAIN_PREFIXES) {
      if (token.startsWith(prefix) && token.length > prefix.length + 1) {
        const core = token.slice(prefix.length);
        if (core.length >= 2 && !seen.has(core)) {
          tokens.push({ token: core, highConfidence: true });
          seen.add(core);
        }
      }
    }
  }

  return tokens;
}

/**
 * Check if a keyword is likely a branded search for a competitor.
 * Uses word-boundary matching for longer tokens and exact word matching for shorter ones.
 *
 * High-confidence tokens (from prefix stripping) match at 2+ chars.
 * Low-confidence tokens require 5+ chars for word-boundary match, 3-4 chars for exact word match.
 * Tokens < 3 chars that are NOT high-confidence are skipped — too ambiguous.
 */
export function isBrandedQuery(keyword: string, competitorBrandTokens: string[]): boolean {
  // Build full-confidence token list from domains for the enhanced check
  const lower = keyword.toLowerCase();
  const words = lower.split(/\s+/);

  return competitorBrandTokens.some(token => {
    // Skip very short tokens (1 char) — always too ambiguous
    if (token.length < 2) return false;

    // For 2-4 char tokens: exact word match only (avoids substring false positives)
    // "dx" matches "dx integrations" but NOT "redux toolkit"
    if (token.length < 5) {
      return words.some(w => w === token);
    }

    // Longer tokens: word-boundary regex match
    const regex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return regex.test(lower);
  });
}

/**
 * Filter content gaps to remove any containing competitor brand names.
 * Returns { filtered, removed } so callers can log what was dropped.
 */
export function filterBrandedContentGaps<T extends { targetKeyword: string; topic: string }>(
  contentGaps: T[],
  competitorDomains: string[],
): { filtered: T[]; removed: T[] } {
  if (competitorDomains.length === 0) return { filtered: contentGaps, removed: [] };

  // Build combined brand tokens from all competitor domains
  const allTokens: string[] = [];
  for (const domain of competitorDomains) {
    allTokens.push(...extractBrandTokens(domain));
  }
  const uniqueTokens = [...new Set(allTokens)];

  const filtered: T[] = [];
  const removed: T[] = [];

  for (const gap of contentGaps) {
    const keywordBranded = isBrandedQuery(gap.targetKeyword, uniqueTokens);
    const topicBranded = isBrandedQuery(gap.topic, uniqueTokens);

    if (keywordBranded || topicBranded) {
      removed.push(gap);
    } else {
      filtered.push(gap);
    }
  }

  if (removed.length > 0) {
    log.info(`Filtered ${removed.length} branded content gaps (tokens: ${uniqueTokens.join(', ')}): ${removed.map(g => g.targetKeyword).join(', ')}`);
  }

  return { filtered, removed };
}

/**
 * Filter a keyword pool map to remove branded competitor keywords.
 * Returns the number of keywords removed.
 */
export function filterBrandedKeywords(
  keywordPool: Map<string, { volume: number; difficulty: number; source: string }>,
  competitorDomains: string[],
): number {
  if (competitorDomains.length === 0) return 0;

  const allTokens: string[] = [];
  for (const domain of competitorDomains) {
    allTokens.push(...extractBrandTokens(domain));
  }
  const uniqueTokens = [...new Set(allTokens)];

  let removed = 0;
  for (const [kw] of keywordPool) {
    if (isBrandedQuery(kw, uniqueTokens)) {
      keywordPool.delete(kw);
      removed++;
    }
  }

  if (removed > 0) {
    log.info(`Removed ${removed} branded keywords from pool (tokens: ${uniqueTokens.join(', ')})`);
  }

  return removed;
}
