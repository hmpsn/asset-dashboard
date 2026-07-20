import * as cheerio from 'cheerio';

import type { VoiceGuardrails } from '../../../../shared/types/brand-engine.js';
import type { GeneratedPost } from '../../../../shared/types/content.js';
import type {
  GenerationAuditCheck,
  GenerationAuditReport,
  GenerationAutomaticRevisionCount,
  GenerationEvidenceValue,
  GenerationHumanRequiredAuditCheck,
} from '../../../../shared/types/generation-evidence.js';
import type {
  MatrixGenerationEvidenceResolution,
  MatrixGenerationPreviewTarget,
  ResolvedPageBlock,
} from '../../../../shared/types/matrix-generation.js';
import { countHtmlWords, stripHtml } from '../../../content-posts-ai.js';
import { extractLinks } from '../../../seo-audit-html.js';
import type { MatrixGenerationModelAuditAIOutput } from './output-schemas.js';
import { canonicalizeMatrixPath, validateRenderedMatrixPath } from './renderer.js';

export interface MatrixGenerationDeterministicAuditInput {
  target: MatrixGenerationPreviewTarget;
  post: GeneratedPost;
  evidenceResolutions: readonly Pick<
    MatrixGenerationEvidenceResolution,
    'requirementId' | 'value'
  >[];
  knownInternalPaths: readonly string[];
  internalPathCensusComplete: boolean;
  voiceGuardrails: VoiceGuardrails;
  revisionCount: GenerationAutomaticRevisionCount;
  now?: () => Date;
}

export interface MergeMatrixGenerationAuditInput {
  target: MatrixGenerationPreviewTarget;
  deterministicReport: GenerationAuditReport;
  modelOutput: MatrixGenerationModelAuditAIOutput;
}

export type MatrixGenerationAuditDisposition =
  | 'ready'
  | 'revise'
  | 'needs_attention'
  | 'blocked_missing_evidence';

export class MatrixGenerationAuditContractError extends Error {
  readonly code = 'matrix_generation_audit_contract';

  constructor(message: string) {
    super(message);
    this.name = 'MatrixGenerationAuditContractError';
  }
}

export const MATRIX_READER_FACING_PROSE_CONTRACT = `Write final reader-facing copy.
Never narrate internal evidence, supplied or provided context, source availability, verification status, research gaps, guardrails, or generation mechanics.
Never write phrases such as "provided evidence," "provided data," "provided information," "the available evidence," "this context supports," or "source verification."
State supported facts naturally and omit unsupported optional claims. Exact [NEEDS CLIENT INPUT: ...] placeholders are exempt and must remain unchanged.
Do not repeat the full address, phone number, booking URL, or equivalent CTA wording across multiple blocks. A full address may appear once in a cell-specific local-proof block or the locked CTA/close; keep the phone number, booking URL, and complete CTA wording in the locked CTA or close.`;

interface CandidateBlock {
  contract: ResolvedPageBlock;
  html: string;
}

const KEYWORD_STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'for', 'in', 'near', 'of', 'on', 'the', 'to', 'with',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function words(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ') : [];
}

function significantWords(value: string): string[] {
  return [...new Set(words(value).filter(word => (
    word.length > 1 && !KEYWORD_STOP_WORDS.has(word)
  )))];
}

function containsKeywordTerms(value: string, keyword: string): boolean {
  const haystack = new Set(words(value));
  const terms = significantWords(keyword);
  return terms.length > 0 && terms.every(term => haystack.has(term));
}

function check(
  id: string,
  category: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
  evidenceRequirementIds: string[] = [],
): GenerationAuditCheck {
  return {
    id,
    category,
    result: passed ? 'passed' : 'failed',
    message: passed ? passedMessage : failedMessage,
    evidenceRequirementIds,
  };
}

function notApplicable(id: string, category: string, message: string): GenerationAuditCheck {
  return { id, category, result: 'not_applicable', message, evidenceRequirementIds: [] };
}

function candidateBlocks(
  target: MatrixGenerationPreviewTarget,
  post: GeneratedPost,
): CandidateBlock[] {
  let templateIndex = 0;
  return target.blockManifest.blocks.map(contract => {
    if (contract.source === 'system' && contract.generationRole === 'introduction') {
      return { contract, html: post.introduction };
    }
    if (contract.source === 'system' && contract.generationRole === 'conclusion') {
      return { contract, html: post.conclusion };
    }
    const html = post.sections[templateIndex]?.content ?? '';
    templateIndex += 1;
    return { contract, html };
  });
}

function pageHtml(post: GeneratedPost): string {
  return [post.introduction, ...post.sections.map(section => section.content), post.conclusion]
    .join('\n');
}

function firstH2(html: string): string {
  const $ = cheerio.load(html, null, false);
  return $('h2').first().text().replace(/\s+/g, ' ').trim();
}

function normalizeHeading(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function templateCensusCheck(
  target: MatrixGenerationPreviewTarget,
  post: GeneratedPost,
): GenerationAuditCheck {
  const bodyContracts = target.blockManifest.blocks.filter(block => block.source === 'template');
  const passed = countHtmlWords(post.introduction) > 0
    && countHtmlWords(post.conclusion) > 0
    && post.sections.length === bodyContracts.length
    && post.sections.every((section, index) => {
      const contract = bodyContracts[index];
      const renderedH2 = firstH2(section.content);
      if (!contract) return false;
      if (contract.heading.renderedText === null) {
        return section.index === index
          && section.status === 'done'
          && countHtmlWords(section.content) > 0
          && section.heading === ''
          && renderedH2 === '';
      }
      if (!renderedH2) return false;
      const headingAgrees = normalizeHeading(section.heading) === normalizeHeading(renderedH2);
      const lockedHeadingAgrees = !contract.heading.locked || (
        contract.heading.renderedText !== null
        && normalizeHeading(renderedH2) === normalizeHeading(contract.heading.renderedText)
      );
      return section.index === index
        && section.status === 'done'
        && countHtmlWords(section.content) > 0
        && headingAgrees
        && lockedHeadingAgrees;
    });
  return check(
    'template-block-census',
    'structure',
    passed,
    'The draft preserves every block and order, keeps literal headings locked, and binds generated headings to their first H2.',
    'The draft added, removed, reordered, emptied, or mismatched a section heading and its first H2.',
  );
}

function urlCheck(target: MatrixGenerationPreviewTarget): GenerationAuditCheck {
  const validation = validateRenderedMatrixPath(target.plannedUrl);
  const passed = validation.status === 'valid'
    && canonicalizeMatrixPath(target.plannedUrl) === validation.canonicalPath;
  return check(
    'planned-url',
    'seo',
    passed,
    'The planned URL remains a valid canonical matrix path.',
    'The planned URL is no longer a valid canonical matrix path.',
  );
}

function metadataCheck(
  target: MatrixGenerationPreviewTarget,
  post: GeneratedPost,
): GenerationAuditCheck {
  const passed = post.title === target.title
    && post.metaDescription === target.metaDescription
    && post.seoTitle === target.title
    && post.seoMetaDescription === target.metaDescription;
  return check(
    'locked-metadata',
    'seo',
    passed,
    'The title and metadata match the frozen target exactly.',
    'The title or metadata drifted from the frozen target.',
  );
}

function metadataLengthCheck(post: GeneratedPost): GenerationAuditCheck {
  const title = post.seoTitle ?? post.title;
  const description = post.seoMetaDescription ?? post.metaDescription;
  const passed = title.length <= 60 && description.length <= 160;
  return check(
    'metadata-lengths',
    'seo',
    passed,
    'The SEO title and meta description stay within their hard character limits.',
    'The SEO title exceeds 60 characters or the meta description exceeds 160 characters.',
  );
}

function keywordChecks(
  target: MatrixGenerationPreviewTarget,
  post: GeneratedPost,
): GenerationAuditCheck[] {
  const keyword = target.targetKeyword.value;
  const hasVisibleBodyHeading = target.blockManifest.blocks.some(block => (
    block.source === 'template' && block.heading.renderedText !== null
  ));
  return [
    check(
      'keyword-url-coverage',
      'seo',
      containsKeywordTerms(target.plannedUrl, keyword),
      'The planned URL covers the material target-keyword terms.',
      'The planned URL is missing material target-keyword terms.',
    ),
    check(
      'keyword-title-coverage',
      'seo',
      containsKeywordTerms(post.title, keyword),
      'The page title covers the material target-keyword terms.',
      'The page title is missing material target-keyword terms.',
    ),
    check(
      'keyword-introduction-coverage',
      'seo',
      containsKeywordTerms(stripHtml(post.introduction), keyword),
      'The introduction covers the material target-keyword terms.',
      'The introduction is missing material target-keyword terms.',
    ),
    hasVisibleBodyHeading
      ? check(
          'keyword-heading-coverage',
          'seo',
          post.sections.some(section => containsKeywordTerms(section.heading, keyword)),
          'A body heading covers the material target-keyword terms.',
          'No body heading covers the material target-keyword terms.',
        )
      : notApplicable(
          'keyword-heading-coverage',
          'seo',
          'The frozen template intentionally contains no visible body headings.',
        ),
    check(
      'keyword-metadata-coverage',
      'seo',
      containsKeywordTerms(post.seoMetaDescription ?? post.metaDescription, keyword),
      'The meta description covers the material target-keyword terms.',
      'The meta description is missing material target-keyword terms.',
    ),
  ];
}

function canonicalHrefPath(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.startsWith('/')) {
    return canonicalizeMatrixPath(trimmed.split(/[?#]/, 1)[0] ?? '');
  }
  if (!/^(?:https?:)?\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    return canonicalizeMatrixPath(parsed.pathname);
  } catch { // catch-ok: malformed links fail the deterministic path audit.
    return null;
  }
}

function internalPathCheck(
  target: MatrixGenerationPreviewTarget,
  blocks: readonly CandidateBlock[],
  knownInternalPaths: readonly string[],
  censusComplete: boolean,
): GenerationAuditCheck {
  const known = new Set(knownInternalPaths.flatMap(path => {
    const canonical = canonicalizeMatrixPath(path);
    return canonical ? [canonical] : [];
  }));
  const plannedPath = canonicalizeMatrixPath(target.plannedUrl);
  const verifiedByBlock = new Map(
    (target.verifiedInternalLinks ?? []).map(linkBlock => [linkBlock.blockId, linkBlock]),
  );
  const frozenOwners = new Map<string, Set<string>>();
  const frozenPathOwners = new Map<string, Set<string>>();
  for (const frozen of target.verifiedInternalLinks ?? []) {
    for (const link of frozen.links) {
      const identity = linkIdentity(link.href, link.anchorText);
      const owners = frozenOwners.get(identity) ?? new Set<string>();
      owners.add(frozen.blockId);
      frozenOwners.set(identity, owners);
      const canonical = canonicalHrefPath(link.href);
      if (canonical) {
        const pathOwners = frozenPathOwners.get(canonical) ?? new Set<string>();
        pathOwners.add(frozen.blockId);
        frozenPathOwners.set(canonical, pathOwners);
      }
    }
  }
  const hasFrozenPolicy = verifiedByBlock.size > 0;
  const invalid = new Set<string>();

  for (const block of blocks) {
    const contract = block.contract.source === 'template'
      ? block.contract.internalLinkContract
      : undefined;
    const frozen = verifiedByBlock.get(block.contract.id as `template:${string}`);
    const allowed = new Set((frozen?.links ?? []).map(link => linkIdentity(link.href, link.anchorText)));
    const accepted = new Set<string>();
    for (const link of extractLinks(block.html)) {
      const href = link.href.trim();
      if (!href || href.startsWith('#') || /^(?:mailto|tel):/i.test(href)) continue;
      const identity = linkIdentity(href, link.text);
      const canonical = canonicalHrefPath(href);
      const isAbsolute = /^(?:https?:)?\/\//i.test(href);
      const isRelative = href.startsWith('/');
      if (!canonical) {
        if (!isAbsolute) invalid.add(`${block.contract.id}:${href}`);
        continue;
      }
      const isSelf = canonical === plannedPath;
      const isFrozenHere = allowed.has(identity);
      const owners = frozenOwners.get(identity);
      const isFrozenElsewhere = Boolean(owners && !owners.has(block.contract.id));
      const destinationOwners = frozenPathOwners.get(canonical);
      const isFrozenDestinationElsewhere = Boolean(
        destinationOwners && !destinationOwners.has(block.contract.id),
      );
      const isKnownInternal = known.has(canonical);
      const isInternal = isRelative
        || isKnownInternal
        || isSelf
        || Boolean(owners)
        || Boolean(destinationOwners);

      if (isSelf || isFrozenElsewhere || isFrozenDestinationElsewhere) {
        invalid.add(`${block.contract.id}:${href}`);
        continue;
      }
      if (contract) {
        if (isInternal && !isFrozenHere) invalid.add(`${block.contract.id}:${href}`);
        if (isFrozenHere) accepted.add(identity);
        continue;
      }
      if (hasFrozenPolicy && isInternal) {
        invalid.add(`${block.contract.id}:${href}`);
        continue;
      }
      if (isInternal && (!known.has(canonical) || !censusComplete)) {
        invalid.add(`${block.contract.id}:${href}`);
      }
    }
    if (contract) {
      const minimum = frozen?.minimum ?? contract.minimum;
      if (!frozen || accepted.size < minimum) invalid.add(block.contract.id);
    }
  }
  return check(
    'internal-paths',
    'seo',
    invalid.size === 0,
    'Every internal-link block contains its minimum frozen anchors, and every internal destination is authoritative and non-self-referential.',
    'The draft is missing a required verified internal anchor or contains a malformed, unverified, unlisted, or self-referential internal link.',
  );
}

function linkIdentity(href: string, anchorText: string): string {
  return JSON.stringify([href.trim(), anchorText.replace(/\s+/g, ' ').trim()]);
}

function tableStructureCheck(blocks: readonly CandidateBlock[]): GenerationAuditCheck {
  const tableBlocks = blocks.filter(block => (
    block.contract.source === 'template' && block.contract.renderAs === 'table'
  ));
  if (tableBlocks.length === 0) {
    return notApplicable('semantic-tables', 'structure', 'No block requires semantic table markup.');
  }
  const failed = tableBlocks.filter(block => {
    const $ = cheerio.load(block.html, null, false);
    const tables = $('table');
    return tables.length !== 1
      || tables.first().find('tr').length < 2
      || tables.first().find('th').length < 1
      || tables.first().find('td').length < 1;
  });
  return check(
    'semantic-tables',
    'structure',
    failed.length === 0,
    'Every table-designated block contains one semantic table with headers, rows, and data cells.',
    'A table-designated block was flattened or lacks semantic table, row, header, or data-cell markup.',
  );
}

function placeholderToken(
  requirement: MatrixGenerationPreviewTarget['evidenceRequirements'][number],
): string {
  return `[NEEDS CLIENT INPUT: ${requirement.clientSafePrompt ?? requirement.reason}]`;
}

function placeholderCheck(
  target: MatrixGenerationPreviewTarget,
  post: GeneratedPost,
): GenerationAuditCheck {
  const expectedRequirements = target.evidenceRequirements.filter(requirement => (
    requirement.requirementStage === 'ready'
    && (requirement.status === 'missing' || requirement.status === 'conflicting')
  ));
  const expected = expectedRequirements.map(placeholderToken).sort();
  const rendered = [...pageHtml(post).matchAll(/\[NEEDS CLIENT INPUT:[^\]]+\]/g)]
    .map(match => match[0])
    .sort();
  return check(
    'placeholder-completeness',
    'grounding',
    JSON.stringify(expected) === JSON.stringify(rendered),
    'Every typed ready-stage placeholder appears exactly once and no others were invented.',
    'A typed ready-stage placeholder was deleted, changed, duplicated, or invented.',
    expectedRequirements.map(requirement => requirement.id),
  );
}

function evidenceTexts(value: GenerationEvidenceValue): string[] {
  switch (value.kind) {
    case 'text': return [value.value];
    case 'text_list': return value.value;
    case 'link_list': return value.value.flatMap(link => [link.anchorText, link.href]);
    case 'number': return [`${value.value}${value.unit ? ` ${value.unit}` : ''}`];
    case 'boolean': return [value.value ? 'confirmed' : 'not confirmed'];
    case 'date': return [value.value];
    case 'url': return [value.value];
  }
}

function carriesEvidence(pageText: string, values: readonly string[]): boolean {
  const pageTokens = new Set(significantWords(pageText));
  return values.some(value => {
    const tokens = significantWords(value);
    if (tokens.length === 0) return false;
    const matched = tokens.filter(token => pageTokens.has(token)).length;
    return matched / tokens.length >= 0.6;
  });
}

function localEvidenceCheck(
  input: MatrixGenerationDeterministicAuditInput,
): GenerationAuditCheck {
  if (input.target.pageType !== 'location') {
    return notApplicable('local-evidence', 'grounding', 'This is not a location page.');
  }
  const requirement = input.target.evidenceRequirements.find(candidate => (
    candidate.fieldPath === 'location.relevance'
  ));
  const resolution = requirement
    ? input.evidenceResolutions.find(candidate => candidate.requirementId === requirement.id)
    : undefined;
  const actualWords = countHtmlWords(pageHtml(input.post));
  const minimumWords = Math.max(
    60,
    Math.floor(input.target.blockManifest.totalWordCountTarget * 0.3),
  );
  const passed = Boolean(
    requirement?.status === 'verified'
    && resolution
    && actualWords >= minimumWords
    && carriesEvidence(stripHtml(pageHtml(input.post)), evidenceTexts(resolution.value)),
  );
  return check(
    'local-evidence',
    'grounding',
    passed,
    'The location page contains substantive copy grounded in its verified local evidence.',
    'The location page is thin or does not carry its verified cell-specific local evidence.',
    requirement ? [requirement.id] : [],
  );
}

function firstParagraphText(html: string): string {
  const match = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return stripHtml(match?.[1] ?? html);
}

function aeoModePasses(mode: string, html: string): boolean {
  const text = stripHtml(html);
  switch (mode) {
    case 'answer_first': {
      const wordCount = words(firstParagraphText(html)).length;
      return wordCount >= 5 && wordCount <= 80;
    }
    case 'definition':
      return /\b(?:is|means|refers to)\b/i.test(text);
    case 'faq':
    case 'paa': {
      const questionEnd = text.indexOf('?');
      return questionEnd >= 0 && words(text.slice(questionEnd + 1)).length >= 5;
    }
    default:
      return false;
  }
}

function aeoCheck(blocks: readonly CandidateBlock[]): GenerationAuditCheck {
  const required = blocks.filter(block => block.contract.aeoContract.required);
  const failed = required.filter(block => (
    block.contract.aeoContract.modes.length === 0
    || block.contract.aeoContract.modes.some(mode => !aeoModePasses(mode, block.html))
  ));
  return check(
    'aeo-contracts',
    'aeo',
    failed.length === 0,
    'Every required AEO block satisfies its locked answer structure.',
    'A required AEO block is missing its locked answer-first, definition, FAQ, or PAA structure.',
  );
}

function canonicalAbsoluteUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch { // catch-ok: invalid CTA URLs fail the deterministic evidence match.
    return null;
  }
}

function ctaCarriesVerifiedInstruction(
  html: string,
  value: GenerationEvidenceValue,
): boolean {
  if (value.kind === 'url') {
    const expected = canonicalAbsoluteUrl(value.value);
    return expected !== null && extractLinks(html).some(link => (
      canonicalAbsoluteUrl(link.href.trim()) === expected
    ));
  }
  if (value.kind !== 'text' && value.kind !== 'text_list') return false;
  return carriesEvidence(stripHtml(html), evidenceTexts(value));
}

function ctaCheck(
  target: MatrixGenerationPreviewTarget,
  blocks: readonly CandidateBlock[],
  evidenceResolutions: MatrixGenerationDeterministicAuditInput['evidenceResolutions'],
): GenerationAuditCheck {
  const required = blocks.filter(block => block.contract.ctaContract.required);
  const actionPattern = /\b(?:book|call|contact|get started|learn more|request|schedule|speak|start|talk)\b/i;
  const requirement = target.evidenceRequirements.find(candidate => (
    candidate.fieldPath === 'cta.details'
  ));
  const resolution = requirement
    ? evidenceResolutions.find(candidate => candidate.requirementId === requirement.id)
    : undefined;
  const failed = required.filter(block => (
    !actionPattern.test(stripHtml(block.html))
    || !resolution
    || !ctaCarriesVerifiedInstruction(block.html, resolution.value)
  ));
  return check(
    'cta-contracts',
    'conversion',
    failed.length === 0,
    'Every required CTA block gives a clear action using its verified destination or instruction.',
    'A required CTA block is unclear or does not use its verified destination or instruction.',
    requirement ? [requirement.id] : [],
  );
}

function uniquenessCheck(
  target: MatrixGenerationPreviewTarget,
  blocks: readonly CandidateBlock[],
): GenerationAuditCheck {
  const substantiveBlocks = blocks
    .map(block => normalizeText(stripHtml(block.html)))
    .filter(text => words(text).length >= 8);
  const duplicate = new Set(substantiveBlocks).size !== substantiveBlocks.length;
  const needsCellSpecificValue = target.pageType === 'location' || target.pageType === 'service';
  const variableTokens = new Set([
    ...Object.values(target.variableValues).flatMap(words),
    ...words(target.targetKeyword.value),
  ]);
  const nonVariableWordCount = words(stripHtml(blocks.map(block => block.html).join('\n')))
    .filter(word => !variableTokens.has(word)).length;
  const minimumDistinctiveWords = Math.min(
    40,
    Math.max(20, Math.floor(target.blockManifest.totalWordCountTarget * 0.15)),
  );
  const passed = !duplicate && (!needsCellSpecificValue || nonVariableWordCount >= minimumDistinctiveWords);
  return check(
    'substantive-uniqueness',
    'quality',
    passed,
    'The draft avoids duplicate blocks and contains substantive cell-specific prose.',
    'The draft repeats substantive blocks or is mostly variable substitution.',
  );
}

function voiceGuardrailCheck(
  post: GeneratedPost,
  guardrails: VoiceGuardrails,
): GenerationAuditCheck {
  const text = normalizeText(stripHtml(pageHtml(post)));
  const padded = ` ${text} `;
  const forbidden = guardrails.forbiddenWords.some(word => (
    padded.includes(` ${normalizeText(word)} `)
  ));
  const wrongTerminology = guardrails.requiredTerminology.some(term => (
    padded.includes(` ${normalizeText(term.insteadOf)} `)
    && !padded.includes(` ${normalizeText(term.use)} `)
  ));
  return check(
    'voice-guardrails',
    'voice',
    !forbidden && !wrongTerminology,
    'The draft respects the frozen lexical voice guardrails.',
    'The draft uses forbidden language or ignores required terminology.',
    ['brand-voice:finalized'],
  );
}

function humanChecks(): GenerationHumanRequiredAuditCheck[] {
  return [
    {
      id: 'factual-accuracy',
      category: 'provenance',
      result: 'needs_human_review',
      message: 'A human must verify factual and inferred assertions against the cited evidence.',
      evidenceRequirementIds: [],
    },
    {
      id: 'no-hallucinations',
      category: 'provenance',
      result: 'needs_human_review',
      message: 'A human must confirm the generated prose introduces no unsupported factual implication.',
      evidenceRequirementIds: [],
    },
  ];
}

function readyChecks(checks: readonly GenerationAuditCheck[]) {
  return checks.map(item => {
    if (item.result !== 'passed' && item.result !== 'not_applicable') {
      throw new MatrixGenerationAuditContractError('A ready report cannot retain a failed check.');
    }
    return { ...item, result: item.result };
  });
}

export function runMatrixGenerationDeterministicAudit(
  input: MatrixGenerationDeterministicAuditInput,
): GenerationAuditReport {
  const blocks = candidateBlocks(input.target, input.post);
  const checks = [
    templateCensusCheck(input.target, input.post),
    urlCheck(input.target),
    metadataCheck(input.target, input.post),
    metadataLengthCheck(input.post),
    ...keywordChecks(input.target, input.post),
    internalPathCheck(
      input.target,
      blocks,
      input.knownInternalPaths,
      input.internalPathCensusComplete,
    ),
    tableStructureCheck(blocks),
    placeholderCheck(input.target, input.post),
    localEvidenceCheck(input),
    aeoCheck(blocks),
    ctaCheck(input.target, blocks, input.evidenceResolutions),
    uniquenessCheck(input.target, blocks),
    voiceGuardrailCheck(input.post, input.voiceGuardrails),
  ];
  const unresolvedRequirementIds = input.target.evidenceRequirements
    .filter(requirement => (
      requirement.requirementStage === 'ready'
      && (requirement.status === 'missing' || requirement.status === 'conflicting')
    ))
    .map(requirement => requirement.id);
  const base = {
    deterministicChecks: checks,
    modelFindings: [],
    humanRequiredChecks: humanChecks(),
    revisionCount: input.revisionCount,
    auditedAt: (input.now?.() ?? new Date()).toISOString(),
  };

  const [firstUnresolved, ...remainingUnresolved] = unresolvedRequirementIds;
  if (firstUnresolved) {
    return {
      ...base,
      verdict: 'blocked_missing_evidence',
      unresolvedRequirementIds: [firstUnresolved, ...remainingUnresolved],
    };
  }
  if (checks.some(item => item.result === 'failed')) {
    return {
      ...base,
      verdict: 'needs_attention',
      unresolvedRequirementIds: [],
    };
  }
  return {
    ...base,
    verdict: 'ready_for_human_review',
    deterministicChecks: readyChecks(checks),
    unresolvedRequirementIds: [],
  };
}

export function mergeMatrixGenerationAudit(
  input: MergeMatrixGenerationAuditInput,
): GenerationAuditReport {
  const allowedTargetIds = new Set<string>(
    input.target.blockManifest.blocks.map(block => block.id),
  );
  for (const finding of input.modelOutput.findings) {
    if (finding.affectedTargetIds.some(targetId => !allowedTargetIds.has(targetId))) {
      throw new MatrixGenerationAuditContractError(
        'Model audit returned an unknown affected target identity.',
      );
    }
  }

  const deterministicFailed = input.deterministicReport.deterministicChecks
    .some(item => item.result === 'failed');
  const modelNeedsAttention = input.modelOutput.findings.some(finding => (
    finding.severity === 'error'
    || (finding.severity === 'warning' && !finding.requiresHumanReview)
  ));
  const reportBase = {
    ...input.deterministicReport,
    modelFindings: input.modelOutput.findings,
  };
  const [firstUnresolved, ...remainingUnresolved] = input.deterministicReport.unresolvedRequirementIds;
  if (firstUnresolved) {
    return {
      ...reportBase,
      verdict: 'blocked_missing_evidence',
      unresolvedRequirementIds: [firstUnresolved, ...remainingUnresolved],
    };
  }
  if (deterministicFailed || modelNeedsAttention) {
    return {
      ...reportBase,
      verdict: 'needs_attention',
      unresolvedRequirementIds: [],
    };
  }
  return {
    ...reportBase,
    verdict: 'ready_for_human_review',
    deterministicChecks: readyChecks(input.deterministicReport.deterministicChecks),
    unresolvedRequirementIds: [],
  };
}

export function getMatrixGenerationAuditDisposition(
  report: GenerationAuditReport,
  revisionCount: GenerationAutomaticRevisionCount,
  revisionRecommended: boolean,
): MatrixGenerationAuditDisposition {
  if (report.revisionCount !== revisionCount) {
    throw new MatrixGenerationAuditContractError(
      'Audit report revision count does not match the generation item.',
    );
  }
  if (report.verdict === 'blocked_missing_evidence') return 'blocked_missing_evidence';
  if (report.verdict === 'ready_for_human_review') return 'ready';
  return revisionCount === 0 && revisionRecommended ? 'revise' : 'needs_attention';
}
