// ── SEO Data Provider Abstraction ──────────────────────────────
// Unified interface for the active SEO provider surface.
// Consumers call the registry instead of provider-specific modules.

import { createLogger } from './logger.js';
import type { KeywordSourceEvidence } from '../shared/types/keywords.js';
import type {
  LocalSeoLocationLookupRequest,
  LocalSeoLocationLookupResponse,
  LocalVisibilityProviderRequest,
  LocalVisibilityProviderResult,
} from '../shared/types/local-seo.js';

const log = createLogger('seo-data-provider');

// ── Common Result Types ──────────────────────────────────────

export interface KeywordMetrics {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  results: number;
  trend: number[];
}

export interface RelatedKeyword {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

export interface QuestionKeyword {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

export interface DomainKeyword {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number;
  cpc: number;
  url: string;
  traffic: number;
  trafficPercent: number;
  trend?: number[];
  serpFeatures?: string;
}

export interface DomainOverview {
  domain: string;
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;
  paidKeywords: number;
  paidTraffic: number;
  paidCost: number;
}

export interface OrganicCompetitor {
  domain: string;
  competitorRelevance: number;
  commonKeywords: number;
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;
}

export interface KeywordGapEntry {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

export interface BacklinksOverview {
  totalBacklinks: number;
  referringDomains: number;
  followLinks: number;
  nofollowLinks: number;
  textLinks: number;
  imageLinks: number;
  formLinks: number;
  frameLinks: number;
}

export interface ReferringDomain {
  domain: string;
  backlinksCount: number;
  firstSeen: string;
  lastSeen: string;
}

// ── National SERP (P6 / national-serp-tracking) ───────────────

/**
 * Request for a single national advanced-SERP read. `ownerDomain` is the client's live
 * domain — the provider computes `position`/`matchedUrl`/`aiOverviewCited` RELATIVE to it.
 * Mirrors the `(request, workspaceId)` shape of `getLocalVisibility`.
 */
export interface NationalSerpProviderRequest {
  keyword: string;
  /** Client domain to match against organic results + AI-Overview references. */
  ownerDomain: string;
  /** Target-geo location code (P4); omit for the US default. */
  locationCode?: number;
  /** Target-geo language code (P4); omit for 'en'. */
  languageCode?: string;
  device?: 'desktop' | 'mobile';
}

/**
 * Parsed national advanced-SERP result for one keyword. All position/citation fields are
 * relative to `request.ownerDomain`. Built from `serp/google/organic/live/advanced` against
 * the ground-truth fixture `tests/fixtures/dataforseo-serp-advanced.ts` — not guessed shapes.
 */
export interface NationalSerpResult {
  query: string;
  /** Client best organic rank_group, or null when the client does not rank. */
  position: number | null;
  /** That ranking result's URL, or null when the client does not rank. */
  matchedUrl: string | null;
  /** Distinct SERP item types present (e.g. 'ai_overview', 'featured_snippet', 'people_also_ask', 'organic'). */
  features: string[];
  /** True when an ai_overview block is present on the SERP at all. */
  aiOverviewPresent: boolean;
  /** True when ownerDomain ∈ ai_overview.references[].domain; null when no AI Overview present. */
  aiOverviewCited: boolean | null;
}

// ── Provider Interface ────────────────────────────────────────

export interface SeoDataProvider {
  readonly name: string;

  /** Check if this provider has valid credentials configured */
  isConfigured(): boolean;

  /** Optional startup probe to detect unavailable capabilities early */
  init?(): Promise<void>;

  // Keyword Intelligence
  // `languageCode` (optional, defaults to 'en') threads the resolved workspace
  // language into pool-path provider calls so non-English markets aren't queried
  // in English (P1 / G13). Omitting it preserves the pre-P1 'en' behavior.
  // `locationCode` (optional) threads the resolved workspace geo into pool-path
  // provider calls so a non-US market is not queried with US-located discovery
  // (P1 / G13). Omitting it preserves the pre-P1 `locationCodeFromDatabase(database)`
  // behavior exactly. Mirrors the `getKeywordMetrics` (database?, locationCode?,
  // languageCode?) parameter shape.
  getKeywordMetrics(keywords: string[], workspaceId: string, database?: string, locationCode?: number, languageCode?: string): Promise<KeywordMetrics[]>;
  getRelatedKeywords(keyword: string, workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<RelatedKeyword[]>;
  getQuestionKeywords(keyword: string, workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<QuestionKeyword[]>;
  getKeywordIdeas?(keywords: string[], workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]>;
  getKeywordsForSite?(target: string, workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]>;
  getKeywordSuggestions?(keyword: string, workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]>;
  getKeywordsForKeywords?(keywords: string[], workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<KeywordSourceEvidence[]>;

  // Domain Analysis
  // `locationCode`/`languageCode` (optional, P4 / geo-targeting) thread the resolved
  // workspace target-geo so non-US clients' ranked keywords, domain overview, competitor
  // set, and keyword gap reflect their own market, not the US/'en' SERP. Omitting both
  // preserves the pre-P4 `locationCodeFromDatabase(database)` + 'en' behavior exactly.
  getDomainKeywords(domain: string, workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<DomainKeyword[]>;
  getUrlKeywords?(url: string, workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<DomainKeyword[]>;
  getDomainOverview(domain: string, workspaceId: string, database?: string, locationCode?: number, languageCode?: string): Promise<DomainOverview | null>;
  getCompetitors(domain: string, workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<OrganicCompetitor[]>;

  // Competitive Analysis
  getKeywordGap(clientDomain: string, competitorDomains: string[], workspaceId: string, limit?: number, database?: string, locationCode?: number, languageCode?: string): Promise<KeywordGapEntry[]>;

  // Backlinks
  getBacklinksOverview(domain: string, workspaceId: string, database?: string): Promise<BacklinksOverview | null>;
  getReferringDomains(domain: string, workspaceId: string, limit?: number, database?: string): Promise<ReferringDomain[]>;

  // Local SEO visibility
  resolveLocalSeoLocation?(request: LocalSeoLocationLookupRequest, workspaceId: string): Promise<LocalSeoLocationLookupResponse>;
  getLocalVisibility?(request: LocalVisibilityProviderRequest, workspaceId: string): Promise<LocalVisibilityProviderResult>;

  // National SERP rank + features (P6 / national-serp-tracking). Optional: providers without
  // advanced-SERP support omit it; callers must feature-detect before calling.
  getNationalSerp?(request: NationalSerpProviderRequest, workspaceId: string): Promise<NationalSerpResult>;
}

// ── Provider Registry ─────────────────────────────────────────

export type ProviderName = 'dataforseo';
export const DEFAULT_SEO_DATA_PROVIDER: ProviderName = 'dataforseo';

const providers = new Map<ProviderName, SeoDataProvider>();

export function registerProvider(name: ProviderName, provider: SeoDataProvider): void {
  providers.set(name, provider);
  log.info(`Registered SEO data provider: ${name} (configured: ${provider.isConfigured()})`);
}

export function getProvider(name: ProviderName): SeoDataProvider | undefined {
  return providers.get(name);
}

export function normalizeRuntimeSeoDataProvider(_provider?: string | null): ProviderName {
  return DEFAULT_SEO_DATA_PROVIDER;
}

export function getConfiguredProvider(_preferred?: ProviderName): SeoDataProvider | null {
  const provider = providers.get(DEFAULT_SEO_DATA_PROVIDER);
  return provider?.isConfigured() ? provider : null;
}

// ── Per-provider capability flags ──
// Providers can mark specific capabilities as unavailable (e.g. DataForSEO
// without a backlinks subscription). The registry uses this to skip optional
// enrichment for disabled capabilities.
// Each entry stores an expiry timestamp (0 = permanent / no TTL).
const disabledCapabilities = new Map<ProviderName, Map<string, number>>();

export function markCapabilityDisabled(providerName: ProviderName, capability: string, ttlMs = 0): void {
  if (!disabledCapabilities.has(providerName)) disabledCapabilities.set(providerName, new Map());
  const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
  disabledCapabilities.get(providerName)!.set(capability, expiresAt);
  log.warn(`${providerName}: "${capability}" capability disabled${ttlMs > 0 ? ` for ${ttlMs / 1000 / 3600}h` : ''}`);
}

export function isCapabilityDisabled(providerName: ProviderName, capability: string): boolean {
  const caps = disabledCapabilities.get(providerName);
  if (!caps) return false;
  const expiresAt = caps.get(capability);
  if (expiresAt === undefined) return false;
  // TTL-based entry: auto-clear when expired
  if (expiresAt > 0 && Date.now() >= expiresAt) {
    caps.delete(capability);
    log.info(`${providerName}: "${capability}" TTL expired — re-enabling`);
    return false;
  }
  return true;
}

export function clearCapabilityDisabled(providerName: ProviderName, capability: string): void {
  disabledCapabilities.get(providerName)?.delete(capability);
}

/** FOR TEST USE ONLY. Clears all registered providers and capability flags. */
export function _resetRegistryForTest(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('_resetRegistryForTest must not be called in production');
  }
  providers.clear();
  disabledCapabilities.clear();
}

export function getProviderDisplayName(providerName: string): string {
  return providerName === 'dataforseo' ? 'DataForSEO' : 'DataForSEO';
}

/**
 * Generic capability-aware provider resolver.
 * Returns the selected provider only if the requested capability is available.
 * Capability-specific calls do not silently fall back to alternate providers,
 * because that can spend credits on a provider the workspace did not select.
 */
export function getProviderForCapability(capability: string, preferred?: ProviderName): SeoDataProvider | null {
  const primary = getConfiguredProvider(preferred);
  if (!primary) return null;

  const primaryName = [...providers.entries()].find(([, p]) => p === primary)?.[0];
  // Backlinks IS gated here (P5): once a 40204 trips the backlinks breaker, this
  // returns null and callers degrade the optional backlink fields — matching the
  // getBacklinksProvider doc contract — instead of re-hitting the unsubscribed
  // endpoint every call. (Previously `capability !== 'backlinks'` skipped the check.)
  if (primaryName && isCapabilityDisabled(primaryName, capability)) {
    return null;
  }

  return primary;
}

/**
 * Get the selected provider for backlinks.
 *
 * Backlinks are intentionally strict: if DataForSEO is selected/default and its
 * backlinks capability is disabled, return null and let callers degrade the
 * optional backlink fields instead of silently falling back to an unavailable provider.
 */
export function getBacklinksProvider(preferred?: ProviderName): SeoDataProvider | null {
  return getProviderForCapability('backlinks', preferred);
}

export function isAnyProviderConfigured(): boolean {
  return providers.get(DEFAULT_SEO_DATA_PROVIDER)?.isConfigured() ?? false;
}

export function listProviders(): { name: ProviderName; configured: boolean }[] {
  return [...providers.entries()].map(([name, p]) => ({ name, configured: p.isConfigured() }));
}

/**
 * Normalize a provider-supplied date string to ISO-8601.
 *
 * Handles the three formats our providers return:
 *   - Unix epoch seconds as a string: "1747509061"
 *   - Unix epoch milliseconds: "1747509061000"
 *   - DataForSEO "YYYY-MM-DD HH:mm:ss +00:00" (ISO-parseable)
 *   - ISO-8601 pass-through: "2025-05-17T00:00:00.000Z"
 *
 * Returns '' for empty, zero/negative epochs, and unparseable input. The empty
 * return is intentional — the frontend falsy-check renders '—' instead of
 * "Invalid Date", which is the whole reason this helper exists.
 *
 * See docs/rules/automated-rules.md → "Raw provider date passed to new Date()".
 */
export function normalizeProviderDate(raw: string): string {
  if (!raw) return '';

  // Numeric string → Unix epoch (sec vs ms discriminated by magnitude)
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return '';
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  // Otherwise try Date.parse (handles ISO-8601 and DFS "YYYY-MM-DD HH:mm:ss +00:00")
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString();
}
