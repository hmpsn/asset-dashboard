import { getTaxonomyForIndustry } from '../../service-taxonomy.js';
import { LOCAL_SEO_POSTURE, type LocalSeoMarket, type LocalSeoWorkspaceSettings } from '../../../shared/types/local-seo.js';
import type { Workspace } from '../../../shared/types/workspace.js';
import { normalizeText } from './keyword-intent.js';

export interface LocalSeoPageKeywordEvidence {
  pagePath?: string;
  pageTitle?: string;
  primaryKeyword?: string;
}

export function buildWorkspaceGeoRegex(workspace: Workspace, markets: LocalSeoMarket[]): RegExp | null {
  const terms: string[] = [];

  for (const market of markets) {
    const city = normalizeText(market.city);
    const state = normalizeText(market.stateOrRegion);
    if (city) terms.push(city);
    if (state) terms.push(state);
  }

  const bpCity = normalizeText(workspace.businessProfile?.address?.city);
  const bpState = normalizeText(workspace.businessProfile?.address?.state);
  if (bpCity) terms.push(bpCity);
  if (bpState) terms.push(bpState);

  const uniqueTerms = [...new Set(terms.filter(Boolean))];
  const geoTermPart = uniqueTerms.map(t => `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).join('|');
  const combined = geoTermPart
    ? `\\bnear me\\b|\\/location\\/${geoTermPart ? `|${geoTermPart}` : ''}`
    : null;

  return combined ? new RegExp(combined, 'i') : null;
}

export function buildWorkspaceServiceTermRegex(workspace: Workspace): RegExp {
  const terms: string[] = [];

  const taxonomy = getTaxonomyForIndustry(workspace.intelligenceProfile?.industry);
  if (taxonomy) {
    for (const service of taxonomy) {
      for (const term of service.matchTerms) {
        terms.push(term.toLowerCase());
      }
    }
  }

  if (!taxonomy) {
    const implicitIndustryHints = [
      workspace.name,
      workspace.keywordStrategy?.businessContext,
      workspace.knowledgeBase,
    ].filter(Boolean).join(' ');
    const implicitTaxonomy = getTaxonomyForIndustry(implicitIndustryHints);
    if (implicitTaxonomy) {
      for (const service of implicitTaxonomy) {
        for (const term of service.matchTerms) {
          terms.push(term.toLowerCase());
        }
      }
    }
  }

  const keywordTokenStopwords = new Set([
    'best', 'near', 'your', 'with', 'guide', 'this', 'that', 'from', 'into',
    'over', 'than', 'then', 'when', 'more', 'also', 'have', 'will', 'what',
    'where', 'which', 'they', 'them', 'their', 'been', 'were', 'very',
  ]);
  for (const kw of workspace.keywordStrategy?.siteKeywords ?? []) {
    const tokens = kw.toLowerCase().trim().split(/\s+/);
    for (const token of tokens) {
      if (token.length >= 4 && !keywordTokenStopwords.has(token)) terms.push(token);
    }
  }

  if (terms.length === 0) {
    return /\bservice\b|\bclinic\b|\bcontractor\b|\brestaurant\b|\bsalon\b|\bspa\b|\boffice\b/i;
  }

  const escaped = [...new Set(terms.filter(Boolean))]
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

export function deriveLocalSeoPosture(
  workspace: Workspace,
  markets: LocalSeoMarket[],
  pageKeywords: LocalSeoPageKeywordEvidence[],
): Pick<LocalSeoWorkspaceSettings, 'suggestedPosture' | 'suggestionReasons'> {
  const reasons: string[] = [];
  const profile = workspace.businessProfile;
  if (profile?.address?.city && profile.address.state) reasons.push('Business profile has city/state contact evidence');
  const industry = workspace.intelligenceProfile?.industry?.toLowerCase() ?? '';
  if (/dent|clinic|medical|legal|law|restaurant|contractor|home service|salon|spa/.test(industry)) reasons.push('Industry commonly depends on local intent');
  const pageTerms = pageKeywords
    .slice(0, 75)
    .map(page => `${page.pagePath} ${page.pageTitle} ${page.primaryKeyword}`.toLowerCase())
    .join(' ');
  const workspaceGeoRegex = buildWorkspaceGeoRegex(workspace, markets);
  const geoPattern = workspaceGeoRegex ?? /\bnear me\b|\/location\//;
  if (geoPattern.test(pageTerms)) reasons.push('Page map contains local/service-area terms');
  if (reasons.length >= 2) return { suggestedPosture: LOCAL_SEO_POSTURE.LOCAL, suggestionReasons: reasons };
  if (reasons.length === 1) return { suggestedPosture: LOCAL_SEO_POSTURE.HYBRID, suggestionReasons: reasons };
  return { suggestedPosture: LOCAL_SEO_POSTURE.UNKNOWN, suggestionReasons: ['No explicit local market evidence found yet'] };
}
