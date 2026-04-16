// ── SEO Data Provider Abstraction ──────────────────────────────
// Unified interface that both SEMRush and DataForSEO implement.
// Consumers call the registry instead of individual providers.

import { createLogger } from './logger.js';

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

// ── Provider Interface ────────────────────────────────────────

export interface SeoDataProvider {
  readonly name: string;

  /** Check if this provider has valid credentials configured */
  isConfigured(): boolean;

  /** Optional startup probe to detect unavailable capabilities early */
  init?(): Promise<void>;

  // Keyword Intelligence
  getKeywordMetrics(keywords: string[], workspaceId: string, database?: string): Promise<KeywordMetrics[]>;
  getRelatedKeywords(keyword: string, workspaceId: string, limit?: number, database?: string): Promise<RelatedKeyword[]>;
  getQuestionKeywords(keyword: string, workspaceId: string, limit?: number, database?: string): Promise<QuestionKeyword[]>;

  // Domain Analysis
  getDomainKeywords(domain: string, workspaceId: string, limit?: number, database?: string): Promise<DomainKeyword[]>;
  getDomainOverview(domain: string, workspaceId: string, database?: string): Promise<DomainOverview | null>;
  getCompetitors(domain: string, workspaceId: string, limit?: number, database?: string): Promise<OrganicCompetitor[]>;

  // Competitive Analysis
  getKeywordGap(clientDomain: string, competitorDomains: string[], workspaceId: string, limit?: number, database?: string): Promise<KeywordGapEntry[]>;

  // Backlinks
  getBacklinksOverview(domain: string, workspaceId: string, database?: string): Promise<BacklinksOverview | null>;
  getReferringDomains(domain: string, workspaceId: string, limit?: number, database?: string): Promise<ReferringDomain[]>;
}

// ── Provider Registry ─────────────────────────────────────────

export type ProviderName = 'semrush' | 'dataforseo';

const providers = new Map<ProviderName, SeoDataProvider>();

export function registerProvider(name: ProviderName, provider: SeoDataProvider): void {
  providers.set(name, provider);
  log.info(`Registered SEO data provider: ${name} (configured: ${provider.isConfigured()})`);
}

export function getProvider(name: ProviderName): SeoDataProvider | undefined {
  return providers.get(name);
}

export function getConfiguredProvider(preferred?: ProviderName): SeoDataProvider | null {
  // If a preferred provider is specified and configured, use it
  if (preferred) {
    const p = providers.get(preferred);
    if (p?.isConfigured()) return p;
  }
  // Fall back to any configured provider (prefer semrush for backwards compat)
  for (const name of ['semrush', 'dataforseo'] as ProviderName[]) {
    const p = providers.get(name);
    if (p?.isConfigured()) return p;
  }
  return null;
}

// ── Per-provider capability flags ──
// Providers can mark specific capabilities as unavailable (e.g. DataForSEO
// without a backlinks subscription). The registry uses this for fallback.
// Each entry stores an expiry timestamp (0 = permanent / no TTL).
const disabledCapabilities = new Map<ProviderName, Map<string, number>>();

export function markCapabilityDisabled(providerName: ProviderName, capability: string, ttlMs = 0): void {
  if (!disabledCapabilities.has(providerName)) disabledCapabilities.set(providerName, new Map());
  const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
  disabledCapabilities.get(providerName)!.set(capability, expiresAt);
  log.warn(`${providerName}: "${capability}" capability disabled${ttlMs > 0 ? ` for ${ttlMs / 1000 / 3600}h` : ''} — will fall back to alternate provider`);
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
  providers.clear();
  disabledCapabilities.clear();
}

/**
 * Generic capability-aware provider resolver.
 * Returns the preferred provider if the capability is available,
 * or falls back to any other configured provider that has it.
 */
export function getProviderForCapability(capability: string, preferred?: ProviderName): SeoDataProvider | null {
  const primary = getConfiguredProvider(preferred);
  if (!primary) return null;

  const primaryName = [...providers.entries()].find(([, p]) => p === primary)?.[0];
  if (primaryName && isCapabilityDisabled(primaryName, capability)) {
    // Primary provider cannot serve this capability — try fallbacks
    for (const [name, p] of providers.entries()) {
      if (name !== primaryName && p.isConfigured() && !isCapabilityDisabled(name, capability)) {
        return p;
      }
    }
    return null; // No fallback available
  }

  return primary;
}

/**
 * Get a provider that supports backlinks. If the preferred provider's backlinks
 * are unavailable (e.g. DataForSEO without backlinks subscription), falls back
 * to another configured provider that does support them.
 */
export function getBacklinksProvider(preferred?: ProviderName): SeoDataProvider | null {
  return getProviderForCapability('backlinks', preferred);
}

export function isAnyProviderConfigured(): boolean {
  for (const p of providers.values()) {
    if (p.isConfigured()) return true;
  }
  return false;
}

export function listProviders(): { name: ProviderName; configured: boolean }[] {
  return [...providers.entries()].map(([name, p]) => ({ name, configured: p.isConfigured() }));
}
