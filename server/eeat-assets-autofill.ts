import { EEAT_ASSET_TYPE, type EeatAsset, type EeatAssetType } from '../shared/types/eeat-assets.js';
import type { PageKeywordMap, Workspace } from '../shared/types/workspace.ts';
import type { CreateEeatAssetInput } from './schemas/eeat-assets.js';

interface AutofillBucket {
  signals: Set<string>;
  rationales: Set<string>;
  pagePaths: Set<string>;
  serviceKeywords: Set<string>;
}

interface BuildEeatAutofillInput {
  workspace: Workspace;
  pageKeywords: PageKeywordMap[];
  existingAssets: EeatAsset[];
  limit?: number;
}

const TYPE_PRIORITY: EeatAssetType[] = [
  EEAT_ASSET_TYPE.TEAM_BIO,
  EEAT_ASSET_TYPE.CREDENTIAL,
  EEAT_ASSET_TYPE.TESTIMONIAL,
  EEAT_ASSET_TYPE.CASE_STUDY,
  EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
  EEAT_ASSET_TYPE.RESEARCH,
  EEAT_ASSET_TYPE.AWARD,
  EEAT_ASSET_TYPE.CLIENT_LOGO,
];

function titleForType(type: EeatAssetType, workspaceName: string): string {
  switch (type) {
    case EEAT_ASSET_TYPE.TESTIMONIAL:
      return `${workspaceName} testimonials and patient feedback`;
    case EEAT_ASSET_TYPE.CASE_STUDY:
      return `${workspaceName} outcome case studies`;
    case EEAT_ASSET_TYPE.CREDENTIAL:
      return `${workspaceName} certifications and professional credentials`;
    case EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY:
      return `${workspaceName} before/after proof gallery`;
    case EEAT_ASSET_TYPE.TEAM_BIO:
      return `${workspaceName} expert team bios`;
    case EEAT_ASSET_TYPE.AWARD:
      return `${workspaceName} awards and recognitions`;
    case EEAT_ASSET_TYPE.RESEARCH:
      return `${workspaceName} cited research and evidence sources`;
    case EEAT_ASSET_TYPE.CLIENT_LOGO:
      return `${workspaceName} partner and trust logos`;
  }
}

function ensureBucket(byType: Map<EeatAssetType, AutofillBucket>, type: EeatAssetType): AutofillBucket {
  const existing = byType.get(type);
  if (existing) return existing;
  const created: AutofillBucket = {
    signals: new Set<string>(),
    rationales: new Set<string>(),
    pagePaths: new Set<string>(),
    serviceKeywords: new Set<string>(),
  };
  byType.set(type, created);
  return created;
}

function fallbackCandidates(workspace: Workspace): CreateEeatAssetInput[] {
  const candidates: CreateEeatAssetInput[] = [];
  const bp = workspace.businessProfile;
  const hasAddressOrPhone = Boolean(bp?.phone || bp?.address?.street || bp?.address?.city || bp?.address?.state);
  const hasFoundingSignals = Boolean(bp?.foundedDate || bp?.numberOfEmployees);
  const workspaceName = workspace.name || 'Business';

  if (hasAddressOrPhone) {
    candidates.push({
      type: EEAT_ASSET_TYPE.TEAM_BIO,
      title: `${workspaceName} local team and service expertise`,
      content: 'Auto-filled baseline candidate from business profile contact/location data. Add provider names, roles, and qualifications.',
      metadata: {
        locations: [bp?.address?.city, bp?.address?.state].filter(Boolean) as string[],
        tags: ['auto-fill', 'business-profile'],
      },
    });
  }

  if (hasFoundingSignals) {
    candidates.push({
      type: EEAT_ASSET_TYPE.CREDENTIAL,
      title: `${workspaceName} operating history and credentials`,
      content: 'Auto-filled baseline candidate from business profile history fields. Add licenses, certifications, and professional affiliations.',
      metadata: {
        metricLabel: bp?.foundedDate ? 'Founded' : undefined,
        metricValue: bp?.foundedDate || bp?.numberOfEmployees || undefined,
        tags: ['auto-fill', 'business-profile'],
      },
    });
  }

  return candidates;
}

export function buildEeatAutofillCandidates({
  workspace,
  pageKeywords,
  existingAssets,
  limit = 8,
}: BuildEeatAutofillInput): CreateEeatAssetInput[] {
  const workspaceName = workspace.name || 'Business';
  const existingTypeSet = new Set(existingAssets.map(asset => asset.type));
  const byType = new Map<EeatAssetType, AutofillBucket>();

  for (const page of pageKeywords) {
    const pagePath = page.pagePath?.trim() || '';
    const keyword = page.primaryKeyword?.trim() || '';
    for (const signal of page.missingTrustSignals || []) {
      for (const type of signal.recommendedAssetTypes || []) {
        const bucket = ensureBucket(byType, type);
        if (signal.signal) bucket.signals.add(signal.signal);
        if (signal.rationale) bucket.rationales.add(signal.rationale);
        if (pagePath) bucket.pagePaths.add(pagePath);
        if (keyword) bucket.serviceKeywords.add(keyword);
      }
    }
  }

  const sortedTypes = [...byType.entries()]
    .sort((a, b) => {
      const delta = b[1].pagePaths.size - a[1].pagePaths.size;
      if (delta !== 0) return delta;
      return TYPE_PRIORITY.indexOf(a[0]) - TYPE_PRIORITY.indexOf(b[0]);
    })
    .map(([type]) => type);

  const candidates: CreateEeatAssetInput[] = [];

  for (const type of sortedTypes) {
    if (candidates.length >= limit) break;
    if (existingTypeSet.has(type)) continue;
    const bucket = byType.get(type);
    if (!bucket) continue;
    const topSignals = [...bucket.signals].slice(0, 3);
    const topRationales = [...bucket.rationales].slice(0, 2);
    const paths = [...bucket.pagePaths].slice(0, 10);
    const services = [...bucket.serviceKeywords].slice(0, 8);
    const pageCount = bucket.pagePaths.size;

    candidates.push({
      type,
      title: titleForType(type, workspaceName),
      content: [
        `Auto-filled from Page Intelligence trust-gap analysis across ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
        topSignals.length ? `Priority gaps: ${topSignals.join('; ')}.` : null,
        topRationales.length ? `Why this helps: ${topRationales.join(' ')}` : null,
      ].filter(Boolean).join(' '),
      metadata: {
        associatedPagePaths: paths.length ? paths : undefined,
        serviceTypes: services.length ? services : undefined,
        tags: ['auto-fill', 'page-intelligence'],
      },
    });
  }

  if (candidates.length > 0) return candidates.slice(0, limit);
  return fallbackCandidates(workspace).filter(candidate => !existingTypeSet.has(candidate.type)).slice(0, limit);
}
