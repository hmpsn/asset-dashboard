import {
  BRIEF_PAGE_TYPES,
  type BriefPageType,
  type ContentMatrix,
  type ContentTemplate,
  type MatrixCell,
} from '../../../../shared/types/content.js';
import type {
  GenerationEvidenceRequirement,
  GenerationEvidenceSourceRef,
} from '../../../../shared/types/generation-evidence.js';
import {
  MATRIX_GENERATION_CONTRACT_VERSION,
  type MatrixSourceRevision,
  type MatrixStructuralResolutionResult,
  type ResolvedMatrixKeyword,
  type ResolvedMatrixStructuralTarget,
} from '../../../../shared/types/matrix-generation.js';
import { buildResolvedPageBlockManifest } from './block-manifest.js';
import {
  canonicalGenerationFingerprint,
  computeStructuralTargetFingerprint,
} from './fingerprint.js';
import {
  canonicalizeMatrixPath,
  renderMatrixPattern,
  slugifyMatrixVariable,
  validateRenderedMatrixPath,
} from './renderer.js';
import { normalizePageUrl } from '../../../utils/page-address.js';
import { structuralBlocker, verifiedStructuralRequirement } from './requirements.js';
import { createContentTemplateGenerationUpgradeProposal } from './template-upgrade.js';

export interface MatrixPlannedUrlInput {
  cellId: string;
  plannedUrl: string;
}

export interface ResolveMatrixStructureInput {
  workspaceId: string;
  matrix: ContentMatrix;
  template: ContentTemplate;
  cell: MatrixCell;
  expectedSourceRevision: MatrixSourceRevision;
  matrixPlannedUrls: readonly MatrixPlannedUrlInput[];
  matrixUrlCensusComplete?: boolean;
  knownWorkspacePagePaths: readonly string[];
  knownWorkspacePublishedSlugs?: readonly string[];
  workspaceUrlCensusComplete?: boolean;
  currentEvidenceRequirementIds?: readonly string[];
}

const BRIEF_PAGE_TYPE_SET = new Set<string>(BRIEF_PAGE_TYPES);

function sourceRevision(value: unknown): number | null {
  if (value === undefined) return 0;
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}

function resultIdentity(
  input: ResolveMatrixStructureInput,
  revision: MatrixSourceRevision,
): Pick<MatrixStructuralResolutionResult, 'matrixId' | 'templateId' | 'cellId' | 'sourceRevision'> {
  return {
    matrixId: typeof input.matrix?.id === 'string' ? input.matrix.id : '',
    templateId: typeof input.template?.id === 'string' ? input.template.id : '',
    cellId: typeof input.cell?.id === 'string' ? input.cell.id : '',
    sourceRevision: revision,
  };
}

function blocker(
  id: string,
  fieldPath: string,
  claim: string,
  reason: string,
): GenerationEvidenceRequirement {
  return structuralBlocker(id, fieldPath, claim, reason);
}

function deduplicateBlockers(blockers: GenerationEvidenceRequirement[]): GenerationEvidenceRequirement[] {
  const seen = new Set<string>();
  return blockers.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function patternIssueReason(issues: readonly { code: string; variableName?: string }[]): string {
  return issues
    .map(issue => issue.variableName ? `${issue.code}:${issue.variableName}` : issue.code)
    .join(', ');
}

function sourceRef(
  sourceType: 'content_matrix' | 'content_template' | 'content_matrix_cell',
  sourceId: string,
  revision: number,
  capturedAt: string,
  fieldPath?: string,
): GenerationEvidenceSourceRef {
  return {
    sourceType,
    sourceId,
    sourceRevision: revision,
    ...(fieldPath ? { fieldPath } : {}),
    capturedAt,
  };
}

function selectKeyword(
  cell: MatrixCell,
  revision: number,
  capturedAt: string,
): ResolvedMatrixKeyword | null {
  const candidates = [
    { source: 'custom' as const, value: cell.customKeyword },
    { source: 'target' as const, value: cell.targetKeyword },
    { source: 'recommended' as const, value: cell.recommendedKeyword },
  ];
  const selected = candidates.find(candidate => (
    typeof candidate.value === 'string' && candidate.value.trim().length > 0
  ));
  if (!selected || typeof selected.value !== 'string') return null;
  const validationApplies = selected.source === 'target' && Boolean(cell.keywordValidation);

  const evidenceRefs: GenerationEvidenceSourceRef[] = [sourceRef(
    'content_matrix_cell',
    cell.id,
    revision,
    capturedAt,
    selected.source === 'recommended' ? 'recommendedKeyword' : `${selected.source}Keyword`,
  )];
  if (validationApplies && cell.keywordValidation
    && Number.isFinite(cell.keywordValidation.volume)
    && Number.isFinite(cell.keywordValidation.difficulty)
    && Number.isFinite(cell.keywordValidation.cpc)
    && typeof cell.keywordValidation.validatedAt === 'string') {
    evidenceRefs.push({
      sourceType: 'seo_provider',
      sourceId: `${cell.id}:keyword-validation`,
      sourceRevision: revision,
      fieldPath: 'keywordValidation',
      label: 'Directional keyword research; not factual business proof',
      capturedAt: cell.keywordValidation.validatedAt,
    });
  }

  return {
    value: selected.value.trim(),
    source: selected.source,
    evidenceRefs,
    ...(validationApplies && cell.keywordValidation
      ? { validation: { ...cell.keywordValidation } }
      : {}),
  };
}

function matrixCellMatchesPassedCell(matrixCell: MatrixCell, passedCell: MatrixCell): boolean {
  return canonicalGenerationFingerprint(matrixCell) === canonicalGenerationFingerprint(passedCell);
}

/**
 * Zero-cost structural resolution. This function performs no reads, writes,
 * provider calls, job dispatch, or artifact creation.
 */
export function resolveMatrixStructure(
  input: ResolveMatrixStructureInput,
): MatrixStructuralResolutionResult {
  const blockers: GenerationEvidenceRequirement[] = [];
  const matrixRevision = sourceRevision(input.matrix?.revision);
  const templateRevision = sourceRevision(input.template?.revision);
  const cellRevision = sourceRevision(input.cell?.revision);
  const actualRevision: MatrixSourceRevision = {
    matrixRevision: matrixRevision ?? 0,
    templateRevision: templateRevision ?? 0,
    cellRevision: cellRevision ?? 0,
  };
  const identity = resultIdentity(input, actualRevision);

  if (!input.matrix || typeof input.matrix !== 'object' || !Array.isArray(input.matrix.cells)) {
    blockers.push(blocker('malformed_matrix', 'matrix', 'The content matrix has a valid stored shape.', 'The matrix could not be read safely.'));
  }
  if (!input.template || typeof input.template !== 'object' || !Array.isArray(input.template.variables) || !Array.isArray(input.template.sections)) {
    blockers.push(blocker('malformed_template', 'template', 'The content template has a valid stored shape.', 'The template could not be read safely.'));
  }
  if (!input.cell || typeof input.cell !== 'object' || !input.cell.variableValues || typeof input.cell.variableValues !== 'object') {
    blockers.push(blocker('malformed_matrix_cell', 'cell', 'The selected matrix cell has a valid stored shape.', 'The selected cell could not be read safely.'));
  }
  if (blockers.length > 0) return { ...identity, status: 'blocked', blockers: deduplicateBlockers(blockers) };

  if (matrixRevision === null) blockers.push(blocker('malformed_matrix_revision', 'matrix.revision', 'The matrix revision is a non-negative integer.', 'The matrix revision is malformed.'));
  if (templateRevision === null) blockers.push(blocker('malformed_template_revision', 'template.revision', 'The template revision is a non-negative integer.', 'The template revision is malformed.'));
  if (cellRevision === null) blockers.push(blocker('malformed_cell_revision', 'cell.revision', 'The cell revision is a non-negative integer.', 'The cell revision is malformed.'));

  const expectedRevision = input.expectedSourceRevision;
  const expectedRevisionIsValid = Boolean(expectedRevision)
    && sourceRevision(expectedRevision.matrixRevision) === expectedRevision.matrixRevision
    && sourceRevision(expectedRevision.templateRevision) === expectedRevision.templateRevision
    && sourceRevision(expectedRevision.cellRevision) === expectedRevision.cellRevision;
  if (!expectedRevisionIsValid) {
    blockers.push(blocker(
      'malformed_expected_source_revision',
      'expectedSourceRevision',
      'The expected source revision is a complete non-negative integer envelope.',
      'The expected source revision is malformed.',
    ));
  }

  if (input.workspaceId !== input.matrix.workspaceId || input.workspaceId !== input.template.workspaceId) {
    blockers.push(blocker('workspace_mismatch', 'workspaceId', 'Matrix and template belong to the requested workspace.', 'The requested sources cross a workspace boundary.'));
  }
  if (input.matrix.templateId !== input.template.id) {
    blockers.push(blocker('matrix_template_mismatch', 'matrix.templateId', 'The matrix points to the selected template.', 'The selected template is not linked to this matrix.'));
  }

  const matchingCells = input.matrix.cells.filter(cell => cell?.id === input.cell.id);
  if (matchingCells.length !== 1 || !matrixCellMatchesPassedCell(matchingCells[0]!, input.cell)) {
    blockers.push(blocker('matrix_cell_mismatch', 'cell.id', 'The selected durable cell belongs to the matrix snapshot.', 'The selected cell is missing, duplicated, or differs from the matrix snapshot.'));
  }

  if (expectedRevisionIsValid && matrixRevision !== null && expectedRevision.matrixRevision !== matrixRevision) {
    blockers.push(blocker('stale_matrix_revision', 'expectedSourceRevision.matrixRevision', 'The expected matrix revision is current.', 'The matrix changed after selection.'));
  }
  if (expectedRevisionIsValid && templateRevision !== null && expectedRevision.templateRevision !== templateRevision) {
    blockers.push(blocker('stale_template_revision', 'expectedSourceRevision.templateRevision', 'The expected template revision is current.', 'The template changed after selection.'));
  }
  if (expectedRevisionIsValid && cellRevision !== null && expectedRevision.cellRevision !== cellRevision) {
    blockers.push(blocker('stale_cell_revision', 'expectedSourceRevision.cellRevision', 'The expected cell revision is current.', 'The selected cell changed after selection.'));
  }

  if (!BRIEF_PAGE_TYPE_SET.has(input.template.pageType)) {
    blockers.push(blocker(
      'unsupported_page_type',
      'template.pageType',
      'The template page type is supported by content generation.',
      `Page type "${String(input.template.pageType)}" needs an explicit migration to a supported brief page type.`,
    ));
  }
  if (typeof input.template.titlePattern !== 'string' || input.template.titlePattern.trim().length === 0) {
    blockers.push(blocker('missing_title_pattern', 'template.titlePattern', 'The template declares a title pattern.', 'No title pattern is available; fallback marketing copy is forbidden.'));
  }
  if (typeof input.template.metaDescPattern !== 'string' || input.template.metaDescPattern.trim().length === 0) {
    blockers.push(blocker('missing_meta_description_pattern', 'template.metaDescPattern', 'The template declares a meta description pattern.', 'No meta description pattern is available; fallback marketing copy is forbidden.'));
  }

  const variableNames: string[] = [];
  const variableNameSet = new Set<string>();
  for (const variable of input.template.variables) {
    if (!variable || typeof variable.name !== 'string' || variable.name.trim().length === 0) {
      blockers.push(blocker('malformed_template_variable', 'template.variables', 'Every template variable has a durable non-empty name.', 'A template variable is malformed.'));
      continue;
    }
    if (variableNameSet.has(variable.name)) {
      blockers.push(blocker(`duplicate_template_variable:${variable.name}`, 'template.variables', 'Template variable names are unique.', `Variable "${variable.name}" is duplicated.`));
      continue;
    }
    variableNames.push(variable.name);
    variableNameSet.add(variable.name);
  }
  if (!Array.isArray(input.matrix.dimensions)) {
    blockers.push(blocker('malformed_matrix_dimensions', 'matrix.dimensions', 'The matrix dimensions have a valid stored shape.', 'The matrix dimensions are malformed.'));
  } else {
    const dimensionNames = new Set<string>();
    const dimensionsByName = new Map<string, readonly string[]>();
    for (const dimension of input.matrix.dimensions) {
      if (!dimension
        || typeof dimension.variableName !== 'string'
        || dimension.variableName.trim().length === 0
        || !Array.isArray(dimension.values)
        || dimension.values.some(value => typeof value !== 'string')) {
        blockers.push(blocker('malformed_matrix_dimensions', 'matrix.dimensions', 'The matrix dimensions have a valid stored shape.', 'A matrix dimension is malformed.'));
        continue;
      }
      if (dimensionNames.has(dimension.variableName)) {
        blockers.push(blocker(`duplicate_matrix_dimension:${dimension.variableName}`, 'matrix.dimensions', 'Matrix dimension names are unique.', `Dimension "${dimension.variableName}" is duplicated.`));
      }
      dimensionNames.add(dimension.variableName);
      dimensionsByName.set(dimension.variableName, dimension.values);
      if (!variableNameSet.has(dimension.variableName)) {
        blockers.push(blocker(`unknown_matrix_dimension:${dimension.variableName}`, 'matrix.dimensions', 'Every matrix dimension is declared by the template.', `Dimension "${dimension.variableName}" is not declared by the template.`));
      }
      if (dimension.values.length === 0) {
        blockers.push(blocker(`empty_matrix_dimension_values:${dimension.variableName}`, `matrix.dimensions.${dimension.variableName}.values`, 'Every matrix dimension contains at least one value.', `Dimension "${dimension.variableName}" has no values.`));
      }
      const normalizedValues = new Set<string>();
      for (const value of dimension.values) {
        if (value.trim().length === 0) {
          blockers.push(blocker(`blank_matrix_dimension_value:${dimension.variableName}`, `matrix.dimensions.${dimension.variableName}.values`, 'Matrix dimension values are non-blank.', `Dimension "${dimension.variableName}" contains a blank value.`));
          continue;
        }
        const comparisonValue = value.normalize('NFKC').trim().toLowerCase();
        if (normalizedValues.has(comparisonValue)) {
          blockers.push(blocker(`duplicate_matrix_dimension_value:${dimension.variableName}`, `matrix.dimensions.${dimension.variableName}.values`, 'Matrix dimension values are unique.', `Dimension "${dimension.variableName}" contains duplicate values.`));
        }
        normalizedValues.add(comparisonValue);
      }
    }
    for (const variableName of variableNames) {
      const dimensionValues = dimensionsByName.get(variableName);
      if (!dimensionValues) {
        blockers.push(blocker(`missing_matrix_dimension:${variableName}`, 'matrix.dimensions', 'Every template variable has one matching matrix dimension.', `Template variable "${variableName}" has no matrix dimension.`));
        continue;
      }
      const selectedValue = input.cell.variableValues[variableName];
      if (typeof selectedValue === 'string'
        && selectedValue.trim().length > 0
        && !dimensionValues.includes(selectedValue)) {
        blockers.push(blocker(`cell_value_outside_dimension:${variableName}`, `cell.variableValues.${variableName}`, 'The selected cell value exists in its authoritative matrix dimension.', `Cell value for "${variableName}" is absent from the matrix dimension.`));
      }
    }
  }
  let hasUnknownCellVariable = false;
  for (const name of Object.keys(input.cell.variableValues)) {
    if (!variableNameSet.has(name)) {
      hasUnknownCellVariable = true;
      blockers.push(blocker(`unknown_cell_variable:${name}`, `cell.variableValues.${name}`, 'The cell contains only template-declared variables.', `Variable "${name}" is not declared by the template.`));
    }
  }
  if (hasUnknownCellVariable) {
    blockers.push(blocker('unknown_cell_variable', 'cell.variableValues', 'The cell contains only template-declared variables.', 'The cell includes an unknown variable.'));
  }
  for (const name of variableNames) {
    const value = input.cell.variableValues[name];
    if (typeof value !== 'string' || value.trim().length === 0) {
      blockers.push(blocker(`missing_cell_variable:${name}`, `cell.variableValues.${name}`, 'Every declared template variable has a non-empty cell value.', `Variable "${name}" is missing or blank.`));
      blockers.push(blocker('missing_cell_variable', 'cell.variableValues', 'Every declared template variable has a non-empty cell value.', 'The cell is missing a required variable.'));
    }
  }

  const slugSubstitutions = Object.create(null) as Record<string, string>;
  const proseSubstitutions = Object.create(null) as Record<string, string>;
  for (const name of variableNames) {
    const raw = input.cell.variableValues[name];
    if (typeof raw !== 'string' || raw.trim().length === 0) continue;
    const slug = slugifyMatrixVariable(raw);
    if (!slug) {
      blockers.push(blocker(`empty_slug_value:${name}`, `cell.variableValues.${name}`, 'Every URL variable has a non-empty locale-safe slug.', `Variable "${name}" normalizes to an empty slug.`));
      continue;
    }
    slugSubstitutions[name] = slug;
    proseSubstitutions[name] = raw;
  }

  const urlRender = renderMatrixPattern(input.matrix.urlPattern, input.cell.variableValues, 'slug', variableNames);
  if (urlRender.status === 'blocked') {
    blockers.push(blocker('invalid_url_pattern', 'matrix.urlPattern', 'The matrix URL pattern resolves every declared placeholder.', patternIssueReason(urlRender.issues)));
  }
  const keywordPatternRender = renderMatrixPattern(input.matrix.keywordPattern, input.cell.variableValues, 'prose', variableNames);
  if (keywordPatternRender.status === 'blocked') {
    blockers.push(blocker('invalid_keyword_pattern', 'matrix.keywordPattern', 'The matrix keyword pattern resolves every declared placeholder.', patternIssueReason(keywordPatternRender.issues)));
  }
  const titleRender = typeof input.template.titlePattern === 'string'
    ? renderMatrixPattern(input.template.titlePattern, input.cell.variableValues, 'prose', variableNames)
    : null;
  if (titleRender?.status === 'blocked') {
    blockers.push(blocker('invalid_title_pattern', 'template.titlePattern', 'The title pattern resolves every declared placeholder.', patternIssueReason(titleRender.issues)));
  }
  const metaRender = typeof input.template.metaDescPattern === 'string'
    ? renderMatrixPattern(input.template.metaDescPattern, input.cell.variableValues, 'prose', variableNames)
    : null;
  if (metaRender?.status === 'blocked') {
    blockers.push(blocker('invalid_meta_description_pattern', 'template.metaDescPattern', 'The meta description pattern resolves every declared placeholder.', patternIssueReason(metaRender.issues)));
  }

  let effectiveCanonicalPath: string | null = null;
  if (urlRender.status === 'rendered') {
    const pathValidation = validateRenderedMatrixPath(urlRender.value);
    if (pathValidation.status === 'blocked') {
      blockers.push(blocker('invalid_planned_url', 'matrix.urlPattern', 'The rendered URL is a safe absolute workspace path.', `Rendered URL failed validation: ${pathValidation.code}.`));
    } else {
      if (input.cell.plannedUrlOverridden === true) {
        const overrideValidation = validateRenderedMatrixPath(input.cell.plannedUrl);
        if (overrideValidation.status === 'blocked') {
          blockers.push(blocker('invalid_planned_url_override', 'cell.plannedUrl', 'The overridden cell URL is a safe absolute workspace path.', `Overridden URL failed validation: ${overrideValidation.code}.`));
        } else {
          effectiveCanonicalPath = overrideValidation.canonicalPath;
        }
      } else {
        effectiveCanonicalPath = pathValidation.canonicalPath;
        const storedCanonicalPath = canonicalizeMatrixPath(input.cell.plannedUrl);
        if (storedCanonicalPath !== effectiveCanonicalPath) {
          blockers.push(blocker('planned_url_drift', 'cell.plannedUrl', 'The stored cell URL matches deterministic matrix rendering.', 'The stored planned URL differs from the rendered matrix URL.'));
        }
      }
    }
  }

  if (effectiveCanonicalPath !== null) {
    let censusIsValid = input.matrixUrlCensusComplete !== false
      && Array.isArray(input.matrixPlannedUrls)
      && input.matrixPlannedUrls.length >= input.matrix.cells.length;
    if (censusIsValid) {
      const censusByCell = new Map<string, string[]>();
      for (const candidate of input.matrixPlannedUrls) {
        if (!candidate || typeof candidate.cellId !== 'string' || typeof candidate.plannedUrl !== 'string') {
          censusIsValid = false;
          continue;
        }
        const values = censusByCell.get(candidate.cellId) ?? [];
        values.push(candidate.plannedUrl);
        censusByCell.set(candidate.cellId, values);
        if (values.length > 1 || canonicalizeMatrixPath(candidate.plannedUrl) === null) {
          censusIsValid = false;
        }
      }
      for (const matrixCell of input.matrix.cells) {
        if (!matrixCell || typeof matrixCell.id !== 'string' || typeof matrixCell.plannedUrl !== 'string') {
          censusIsValid = false;
          continue;
        }
        const censusValues = censusByCell.get(matrixCell.id);
        if (!censusValues || censusValues.length !== 1 || censusValues[0] !== matrixCell.plannedUrl) {
          censusIsValid = false;
        }
      }
    }
    if (!censusIsValid) {
      blockers.push(blocker('malformed_matrix_url_census', 'matrixPlannedUrls', 'The collision census includes every matrix cell URL.', 'The matrix URL census is malformed.'));
    }
    for (const matrixCell of input.matrix.cells) {
      if (!matrixCell || typeof matrixCell.id !== 'string' || typeof matrixCell.plannedUrl !== 'string') {
        blockers.push(blocker('malformed_matrix_url_census', 'matrix.cells', 'Every authoritative matrix cell has a durable ID and planned URL.', 'An authoritative matrix cell is malformed.'));
        continue;
      }
      if (matrixCell.id === input.cell.id) continue;
      const canonicalCandidate = canonicalizeMatrixPath(matrixCell.plannedUrl);
      if (canonicalCandidate === null) {
        blockers.push(blocker(`invalid_matrix_cell_planned_url:${matrixCell.id}`, `matrix.cells.${matrixCell.id}.plannedUrl`, 'Every matrix cell has a safe canonical planned URL.', `Matrix cell ${matrixCell.id} has an invalid planned URL.`));
      } else if (canonicalCandidate === effectiveCanonicalPath) {
        blockers.push(blocker('planned_url_collision', 'cell.plannedUrl', 'The planned URL is unique across the matrix.', `Another durable matrix cell (${matrixCell.id}) has the same canonical URL.`));
      }
    }
    if (Array.isArray(input.matrixPlannedUrls)) {
      for (const candidate of input.matrixPlannedUrls) {
        if (!candidate
          || typeof candidate.cellId !== 'string'
          || typeof candidate.plannedUrl !== 'string'
          || candidate.cellId === input.cell.id) {
          continue;
        }
        const canonicalCandidate = canonicalizeMatrixPath(candidate.plannedUrl);
        if (canonicalCandidate === effectiveCanonicalPath) {
          blockers.push(blocker('planned_url_collision', 'cell.plannedUrl', 'The planned URL is unique across the workspace matrix census.', `Another durable matrix cell (${candidate.cellId}) has the same canonical URL.`));
        }
      }
    }

    if (input.workspaceUrlCensusComplete === false) {
      blockers.push(blocker('malformed_workspace_url_census', 'knownWorkspacePagePaths', 'The collision census includes every authoritative workspace page source.', 'The live or published workspace page census is unavailable or incomplete.'));
    }
    if (!Array.isArray(input.knownWorkspacePagePaths)) {
      blockers.push(blocker('malformed_workspace_url_census', 'knownWorkspacePagePaths', 'The collision census includes known workspace pages.', 'The workspace page path census is malformed.'));
    } else {
      for (const path of input.knownWorkspacePagePaths) {
        const canonicalKnownPath = canonicalizeMatrixPath(path);
        if (canonicalKnownPath === null) {
          blockers.push(blocker('malformed_workspace_url_census', 'knownWorkspacePagePaths', 'The collision census includes safe known workspace paths.', 'A known workspace page path is malformed.'));
        } else if (canonicalKnownPath === effectiveCanonicalPath) {
          blockers.push(blocker('workspace_url_collision', 'cell.plannedUrl', 'The planned URL does not collide with a known workspace page.', 'A known workspace page has the same canonical path.'));
        }
      }
    }

    const publishedPaths = input.knownWorkspacePublishedSlugs ?? [];
    if (!Array.isArray(publishedPaths)) {
      blockers.push(blocker('malformed_workspace_url_census', 'knownWorkspacePublishedSlugs', 'The collision census includes durable published page identities.', 'The published page identity census is malformed.'));
    } else {
      for (const path of publishedPaths) {
        const canonicalPublishedIdentity = typeof path === 'string'
          ? canonicalizeMatrixPath(normalizePageUrl(path))
          : null;
        if (canonicalPublishedIdentity === null) {
          blockers.push(blocker('malformed_workspace_url_census', 'knownWorkspacePublishedSlugs', 'The collision census includes safe durable published page identities.', 'A published page identity is malformed.'));
          continue;
        }
        if (canonicalPublishedIdentity === effectiveCanonicalPath) {
          blockers.push(blocker('workspace_url_collision', 'cell.plannedUrl', 'The planned URL does not collide with a published workspace page.', 'A published content page has the same canonical path.'));
        }
      }
    }
  }

  const resolvedKeyword = selectKeyword(input.cell, actualRevision.cellRevision, input.matrix.createdAt);
  if (resolvedKeyword?.source === 'target' && input.cell.keywordValidation && (
    !Number.isFinite(input.cell.keywordValidation.volume)
    || !Number.isFinite(input.cell.keywordValidation.difficulty)
    || !Number.isFinite(input.cell.keywordValidation.cpc)
    || typeof input.cell.keywordValidation.validatedAt !== 'string'
    || input.cell.keywordValidation.validatedAt.trim().length === 0
  )) {
    blockers.push(blocker(
      'malformed_keyword_validation',
      'cell.keywordValidation',
      'Stored directional keyword research has a valid numeric and timestamp shape.',
      'The keyword validation snapshot is malformed.',
    ));
  }
  if (!resolvedKeyword) {
    blockers.push(blocker('missing_target_keyword', 'cell.targetKeyword', 'The cell has a non-empty custom, target, or recommended keyword.', 'No keyword is available under the locked precedence rule.'));
  }

  let manifestResult: ReturnType<typeof buildResolvedPageBlockManifest> | null = null;
  let upgradeResult: ReturnType<typeof createContentTemplateGenerationUpgradeProposal> | null = null;
  if (input.template.generationContractVersion === MATRIX_GENERATION_CONTRACT_VERSION) {
    manifestResult = buildResolvedPageBlockManifest(
      input.template.sections,
      input.cell.variableValues,
      variableNames,
      input.cell.id,
      input.currentEvidenceRequirementIds,
    );
    if (manifestResult.status === 'blocked') {
      blockers.push(...manifestResult.issues.map(issue => blocker(
        `invalid_template_block:${issue.sectionId ?? 'unknown'}:${issue.code}`,
        `template.sections.${issue.sectionId ?? 'unknown'}`,
        'The accepted template produces one complete locked block manifest.',
        issue.patternIssues ? patternIssueReason(issue.patternIssues) : issue.code,
      )));
    }
  } else if (input.template.generationContractVersion === undefined || input.template.generationContractVersion === 0) {
    upgradeResult = createContentTemplateGenerationUpgradeProposal(input.template);
    if (upgradeResult.status === 'blocked') blockers.push(...upgradeResult.blockers);
  } else {
    blockers.push(blocker(
      'unsupported_generation_contract_version',
      'template.generationContractVersion',
      'The template uses the current generation contract.',
      `Generation contract version ${String(input.template.generationContractVersion)} is unsupported.`,
    ));
  }

  if (blockers.length > 0) {
    return { ...identity, status: 'blocked', blockers: deduplicateBlockers(blockers) };
  }
  if (upgradeResult?.status === 'proposal') {
    return { ...identity, status: 'upgrade_required', proposal: upgradeResult.proposal };
  }
  if (!manifestResult || manifestResult.status !== 'resolved'
    || !resolvedKeyword
    || !titleRender || titleRender.status !== 'rendered'
    || !metaRender || metaRender.status !== 'rendered'
    || urlRender.status !== 'rendered') {
    return {
      ...identity,
      status: 'blocked',
      blockers: [blocker('malformed_structural_resolution', 'resolution', 'Structural resolution produces a complete target.', 'The source could not produce a complete structural target.')],
    };
  }

  const capturedAt = input.matrix.createdAt;
  const structuralRequirements: GenerationEvidenceRequirement[] = [
    verifiedStructuralRequirement(
      'matrix_source_identity',
      'matrixId',
      'The target is addressed by a durable content matrix.',
      'The matrix ID and revision ground structure only; they do not prove business facts.',
      [sourceRef('content_matrix', input.matrix.id, actualRevision.matrixRevision, capturedAt)],
    ),
    verifiedStructuralRequirement(
      'template_source_identity',
      'templateId',
      'The target uses an accepted generation template.',
      'The template ID and revision lock page structure only; they do not prove business facts.',
      [sourceRef('content_template', input.template.id, actualRevision.templateRevision, input.template.createdAt)],
    ),
    verifiedStructuralRequirement(
      'cell_source_identity',
      'cellId',
      'The target is addressed by a durable matrix cell.',
      'The cell ID and revision lock targeting labels only; they do not prove business facts.',
      [sourceRef('content_matrix_cell', input.cell.id, actualRevision.cellRevision, capturedAt)],
    ),
  ];

  const targetCore = {
    workspaceId: input.workspaceId,
    matrixId: input.matrix.id,
    templateId: input.template.id,
    cellId: input.cell.id,
    sourceRevision: actualRevision,
    variableValues: { ...input.cell.variableValues },
    slugSubstitutions,
    proseSubstitutions,
    targetKeyword: resolvedKeyword,
    plannedUrl: input.cell.plannedUrlOverridden === true
      ? input.cell.plannedUrl
      : urlRender.value,
    title: titleRender.value,
    metaDescription: metaRender.value,
    renderedHeadings: manifestResult.renderedHeadings,
    pageType: input.template.pageType as BriefPageType,
    schemaTypes: input.cell.expectedSchemaTypesOverridden === true
      ? [...(input.cell.expectedSchemaTypes ?? [])]
      : input.template.schemaTypes?.length
        ? [...input.template.schemaTypes]
        : [...(input.cell.expectedSchemaTypes ?? [])],
    blockManifest: manifestResult.manifest,
    generationContractVersion: MATRIX_GENERATION_CONTRACT_VERSION,
    structuralRequirements,
    structuralBlockingRequirementIds: [] as string[],
  };
  const target: ResolvedMatrixStructuralTarget = {
    ...targetCore,
    structuralFingerprint: computeStructuralTargetFingerprint(targetCore),
  };
  return { ...identity, status: 'resolved', target };
}
