// ── SEMRush Provider — wraps existing server/semrush.ts ──────
// Delegates all calls to the existing SEMRush client functions.
// No new API calls, no behavior changes.

import type {
  SeoDataProvider,
  KeywordMetrics,
  RelatedKeyword,
  QuestionKeyword,
  DomainKeyword,
  DomainOverview,
  OrganicCompetitor,
  KeywordGapEntry,
  BacklinksOverview,
  ReferringDomain,
} from '../seo-data-provider.js';
import {
  isSemrushConfigured,
  getKeywordOverview,
  getRelatedKeywords as semrushRelated,
  getQuestionKeywords as semrushQuestions,
  getDomainOrganicKeywords,
  getDomainOverview as semrushDomainOverview,
  getOrganicCompetitors,
  getKeywordGap as semrushKeywordGap,
  getBacklinksOverview as semrushBacklinksOverview,
  getTopReferringDomains,
} from '../semrush.js';

export class SemrushProvider implements SeoDataProvider {
  readonly name = 'semrush';

  isConfigured(): boolean {
    return isSemrushConfigured();
  }

  async getKeywordMetrics(keywords: string[], workspaceId: string, database = 'us'): Promise<KeywordMetrics[]> {
    return getKeywordOverview(keywords, workspaceId, database);
  }

  async getRelatedKeywords(keyword: string, workspaceId: string, limit = 20, database = 'us'): Promise<RelatedKeyword[]> {
    return semrushRelated(keyword, workspaceId, limit, database);
  }

  async getQuestionKeywords(keyword: string, workspaceId: string, limit = 20, database = 'us'): Promise<QuestionKeyword[]> {
    return semrushQuestions(keyword, workspaceId, limit, database);
  }

  async getDomainKeywords(domain: string, workspaceId: string, limit = 100, database = 'us'): Promise<DomainKeyword[]> {
    return getDomainOrganicKeywords(domain, workspaceId, limit, database);
  }

  async getDomainOverview(domain: string, workspaceId: string, database = 'us'): Promise<DomainOverview | null> {
    return semrushDomainOverview(domain, workspaceId, database);
  }

  async getCompetitors(domain: string, workspaceId: string, limit = 10, database = 'us'): Promise<OrganicCompetitor[]> {
    return getOrganicCompetitors(domain, workspaceId, limit, database);
  }

  async getKeywordGap(clientDomain: string, competitorDomains: string[], workspaceId: string, limit = 50, database = 'us'): Promise<KeywordGapEntry[]> {
    return semrushKeywordGap(clientDomain, competitorDomains, workspaceId, limit, database);
  }

  async getBacklinksOverview(domain: string, workspaceId: string, database = 'us'): Promise<BacklinksOverview | null> {
    return semrushBacklinksOverview(domain, workspaceId, database);
  }

  async getReferringDomains(domain: string, workspaceId: string, limit = 20, database = 'us'): Promise<ReferringDomain[]> {
    return getTopReferringDomains(domain, workspaceId, limit, database);
  }
}
