import type {
  BrandIntakeCompatibilityProjectionState,
  BrandIntakeEvidenceResolution,
  BrandIntakePayload,
  BrandIntakeRevision,
} from '../../../../shared/types/brand-intake.js';
import type { AudiencePersona, Workspace } from '../../../../shared/types/workspace.js';
import {
  isDiscoverableCompetitorDomain,
  isGenericDiscoveryDomain,
  isProviderSafeDomain,
  normalizeCompetitorDomain,
} from '../../../competitor-domain-filter.js';
import { isWorkspaceVoiceProfileAuthoritative } from '../../../intelligence/seo-context-source.js';
import { getWorkspace, updateWorkspace } from '../../../workspaces.js';

const KNOWLEDGE_BEGIN = '--- BRAND INTAKE KNOWLEDGE — MANAGED ---';
const KNOWLEDGE_END = '--- END MANAGED BRAND INTAKE KNOWLEDGE ---';
const VOICE_BEGIN = '--- BRAND INTAKE VOICE — MANAGED ---';
const VOICE_END = '--- END MANAGED BRAND INTAKE VOICE ---';
const LEGACY_ONBOARDING_MARKER = '--- Client Onboarding Responses ---';
const LEGACY_ONBOARDING_VOICE_MARKER = '--- Brand Voice (from onboarding) ---';

const PRIMARY_PERSONA_ID = 'persona_brand_intake_primary';
const SECONDARY_PERSONA_ID = 'persona_brand_intake_secondary';

interface ProjectionInput {
  workspaceId: string;
  revision: BrandIntakeRevision;
  projectionState: BrandIntakeCompatibilityProjectionState;
}

interface CompatibilityProjectionUpdates {
  knowledgeBase: string;
  brandVoice?: string;
  personas: AudiencePersona[];
  competitorDomains: string[];
  onboardingCompleted: true;
}

function replaceManagedBlock(
  source: string,
  begin: string,
  end: string,
  content: string,
  legacyTailMarkers: readonly string[],
): string {
  const lines = source.split('\n');
  const openMarkers: number[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (line === begin) {
      openMarkers.push(index);
      continue;
    }
    if (line === end && openMarkers.length > 0) {
      ranges.push({ start: openMarkers.pop()!, end: index });
    }
  }

  const removed = new Set<number>();
  for (const range of ranges) {
    for (let index = range.start; index <= range.end; index += 1) removed.add(index);
  }
  let manualLines = lines.filter((_line, index) => !removed.has(index));
  const legacyTailAt = manualLines.findIndex(line => {
    const exactLine = line.replace(/\r$/, '');
    return legacyTailMarkers.includes(exactLine);
  });
  if (legacyTailAt >= 0) manualLines = manualLines.slice(0, legacyTailAt);
  const manual = manualLines.join('\n').trimEnd();
  if (!content.trim()) return manual;

  const managed = `${begin}\n${content.trim()}\n${end}`;
  return manual ? `${manual}\n\n${managed}` : managed;
}

function resolutionByField(
  resolutions: BrandIntakeEvidenceResolution[],
): Map<BrandIntakeEvidenceResolution['fieldPath'], BrandIntakeEvidenceResolution> {
  return new Map(resolutions.map(resolution => [resolution.fieldPath, resolution]));
}

function textValue(resolution: BrandIntakeEvidenceResolution): string {
  if (resolution.value.kind !== 'text') {
    throw new Error(`Invalid text resolution for ${resolution.fieldPath}`);
  }
  return resolution.value.value;
}

function textListValue(resolution: BrandIntakeEvidenceResolution): string[] {
  if (resolution.value.kind !== 'text_list' || resolution.value.value.length === 0) {
    throw new Error(`Invalid text-list resolution for ${resolution.fieldPath}`);
  }
  return resolution.value.value;
}

function urlValue(resolution: BrandIntakeEvidenceResolution): string {
  if (resolution.value.kind !== 'url') {
    throw new Error(`Invalid URL resolution for ${resolution.fieldPath}`);
  }
  return resolution.value.value;
}

function urlListValue(resolution: BrandIntakeEvidenceResolution): string[] {
  if (resolution.value.kind !== 'url_list' || resolution.value.value.length === 0) {
    throw new Error(`Invalid URL-list resolution for ${resolution.fieldPath}`);
  }
  return resolution.value.value;
}

function buyingStageValue(
  resolution: BrandIntakeEvidenceResolution,
): BrandIntakePayload['audience']['buyingStage'] {
  if (resolution.value.kind !== 'buying_stage') {
    throw new Error(`Invalid buying-stage resolution for ${resolution.fieldPath}`);
  }
  return resolution.value.value;
}

/** Apply field-level evidence without mutating the immutable stored payload. */
export function materializeBrandIntakePayloadFrom(
  payload: BrandIntakePayload,
  evidenceResolutions: BrandIntakeEvidenceResolution[],
): BrandIntakePayload {
  const effective: BrandIntakePayload = {
    ...payload,
    business: { ...payload.business },
    audience: { ...payload.audience },
    brand: { ...payload.brand },
    competitors: { ...payload.competitors },
    authenticSamples: [...payload.authenticSamples],
  };

  for (const resolution of resolutionByField(evidenceResolutions).values()) {
    switch (resolution.fieldPath) {
      case 'business.businessName': effective.business.businessName = textValue(resolution); break;
      case 'business.industry': effective.business.industry = textValue(resolution); break;
      case 'business.description': effective.business.description = textValue(resolution); break;
      case 'business.services': effective.business.services = textValue(resolution); break;
      case 'business.locations': effective.business.locations = textValue(resolution); break;
      case 'business.differentiators': effective.business.differentiators = textValue(resolution); break;
      case 'business.website': effective.business.website = urlValue(resolution); break;
      case 'audience.primaryAudience': effective.audience.primaryAudience = textValue(resolution); break;
      case 'audience.painPoints': effective.audience.painPoints = textValue(resolution); break;
      case 'audience.goals': effective.audience.goals = textValue(resolution); break;
      case 'audience.objections': effective.audience.objections = textValue(resolution); break;
      case 'audience.buyingStage': effective.audience.buyingStage = buyingStageValue(resolution); break;
      case 'audience.secondaryAudience': effective.audience.secondaryAudience = textValue(resolution); break;
      case 'brand.tone': effective.brand.tone = textValue(resolution); break;
      case 'brand.personality': effective.brand.personality = textListValue(resolution); break;
      case 'brand.avoidWords': effective.brand.avoidWords = textValue(resolution); break;
      case 'brand.contentFormats': effective.brand.contentFormats = textListValue(resolution); break;
      case 'brand.existingExamples': effective.brand.existingExamples = textValue(resolution); break;
      case 'competitors.competitors': effective.competitors.competitors = textValue(resolution); break;
      case 'competitors.whatTheyDoBetter': effective.competitors.whatTheyDoBetter = textValue(resolution); break;
      case 'competitors.whatYouDoBetter': effective.competitors.whatYouDoBetter = textValue(resolution); break;
      case 'competitors.referenceUrls': effective.competitors.referenceUrls = urlListValue(resolution).join('\n'); break;
    }
  }

  return effective;
}

export function materializeBrandIntakePayload(revision: BrandIntakeRevision): BrandIntakePayload {
  return materializeBrandIntakePayloadFrom(revision.payload, revision.evidenceResolutions);
}

function buildKnowledgeContent(payload: BrandIntakePayload): string {
  const { business, competitors } = payload;
  const parts: string[] = [];
  if (business.businessName) parts.push(`Business Name: ${business.businessName}`);
  if (business.industry) parts.push(`Industry: ${business.industry}`);
  if (business.description) parts.push(`About: ${business.description}`);
  if (business.services) parts.push(`Key Services/Products:\n${business.services}`);
  if (business.locations) parts.push(`Service Locations: ${business.locations}`);
  if (business.differentiators) parts.push(`Differentiators: ${business.differentiators}`);
  if (business.website) parts.push(`Website: ${business.website}`);
  if (competitors.competitors) parts.push(`Competitors:\n${competitors.competitors}`);
  if (competitors.whatTheyDoBetter) parts.push(`Competitor Strengths: ${competitors.whatTheyDoBetter}`);
  if (competitors.whatYouDoBetter) parts.push(`Our Advantages: ${competitors.whatYouDoBetter}`);
  if (competitors.referenceUrls) parts.push(`Competitor Reference URLs:\n${competitors.referenceUrls}`);
  return parts.join('\n\n');
}

function buildVoiceContent(payload: BrandIntakePayload): string {
  const { brand } = payload;
  const parts: string[] = [];
  if (brand.personality.length > 0) parts.push(`Brand Personality: ${brand.personality.join(', ')}`);
  if (brand.tone) parts.push(`Tone: ${brand.tone}`);
  if (brand.avoidWords) parts.push(`Words to Avoid: ${brand.avoidWords}`);
  if (brand.contentFormats.length > 0) {
    parts.push(`Preferred Content Formats: ${brand.contentFormats.join(', ')}`);
  }
  if (brand.existingExamples) parts.push(`Reference Examples:\n${brand.existingExamples}`);
  return parts.join('\n');
}

function splitAudienceLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function personaName(value: string, fallback: string): string {
  return value.split(/[,\.\n]/)[0]?.trim().slice(0, 60) || fallback;
}

function buildManagedPersonas(payload: BrandIntakePayload): AudiencePersona[] {
  const { audience, brand } = payload;
  const personas: AudiencePersona[] = [];
  if (
    audience.primaryAudience
    || audience.painPoints
    || audience.goals
    || audience.objections
  ) {
    personas.push({
      id: PRIMARY_PERSONA_ID,
      name: personaName(audience.primaryAudience, 'Primary Audience'),
      description: audience.primaryAudience,
      painPoints: splitAudienceLines(audience.painPoints),
      goals: splitAudienceLines(audience.goals),
      objections: splitAudienceLines(audience.objections),
      ...(brand.contentFormats.length > 0
        ? { preferredContentFormat: brand.contentFormats.join(', ') }
        : {}),
      ...(audience.buyingStage === '' || audience.buyingStage === 'mixed'
        ? {}
        : { buyingStage: audience.buyingStage }),
    });
  }
  if (audience.secondaryAudience) {
    personas.push({
      id: SECONDARY_PERSONA_ID,
      name: personaName(audience.secondaryAudience, 'Secondary Audience'),
      description: audience.secondaryAudience,
      painPoints: [],
      goals: [],
      objections: [],
    });
  }
  return personas;
}

function isIntakeOwnedPersona(persona: AudiencePersona): boolean {
  return persona.id === PRIMARY_PERSONA_ID
    || persona.id === SECONDARY_PERSONA_ID
    || persona.id.startsWith('persona_onboard_')
    || persona.id.startsWith('persona_onboard2_');
}

export function getBrandIntakeCompetitorDomains(
  payload: BrandIntakePayload,
  clientDomain = '',
): string[] {
  const tokens = payload.competitors.competitors
    .split(/[\n,]/)
    .flatMap(line => {
      const urls = line.match(/https?:\/\/[^\s,]+/gi);
      return urls?.length ? urls : [line];
    });
  return [...new Set(tokens
    .map(token => normalizeCompetitorDomain(token.trim().replace(/[),.;]+$/g, '')))
    .filter(domain => {
      if (!domain || !isProviderSafeDomain(domain)) return false;
      return clientDomain
        ? isDiscoverableCompetitorDomain(domain, clientDomain)
        : !isGenericDiscoveryDomain(domain);
    }))]
    .sort((a, b) => a.localeCompare(b));
}

function canonicalDomainIdentity(raw: string): string {
  return normalizeCompetitorDomain(raw) || raw.trim().toLowerCase();
}

function dedupePreservingRawDomains(domains: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of domains) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const identity = canonicalDomainIdentity(trimmed);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(trimmed);
  }
  return result;
}

/**
 * Freeze explicit ownership before the immutable revision is inserted.
 * Existing/unowned workspace values retain their raw representation and order;
 * B0-owned additions are canonical hostnames so a successor can remove only
 * values that this projection actually introduced.
 */
export function buildBrandIntakeCompatibilityProjectionState(input: {
  currentWorkspaceDomains: string[];
  previousProjectionState: BrandIntakeCompatibilityProjectionState | null;
  effectivePayload: BrandIntakePayload;
  clientDomain?: string;
}): BrandIntakeCompatibilityProjectionState {
  const predecessorOwned = new Set(
    (input.previousProjectionState?.intakeOwnedCompetitorDomains ?? [])
      .map(canonicalDomainIdentity),
  );
  const preservedCompetitorDomains = dedupePreservingRawDomains(
    input.currentWorkspaceDomains.filter(
      domain => !predecessorOwned.has(canonicalDomainIdentity(domain)),
    ),
  );
  const preservedIdentities = new Set(preservedCompetitorDomains.map(canonicalDomainIdentity));
  const intakeOwnedCompetitorDomains = getBrandIntakeCompetitorDomains(
    input.effectivePayload,
    input.clientDomain,
  )
    .filter(domain => !preservedIdentities.has(canonicalDomainIdentity(domain)));
  return { preservedCompetitorDomains, intakeOwnedCompetitorDomains };
}

function projectedCompetitorDomains(
  projectionState: BrandIntakeCompatibilityProjectionState,
): string[] {
  return dedupePreservingRawDomains([
    ...projectionState.preservedCompetitorDomains,
    ...projectionState.intakeOwnedCompetitorDomains,
  ]);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function samePersonas(left: AudiencePersona[], right: AudiencePersona[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildProjectionUpdates(
  workspace: Workspace,
  currentPayload: BrandIntakePayload,
  projectionState: BrandIntakeCompatibilityProjectionState,
  workspaceVoiceIsAuthoritative: boolean,
): CompatibilityProjectionUpdates {
  const voiceContent = buildVoiceContent(currentPayload);
  const baseKnowledgeContent = buildKnowledgeContent(currentPayload);
  const knowledgeContent = workspaceVoiceIsAuthoritative && voiceContent
    ? [baseKnowledgeContent, `Brand Voice Preferences (intake):\n${voiceContent}`]
      .filter(Boolean)
      .join('\n\n')
    : baseKnowledgeContent;

  const knowledgeBase = replaceManagedBlock(
    workspace.knowledgeBase ?? '',
    KNOWLEDGE_BEGIN,
    KNOWLEDGE_END,
    knowledgeContent,
    [LEGACY_ONBOARDING_MARKER, LEGACY_ONBOARDING_VOICE_MARKER],
  );
  const brandVoice = workspaceVoiceIsAuthoritative
    ? undefined
    : replaceManagedBlock(
        workspace.brandVoice ?? '',
        VOICE_BEGIN,
        VOICE_END,
        voiceContent,
        [LEGACY_ONBOARDING_MARKER],
      );

  const personas = [
    ...(workspace.personas ?? []).filter(persona => !isIntakeOwnedPersona(persona)),
    ...buildManagedPersonas(currentPayload),
  ];

  return {
    knowledgeBase,
    ...(brandVoice !== undefined ? { brandVoice } : {}),
    personas,
    competitorDomains: projectedCompetitorDomains(projectionState),
    onboardingCompleted: true,
  };
}

/**
 * Update the legacy workspace columns inside the caller-owned transaction.
 * VoiceProfile itself is read-only here: authoritative DNA/status/guardrails
 * are never changed and the legacy `brandVoice` column is not written.
 */
export function projectBrandIntakeCompatibility(input: ProjectionInput): boolean {
  const workspace = getWorkspace(input.workspaceId);
  if (!workspace) throw new Error('Workspace not found');

  const currentPayload = materializeBrandIntakePayload(input.revision);
  const updates = buildProjectionUpdates(
    workspace,
    currentPayload,
    input.projectionState,
    isWorkspaceVoiceProfileAuthoritative(input.workspaceId),
  );

  const changed = workspace.knowledgeBase !== updates.knowledgeBase
    || (updates.brandVoice !== undefined && workspace.brandVoice !== updates.brandVoice)
    || !samePersonas(workspace.personas ?? [], updates.personas)
    || !sameStringArray(workspace.competitorDomains ?? [], updates.competitorDomains)
    || workspace.onboardingCompleted !== true;
  if (!changed) return false;

  const persisted = updateWorkspace(input.workspaceId, updates);
  if (!persisted) throw new Error('Workspace not found');
  return true;
}
