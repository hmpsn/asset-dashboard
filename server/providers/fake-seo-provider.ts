import type {
  BacklinksOverview,
  DomainKeyword,
  DomainOverview,
  KeywordGapEntry,
  KeywordMetrics,
  OrganicCompetitor,
  QuestionKeyword,
  ReferringDomain,
  RelatedKeyword,
  SeoDataProvider,
} from '../seo-data-provider.js';

function keywordMetric(keyword: string): KeywordMetrics {
  return {
    keyword,
    volume: 1200,
    difficulty: 38,
    cpc: 2.6,
    competition: 0.44,
    results: 1230000,
    trend: [66, 68, 70, 73, 75, 78, 80, 82, 84, 86, 88, 90],
  };
}

export class FakeSeoProvider implements SeoDataProvider {
  readonly name = 'fake-seo-provider';

  isConfigured(): boolean {
    return true;
  }

  async getKeywordMetrics(keywords: string[]): Promise<KeywordMetrics[]> {
    return keywords.map(keywordMetric);
  }

  async getRelatedKeywords(keyword: string, _workspaceId: string, limit = 10): Promise<RelatedKeyword[]> {
    return Array.from({ length: Math.max(1, limit) }, (_, idx) => ({
      keyword: `${keyword} variation ${idx + 1}`,
      volume: 900 - idx * 25,
      difficulty: 33 + (idx % 10),
      cpc: 2.2 + idx * 0.04,
    }));
  }

  async getQuestionKeywords(keyword: string, _workspaceId: string, limit = 10): Promise<QuestionKeyword[]> {
    return Array.from({ length: Math.max(1, limit) }, (_, idx) => ({
      keyword: `how to ${keyword} ${idx + 1}`,
      volume: 420 - idx * 12,
      difficulty: 25 + (idx % 8),
      cpc: 1.9 + idx * 0.03,
    }));
  }

  async getDomainKeywords(domain: string, _workspaceId: string, limit = 20): Promise<DomainKeyword[]> {
    return Array.from({ length: Math.max(1, limit) }, (_, idx) => ({
      keyword: `synthetic ${domain} keyword ${idx + 1}`,
      position: idx + 1,
      volume: 1400 - idx * 20,
      difficulty: 31 + (idx % 12),
      cpc: 2.7 + idx * 0.05,
      url: `https://${domain}/synthetic-page-${idx + 1}`,
      traffic: Math.max(20, 240 - idx * 7),
      trafficPercent: Math.max(0.2, 8.5 - idx * 0.18),
      trend: [62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84],
      serpFeatures: 'featured_snippet,people_also_ask',
    }));
  }

  async getUrlKeywords(url: string, workspaceId: string, limit = 20): Promise<DomainKeyword[]> {
    let parsedDomain = 'example.com';
    try {
      parsedDomain = new URL(url).host || parsedDomain;
    } catch (err) {
      void err;
    }
    return this.getDomainKeywords(parsedDomain, workspaceId, limit);
  }

  async getDomainOverview(domain: string): Promise<DomainOverview> {
    return {
      domain,
      organicKeywords: 3200,
      organicTraffic: 21800,
      organicCost: 14200,
      paidKeywords: 180,
      paidTraffic: 2600,
      paidCost: 5100,
    };
  }

  async getCompetitors(domain: string, _workspaceId: string, limit = 10): Promise<OrganicCompetitor[]> {
    return Array.from({ length: Math.max(1, limit) }, (_, idx) => ({
      domain: `competitor-${idx + 1}.${domain}`,
      competitorRelevance: Math.max(0.2, 0.92 - idx * 0.05),
      commonKeywords: Math.max(40, 620 - idx * 33),
      organicKeywords: Math.max(80, 5200 - idx * 180),
      organicTraffic: Math.max(120, 19000 - idx * 850),
      organicCost: Math.max(100, 11000 - idx * 450),
    }));
  }

  async getKeywordGap(clientDomain: string, competitorDomains: string[], _workspaceId: string, limit = 30): Promise<KeywordGapEntry[]> {
    const competitorDomain = competitorDomains[0] ?? `competitor.${clientDomain}`;
    return Array.from({ length: Math.max(1, limit) }, (_, idx) => ({
      keyword: `opportunity keyword ${idx + 1}`,
      volume: Math.max(80, 1800 - idx * 35),
      difficulty: 28 + (idx % 18),
      competitorPosition: 1 + (idx % 7),
      competitorDomain,
    }));
  }

  async getBacklinksOverview(): Promise<BacklinksOverview> {
    return {
      totalBacklinks: 1840,
      referringDomains: 360,
      followLinks: 1280,
      nofollowLinks: 560,
      textLinks: 1520,
      imageLinks: 210,
      formLinks: 35,
      frameLinks: 75,
    };
  }

  async getReferringDomains(domain: string, _workspaceId: string, limit = 20): Promise<ReferringDomain[]> {
    return Array.from({ length: Math.max(1, limit) }, (_, idx) => ({
      domain: `ref-${idx + 1}.${domain}`,
      backlinksCount: Math.max(1, 120 - idx * 3),
      firstSeen: '2025-01-01T00:00:00.000Z',
      lastSeen: '2026-05-01T00:00:00.000Z',
    }));
  }
}
