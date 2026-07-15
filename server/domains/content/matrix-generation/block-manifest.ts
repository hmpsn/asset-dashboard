import {
  MATRIX_GENERATION_CONTRACT_VERSION,
  RESOLVED_SYSTEM_BLOCK_IDS,
  type ResolvedPageBlockManifest,
  type ResolvedPageBlockSequence,
  type ResolvedSystemConclusionBlock,
  type ResolvedSystemIntroductionBlock,
  type ResolvedTemplatePageBlock,
} from '../../../../shared/types/matrix-generation.js';
import {
  TEMPLATE_SECTION_GENERATION_ROLES,
  type TemplateAeoContract,
  type TemplateCtaContract,
  type TemplateSection,
} from '../../../../shared/types/content.js';
import { computeBlockManifestFingerprint } from './fingerprint.js';
import { renderMatrixPattern, type MatrixPatternIssue } from './renderer.js';

export interface BlockManifestIssue {
  code:
    | 'duplicate_section_id'
    | 'duplicate_section_order'
    | 'empty_template_sections'
    | 'invalid_section'
    | 'missing_generation_role'
    | 'invalid_aeo_contract'
    | 'invalid_cta_contract'
    | 'multiple_primary_cta_contracts'
    | 'invalid_heading_pattern';
  sectionId?: string;
  patternIssues?: MatrixPatternIssue[];
}

export type BuildResolvedPageBlockManifestResult =
  | { status: 'resolved'; manifest: ResolvedPageBlockManifest; renderedHeadings: string[] }
  | { status: 'blocked'; issues: BlockManifestIssue[] };

const GENERATION_ROLE_SET = new Set<string>(TEMPLATE_SECTION_GENERATION_ROLES);
const AEO_MODE_SET = new Set<string>(['answer_first', 'definition', 'faq', 'paa']);

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

function sectionShapeIsValid(section: TemplateSection): boolean {
  return Boolean(section)
    && typeof section.id === 'string'
    && section.id.trim().length > 0
    && typeof section.name === 'string'
    && typeof section.headingTemplate === 'string'
    && typeof section.guidance === 'string'
    && Number.isInteger(section.wordCountTarget)
    && section.wordCountTarget >= 0
    && Number.isInteger(section.order)
    && section.order >= 0;
}

function systemBlocks(hasTemplatePrimaryCta: boolean): {
  introduction: ResolvedSystemIntroductionBlock;
  conclusion: ResolvedSystemConclusionBlock;
} {
  const conclusionCtaContract: TemplateCtaContract = hasTemplatePrimaryCta
    ? { role: 'none', required: false }
    : { role: 'primary', required: true };
  return {
    introduction: {
      id: RESOLVED_SYSTEM_BLOCK_IDS.introduction,
      source: 'system',
      generationRole: 'introduction',
      order: 0,
      heading: { level: null, renderedText: null, locked: true },
      guidance: 'Open directly with the page intent and target keyword; do not add a heading.',
      aeoContract: { modes: ['answer_first'], required: true },
      ctaContract: { role: 'none', required: false },
    },
    conclusion: {
      id: RESOLVED_SYSTEM_BLOCK_IDS.conclusion,
      source: 'system',
      generationRole: 'conclusion',
      order: 0,
      heading: { level: 2, renderedText: null, locked: false },
      guidance: hasTemplatePrimaryCta
        ? 'Close with a grounded next step without introducing a second primary action.'
        : 'Close with a grounded next step and one clear primary action.',
      aeoContract: { modes: [], required: false },
      ctaContract: conclusionCtaContract,
    },
  };
}

function aeoContractMatchesRole(section: TemplateSection): boolean {
  const contract = section.aeoContract;
  if (!contract) return false;
  if (section.generationRole === 'answer_first') {
    return contract.required && contract.modes.includes('answer_first');
  }
  if (section.generationRole === 'definition') {
    return contract.required && contract.modes.includes('definition');
  }
  if (section.generationRole === 'faq') {
    return contract.required && contract.modes.includes('faq');
  }
  return true;
}

function ctaContractMatchesRole(section: TemplateSection): boolean {
  const contract = section.ctaContract;
  if (!contract) return false;
  if (section.generationRole === 'cta') {
    return contract.required && contract.role !== 'none';
  }
  return true;
}

interface BuildSequenceOptions {
  headingValues?: Readonly<Record<string, string>>;
  allowedVariableNames: readonly string[];
  preserveHeadingTemplates: boolean;
}

export function buildResolvedBlockSequence(
  sections: readonly TemplateSection[],
  options: BuildSequenceOptions,
): { status: 'resolved'; blocks: ResolvedPageBlockSequence; renderedHeadings: string[] }
  | { status: 'blocked'; issues: BlockManifestIssue[] } {
  if (!Array.isArray(sections)) {
    return { status: 'blocked', issues: [{ code: 'invalid_section' }] };
  }

  const issues: BlockManifestIssue[] = [];
  if (sections.length === 0) {
    return { status: 'blocked', issues: [{ code: 'empty_template_sections' }] };
  }
  for (const section of sections) {
    if (!sectionShapeIsValid(section)) {
      issues.push({ code: 'invalid_section', sectionId: section?.id });
    }
  }
  if (issues.length > 0) return { status: 'blocked', issues };

  const ids = new Set<string>();
  const orders = new Set<number>();
  const sorted = [...sections].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  for (const section of sorted) {
    if (ids.has(section.id)) issues.push({ code: 'duplicate_section_id', sectionId: section.id });
    ids.add(section.id);
    if (orders.has(section.order)) issues.push({ code: 'duplicate_section_order', sectionId: section.id });
    orders.add(section.order);
    if (!section.generationRole || !GENERATION_ROLE_SET.has(section.generationRole)) {
      issues.push({ code: 'missing_generation_role', sectionId: section.id });
    }
    if (!isAeoContract(section.aeoContract) || !aeoContractMatchesRole(section)) {
      issues.push({ code: 'invalid_aeo_contract', sectionId: section.id });
    }
    if (!isCtaContract(section.ctaContract) || !ctaContractMatchesRole(section)) {
      issues.push({ code: 'invalid_cta_contract', sectionId: section.id });
    }
  }
  if (issues.length > 0) return { status: 'blocked', issues };

  const templatePrimaryCtaCount = sorted.filter(section => (
    section.ctaContract?.required && section.ctaContract.role === 'primary'
  )).length;
  if (templatePrimaryCtaCount > 1) {
    return {
      status: 'blocked',
      issues: [{ code: 'multiple_primary_cta_contracts' }],
    };
  }

  const templateBlocks: ResolvedTemplatePageBlock[] = [];
  const renderedHeadings: string[] = [];
  const headingValidationValues = Object.create(null) as Record<string, string>;
  for (const variableName of options.allowedVariableNames) {
    headingValidationValues[variableName] = variableName;
  }
  for (const section of sorted) {
    let renderedHeading: string | null = null;
    if (section.headingTemplate.length > 0) {
      if (options.preserveHeadingTemplates) {
        const validation = renderMatrixPattern(
          section.headingTemplate,
          headingValidationValues,
          'prose',
          options.allowedVariableNames,
        );
        if (validation.status === 'blocked') {
          issues.push({
            code: 'invalid_heading_pattern',
            sectionId: section.id,
            patternIssues: validation.issues,
          });
          continue;
        }
        renderedHeading = section.headingTemplate;
      } else {
        const rendered = renderMatrixPattern(
          section.headingTemplate,
          options.headingValues ?? {},
          'prose',
          options.allowedVariableNames,
        );
        if (rendered.status === 'blocked') {
          issues.push({
            code: 'invalid_heading_pattern',
            sectionId: section.id,
            patternIssues: rendered.issues,
          });
          continue;
        }
        renderedHeading = rendered.value;
      }
    }

    if (renderedHeading !== null) renderedHeadings.push(renderedHeading);
    templateBlocks.push({
      id: `template:${section.id}`,
      source: 'template',
      sourceSectionId: section.id,
      generationRole: section.generationRole!,
      order: templateBlocks.length + 1,
      heading: {
        level: renderedHeading === null ? null : 2,
        renderedText: renderedHeading,
        locked: true,
      },
      guidance: section.guidance,
      wordCountTarget: section.wordCountTarget,
      aeoContract: section.aeoContract!,
      ctaContract: section.ctaContract!,
    });
  }
  if (issues.length > 0) return { status: 'blocked', issues };

  // The system conclusion is the fallback primary CTA only when the locked
  // template does not already own one. The final sequence therefore carries
  // exactly one required primary CTA contract.
  const system = systemBlocks(templatePrimaryCtaCount === 1);
  const conclusion = {
    ...system.conclusion,
    order: templateBlocks.length + 1,
  } satisfies ResolvedSystemConclusionBlock;
  const blocks = [system.introduction, ...templateBlocks, conclusion] as ResolvedPageBlockSequence;
  return { status: 'resolved', blocks, renderedHeadings };
}

export function buildResolvedPageBlockManifest(
  sections: readonly TemplateSection[],
  variableValues: Readonly<Record<string, string>>,
  allowedVariableNames: readonly string[],
): BuildResolvedPageBlockManifestResult {
  const sequence = buildResolvedBlockSequence(sections, {
    headingValues: variableValues,
    allowedVariableNames,
    preserveHeadingTemplates: false,
  });
  if (sequence.status === 'blocked') return sequence;

  const totalWordCountTarget = sequence.blocks.reduce(
    (sum, block) => sum + (block.wordCountTarget ?? 0),
    0,
  );
  const fingerprint = computeBlockManifestFingerprint({
    generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
    blocks: sequence.blocks,
    totalWordCountTarget,
  });

  return {
    status: 'resolved',
    manifest: {
      generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
      blocks: sequence.blocks,
      totalWordCountTarget,
      fingerprint,
    },
    renderedHeadings: sequence.renderedHeadings,
  };
}
