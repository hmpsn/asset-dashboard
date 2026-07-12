import type {
  BacklinksOverview,
  BusinessListingResult,
  BusinessListingsRequest,
  DomainAuthorityMetric,
  DomainKeyword,
  DomainOverview,
  KeywordGapEntry,
  KeywordMetrics,
  LlmMentionsRequest,
  LlmMentionsResult,
  NationalSerpProviderRequest,
  NationalSerpResult,
  OrganicCompetitor,
  QuestionKeyword,
  ReferringDomain,
  RelatedKeyword,
  SeoDataProvider,
} from '../seo-data-provider.js';
import {
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
  LOCAL_SEO_LOCATION_LOOKUP_STATUS,
  type LocalSeoLocationLookupRequest,
  type LocalSeoLocationLookupResponse,
  type LocalVisibilityProviderRequest,
  type LocalVisibilityProviderResult,
} from '../../shared/types/local-seo.js';
import { LOCAL_PROVIDER_FIXTURE } from './local-provider-fixtures.js';

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

  async getKeywordMetrics(keywords: string[], _workspaceId?: string, _database?: string, _locationCode?: number): Promise<KeywordMetrics[]> {
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

  async resolveLocalSeoLocation(
    request: LocalSeoLocationLookupRequest,
    workspaceId: string,
  ): Promise<LocalSeoLocationLookupResponse> {
    if (workspaceId !== LOCAL_PROVIDER_FIXTURE.workspaceId) {
      return {
        query: request,
        status: LOCAL_SEO_LOCATION_LOOKUP_STATUS.PROVIDER_UNAVAILABLE,
        candidates: [],
        degradedReason: 'Advanced local fixtures are scoped to the provider-rich demo workspace.',
      };
    }
    const candidate = {
      providerLocationCode: 1026201,
      providerLocationName: 'Austin,Texas,United States',
      countryIsoCode: 'US',
      locationType: 'City',
      score: 1,
    };
    return {
      query: request,
      status: LOCAL_SEO_LOCATION_LOOKUP_STATUS.MATCHED,
      candidates: [candidate],
      bestCandidate: candidate,
    };
  }

  async getNationalSerp(
    request: NationalSerpProviderRequest,
    workspaceId: string,
  ): Promise<NationalSerpResult> {
    if (workspaceId !== LOCAL_PROVIDER_FIXTURE.workspaceId) {
      return {
        query: request.keyword,
        position: null,
        matchedUrl: null,
        features: [],
        aiOverviewPresent: false,
        aiOverviewCited: null,
      };
    }
    return {
      query: request.keyword,
      position: 3,
      matchedUrl: `https://${LOCAL_PROVIDER_FIXTURE.domain}/services/seo`,
      features: ['ai_overview', 'featured_snippet', 'people_also_ask', 'organic'],
      aiOverviewPresent: true,
      aiOverviewCited: true,
    };
  }

  async getBusinessListings(
    _request: BusinessListingsRequest,
    workspaceId: string,
  ): Promise<BusinessListingResult[]> {
    if (workspaceId !== LOCAL_PROVIDER_FIXTURE.workspaceId) return [];
    return [
      {
        title: LOCAL_PROVIDER_FIXTURE.businessName,
        placeId: LOCAL_PROVIDER_FIXTURE.gbpPlaceId,
        cid: 'cid_provider_rich_primary',
        domain: LOCAL_PROVIDER_FIXTURE.domain,
        category: 'Marketing agency',
        city: 'Austin',
        rating: 4.8,
        reviewCount: 187,
        ratingDistribution: { '1': 2, '2': 1, '3': 5, '4': 24, '5': 155 },
        attributes: {
          items: ['has_wheelchair_accessible_entrance', 'offers_online_appointments', 'identifies_as_women_owned'],
          completenessScore: 94,
        },
        totalPhotos: 64,
        claimed: true,
        isOwned: true,
      },
      {
        title: 'Signal Studio',
        placeId: 'place_signal_studio',
        domain: 'signal-studio.example',
        category: 'Marketing agency',
        city: 'Austin',
        rating: 4.9,
        reviewCount: 264,
        totalPhotos: 91,
        claimed: true,
        isOwned: false,
      },
      {
        title: 'North Loop Growth',
        placeId: 'place_north_loop_growth',
        domain: 'north-loop-growth.example',
        category: 'Internet marketing service',
        city: 'Austin',
        rating: 4.6,
        reviewCount: 143,
        totalPhotos: 38,
        claimed: true,
        isOwned: false,
      },
    ];
  }

  async getLlmMentions(
    request: LlmMentionsRequest,
    workspaceId: string,
  ): Promise<LlmMentionsResult> {
    if (workspaceId !== LOCAL_PROVIDER_FIXTURE.workspaceId) {
      return {
        domain: request.domain,
        platform: request.platform ?? 'chat_gpt',
        mentions: 0,
        aiSearchVolume: 0,
        competitors: [],
        sourceDomains: [],
      };
    }
    return {
      domain: LOCAL_PROVIDER_FIXTURE.domain,
      platform: request.platform ?? 'chat_gpt',
      mentions: 42,
      aiSearchVolume: 8_460,
      shareOfVoice: 0.42,
      competitors: [
        { name: 'Signal Studio', mentions: 31, aiSearchVolume: 6_240 },
        { name: 'North Loop Growth', mentions: 18, aiSearchVolume: 3_710 },
        { name: 'Searchcraft', mentions: 9, aiSearchVolume: 1_920 },
      ],
      sourceDomains: [
        { domain: LOCAL_PROVIDER_FIXTURE.domain, mentions: 27 },
        { domain: 'clutch.co', mentions: 11 },
        { domain: 'austinbusinessjournal.com', mentions: 7 },
      ],
    };
  }

  async getDomainAuthorityMetrics(
    domains: string[],
    workspaceId: string,
  ): Promise<DomainAuthorityMetric[]> {
    if (workspaceId !== LOCAL_PROVIDER_FIXTURE.workspaceId) return [];
    const fixtures: Record<string, Omit<DomainAuthorityMetric, 'domain'>> = {
      [LOCAL_PROVIDER_FIXTURE.domain]: { authorityRank: 61, top3Keywords: 148 },
      'signal-studio.example': { authorityRank: 54, top3Keywords: 93 },
      'north-loop-growth.example': { authorityRank: 48, top3Keywords: 71 },
    };
    return domains.flatMap((domain) => fixtures[domain] ? [{ domain, ...fixtures[domain] }] : []);
  }

  async getLocalVisibility(
    request: LocalVisibilityProviderRequest,
    workspaceId: string,
  ): Promise<LocalVisibilityProviderResult> {
    const providerRich = workspaceId === LOCAL_PROVIDER_FIXTURE.workspaceId;
    const domain = providerRich ? LOCAL_PROVIDER_FIXTURE.domain : 'example.com';
    return {
      keyword: request.keyword,
      marketId: request.market.id,
      provider: 'fake-seo-provider',
      sourceEndpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
      capturedAt: providerRich ? LOCAL_PROVIDER_FIXTURE.capturedAt : new Date().toISOString(),
      localPackPresent: true,
      status: LOCAL_VISIBILITY_STATUS.SUCCESS,
      results: [
        {
          title: `Synthetic ${request.market.city} Business`,
          rank: 1,
          domain,
          url: `https://${domain}/local`,
          address: `${request.market.city}, ${request.market.stateOrRegion ?? request.market.country}`,
        },
      ],
    };
  }
}
