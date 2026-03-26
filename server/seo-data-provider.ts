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

export function isAnyProviderConfigured(): boolean {
  for (const p of providers.values()) {
    if (p.isConfigured()) return true;
  }
  return false;
}

export function listProviders(): { name: ProviderName; configured: boolean }[] {
  return [...providers.entries()].map(([name, p]) => ({ name, configured: p.isConfigured() }));
}
