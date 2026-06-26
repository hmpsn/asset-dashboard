import {
  EEAT_ASSET_TYPE,
  EEAT_PAGE_TYPE,
  EEAT_RECOMMENDATION_SURFACE,
  TRUST_SIGNAL_SEVERITY,
  type EeatAsset,
  type EeatAssetRecommendation,
  type EeatPageType,
  type EeatRecommendationSurface,
  type MissingTrustSignal,
} from '../shared/types/eeat-assets.js';
import { normalizePageUrl } from './utils/page-address.js';

interface TrustSignalRule {
  signal: string;
  rationale: string;
  severity: MissingTrustSignal['severity'];
  recommendedAssetTypes: MissingTrustSignal['recommendedAssetTypes'];
}

interface EvaluateTrustSignalsInput {
  pagePath: string;
  pageTitle?: string;
  searchIntent?: string;
  assets: EeatAsset[];
  surface: EeatRecommendationSurface;
  maxRecommendations?: number;
}

interface EvaluateTrustSignalsResult {
  pageType: EeatPageType;
  missingTrustSignals: MissingTrustSignal[];
  eeatAssetRecommendations: EeatAssetRecommendation[];
}

function includesAnyToken(value: string, tokens: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return tokens.some(token => lower.includes(token));
}

export function deriveEeatPageType(pagePath: string, pageTitle?: string, searchIntent?: string): EeatPageType {
  const normalizedPath = normalizePageUrl(pagePath).toLowerCase();
  const title = (pageTitle || '').toLowerCase();
  const intent = (searchIntent || '').toLowerCase();

  if (normalizedPath === '/') return EEAT_PAGE_TYPE.HOMEPAGE;
  if (includesAnyToken(normalizedPath, ['/services', '/service/', '/solutions', '/offerings'])) return EEAT_PAGE_TYPE.SERVICE;
  if (includesAnyToken(normalizedPath, ['/locations', '/location/', '/areas-we-serve', '/cities'])) return EEAT_PAGE_TYPE.LOCATION;
  if (includesAnyToken(normalizedPath, ['/pricing', '/book', '/schedule', '/contact']) || intent === 'transactional') return EEAT_PAGE_TYPE.LANDING;
  if (includesAnyToken(normalizedPath, ['/product', '/products', '/shop', '/store'])) return EEAT_PAGE_TYPE.PRODUCT;
  if (includesAnyToken(normalizedPath, ['/about', '/team', '/our-story'])) return EEAT_PAGE_TYPE.ABOUT;
  if (includesAnyToken(normalizedPath, ['/case-study', '/case-studies', '/our-work'])) return EEAT_PAGE_TYPE.CASE_STUDY;
  if (includesAnyToken(normalizedPath, ['/testimonial', '/testimonials', '/reviews'])) return EEAT_PAGE_TYPE.TESTIMONIAL;
  if (includesAnyToken(normalizedPath, ['/blog', '/insights', '/resources', '/guides', '/learn'])) return EEAT_PAGE_TYPE.ARTICLE;
  if (includesAnyToken(title, ['case study', 'customer story'])) return EEAT_PAGE_TYPE.CASE_STUDY;
  if (includesAnyToken(title, ['service', 'solution'])) return EEAT_PAGE_TYPE.SERVICE;
  if (includesAnyToken(title, ['review', 'testimonial'])) return EEAT_PAGE_TYPE.TESTIMONIAL;
  return EEAT_PAGE_TYPE.OTHER;
}

const PAGE_TYPE_RULES: Record<EeatPageType, TrustSignalRule[]> = {
  [EEAT_PAGE_TYPE.HOMEPAGE]: [
    {
      signal: 'Outcome proof',
      rationale: 'Homepage claims should be backed by concrete customer results.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.CASE_STUDY, EEAT_ASSET_TYPE.TESTIMONIAL],
    },
    {
      signal: 'Authority markers',
      rationale: 'Homepage authority improves trust when awards and credentials are visible.',
      severity: TRUST_SIGNAL_SEVERITY.MEDIUM,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.CREDENTIAL, EEAT_ASSET_TYPE.AWARD],
    },
  ],
  [EEAT_PAGE_TYPE.SERVICE]: [
    {
      signal: 'Service proof',
      rationale: 'Service pages need explicit proof that outcomes were achieved for real clients.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TESTIMONIAL, EEAT_ASSET_TYPE.CASE_STUDY],
    },
    {
      signal: 'Practitioner expertise',
      rationale: 'Service pages should identify qualified experts and credentials.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TEAM_BIO, EEAT_ASSET_TYPE.CREDENTIAL],
    },
  ],
  [EEAT_PAGE_TYPE.LOCATION]: [
    {
      signal: 'Local trust proof',
      rationale: 'Location pages perform better with local testimonials and recognizable client logos.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TESTIMONIAL, EEAT_ASSET_TYPE.CLIENT_LOGO],
    },
    {
      signal: 'Local expertise',
      rationale: 'Location pages should show who provides the service and what credentials they hold.',
      severity: TRUST_SIGNAL_SEVERITY.MEDIUM,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TEAM_BIO, EEAT_ASSET_TYPE.CREDENTIAL],
    },
  ],
  [EEAT_PAGE_TYPE.PRODUCT]: [
    {
      signal: 'Buyer proof',
      rationale: 'Product pages need social proof and measurable outcomes for purchase confidence.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TESTIMONIAL, EEAT_ASSET_TYPE.CASE_STUDY],
    },
    {
      signal: 'Independent support',
      rationale: 'Product trust increases when external research or certifications are cited.',
      severity: TRUST_SIGNAL_SEVERITY.MEDIUM,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.RESEARCH, EEAT_ASSET_TYPE.CREDENTIAL],
    },
  ],
  [EEAT_PAGE_TYPE.LANDING]: [
    {
      signal: 'Conversion trust signals',
      rationale: 'Landing pages should include immediate proof near CTA sections.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TESTIMONIAL, EEAT_ASSET_TYPE.CLIENT_LOGO],
    },
  ],
  [EEAT_PAGE_TYPE.ARTICLE]: [
    {
      signal: 'Evidence citations',
      rationale: 'Articles should cite research and authoritative references to support claims.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.RESEARCH],
    },
    {
      signal: 'Author expertise',
      rationale: 'Articles need author credentials or expert bios for E-E-A-T strength.',
      severity: TRUST_SIGNAL_SEVERITY.MEDIUM,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TEAM_BIO, EEAT_ASSET_TYPE.CREDENTIAL],
    },
  ],
  [EEAT_PAGE_TYPE.ABOUT]: [
    {
      signal: 'Team credibility',
      rationale: 'About pages should clearly show experience and qualifications.',
      severity: TRUST_SIGNAL_SEVERITY.HIGH,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TEAM_BIO, EEAT_ASSET_TYPE.CREDENTIAL],
    },
    {
      signal: 'External validation',
      rationale: 'About pages gain authority with awards and recognitions.',
      severity: TRUST_SIGNAL_SEVERITY.MEDIUM,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.AWARD],
    },
  ],
  [EEAT_PAGE_TYPE.TESTIMONIAL]: [
    {
      signal: 'Outcome detail',
      rationale: 'Testimonial pages are stronger when supported by concrete case-study outcomes.',
      severity: TRUST_SIGNAL_SEVERITY.MEDIUM,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.CASE_STUDY],
    },
  ],
  [EEAT_PAGE_TYPE.CASE_STUDY]: [
    {
      signal: 'Attribution and authority',
      rationale: 'Case studies should include attributed quotes and supporting credentials.',
      severity: TRUST_SIGNAL_SEVERITY.MEDIUM,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TESTIMONIAL, EEAT_ASSET_TYPE.CREDENTIAL],
    },
  ],
  [EEAT_PAGE_TYPE.OTHER]: [
    {
      signal: 'General trust proof',
      rationale: 'Add at least one concrete trust signal to strengthen this page.',
      severity: TRUST_SIGNAL_SEVERITY.LOW,
      recommendedAssetTypes: [EEAT_ASSET_TYPE.TESTIMONIAL, EEAT_ASSET_TYPE.TEAM_BIO],
    },
  ],
};

function signalHasCoverage(rule: TrustSignalRule, assetsByType: Map<EeatAsset['type'], EeatAsset[]>): boolean {
  return rule.recommendedAssetTypes.some(type => (assetsByType.get(type)?.length ?? 0) > 0);
}

function recommendationReason(rule: TrustSignalRule, asset: EeatAsset, pageType: EeatPageType): string {
  return `Use this ${asset.type.replace(/_/g, ' ')} asset to support ${rule.signal.toLowerCase()} for ${pageType.replace(/_/g, ' ')} pages.`;
}

function candidateAssetsForRule(
  rule: TrustSignalRule,
  pagePath: string,
  assetsByType: Map<EeatAsset['type'], EeatAsset[]>,
): EeatAsset[] {
  const normalizedPath = normalizePageUrl(pagePath);
  const candidates = rule.recommendedAssetTypes.flatMap(type => assetsByType.get(type) ?? []);
  const pathMatched = candidates.filter(asset =>
    asset.metadata?.associatedPagePaths?.some(p => normalizePageUrl(p) === normalizedPath),
  );
  return pathMatched.length > 0 ? pathMatched : candidates;
}

export function evaluatePageTrustSignals(input: EvaluateTrustSignalsInput): EvaluateTrustSignalsResult {
  const pageType = deriveEeatPageType(input.pagePath, input.pageTitle, input.searchIntent);
  const rules = PAGE_TYPE_RULES[pageType] ?? PAGE_TYPE_RULES[EEAT_PAGE_TYPE.OTHER];
  const maxRecommendations = input.maxRecommendations ?? 3;

  const assetsByType = new Map<EeatAsset['type'], EeatAsset[]>();
  for (const asset of input.assets) {
    const list = assetsByType.get(asset.type) ?? [];
    list.push(asset);
    assetsByType.set(asset.type, list);
  }

  const missingTrustSignals: MissingTrustSignal[] = [];
  const eeatAssetRecommendations: EeatAssetRecommendation[] = [];

  for (const rule of rules) {
    if (signalHasCoverage(rule, assetsByType)) continue;
    missingTrustSignals.push({
      signal: rule.signal,
      rationale: rule.rationale,
      severity: rule.severity,
      recommendedAssetTypes: rule.recommendedAssetTypes,
    });
  }

  for (const rule of rules) {
    if (eeatAssetRecommendations.length >= maxRecommendations) break;
    const candidates = candidateAssetsForRule(rule, input.pagePath, assetsByType);
    for (const asset of candidates) {
      if (eeatAssetRecommendations.some(existing => existing.assetId === asset.id)) continue;
      eeatAssetRecommendations.push({
        assetId: asset.id,
        type: asset.type,
        title: asset.title,
        reason: recommendationReason(rule, asset, pageType),
        surface: input.surface,
        url: asset.url,
      });
      if (eeatAssetRecommendations.length >= maxRecommendations) break;
    }
  }

  return {
    pageType,
    missingTrustSignals,
    eeatAssetRecommendations,
  };
}

export function formatEeatRecommendation(asset: EeatAssetRecommendation): string {
  const ref = asset.url ? ` (${asset.url})` : '';
  return `${asset.title}${ref} — ${asset.reason}`;
}

export function formatMissingTrustSignal(signal: MissingTrustSignal): string {
  return `${signal.signal}: ${signal.rationale}`;
}

export { EEAT_RECOMMENDATION_SURFACE };
