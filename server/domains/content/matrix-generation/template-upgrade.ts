import {
  MATRIX_GENERATION_CONTRACT_VERSION,
  type ContentTemplateGenerationUpgradeProposal,
} from '../../../../shared/types/matrix-generation.js';
import {
  BRIEF_PAGE_TYPES,
  TEMPLATE_SECTION_GENERATION_ROLES,
  type ContentTemplate,
  type TemplateAeoContract,
  type TemplateCtaContract,
  type TemplateSection,
  type TemplateSectionGenerationRole,
} from '../../../../shared/types/content.js';
import type { GenerationEvidenceRequirement } from '../../../../shared/types/generation-evidence.js';
import { buildResolvedBlockSequence } from './block-manifest.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import { renderMatrixPattern } from './renderer.js';
import { structuralBlocker } from './requirements.js';

export type ContentTemplateGenerationUpgradeProposalResult =
  | {
      status: 'proposal';
      proposal: ContentTemplateGenerationUpgradeProposal;
      upgradedSections: TemplateSection[];
    }
  | {
      status: 'blocked';
      blockers: GenerationEvidenceRequirement[];
    };

export type VerifyContentTemplateGenerationUpgradeResult =
  | {
      status: 'valid';
      proposal: ContentTemplateGenerationUpgradeProposal;
      upgradedSections: TemplateSection[];
    }
  | { status: 'stale_revision'; actualTemplateRevision: number }
  | { status: 'stale_fingerprint'; actualProposalFingerprint: string }
  | { status: 'blocked'; blockers: GenerationEvidenceRequirement[] };

const ROLE_SET = new Set<string>(TEMPLATE_SECTION_GENERATION_ROLES);
const AEO_MODE_SET = new Set<string>(['answer_first', 'definition', 'faq', 'paa']);
const BRIEF_PAGE_TYPE_SET = new Set<string>(BRIEF_PAGE_TYPES);

/**
 * Every field whose value can change the effective generation contract. Keep
 * this projection aligned with the generation-field CAS in content-templates.
 * Display-only metadata and timestamps are deliberately excluded.
 */
const TEMPLATE_UPGRADE_FINGERPRINT_FIELDS = [
  'pageType',
  'variables',
  'sections',
  'urlPattern',
  'keywordPattern',
  'titlePattern',
  'metaDescPattern',
  'cmsFieldMap',
  'toneAndStyle',
  'schemaTypes',
  'generationContractVersion',
] as const satisfies ReadonlyArray<keyof ContentTemplate>;

const ROLE_SIGNALS: Readonly<Record<TemplateSectionGenerationRole, readonly string[]>> = {
  body: ['body', 'content', 'content-body', 'features-benefits', 'hero', 'overview', 'solution'],
  answer_first: ['answer-first', 'direct-answer', 'quick-answer'],
  definition: ['definition', 'what-is'],
  proof: ['proof', 'social-proof', 'testimonial', 'testimonials', 'case-study', 'case-studies', 'evidence', 'authority'],
  process: ['process', 'plan', 'steps', 'how-it-works'],
  faq: ['faq', 'faqs', 'frequently-asked-questions', 'questions'],
  cta: ['cta', 'call-to-action', 'contact-form'],
};

const SIGNAL_TO_ROLE = new Map<string, TemplateSectionGenerationRole>(
  Object.entries(ROLE_SIGNALS).flatMap(([role, signals]) => (
    signals.map(signal => [signal, role as TemplateSectionGenerationRole] as const)
  )),
);

function normalizeSignal(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isAeoContract(value: unknown): value is TemplateAeoContract {
  if (!value || typeof value !== 'object') return false;
  const contract = value as Partial<TemplateAeoContract>;
  return typeof contract.required === 'boolean'
    && Array.isArray(contract.modes)
    && contract.modes.every(mode => typeof mode === 'string' && AEO_MODE_SET.has(mode))
    && (!contract.required || contract.modes.length > 0);
}

function isCtaContract(value: unknown): value is TemplateCtaContract {
  if (!value || typeof value !== 'object') return false;
  const contract = value as Partial<TemplateCtaContract>;
  return typeof contract.required === 'boolean'
    && (contract.role === 'none' || contract.role === 'primary' || contract.role === 'secondary')
    && (!contract.required || contract.role !== 'none')
    && (contract.role !== 'primary' || contract.required);
}

function inferSectionRole(section: TemplateSection): TemplateSectionGenerationRole[] {
  if (section.generationRole && ROLE_SET.has(section.generationRole)) {
    return [section.generationRole];
  }

  const signals = [section.name, section.narrativeRole, section.cmsFieldSlug]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeSignal)
    .map(signal => SIGNAL_TO_ROLE.get(signal))
    .filter((role): role is TemplateSectionGenerationRole => role !== undefined);
  return [...new Set(signals)];
}

function defaultAeoContract(role: TemplateSectionGenerationRole): TemplateAeoContract {
  switch (role) {
    case 'answer_first':
      return { modes: ['answer_first'], required: true };
    case 'definition':
      return { modes: ['definition'], required: true };
    case 'faq':
      return { modes: ['faq', 'paa'], required: true };
    default:
      return { modes: [], required: false };
  }
}

function aeoContractMatchesRole(role: TemplateSectionGenerationRole, contract: TemplateAeoContract): boolean {
  if (role === 'answer_first') return contract.required && contract.modes.includes('answer_first');
  if (role === 'definition') return contract.required && contract.modes.includes('definition');
  if (role === 'faq') return contract.required && contract.modes.includes('faq');
  return true;
}

function ctaContractMatchesRole(role: TemplateSectionGenerationRole, contract: TemplateCtaContract): boolean {
  if (role !== 'cta') return true;
  return contract.required && contract.role !== 'none';
}

function templateRevision(template: ContentTemplate): number {
  return Number.isInteger(template.revision) && (template.revision ?? 0) >= 0
    ? template.revision ?? 0
    : 0;
}

function isLegacyGenerationContractVersion(version: number | undefined): boolean {
  return version === undefined || version === 0;
}

function generationEffectiveTemplateSource(template: ContentTemplate): Record<string, unknown> {
  return Object.fromEntries(
    TEMPLATE_UPGRADE_FINGERPRINT_FIELDS.map(field => [field, template[field]]),
  );
}

/** Recompute the exact template-level upgrade proposal without cell-specific inputs. */
export function createContentTemplateGenerationUpgradeProposal(
  template: ContentTemplate,
): ContentTemplateGenerationUpgradeProposalResult {
  const blockers: GenerationEvidenceRequirement[] = [];
  if (!template
    || typeof template !== 'object'
    || !Array.isArray(template.variables)
    || !Array.isArray(template.sections)) {
    return {
      status: 'blocked',
      blockers: [structuralBlocker(
        'malformed_template',
        'template',
        'The content template has a valid stored shape.',
        'The template could not be read safely.',
      )],
    };
  }
  if (!isLegacyGenerationContractVersion(template.generationContractVersion)) {
    return {
      status: 'blocked',
      blockers: [structuralBlocker(
        'generation_contract_upgrade_not_applicable',
        'template.generationContractVersion',
        'Only an unversioned or version 0 legacy template enters the generation-contract upgrade flow.',
        `Generation contract version ${String(template.generationContractVersion)} is already assigned and cannot be replaced or downgraded by the legacy upgrade flow.`,
      )],
    };
  }
  if (!BRIEF_PAGE_TYPE_SET.has(template.pageType)) {
    return {
      status: 'blocked',
      blockers: [structuralBlocker(
        'unsupported_page_type',
        'template.pageType',
        'The template page type is supported by content generation.',
        `Page type "${String(template.pageType)}" needs an explicit migration to a supported brief page type.`,
      )],
    };
  }

  const variableNames = template.variables.map(variable => variable.name);
  const patternValues = Object.create(null) as Record<string, string>;
  for (const variableName of variableNames) patternValues[variableName] = variableName;
  const requiredPatterns = [
    {
      value: template.titlePattern,
      missingId: 'missing_title_pattern',
      invalidId: 'invalid_title_pattern',
      field: 'template.titlePattern',
      label: 'title',
    },
    {
      value: template.metaDescPattern,
      missingId: 'missing_meta_description_pattern',
      invalidId: 'invalid_meta_description_pattern',
      field: 'template.metaDescPattern',
      label: 'meta description',
    },
  ] as const;
  for (const pattern of requiredPatterns) {
    if (typeof pattern.value !== 'string' || pattern.value.trim().length === 0) {
      blockers.push(structuralBlocker(
        pattern.missingId,
        pattern.field,
        `The legacy template declares a non-empty ${pattern.label} pattern before upgrade.`,
        `No ${pattern.label} pattern is available; an operator must supply one.`,
      ));
      continue;
    }
    const rendered = renderMatrixPattern(
      pattern.value,
      patternValues,
      'prose',
      variableNames,
    );
    if (rendered.status === 'blocked') {
      blockers.push(structuralBlocker(
        pattern.invalidId,
        pattern.field,
        `The legacy template ${pattern.label} pattern resolves every declared placeholder.`,
        `The ${pattern.label} pattern is invalid (${rendered.issues.map(issue => issue.code).join(', ')}); an operator must repair it.`,
      ));
    }
  }
  if (blockers.length > 0) return { status: 'blocked', blockers };

  const roles = new Map<string, TemplateSectionGenerationRole>();
  for (const section of template.sections) {
    if (!section || typeof section.id !== 'string' || section.id.trim().length === 0) {
      blockers.push(structuralBlocker(
        'malformed_template_section',
        'template.sections',
        'Every template section has a durable ID.',
        'A template section is malformed.',
      ));
      continue;
    }
    if (section.generationRole !== undefined && !ROLE_SET.has(section.generationRole)) {
      blockers.push(structuralBlocker(
        `ambiguous_template_section_role:${section.id}`,
        `template.sections.${section.id}.generationRole`,
        `Section "${section.name}" has a supported explicit generation role.`,
        'The stored generation role is unsupported and cannot be replaced by inference.',
      ));
      continue;
    }
    const inferred = inferSectionRole(section);
    if (inferred.length !== 1) {
      blockers.push(structuralBlocker(
        `${inferred.length === 0 ? 'unmapped' : 'ambiguous'}_template_section_role:${section.id}`,
        `template.sections.${section.id}.generationRole`,
        `Section "${section.name}" has one explicit generation role.`,
        inferred.length === 0
          ? 'No exact role mapping exists; an operator must assign one.'
          : 'Section metadata maps to multiple roles; an operator must choose one.',
      ));
      continue;
    }
    roles.set(section.id, inferred[0]);
  }
  if (blockers.length > 0) return { status: 'blocked', blockers };

  const unresolvedCtaSections = template.sections.filter(section => (
    roles.get(section.id) === 'cta' && section.ctaContract === undefined
  ));
  if (unresolvedCtaSections.length > 1) {
    return {
      status: 'blocked',
      blockers: [structuralBlocker(
        'ambiguous_primary_cta',
        'template.sections.ctaContract',
        'The template identifies exactly one primary CTA section.',
        'Multiple CTA sections need explicit primary/secondary contracts.',
      )],
    };
  }

  const upgradedSections: TemplateSection[] = [];
  for (const section of template.sections) {
    const role = roles.get(section.id)!;
    if (section.aeoContract !== undefined && !isAeoContract(section.aeoContract)) {
      blockers.push(structuralBlocker(
        `ambiguous_aeo_contract:${section.id}`,
        `template.sections.${section.id}.aeoContract`,
        `Section "${section.name}" has one valid AEO contract.`,
        'The stored AEO contract is incomplete or unsupported.',
      ));
      continue;
    }
    if (section.ctaContract !== undefined && !isCtaContract(section.ctaContract)) {
      blockers.push(structuralBlocker(
        `ambiguous_cta_contract:${section.id}`,
        `template.sections.${section.id}.ctaContract`,
        `Section "${section.name}" has one valid CTA contract.`,
        'The stored CTA contract is incomplete or unsupported.',
      ));
      continue;
    }

    const aeoContract = section.aeoContract ?? defaultAeoContract(role);
    const ctaContract = section.ctaContract ?? (
      role === 'cta'
        ? { role: 'primary', required: true }
        : { role: 'none', required: false }
    );
    if (!aeoContractMatchesRole(role, aeoContract)) {
      blockers.push(structuralBlocker(
        `ambiguous_aeo_contract:${section.id}`,
        `template.sections.${section.id}.aeoContract`,
        `Section "${section.name}" has an AEO contract consistent with its generation role.`,
        'The stored AEO contract conflicts with the section role.',
      ));
      continue;
    }
    if (!ctaContractMatchesRole(role, ctaContract)) {
      blockers.push(structuralBlocker(
        `ambiguous_cta_contract:${section.id}`,
        `template.sections.${section.id}.ctaContract`,
        `Section "${section.name}" has a CTA contract consistent with its generation role.`,
        'The stored CTA contract conflicts with the section role.',
      ));
      continue;
    }
    upgradedSections.push({
      ...section,
      optional: section.optional ?? false,
      generationRole: role,
      aeoContract,
      ctaContract,
    });
  }
  if (blockers.length > 0) return { status: 'blocked', blockers };

  const primaryCtaCount = upgradedSections.filter(section => (
    section.ctaContract?.required && section.ctaContract.role === 'primary'
  )).length;
  if (primaryCtaCount > 1) {
    return {
      status: 'blocked',
      blockers: [structuralBlocker(
        'ambiguous_primary_cta',
        'template.sections.ctaContract',
        'The template identifies exactly one primary CTA section.',
        'Multiple sections declare a required primary CTA.',
      )],
    };
  }

  const sequence = buildResolvedBlockSequence(upgradedSections, {
    allowedVariableNames: template.variables.map(variable => variable.name),
    preserveHeadingTemplates: true,
  });
  if (sequence.status === 'blocked') {
    return {
      status: 'blocked',
      blockers: sequence.issues.map(issue => structuralBlocker(
        `invalid_template_block:${issue.sectionId ?? 'unknown'}:${issue.code}`,
        `template.sections.${issue.sectionId ?? 'unknown'}`,
        'The template can produce one deterministic locked block manifest.',
        `Template block validation failed: ${issue.code}.`,
      )),
    };
  }

  const proposalCore = {
    templateId: template.id,
    expectedTemplateRevision: templateRevision(template),
    generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
    blocks: sequence.blocks,
    blockers: [] as GenerationEvidenceRequirement[],
  };
  return {
    status: 'proposal',
    proposal: {
      ...proposalCore,
      proposalFingerprint: canonicalGenerationFingerprint({
        proposal: proposalCore,
        source: generationEffectiveTemplateSource(template),
        upgradedSections,
      }),
    },
    upgradedSections,
  };
}

/** Locked service-name alias used by thin acceptance adapters. */
export const proposeTemplateGenerationUpgrade = createContentTemplateGenerationUpgradeProposal;

export function verifyContentTemplateGenerationUpgradeProposal(
  template: ContentTemplate,
  expected: { expectedTemplateRevision: number; proposalFingerprint: string },
): VerifyContentTemplateGenerationUpgradeResult {
  const actualTemplateRevision = templateRevision(template);
  if (expected.expectedTemplateRevision !== actualTemplateRevision) {
    return { status: 'stale_revision', actualTemplateRevision };
  }

  const result = createContentTemplateGenerationUpgradeProposal(template);
  if (result.status === 'blocked') return result;
  if (expected.proposalFingerprint !== result.proposal.proposalFingerprint) {
    return {
      status: 'stale_fingerprint',
      actualProposalFingerprint: result.proposal.proposalFingerprint,
    };
  }
  return {
    status: 'valid',
    proposal: result.proposal,
    upgradedSections: result.upgradedSections,
  };
}
