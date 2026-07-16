import { randomUUID } from 'node:crypto';
import type {
  CreateMatrixGenerationRunRequest,
  MatrixGenerationAttempt,
  MatrixGenerationItem,
  MatrixGenerationItemStatus,
  MatrixGenerationReadySelectionItem,
  MatrixGenerationRun,
  MatrixGenerationRunStatus,
  MatrixGenerationStage,
  MatrixGenerationAttemptStatus,
  MatrixGenerationAcceptedBudget,
  MatrixGenerationBudgetUsage,
  MatrixGenerationSetAuditReport,
  MatrixPageApprovalEvidence,
  MatrixGenerationPreviewTarget,
  MatrixGenerationSelection,
  PersistedMatrixGenerationRun,
  PublicMatrixGenerationCreatorAttribution,
} from '../../../../shared/types/matrix-generation.js';
import type {
  ContentBrief,
  GeneratedPost,
  PersistedContentBrief,
  PersistedGeneratedPost,
} from '../../../../shared/types/content.js';
import { normalizeMatrixGenerationSchemaTypes } from '../../../../shared/types/matrix-generation.js';
import type {
  GenerationResolverAttribution,
  GenerationRunCounts,
} from '../../../../shared/types/generation-evidence.js';
import {
  GENERATION_EVIDENCE_SOURCE_TYPES,
  STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES,
} from '../../../../shared/types/generation-evidence.js';
import {
  BRAND_DELIVERABLE_TYPES,
} from '../../../../shared/types/brand-engine.js';
import { finalizedVoiceSnapshotRefSchema } from '../../../../shared/types/voice-finalization-schemas.js';
import db from '../../../db/index.js';
import { parseJsonSafe } from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { z } from '../../../middleware/validate.js';
import {
  canonicalGenerationFingerprint,
  computeBlockManifestFingerprint,
  computeStructuralTargetFingerprint,
} from './fingerprint.js';
import { getBrief, persistGeneratedBrief } from '../../../content-brief.js';
import { getMatrix, updateMatrixCell } from '../../../content-matrices.js';
import { getTemplate } from '../../../content-templates.js';
import {
  getPost,
  persistGeneratedPost,
  replacePostWithSnapshot,
} from '../../../content-posts-db.js';
import {
  MATRIX_GENERATION_ATTEMPT_TRANSITIONS,
  MATRIX_GENERATION_ITEM_TRANSITIONS,
  MATRIX_GENERATION_RUN_TRANSITIONS,
  validateTransition,
} from '../../../state-machines.js';
import { assertPreviewIdentityCurrent } from './preview.js';
import { generationProvenanceSchema } from '../../../schemas/generation-provenance.js';

interface MatrixGenerationRunRow {
  id: string;
  workspace_id: string;
  matrix_id: string;
  template_id: string;
  status: PersistedMatrixGenerationRun['status'];
  revision: number;
  idempotency_key: string;
  selection_fingerprint: string;
  job_id: string | null;
  accepted_budget: string | null;
  set_audit_report: string | null;
  selected_count: number;
  queued_count: number;
  running_count: number;
  ready_for_human_review_count: number;
  needs_attention_count: number;
  blocked_count: number;
  conflict_count: number;
  failed_count: number;
  cancelled_count: number;
  created_by: string;
  mcp_execution_context: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface MatrixGenerationSelectionRow {
  matrix_id: string;
  cell_id: string;
  matrix_revision: number;
  template_revision: number;
  cell_revision: number;
  structural_fingerprint: string;
  preview_fingerprint: string;
}

interface MatrixGenerationItemRow {
  id: string;
  run_id: string;
  workspace_id: string;
  matrix_id: string;
  run_matrix_id: string;
  run_template_id: string;
  cell_id: string;
  matrix_revision: number;
  template_revision: number;
  cell_revision: number;
  status: MatrixGenerationItem['status'];
  revision: number;
  structural_fingerprint: string;
  preview_fingerprint: string;
  structural_target: string | null;
  preview_target: string | null;
  brief_id: string | null;
  post_id: string | null;
  audit_report: string | null;
  approval_evidence: string | null;
  attempt_count: number;
  automatic_revision_count: 0 | 1;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface MatrixGenerationAttemptRow {
  id: string;
  item_id: string;
  attempt_number: number;
  stage: MatrixGenerationAttempt['stage'];
  status: MatrixGenerationAttempt['status'];
  effective_input_fingerprint: string;
  provenance: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

const resolverAttributionSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp', 'system']),
  actorId: z.string().min(1),
  actorLabel: z.string().optional(),
}).strict();

const masterCallerSchema = z.object({
  kind: z.literal('master_key'),
  scope: z.literal('all'),
  keyId: z.null(),
  keyLabel: z.null(),
}).strict();

const workspaceCallerSchema = z.object({
  kind: z.literal('workspace_key'),
  scope: z.string().min(1),
  workspaceId: z.string().min(1),
  keyId: z.string().min(1),
  keyLabel: z.string().min(1),
}).strict();

const mcpExecutionContextSchema = z.object({
  requestId: z.string().min(1),
  toolName: z.string().min(1),
  targetWorkspaceId: z.string().nullable(),
  caller: z.union([masterCallerSchema, workspaceCallerSchema]),
}).strict();

const sourceRevisionSchema = z.object({
  matrixRevision: z.number().int().nonnegative(),
  templateRevision: z.number().int().nonnegative(),
  cellRevision: z.number().int().nonnegative(),
}).strict();

const readySelectionSchema = z.object({
  matrixId: z.string().min(1),
  cellId: z.string().min(1),
  sourceRevision: sourceRevisionSchema,
  structuralFingerprint: z.string().min(1),
  previewFingerprint: z.string().min(1),
}).strict();

const evidenceSourceRefSchema = z.object({
  sourceType: z.enum(GENERATION_EVIDENCE_SOURCE_TYPES),
  sourceId: z.string().min(1),
  sourceRevision: z.number().int().nonnegative().optional(),
  fieldPath: z.string().optional(),
  label: z.string().optional(),
  uri: z.string().optional(),
  capturedAt: z.string().min(1),
}).strict();

const evidenceRequirementSchema = z.object({
  id: z.string().min(1),
  fieldPath: z.string().min(1),
  claim: z.string(),
  reason: z.string(),
  requirementStage: z.enum(['preflight', 'ready', 'optional_omit']),
  claimKind: z.enum(['factual', 'structural', 'creative']),
  status: z.enum(['verified', 'inferred', 'missing', 'conflicting', 'creative_proposal']),
  sourceRefs: z.array(evidenceSourceRefSchema),
  clientSafePrompt: z.string().optional(),
}).superRefine((requirement, ctx) => {
  if (requirement.claimKind === 'creative') {
    if (requirement.status !== 'creative_proposal') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Creative claims require creative_proposal status' });
    }
  } else if (requirement.status === 'creative_proposal') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only creative claims may use creative_proposal status' });
  }
  if (requirement.status === 'verified' && requirement.sourceRefs.length < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Verified requirements need a source' });
  }
  if (requirement.status === 'conflicting' && requirement.sourceRefs.length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conflicting requirements need two sources' });
  }
  if (requirement.status === 'missing' && requirement.sourceRefs.length !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Missing requirements cannot carry sources' });
  }
  if (requirement.claimKind === 'factual' && requirement.sourceRefs.some(source =>
    (STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES as readonly string[])
      .includes(source.sourceType))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Structural sources cannot prove factual claims' });
  }
});

const resolvedAeoContractSchema = z.object({
  modes: z.array(z.enum(['answer_first', 'definition', 'faq', 'paa'])),
  required: z.boolean(),
}).strict().superRefine((contract, ctx) => {
  if (contract.required && contract.modes.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Required AEO contracts need at least one mode',
    });
  }
});

const resolvedCtaContractSchema = z.object({
  role: z.enum(['none', 'primary', 'secondary']),
  required: z.boolean(),
}).strict().superRefine((contract, ctx) => {
  if (contract.role === 'none' && contract.required) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A required CTA contract cannot use the none role',
    });
  }
  if (contract.role === 'primary' && !contract.required) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A primary CTA contract must be required',
    });
  }
});

const resolvedBlockBaseShape = {
  order: z.number().int().nonnegative(),
  heading: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.null()]),
    renderedText: z.string().nullable(),
    locked: z.boolean(),
  }).strict(),
  guidance: z.string(),
  wordCountTarget: z.number().nonnegative().optional(),
  aeoContract: resolvedAeoContractSchema,
  ctaContract: resolvedCtaContractSchema,
};

const resolvedBlockSchema = z.union([
  z.object({
    id: z.literal('system:introduction'),
    source: z.literal('system'),
    generationRole: z.literal('introduction'),
    ...resolvedBlockBaseShape,
  }).strict(),
  z.object({
    id: z.string().regex(/^template:.+/),
    source: z.literal('template'),
    sourceSectionId: z.string().min(1),
    generationRole: z.enum(['body', 'answer_first', 'definition', 'proof', 'process', 'faq', 'cta']),
    optional: z.boolean().optional(),
    ...resolvedBlockBaseShape,
  }).strict(),
  z.object({
    id: z.literal('system:conclusion'),
    source: z.literal('system'),
    generationRole: z.literal('conclusion'),
    ...resolvedBlockBaseShape,
  }).strict(),
]);

const resolvedBlockSequenceSchema = z.array(resolvedBlockSchema).min(2).superRefine((blocks, ctx) => {
  if (blocks[0]?.id !== 'system:introduction') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Introduction must be the first block' });
  }
  if (blocks.at(-1)?.id !== 'system:conclusion') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conclusion must be the last block' });
  }
  if (blocks.filter(block => block.id === 'system:introduction').length !== 1
    || blocks.filter(block => block.id === 'system:conclusion').length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'System wrappers must appear exactly once' });
  }

  const blockIds = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (blockIds.has(block.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Resolved block IDs must be unique',
        path: [index, 'id'],
      });
    }
    blockIds.add(block.id);
    if (block.order !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Resolved block order must match its locked sequence position',
        path: [index, 'order'],
      });
    }
    if (block.source === 'template' && block.id !== `template:${block.sourceSectionId}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Template block IDs must bind their source section ID',
        path: [index, 'id'],
      });
    }
    if (block.generationRole === 'answer_first'
      && (!block.aeoContract.required || !block.aeoContract.modes.includes('answer_first'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Answer-first blocks require the answer_first AEO contract',
        path: [index, 'aeoContract'],
      });
    }
    if (block.generationRole === 'definition'
      && (!block.aeoContract.required || !block.aeoContract.modes.includes('definition'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Definition blocks require the definition AEO contract',
        path: [index, 'aeoContract'],
      });
    }
    if (block.generationRole === 'faq'
      && (!block.aeoContract.required || !block.aeoContract.modes.includes('faq'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FAQ blocks require the faq AEO contract',
        path: [index, 'aeoContract'],
      });
    }
    if (block.generationRole === 'cta'
      && (!block.ctaContract.required || block.ctaContract.role === 'none')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CTA blocks require a non-none CTA contract',
        path: [index, 'ctaContract'],
      });
    }
  }

  const requiredPrimaryCtaBlocks = blocks.filter(block => (
    block.ctaContract.role === 'primary' && block.ctaContract.required
  ));
  if (requiredPrimaryCtaBlocks.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Resolved block manifests require exactly one required primary CTA',
    });
  }

  const introduction = blocks[0];
  if (introduction?.id === 'system:introduction'
    && (introduction.ctaContract.role !== 'none' || introduction.ctaContract.required)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The system introduction cannot own a CTA contract',
      path: [0, 'ctaContract'],
    });
  }
  const conclusionIndex = blocks.length - 1;
  const conclusion = blocks[conclusionIndex];
  const templateOwnsPrimaryCta = blocks.some(block => (
    block.source === 'template'
    && block.ctaContract.role === 'primary'
    && block.ctaContract.required
  ));
  if (conclusion?.id === 'system:conclusion') {
    const conclusionHasFallbackPrimary = conclusion.ctaContract.role === 'primary'
      && conclusion.ctaContract.required;
    const conclusionHasNoCta = conclusion.ctaContract.role === 'none'
      && !conclusion.ctaContract.required;
    if ((templateOwnsPrimaryCta && !conclusionHasNoCta)
      || (!templateOwnsPrimaryCta && !conclusionHasFallbackPrimary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The system conclusion must own the fallback primary CTA exactly when the template does not',
        path: [conclusionIndex, 'ctaContract'],
      });
    }
  }
});

const normalizedSchemaTypesSchema = z.array(z.string()).superRefine((schemaTypes, ctx) => {
  try {
    const normalized = normalizeMatrixGenerationSchemaTypes(
      schemaTypes,
      'structuralTarget.schemaTypes',
    );
    if (normalized.length !== schemaTypes.length
      || normalized.some((schemaType, index) => schemaType !== schemaTypes[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Stored schema types must already be normalized',
      });
    }
  } catch { // catch-ok: schema contract failures are converted into a stable stored-row validation issue.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Stored schema types violate the generation contract',
    });
  }
});

const resolvedStructuralTargetSchema = z.object({
  workspaceId: z.string().min(1),
  matrixId: z.string().min(1),
  templateId: z.string().min(1),
  cellId: z.string().min(1),
  sourceRevision: sourceRevisionSchema,
  variableValues: z.record(z.string()),
  slugSubstitutions: z.record(z.string()),
  proseSubstitutions: z.record(z.string()),
  targetKeyword: z.object({
    value: z.string(),
    source: z.enum(['target', 'custom', 'recommended']),
    evidenceRefs: z.array(evidenceSourceRefSchema),
    validation: z.object({
      volume: z.number(),
      difficulty: z.number(),
      cpc: z.number(),
      validatedAt: z.string().min(1),
    }).optional(),
  }),
  plannedUrl: z.string(),
  title: z.string(),
  metaDescription: z.string(),
  renderedHeadings: z.array(z.string()),
  pageType: z.enum(['blog', 'landing', 'service', 'location', 'pillar', 'product', 'resource']),
  schemaTypes: normalizedSchemaTypesSchema,
  blockManifest: z.object({
    generationContractVersion: z.number().int().positive(),
    blocks: resolvedBlockSequenceSchema,
    omittedOptionalSections: z.array(z.object({
      sourceSectionId: z.string().min(1),
      name: z.string().min(1),
      generationRole: z.enum(['body', 'answer_first', 'definition', 'proof', 'process', 'faq', 'cta']),
      evidenceRequirementId: z.string().min(1),
      reason: z.literal('missing_section_evidence'),
    }).strict()).optional(),
    totalWordCountTarget: z.number().nonnegative(),
    fingerprint: z.string().min(1),
  }),
  generationContractVersion: z.number().int().positive(),
  structuralRequirements: z.array(evidenceRequirementSchema),
  structuralBlockingRequirementIds: z.array(z.string()),
  structuralFingerprint: z.string().min(1),
});

const previewTargetSchema = resolvedStructuralTargetSchema.extend({
  voiceSnapshot: finalizedVoiceSnapshotRefSchema,
  identitySnapshot: z.array(z.object({
    deliverableId: z.string().min(1),
    deliverableType: z.enum(BRAND_DELIVERABLE_TYPES),
    version: z.number().int().nonnegative(),
    approvedAt: z.string().min(1),
    contentFingerprint: z.string().min(1),
    approvalFingerprint: z.string().min(1),
  })),
  evidenceRequirements: z.array(evidenceRequirementSchema),
  evidenceCapturedAt: z.string().min(1),
  evidenceFreshThrough: z.string().min(1),
  expectedArtifactRevisions: z.object({
    brief: z.object({
      artifactType: z.literal('content_brief'),
      artifactId: z.string().nullable(),
      generationRevision: z.number().int().nonnegative(),
    }),
    post: z.object({
      artifactType: z.literal('generated_post'),
      artifactId: z.string().nullable(),
      generationRevision: z.number().int().nonnegative(),
    }),
  }),
  effectiveInputFingerprint: z.string().min(1),
  blockingRequirementIds: z.array(z.string()),
  estimatedPaidBudget: z.object({
    providerCalls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedUsd: z.number().nonnegative(),
    maxConcurrency: z.number().int().positive(),
  }),
});

const auditCheckSchema = z.object({
  id: z.string().min(1),
  category: z.string(),
  result: z.enum(['passed', 'failed', 'needs_human_review', 'not_applicable']),
  message: z.string(),
  evidenceRequirementIds: z.array(z.string()),
});

const readyAuditCheckSchema = auditCheckSchema.extend({
  result: z.enum(['passed', 'not_applicable']),
});

const humanRequiredAuditCheckSchema = auditCheckSchema.extend({
  result: z.enum(['needs_human_review', 'not_applicable']),
});

const modelFindingSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  affectedTargetIds: z.array(z.string()),
  requiresHumanReview: z.boolean(),
});

const auditReportBaseShape = {
  modelFindings: z.array(modelFindingSchema),
  humanRequiredChecks: z.array(humanRequiredAuditCheckSchema),
  revisionCount: z.union([z.literal(0), z.literal(1)]),
  auditedAt: z.string().min(1),
};

const auditReportSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('ready_for_human_review'),
    deterministicChecks: z.array(readyAuditCheckSchema),
    unresolvedRequirementIds: z.tuple([]),
    ...auditReportBaseShape,
  }),
  z.object({
    verdict: z.literal('needs_attention'),
    deterministicChecks: z.array(auditCheckSchema),
    unresolvedRequirementIds: z.array(z.string()),
    ...auditReportBaseShape,
  }),
  z.object({
    verdict: z.literal('blocked_missing_evidence'),
    deterministicChecks: z.array(auditCheckSchema),
    unresolvedRequirementIds: z.array(z.string()).min(1),
    ...auditReportBaseShape,
  }),
]);

const sanitizedErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  stage: z.string().optional(),
});

const batchBudgetLimitsSchema = z.object({
  maxProviderCalls: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxEstimatedUsd: z.number().positive(),
  maxConcurrency: z.number().int().positive(),
}).strict();

const costEstimateSchema = z.object({
  providerCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedUsd: z.number().nonnegative(),
  maxConcurrency: z.number().int().positive(),
}).strict();

const budgetUsageSchema = z.object({
  providerCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedUsd: z.number().nonnegative(),
}).strict();

const acceptedBudgetSchema = z.object({
  estimate: costEstimateSchema,
  limits: batchBudgetLimitsSchema,
  reserved: budgetUsageSchema,
}).strict();

const setAuditFindingSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['deterministic', 'model']),
  kind: z.enum(['structural', 'prose', 'provenance']),
  code: z.string().min(1),
  severity: z.enum(['warning', 'error']),
  message: z.string(),
  affectedItemIds: z.array(z.string().min(1)),
  affectedTargetIds: z.array(z.string().min(1)),
  requiresHumanReview: z.boolean(),
}).strict();

const setAuditReportSchema = z.object({
  verdict: z.enum(['passed', 'needs_attention', 'source_correction_required']),
  findings: z.array(setAuditFindingSchema),
  passCount: z.union([z.literal(1), z.literal(2)]),
  modelProvenance: generationProvenanceSchema.nullable(),
  auditedAt: z.string().min(1),
}).strict();

const humanReviewerSchema = resolverAttributionSchema.extend({
  actorType: z.enum(['operator', 'client']),
}).strict();

const pageApprovalEvidenceSchema = z.object({
  runId: z.string().min(1),
  itemId: z.string().min(1),
  matrixId: z.string().min(1),
  cellId: z.string().min(1),
  sourceRevision: sourceRevisionSchema,
  postId: z.string().min(1),
  postRevision: z.number().int().nonnegative(),
  approvedBy: humanReviewerSchema,
  approvedAt: z.string().min(1),
}).strict();

const stmts = createStmtCache(() => ({
  selectByIdempotency: db.prepare(`
    SELECT *
    FROM content_matrix_generation_runs
    WHERE workspace_id = ? AND matrix_id = ? AND idempotency_key = ?
  `),
  selectById: db.prepare(`
    SELECT *
    FROM content_matrix_generation_runs
    WHERE id = ? AND workspace_id = ?
  `),
  selectByJob: db.prepare(`
    SELECT *
    FROM content_matrix_generation_runs
    WHERE workspace_id = ? AND job_id = ?
  `),
  listRecoverableRuns: db.prepare(`
    SELECT *
    FROM content_matrix_generation_runs
    WHERE status IN ('queued', 'running')
    ORDER BY created_at ASC, id ASC
  `),
  selectSelections: db.prepare(`
    SELECT matrix_id, cell_id, matrix_revision, template_revision, cell_revision,
           structural_fingerprint, preview_fingerprint
    FROM content_matrix_generation_items
    WHERE run_id = ? AND workspace_id = ?
    ORDER BY created_at ASC, id ASC
  `),
  listItems: db.prepare(`
    SELECT item.*,
           run.matrix_id AS run_matrix_id,
           run.template_id AS run_template_id
    FROM content_matrix_generation_items item
    JOIN content_matrix_generation_runs run
      ON run.id = item.run_id
     AND run.workspace_id = item.workspace_id
    WHERE item.workspace_id = ? AND item.run_id = ?
    ORDER BY item.created_at ASC, item.id ASC
  `),
  selectItemById: db.prepare(`
    SELECT item.*,
           run.matrix_id AS run_matrix_id,
           run.template_id AS run_template_id
    FROM content_matrix_generation_items item
    JOIN content_matrix_generation_runs run
      ON run.id = item.run_id
     AND run.workspace_id = item.workspace_id
    WHERE item.id = ? AND item.workspace_id = ?
  `),
  updateItem: db.prepare(`
    UPDATE content_matrix_generation_items
    SET status = @next_status, -- status-ok: writeMatrixGenerationItem validates MATRIX_GENERATION_ITEM_TRANSITIONS before this CAS
        revision = revision + 1,
        structural_target = @structural_target,
        preview_target = @preview_target,
        brief_id = @brief_id,
        post_id = @post_id,
        audit_report = @audit_report,
        approval_evidence = @approval_evidence,
        automatic_revision_count = @automatic_revision_count,
        error = @error,
        updated_at = @updated_at,
        completed_at = @completed_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND revision = @expected_revision AND status = @expected_status
  `),
  bumpItemAttempt: db.prepare(`
    UPDATE content_matrix_generation_items
    SET revision = revision + 1,
        attempt_count = attempt_count + 1,
        updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND revision = @expected_revision
  `),
  updateRun: db.prepare(`
    UPDATE content_matrix_generation_runs
    SET status = @next_status, -- status-ok: transitionMatrixGenerationRun validates MATRIX_GENERATION_RUN_TRANSITIONS before this CAS
        revision = revision + 1,
        queued_count = @queued_count,
        running_count = @running_count,
        ready_for_human_review_count = @ready_count,
        needs_attention_count = @needs_attention_count,
        blocked_count = @blocked_count,
        conflict_count = @conflict_count,
        failed_count = @failed_count,
        cancelled_count = @cancelled_count,
        updated_at = @updated_at,
        completed_at = @completed_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND revision = @expected_revision AND status = @expected_status
  `),
  updateRunSetAudit: db.prepare(`
    UPDATE content_matrix_generation_runs
    SET revision = revision + 1,
        set_audit_report = @set_audit_report,
        updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND revision = @expected_revision
  `),
  updateRunBudget: db.prepare(`
    UPDATE content_matrix_generation_runs
    SET revision = revision + 1,
        accepted_budget = @accepted_budget,
        updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND revision = @expected_revision
  `),
  recordApprovalEvidence: db.prepare(`
    UPDATE content_matrix_generation_items
    SET revision = revision + 1,
        approval_evidence = @approval_evidence,
        updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND run_id = @run_id AND revision = @expected_revision
      AND status = 'ready_for_human_review'
      AND approval_evidence IS NULL
  `),
  insertAttempt: db.prepare(`
    INSERT INTO content_matrix_generation_attempts (
      id, item_id, attempt_number, stage, status,
      effective_input_fingerprint, provenance, error, started_at, completed_at
    ) VALUES (
      @id, @item_id, @attempt_number, @stage, 'running',
      @effective_input_fingerprint, NULL, NULL, @started_at, NULL
    )
  `),
  updateAttempt: db.prepare(`
    UPDATE content_matrix_generation_attempts
    SET status = @next_status, -- status-ok: finishMatrixGenerationAttempt validates MATRIX_GENERATION_ATTEMPT_TRANSITIONS before this CAS
        provenance = @provenance,
        error = @error,
        completed_at = @completed_at
    WHERE id = @id AND item_id = @item_id AND status = @expected_status
  `),
  selectAttemptById: db.prepare(`
    SELECT attempt.*
    FROM content_matrix_generation_attempts attempt
    JOIN content_matrix_generation_items item ON item.id = attempt.item_id
    WHERE attempt.id = ? AND attempt.item_id = ? AND item.workspace_id = ?
  `),
  listAttempts: db.prepare(`
    SELECT attempt.*
    FROM content_matrix_generation_attempts attempt
    JOIN content_matrix_generation_items item ON item.id = attempt.item_id
    WHERE attempt.item_id = ? AND item.workspace_id = ?
    ORDER BY attempt.attempt_number, attempt.started_at, attempt.id
  `),
  insertRun: db.prepare(`
    INSERT INTO content_matrix_generation_runs (
      id, workspace_id, matrix_id, template_id, status, revision,
      idempotency_key, selection_fingerprint, job_id, accepted_budget, set_audit_report,
      selected_count, queued_count, running_count,
      ready_for_human_review_count, needs_attention_count, blocked_count,
      conflict_count, failed_count, cancelled_count, created_by,
      mcp_execution_context, created_at, updated_at, completed_at
    ) VALUES (
      @id, @workspace_id, @matrix_id, @template_id, 'queued', 0,
      @idempotency_key, @selection_fingerprint, @job_id, @accepted_budget, NULL,
      @selected_count, @queued_count, 0,
      0, 0, 0,
      0, 0, 0, @created_by,
      @mcp_execution_context, @created_at, @updated_at, NULL
    )
  `),
  insertItem: db.prepare(`
    INSERT INTO content_matrix_generation_items (
      id, run_id, workspace_id, matrix_id, cell_id,
      matrix_revision, template_revision, cell_revision,
      structural_fingerprint, preview_fingerprint, status, revision,
      structural_target, preview_target, brief_id, post_id, audit_report, approval_evidence,
      attempt_count, automatic_revision_count, error,
      created_at, updated_at, completed_at
    ) VALUES (
      @id, @run_id, @workspace_id, @matrix_id, @cell_id,
      @matrix_revision, @template_revision, @cell_revision,
      @structural_fingerprint, @preview_fingerprint, 'queued', 0,
      NULL, NULL, NULL, NULL, NULL, NULL,
      0, 0, NULL,
      @created_at, @updated_at, NULL
    )
  `),
}));

export class MatrixGenerationRunIdempotencyConflictError extends Error {
  readonly workspaceId: string;
  readonly matrixId: string;
  readonly idempotencyKey: string;

  constructor(workspaceId: string, matrixId: string, idempotencyKey: string) {
    super('Matrix generation idempotency key was already used for a different selection');
    this.name = 'MatrixGenerationRunIdempotencyConflictError';
    this.workspaceId = workspaceId;
    this.matrixId = matrixId;
    this.idempotencyKey = idempotencyKey;
  }
}

export class MatrixGenerationPersistenceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatrixGenerationPersistenceContractError';
  }
}

function assertRunAttributionContext(
  workspaceId: string,
  createdBy: z.infer<typeof resolverAttributionSchema>,
  mcpExecutionContext: z.infer<typeof mcpExecutionContextSchema> | null,
  stored = false,
): void {
  const fail = (message: string): never => {
    throw new MatrixGenerationPersistenceContractError(
      stored
        ? `Stored matrix generation attribution is inconsistent: ${message}`
        : message,
    );
  };

  if (createdBy.actorType === 'mcp' && mcpExecutionContext === null) {
    fail('MCP creator attribution requires an MCP execution context');
  }
  if (!mcpExecutionContext) return;
  if (mcpExecutionContext.targetWorkspaceId !== workspaceId) {
    fail('MCP execution context workspace mismatch');
  }
  if (createdBy.actorType !== 'mcp') {
    fail('MCP execution context requires MCP creator attribution');
  }
  if (mcpExecutionContext.caller.kind !== 'workspace_key') return;
  if (mcpExecutionContext.caller.workspaceId !== workspaceId
    || mcpExecutionContext.caller.scope !== workspaceId) {
    fail('MCP caller workspace mismatch');
  }
  if (createdBy.actorId !== mcpExecutionContext.caller.keyId
    || (createdBy.actorLabel !== undefined
      && createdBy.actorLabel !== mcpExecutionContext.caller.keyLabel)) {
    fail('MCP caller attribution mismatch');
  }
}

function assertCreateRequest(request: CreateMatrixGenerationRunRequest): {
  createdBy: z.infer<typeof resolverAttributionSchema>;
  mcpExecutionContext: z.infer<typeof mcpExecutionContextSchema> | null;
  selections: MatrixGenerationSelection;
  acceptedBudget: MatrixGenerationAcceptedBudget | null;
} {
  if (!request.workspaceId || !request.matrixId || !request.templateId) {
    throw new MatrixGenerationPersistenceContractError('Workspace, matrix, and template IDs are required');
  }
  if (!request.idempotencyKey || !request.selectionFingerprint) {
    throw new MatrixGenerationPersistenceContractError('Idempotency key and selection fingerprint are required');
  }
  if (!Array.isArray(request.selections) || request.selections.length === 0) {
    throw new MatrixGenerationPersistenceContractError('A matrix generation run requires at least one previewed cell');
  }
  const jobId = request.jobId ?? null;
  const budgetResult = request.acceptedBudget === undefined || request.acceptedBudget === null
    ? null
    : acceptedBudgetSchema.safeParse(request.acceptedBudget);
  if ((jobId === null) !== (budgetResult === null)) {
    throw new MatrixGenerationPersistenceContractError(
      'Batch matrix generation requires both a job ID and accepted budget',
    );
  }
  if (jobId !== null && (!jobId.trim() || jobId !== jobId.trim() || jobId.length > 200)) {
    throw new MatrixGenerationPersistenceContractError('Matrix generation job ID is invalid');
  }
  if (budgetResult && !budgetResult.success) {
    throw new MatrixGenerationPersistenceContractError('Matrix generation accepted budget is invalid');
  }
  const cellIds = new Set<string>();
  const parsedSelections: MatrixGenerationReadySelectionItem[] = [];
  let matrixRevision: number | undefined;
  let templateRevision: number | undefined;
  for (const rawSelection of request.selections) {
    const parsedSelection = readySelectionSchema.safeParse(rawSelection);
    if (!parsedSelection.success) {
      throw new MatrixGenerationPersistenceContractError(
        'Every selection must have the exact previewed durable-cell shape',
      );
    }
    const selection = parsedSelection.data;
    parsedSelections.push(selection);
    if (selection.matrixId !== request.matrixId) {
      throw new MatrixGenerationPersistenceContractError('Every selection must belong to the run matrix');
    }
    if (!selection.cellId || !selection.structuralFingerprint || !selection.previewFingerprint) {
      throw new MatrixGenerationPersistenceContractError('Every selection must be a previewed durable cell');
    }
    if (!Number.isInteger(selection.sourceRevision.matrixRevision)
      || selection.sourceRevision.matrixRevision < 0
      || !Number.isInteger(selection.sourceRevision.templateRevision)
      || selection.sourceRevision.templateRevision < 0
      || !Number.isInteger(selection.sourceRevision.cellRevision)
      || selection.sourceRevision.cellRevision < 0) {
      throw new MatrixGenerationPersistenceContractError(
        'Every selection must carry a complete non-negative source revision',
      );
    }
    matrixRevision ??= selection.sourceRevision.matrixRevision;
    templateRevision ??= selection.sourceRevision.templateRevision;
    if (selection.sourceRevision.matrixRevision !== matrixRevision
      || selection.sourceRevision.templateRevision !== templateRevision) {
      throw new MatrixGenerationPersistenceContractError(
        'Every selection in a run must share the same matrix and template revisions',
      );
    }
    if (cellIds.has(selection.cellId)) {
      throw new MatrixGenerationPersistenceContractError('A matrix generation run cannot select a cell twice');
    }
    cellIds.add(selection.cellId);
  }
  const createdBy = resolverAttributionSchema.safeParse(request.createdBy);
  if (!createdBy.success) {
    throw new MatrixGenerationPersistenceContractError('Run creator attribution is invalid');
  }
  const mcpExecutionContext = request.mcpExecutionContext === null
    ? null
    : mcpExecutionContextSchema.safeParse(request.mcpExecutionContext);
  if (mcpExecutionContext !== null && !mcpExecutionContext.success) {
    throw new MatrixGenerationPersistenceContractError('MCP execution context is invalid');
  }
  const parsedContext = mcpExecutionContext?.data ?? null;
  assertRunAttributionContext(request.workspaceId, createdBy.data, parsedContext);
  const [firstSelection, ...remainingSelections] = parsedSelections;
  if (!firstSelection) {
    throw new MatrixGenerationPersistenceContractError(
      'A matrix generation run requires at least one previewed cell',
    );
  }
  return {
    createdBy: createdBy.data,
    mcpExecutionContext: parsedContext,
    selections: [firstSelection, ...remainingSelections],
    acceptedBudget: budgetResult?.data ?? null,
  };
}

function countsFromRow(row: MatrixGenerationRunRow): GenerationRunCounts {
  return {
    selected: row.selected_count,
    queued: row.queued_count,
    running: row.running_count,
    readyForHumanReview: row.ready_for_human_review_count,
    needsAttention: row.needs_attention_count,
    blocked: row.blocked_count,
    conflicts: row.conflict_count,
    failed: row.failed_count,
    cancelled: row.cancelled_count,
  };
}

function selectionFromRow(row: MatrixGenerationSelectionRow): MatrixGenerationReadySelectionItem {
  return {
    matrixId: row.matrix_id,
    cellId: row.cell_id,
    sourceRevision: {
      matrixRevision: row.matrix_revision,
      templateRevision: row.template_revision,
      cellRevision: row.cell_revision,
    },
    structuralFingerprint: row.structural_fingerprint,
    previewFingerprint: row.preview_fingerprint,
  };
}

function rowToRun(row: MatrixGenerationRunRow): PersistedMatrixGenerationRun {
  const createdBy = parseJsonSafe(row.created_by, resolverAttributionSchema, null, {
    workspaceId: row.workspace_id,
    table: 'content_matrix_generation_runs',
    field: 'created_by',
  });
  if (!createdBy) {
    throw new MatrixGenerationPersistenceContractError('Stored matrix generation creator attribution is invalid');
  }
  const mcpExecutionContext = row.mcp_execution_context
    ? parseJsonSafe(row.mcp_execution_context, mcpExecutionContextSchema, null, {
        workspaceId: row.workspace_id,
        table: 'content_matrix_generation_runs',
        field: 'mcp_execution_context',
      })
    : null;
  if (row.mcp_execution_context && !mcpExecutionContext) {
    throw new MatrixGenerationPersistenceContractError('Stored MCP execution context is invalid');
  }
  assertRunAttributionContext(row.workspace_id, createdBy, mcpExecutionContext, true);
  const acceptedBudget = row.accepted_budget
    ? parseJsonSafe(row.accepted_budget, acceptedBudgetSchema, null, {
        workspaceId: row.workspace_id,
        table: 'content_matrix_generation_runs',
        field: 'accepted_budget',
      })
    : null;
  const setAuditReport = row.set_audit_report
    ? parseJsonSafe(row.set_audit_report, setAuditReportSchema, null, {
        workspaceId: row.workspace_id,
        table: 'content_matrix_generation_runs',
        field: 'set_audit_report',
      })
    : null;
  if ((row.accepted_budget && !acceptedBudget) || (row.set_audit_report && !setAuditReport)) {
    throw new MatrixGenerationPersistenceContractError(
      'Stored matrix generation batch metadata is invalid',
    );
  }
  const selectionRows = stmts().selectSelections.all(row.id, row.workspace_id) as MatrixGenerationSelectionRow[];
  const [firstSelectionRow, ...remainingSelectionRows] = selectionRows;
  if (!firstSelectionRow) {
    throw new MatrixGenerationPersistenceContractError('Stored matrix generation run has no items');
  }
  if (selectionRows.length !== row.selected_count) {
    throw new MatrixGenerationPersistenceContractError(
      'Stored matrix generation selected count does not match its item snapshot',
    );
  }
  if (selectionRows.some(selection => selection.matrix_id !== row.matrix_id)) {
    throw new MatrixGenerationPersistenceContractError(
      'Stored matrix generation item belongs to a different matrix than its run',
    );
  }
  if (selectionRows.some(selection => (
    selection.matrix_revision !== firstSelectionRow.matrix_revision
    || selection.template_revision !== firstSelectionRow.template_revision
  ))) {
    throw new MatrixGenerationPersistenceContractError(
      'Stored matrix generation run spans multiple matrix or template revisions',
    );
  }
  const selections: MatrixGenerationSelection = [
    selectionFromRow(firstSelectionRow),
    ...remainingSelectionRows.map(selectionFromRow),
  ];

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    matrixId: row.matrix_id,
    templateId: row.template_id,
    status: row.status,
    revision: row.revision,
    idempotencyKey: row.idempotency_key,
    selectionFingerprint: row.selection_fingerprint,
    selections,
    jobId: row.job_id,
    acceptedBudget: acceptedBudget as MatrixGenerationAcceptedBudget | null,
    setAuditReport: setAuditReport as MatrixGenerationSetAuditReport | null,
    counts: countsFromRow(row),
    createdBy,
    mcpExecutionContext,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function projectPublicCreator(
  creator: GenerationResolverAttribution,
): PublicMatrixGenerationCreatorAttribution {
  if (creator.actorType === 'mcp' || creator.actorType === 'system') {
    return { actorType: creator.actorType };
  }
  return {
    actorType: creator.actorType,
    actorId: creator.actorId,
    ...(creator.actorLabel === undefined ? {} : { actorLabel: creator.actorLabel }),
  };
}

/** Removes operational execution/key attribution before an HTTP or MCP read. */
export function projectMatrixGenerationRun(
  run: PersistedMatrixGenerationRun,
): MatrixGenerationRun {
  const {
    createdBy,
    idempotencyKey: _idempotencyKey,
    mcpExecutionContext: _mcpExecutionContext,
    ...publicFields
  } = run;
  return {
    ...publicFields,
    createdBy: projectPublicCreator(createdBy),
  };
}

function parseStoredSnapshot<T>(
  raw: string | null,
  schema: z.ZodType<unknown>,
  workspaceId: string,
  field: string,
): T | null {
  if (raw === null) return null;
  const parsed = parseJsonSafe(raw, schema, null, {
    workspaceId,
    table: 'content_matrix_generation_items',
    field,
  });
  if (parsed === null) {
    throw new MatrixGenerationPersistenceContractError(
      `Stored matrix generation item ${field} is invalid`,
    );
  }
  return parsed as T;
}

function assertStoredTargetMatchesItem(
  row: MatrixGenerationItemRow,
  target: NonNullable<MatrixGenerationItem['structuralTarget']>,
  field: 'structural_target' | 'preview_target',
): void {
  const revisionsMatch = target.sourceRevision.matrixRevision === row.matrix_revision
    && target.sourceRevision.templateRevision === row.template_revision
    && target.sourceRevision.cellRevision === row.cell_revision;
  const previewFingerprintMatches = field !== 'preview_target'
    || ('effectiveInputFingerprint' in target
      && target.effectiveInputFingerprint === row.preview_fingerprint);
  const manifestFingerprintMatches = target.blockManifest.fingerprint
    === computeBlockManifestFingerprint(target.blockManifest);
  const structuralFingerprintMatches = target.structuralFingerprint
    === computeStructuralTargetFingerprint(target);
  if (
    row.matrix_id !== row.run_matrix_id
    || target.workspaceId !== row.workspace_id
    || target.matrixId !== row.matrix_id
    || target.templateId !== row.run_template_id
    || target.cellId !== row.cell_id
    || !revisionsMatch
    || !manifestFingerprintMatches
    || !structuralFingerprintMatches
    || target.structuralFingerprint !== row.structural_fingerprint
    || !previewFingerprintMatches
  ) {
    throw new MatrixGenerationPersistenceContractError(
      `Stored matrix generation item ${field} does not match its durable row identity`,
    );
  }
}

function rowToItem(row: MatrixGenerationItemRow): MatrixGenerationItem {
  if (row.matrix_id !== row.run_matrix_id) {
    throw new MatrixGenerationPersistenceContractError(
      'Stored matrix generation item belongs to a different matrix than its run',
    );
  }
  const structuralTarget = parseStoredSnapshot<NonNullable<MatrixGenerationItem['structuralTarget']>>(
    row.structural_target,
    resolvedStructuralTargetSchema,
    row.workspace_id,
    'structural_target',
  );
  const previewTarget = parseStoredSnapshot<NonNullable<MatrixGenerationItem['previewTarget']>>(
    row.preview_target,
    previewTargetSchema,
    row.workspace_id,
    'preview_target',
  );
  if (structuralTarget) {
    assertStoredTargetMatchesItem(row, structuralTarget, 'structural_target');
  }
  if (previewTarget) {
    assertStoredTargetMatchesItem(row, previewTarget, 'preview_target');
  }
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    matrixId: row.matrix_id,
    cellId: row.cell_id,
    sourceRevision: {
      matrixRevision: row.matrix_revision,
      templateRevision: row.template_revision,
      cellRevision: row.cell_revision,
    },
    status: row.status,
    revision: row.revision,
    structuralFingerprint: row.structural_fingerprint,
    previewFingerprint: row.preview_fingerprint,
    structuralTarget,
    previewTarget,
    briefId: row.brief_id,
    postId: row.post_id,
    auditReport: parseStoredSnapshot<NonNullable<MatrixGenerationItem['auditReport']>>(
      row.audit_report,
      auditReportSchema,
      row.workspace_id,
      'audit_report',
    ),
    approvalEvidence: parseStoredSnapshot<MatrixPageApprovalEvidence>(
      row.approval_evidence,
      pageApprovalEvidenceSchema,
      row.workspace_id,
      'approval_evidence',
    ),
    attemptCount: row.attempt_count,
    automaticRevisionCount: row.automatic_revision_count,
    error: parseStoredSnapshot<NonNullable<MatrixGenerationItem['error']>>(
      row.error,
      sanitizedErrorSchema,
      row.workspace_id,
      'error',
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export interface CreateMatrixGenerationRunResult {
  run: PersistedMatrixGenerationRun;
  existing: boolean;
}

export function getPersistedMatrixGenerationRun(
  workspaceId: string,
  runId: string,
): PersistedMatrixGenerationRun | null {
  const row = stmts().selectById.get(runId, workspaceId) as MatrixGenerationRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function getPersistedMatrixGenerationRunByIdempotency(
  workspaceId: string,
  matrixId: string,
  idempotencyKey: string,
): PersistedMatrixGenerationRun | null {
  const row = stmts().selectByIdempotency.get(
    workspaceId,
    matrixId,
    idempotencyKey,
  ) as MatrixGenerationRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function getPersistedMatrixGenerationRunByJob(
  workspaceId: string,
  jobId: string,
): PersistedMatrixGenerationRun | null {
  const row = stmts().selectByJob.get(workspaceId, jobId) as MatrixGenerationRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function listRecoverableMatrixGenerationRuns(): PersistedMatrixGenerationRun[] {
  return (stmts().listRecoverableRuns.all() as MatrixGenerationRunRow[]).map(rowToRun);
}

/** Public-safe run read. Internal callers needing evidence use the explicit persisted read. */
export function getMatrixGenerationRun(
  workspaceId: string,
  runId: string,
): MatrixGenerationRun | null {
  const run = getPersistedMatrixGenerationRun(workspaceId, runId);
  return run ? projectMatrixGenerationRun(run) : null;
}

/** Workspace/run-scoped deterministic item projection. Public paging lands in M1/M3. */
export function listMatrixGenerationItems(
  workspaceId: string,
  runId: string,
): MatrixGenerationItem[] {
  const rows = stmts().listItems.all(workspaceId, runId) as MatrixGenerationItemRow[];
  return rows.map(rowToItem);
}

export function getMatrixGenerationItem(
  workspaceId: string,
  itemId: string,
): MatrixGenerationItem | null {
  const row = stmts().selectItemById.get(itemId, workspaceId) as MatrixGenerationItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export class MatrixGenerationRevisionConflictError extends Error {
  readonly entity: 'run' | 'item' | 'attempt';
  readonly id: string;

  constructor(entity: 'run' | 'item' | 'attempt', id: string) {
    super(`Matrix generation ${entity} changed since it was read`);
    this.name = 'MatrixGenerationRevisionConflictError';
    this.entity = entity;
    this.id = id;
  }
}

const TERMINAL_ITEM_STATUSES = new Set<MatrixGenerationItemStatus>([
  'ready_for_human_review',
  'needs_attention',
  'blocked_missing_evidence',
  'conflict',
  'cancelled',
  'failed',
]);

const ACTIVE_ITEM_STATUSES = new Set<MatrixGenerationItemStatus>([
  'preflighting',
  'preflighted',
  'generating_brief',
  'generating_post',
  'auditing_deterministic',
  'auditing_model',
  'revising',
]);

function writeMatrixGenerationItem(input: {
  workspaceId: string;
  itemId: string;
  expectedRevision: number;
  nextStatus: MatrixGenerationItemStatus;
  structuralTarget?: MatrixGenerationItem['structuralTarget'];
  previewTarget?: MatrixGenerationItem['previewTarget'];
  briefId?: string;
  postId?: string;
  auditReport?: MatrixGenerationItem['auditReport'];
  approvalEvidence?: MatrixGenerationItem['approvalEvidence'];
  automaticRevisionCount?: MatrixGenerationItem['automaticRevisionCount'];
  error?: MatrixGenerationItem['error'];
}): MatrixGenerationItem {
  const current = getMatrixGenerationItem(input.workspaceId, input.itemId);
  if (!current || current.revision !== input.expectedRevision) {
    throw new MatrixGenerationRevisionConflictError('item', input.itemId);
  }
  validateTransition(
    'matrix_generation_item',
    MATRIX_GENERATION_ITEM_TRANSITIONS,
    current.status,
    input.nextStatus,
  );
  const now = new Date().toISOString();
  const completedAt = TERMINAL_ITEM_STATUSES.has(input.nextStatus) ? now : null;
  const structuralTarget = input.structuralTarget ?? current.structuralTarget;
  const previewTarget = input.previewTarget ?? current.previewTarget;
  const info = stmts().updateItem.run({
    id: input.itemId,
    workspace_id: input.workspaceId,
    expected_revision: input.expectedRevision,
    expected_status: current.status,
    next_status: input.nextStatus,
    structural_target: structuralTarget ? JSON.stringify(structuralTarget) : null,
    preview_target: previewTarget ? JSON.stringify(previewTarget) : null,
    brief_id: input.briefId ?? current.briefId,
    post_id: input.postId ?? current.postId,
    audit_report: input.auditReport === undefined
      ? current.auditReport ? JSON.stringify(current.auditReport) : null
      : input.auditReport ? JSON.stringify(input.auditReport) : null,
    approval_evidence: input.approvalEvidence === undefined
      ? current.approvalEvidence ? JSON.stringify(current.approvalEvidence) : null
      : input.approvalEvidence ? JSON.stringify(input.approvalEvidence) : null,
    automatic_revision_count: input.automaticRevisionCount
      ?? current.automaticRevisionCount,
    error: input.error === undefined
      ? current.error ? JSON.stringify(current.error) : null
      : input.error ? JSON.stringify(input.error) : null,
    updated_at: now,
    completed_at: completedAt,
  });
  if (info.changes !== 1) {
    throw new MatrixGenerationRevisionConflictError('item', input.itemId);
  }
  const updated = getMatrixGenerationItem(input.workspaceId, input.itemId);
  if (!updated) throw new MatrixGenerationRevisionConflictError('item', input.itemId);
  return updated;
}

export function transitionMatrixGenerationItem(input: {
  workspaceId: string;
  itemId: string;
  expectedRevision: number;
  nextStatus: MatrixGenerationItemStatus;
  structuralTarget?: MatrixGenerationItem['structuralTarget'];
  previewTarget?: MatrixGenerationItem['previewTarget'];
  briefId?: string;
  postId?: string;
  auditReport?: MatrixGenerationItem['auditReport'];
  approvalEvidence?: MatrixGenerationItem['approvalEvidence'];
  automaticRevisionCount?: MatrixGenerationItem['automaticRevisionCount'];
  error?: MatrixGenerationItem['error'];
}): MatrixGenerationItem {
  const write = () => writeMatrixGenerationItem(input);
  return db.inTransaction ? write() : db.transaction(write).immediate();
}

function countsForItems(items: readonly MatrixGenerationItem[]): GenerationRunCounts {
  const count = (status: MatrixGenerationItemStatus) => items.filter(item => item.status === status).length;
  return {
    selected: items.length,
    queued: count('queued'),
    running: items.filter(item => ACTIVE_ITEM_STATUSES.has(item.status)).length,
    readyForHumanReview: count('ready_for_human_review'),
    needsAttention: count('needs_attention'),
    blocked: count('blocked_missing_evidence'),
    conflicts: count('conflict'),
    failed: count('failed'),
    cancelled: count('cancelled'),
  };
}

const TERMINAL_RUN_STATUSES = new Set<MatrixGenerationRunStatus>([
  'completed',
  'completed_with_errors',
  'blocked',
  'conflict',
  'cancelled',
  'failed',
]);

export function transitionMatrixGenerationRun(input: {
  workspaceId: string;
  runId: string;
  expectedRevision: number;
  nextStatus: MatrixGenerationRunStatus;
}): PersistedMatrixGenerationRun {
  const write = (): PersistedMatrixGenerationRun => {
    const current = getPersistedMatrixGenerationRun(input.workspaceId, input.runId);
    if (!current || current.revision !== input.expectedRevision) {
      throw new MatrixGenerationRevisionConflictError('run', input.runId);
    }
    validateTransition(
      'matrix_generation_run',
      MATRIX_GENERATION_RUN_TRANSITIONS,
      current.status,
      input.nextStatus,
    );
    const counts = countsForItems(listMatrixGenerationItems(input.workspaceId, input.runId));
    const now = new Date().toISOString();
    const info = stmts().updateRun.run({
      id: input.runId,
      workspace_id: input.workspaceId,
      expected_revision: input.expectedRevision,
      expected_status: current.status,
      next_status: input.nextStatus,
      queued_count: counts.queued,
      running_count: counts.running,
      ready_count: counts.readyForHumanReview,
      needs_attention_count: counts.needsAttention,
      blocked_count: counts.blocked,
      conflict_count: counts.conflicts,
      failed_count: counts.failed,
      cancelled_count: counts.cancelled,
      updated_at: now,
      completed_at: TERMINAL_RUN_STATUSES.has(input.nextStatus) ? now : null,
    });
    if (info.changes !== 1) throw new MatrixGenerationRevisionConflictError('run', input.runId);
    const updated = getPersistedMatrixGenerationRun(input.workspaceId, input.runId);
    if (!updated) throw new MatrixGenerationRevisionConflictError('run', input.runId);
    return updated;
  };
  return db.inTransaction ? write() : db.transaction(write).immediate();
}

export function saveMatrixGenerationSetAuditReport(input: {
  workspaceId: string;
  runId: string;
  expectedRunRevision: number;
  report: MatrixGenerationSetAuditReport;
}): PersistedMatrixGenerationRun {
  const parsed = setAuditReportSchema.safeParse(input.report);
  if (!parsed.success) {
    throw new MatrixGenerationPersistenceContractError('Matrix generation set audit report is invalid');
  }
  const write = (): PersistedMatrixGenerationRun => {
    const current = getPersistedMatrixGenerationRun(input.workspaceId, input.runId);
    if (!current || current.revision !== input.expectedRunRevision) {
      throw new MatrixGenerationRevisionConflictError('run', input.runId);
    }
    const info = stmts().updateRunSetAudit.run({
      id: input.runId,
      workspace_id: input.workspaceId,
      expected_revision: input.expectedRunRevision,
      set_audit_report: JSON.stringify(parsed.data),
      updated_at: new Date().toISOString(),
    });
    if (info.changes !== 1) throw new MatrixGenerationRevisionConflictError('run', input.runId);
    const updated = getPersistedMatrixGenerationRun(input.workspaceId, input.runId);
    if (!updated) throw new MatrixGenerationRevisionConflictError('run', input.runId);
    return updated;
  };
  return db.inTransaction ? write() : db.transaction(write).immediate();
}

export function clearMatrixGenerationSetAuditReport(input: {
  workspaceId: string;
  runId: string;
  expectedRunRevision: number;
}): PersistedMatrixGenerationRun {
  const write = (): PersistedMatrixGenerationRun => {
    const current = getPersistedMatrixGenerationRun(input.workspaceId, input.runId);
    if (!current || current.revision !== input.expectedRunRevision) {
      throw new MatrixGenerationRevisionConflictError('run', input.runId);
    }
    if (!current.setAuditReport) return current;
    const info = stmts().updateRunSetAudit.run({
      id: input.runId,
      workspace_id: input.workspaceId,
      expected_revision: input.expectedRunRevision,
      set_audit_report: null,
      updated_at: new Date().toISOString(),
    });
    if (info.changes !== 1) throw new MatrixGenerationRevisionConflictError('run', input.runId);
    const updated = getPersistedMatrixGenerationRun(input.workspaceId, input.runId);
    if (!updated) throw new MatrixGenerationRevisionConflictError('run', input.runId);
    return updated;
  };
  return db.inTransaction ? write() : db.transaction(write).immediate();
}

export type MatrixGenerationBudgetDimension = keyof MatrixGenerationBudgetUsage;

export class MatrixGenerationBudgetExceededError extends Error {
  readonly code = 'matrix_generation_budget_exceeded';
  readonly dimension: MatrixGenerationBudgetDimension;

  constructor(dimension: MatrixGenerationBudgetDimension) {
    super(`Matrix generation cannot reserve more ${dimension} within the accepted budget`);
    this.name = 'MatrixGenerationBudgetExceededError';
    this.dimension = dimension;
  }
}

export function reserveMatrixGenerationBudget(input: {
  workspaceId: string;
  runId: string;
  reservation: MatrixGenerationBudgetUsage;
}): PersistedMatrixGenerationRun {
  const parsed = budgetUsageSchema.safeParse(input.reservation);
  if (!parsed.success) {
    throw new MatrixGenerationPersistenceContractError('Matrix generation budget reservation is invalid');
  }
  return db.transaction(() => {
    const run = getPersistedMatrixGenerationRun(input.workspaceId, input.runId);
    if (!run?.acceptedBudget) {
      throw new MatrixGenerationPersistenceContractError('Matrix generation run has no accepted budget');
    }
    const current = run.acceptedBudget.reserved;
    const next: MatrixGenerationBudgetUsage = {
      providerCalls: current.providerCalls + parsed.data.providerCalls,
      inputTokens: current.inputTokens + parsed.data.inputTokens,
      outputTokens: current.outputTokens + parsed.data.outputTokens,
      estimatedUsd: Number((current.estimatedUsd + parsed.data.estimatedUsd).toFixed(6)),
    };
    const limits = run.acceptedBudget.limits;
    const exceeded: MatrixGenerationBudgetDimension | undefined = [
      ['providerCalls', next.providerCalls, limits.maxProviderCalls],
      ['inputTokens', next.inputTokens, limits.maxInputTokens],
      ['outputTokens', next.outputTokens, limits.maxOutputTokens],
      ['estimatedUsd', next.estimatedUsd, limits.maxEstimatedUsd],
    ].find(([, value, limit]) => value > limit)?.[0] as MatrixGenerationBudgetDimension | undefined;
    if (exceeded) throw new MatrixGenerationBudgetExceededError(exceeded);
    const acceptedBudget: MatrixGenerationAcceptedBudget = {
      ...run.acceptedBudget,
      reserved: next,
    };
    const info = stmts().updateRunBudget.run({
      id: run.id,
      workspace_id: run.workspaceId,
      expected_revision: run.revision,
      accepted_budget: JSON.stringify(acceptedBudget),
      updated_at: new Date().toISOString(),
    });
    if (info.changes !== 1) throw new MatrixGenerationRevisionConflictError('run', run.id);
    const updated = getPersistedMatrixGenerationRun(run.workspaceId, run.id);
    if (!updated) throw new MatrixGenerationRevisionConflictError('run', run.id);
    return updated;
  }).immediate();
}

export function recordMatrixPageApprovalEvidence(input: {
  workspaceId: string;
  runId: string;
  itemId: string;
  expectedItemRevision: number;
  evidence: MatrixPageApprovalEvidence;
}): MatrixGenerationItem {
  const parsed = pageApprovalEvidenceSchema.safeParse(input.evidence);
  if (!parsed.success) {
    throw new MatrixGenerationPersistenceContractError('Matrix page approval evidence is invalid');
  }
  const write = (): MatrixGenerationItem => {
    const item = getMatrixGenerationItem(input.workspaceId, input.itemId);
    if (
      !item
      || item.runId !== input.runId
      || item.revision !== input.expectedItemRevision
      || item.status !== 'ready_for_human_review'
      || item.approvalEvidence !== null
      || parsed.data.runId !== item.runId
      || parsed.data.itemId !== item.id
      || parsed.data.matrixId !== item.matrixId
      || parsed.data.cellId !== item.cellId
      || parsed.data.postId !== item.postId
      || canonicalGenerationFingerprint(parsed.data.sourceRevision)
        !== canonicalGenerationFingerprint(item.sourceRevision)
    ) {
      throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    }
    const info = stmts().recordApprovalEvidence.run({
      id: input.itemId,
      workspace_id: input.workspaceId,
      run_id: input.runId,
      expected_revision: input.expectedItemRevision,
      approval_evidence: JSON.stringify(parsed.data),
      updated_at: new Date().toISOString(),
    });
    if (info.changes !== 1) throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    const updated = getMatrixGenerationItem(input.workspaceId, input.itemId);
    if (!updated) throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    return updated;
  };
  return db.inTransaction ? write() : db.transaction(write).immediate();
}

function rowToAttempt(row: MatrixGenerationAttemptRow, workspaceId: string): MatrixGenerationAttempt {
  const provenance = row.provenance
    ? parseJsonSafe(row.provenance, generationProvenanceSchema, null, {
        workspaceId,
        table: 'content_matrix_generation_attempts',
        field: 'provenance',
      })
    : null;
  const error = row.error
    ? parseJsonSafe(row.error, sanitizedErrorSchema, null, {
        workspaceId,
        table: 'content_matrix_generation_attempts',
        field: 'error',
      })
    : null;
  if (row.provenance && !provenance) {
    throw new MatrixGenerationPersistenceContractError('Stored matrix attempt provenance is invalid');
  }
  if (row.error && !error) {
    throw new MatrixGenerationPersistenceContractError('Stored matrix attempt error is invalid');
  }
  return {
    id: row.id,
    itemId: row.item_id,
    attemptNumber: row.attempt_number,
    stage: row.stage,
    status: row.status,
    effectiveInputFingerprint: row.effective_input_fingerprint,
    provenance,
    error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function listMatrixGenerationAttempts(
  workspaceId: string,
  itemId: string,
): MatrixGenerationAttempt[] {
  return (stmts().listAttempts.all(itemId, workspaceId) as MatrixGenerationAttemptRow[])
    .map(row => rowToAttempt(row, workspaceId));
}

export function startMatrixGenerationAttempt(input: {
  workspaceId: string;
  itemId: string;
  expectedItemRevision: number;
  stage: MatrixGenerationStage;
  effectiveInputFingerprint: string;
}): { item: MatrixGenerationItem; attempt: MatrixGenerationAttempt } {
  const write = () => {
    const item = getMatrixGenerationItem(input.workspaceId, input.itemId);
    if (!item || item.revision !== input.expectedItemRevision) {
      throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    }
    const now = new Date().toISOString();
    const attemptId = `mga_${randomUUID()}`;
    stmts().insertAttempt.run({
      id: attemptId,
      item_id: item.id,
      attempt_number: item.attemptCount + 1,
      stage: input.stage,
      effective_input_fingerprint: input.effectiveInputFingerprint,
      started_at: now,
    });
    const info = stmts().bumpItemAttempt.run({
      id: item.id,
      workspace_id: input.workspaceId,
      expected_revision: input.expectedItemRevision,
      updated_at: now,
    });
    if (info.changes !== 1) throw new MatrixGenerationRevisionConflictError('item', item.id);
    const updatedItem = getMatrixGenerationItem(input.workspaceId, item.id);
    const attemptRow = stmts().selectAttemptById.get(
      attemptId,
      item.id,
      input.workspaceId,
    ) as MatrixGenerationAttemptRow | undefined;
    if (!updatedItem || !attemptRow) throw new MatrixGenerationRevisionConflictError('attempt', attemptId);
    return { item: updatedItem, attempt: rowToAttempt(attemptRow, input.workspaceId) };
  };
  return db.inTransaction ? write() : db.transaction(write).immediate();
}

export function finishMatrixGenerationAttempt(input: {
  workspaceId: string;
  itemId: string;
  attemptId: string;
  nextStatus: Exclude<MatrixGenerationAttemptStatus, 'running'>;
  provenance?: MatrixGenerationAttempt['provenance'];
  error?: MatrixGenerationAttempt['error'];
}): MatrixGenerationAttempt {
  const write = () => {
    const row = stmts().selectAttemptById.get(
      input.attemptId,
      input.itemId,
      input.workspaceId,
    ) as MatrixGenerationAttemptRow | undefined;
    if (!row) throw new MatrixGenerationRevisionConflictError('attempt', input.attemptId);
    validateTransition(
      'matrix_generation_attempt',
      MATRIX_GENERATION_ATTEMPT_TRANSITIONS,
      row.status,
      input.nextStatus,
    );
    const info = stmts().updateAttempt.run({
      id: input.attemptId,
      item_id: input.itemId,
      expected_status: row.status,
      next_status: input.nextStatus,
      provenance: input.provenance ? JSON.stringify(input.provenance) : null,
      error: input.error ? JSON.stringify(input.error) : null,
      completed_at: new Date().toISOString(),
    });
    if (info.changes !== 1) {
      throw new MatrixGenerationRevisionConflictError('attempt', input.attemptId);
    }
    const updated = stmts().selectAttemptById.get(
      input.attemptId,
      input.itemId,
      input.workspaceId,
    ) as MatrixGenerationAttemptRow | undefined;
    if (!updated) throw new MatrixGenerationRevisionConflictError('attempt', input.attemptId);
    return rowToAttempt(updated, input.workspaceId);
  };
  return db.inTransaction ? write() : db.transaction(write).immediate();
}

/** Completes one stage and advances its item in the same transaction. */
export function finishMatrixGenerationAttemptAndTransitionItem(input: {
  workspaceId: string;
  itemId: string;
  expectedItemRevision: number;
  attemptId: string;
  attemptStatus: Exclude<MatrixGenerationAttemptStatus, 'running'>;
  nextItemStatus: MatrixGenerationItemStatus;
  provenance?: MatrixGenerationAttempt['provenance'];
  attemptError?: MatrixGenerationAttempt['error'];
  auditReport?: MatrixGenerationItem['auditReport'];
  automaticRevisionCount?: MatrixGenerationItem['automaticRevisionCount'];
  itemError?: MatrixGenerationItem['error'];
}): { item: MatrixGenerationItem; attempt: MatrixGenerationAttempt } {
  return db.transaction(() => {
    const attempt = finishMatrixGenerationAttempt({
      workspaceId: input.workspaceId,
      itemId: input.itemId,
      attemptId: input.attemptId,
      nextStatus: input.attemptStatus,
      provenance: input.provenance,
      error: input.attemptError,
    });
    const item = writeMatrixGenerationItem({
      workspaceId: input.workspaceId,
      itemId: input.itemId,
      expectedRevision: input.expectedItemRevision,
      nextStatus: input.nextItemStatus,
      auditReport: input.auditReport,
      automaticRevisionCount: input.automaticRevisionCount,
      error: input.itemError,
    });
    return { item, attempt };
  }).immediate();
}

export interface CommitMatrixGenerationDraftResult {
  item: MatrixGenerationItem;
  brief: PersistedContentBrief;
  post: PersistedGeneratedPost;
  cellRevision: number;
}

export function commitMatrixGenerationDraft(input: {
  workspaceId: string;
  itemId: string;
  expectedItemRevision: number;
  target: MatrixGenerationPreviewTarget;
  brief: ContentBrief;
  post: GeneratedPost;
}): CommitMatrixGenerationDraftResult {
  return db.transaction((): CommitMatrixGenerationDraftResult => {
    const item = getMatrixGenerationItem(input.workspaceId, input.itemId);
    if (!item || item.revision !== input.expectedItemRevision || item.status !== 'generating_post') {
      throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    }
    if (input.brief.id !== input.post.briefId) {
      throw new MatrixGenerationPersistenceContractError('Generated post must reference its candidate brief');
    }
    if (getBrief(input.workspaceId, input.brief.id) || getPost(input.workspaceId, input.post.id)) {
      throw new MatrixGenerationPersistenceContractError('Generated candidate IDs must be insert-only');
    }
    assertPreviewIdentityCurrent(input.workspaceId, input.target);

    const brief = persistGeneratedBrief(input.workspaceId, input.brief);
    const post = persistGeneratedPost(input.workspaceId, input.post);
    const updatedMatrix = updateMatrixCell(
      input.workspaceId,
      input.target.matrixId,
      input.target.cellId,
      { briefId: brief.id, postId: post.id, status: 'draft' },
      {
        expectedMatrixRevision: input.target.sourceRevision.matrixRevision,
        expectedTemplateRevision: input.target.sourceRevision.templateRevision,
        expectedCellRevision: input.target.sourceRevision.cellRevision,
        requireExpectedCellRevision: true,
      },
    );
    const cell = updatedMatrix?.cells.find(candidate => candidate.id === input.target.cellId);
    if (!cell) throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    const updatedItem = writeMatrixGenerationItem({
      workspaceId: input.workspaceId,
      itemId: input.itemId,
      expectedRevision: input.expectedItemRevision,
      nextStatus: 'auditing_deterministic',
      previewTarget: input.target,
      briefId: brief.id,
      postId: post.id,
      error: null,
    });
    return {
      item: updatedItem,
      brief,
      post,
      cellRevision: cell.revision ?? 0,
    };
  }).immediate();
}

export interface CommitMatrixGenerationRevisionResult {
  item: MatrixGenerationItem;
  post: PersistedGeneratedPost;
}

/** Atomically adopts one audited revision and reopens deterministic audit. */
export function commitMatrixGenerationRevision(input: {
  workspaceId: string;
  itemId: string;
  expectedItemRevision: number;
  expectedPostRevision: number;
  attemptId: string;
  replacement: PersistedGeneratedPost;
  provenance: NonNullable<MatrixGenerationAttempt['provenance']>;
}): CommitMatrixGenerationRevisionResult {
  return db.transaction((): CommitMatrixGenerationRevisionResult => {
    const item = getMatrixGenerationItem(input.workspaceId, input.itemId);
    if (
      !item
      || item.revision !== input.expectedItemRevision
      || item.status !== 'revising'
      || item.automaticRevisionCount !== 0
      || !item.previewTarget
      || !item.postId
      || item.postId !== input.replacement.id
    ) {
      throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    }
    const target = item.previewTarget;
    const matrix = getMatrix(input.workspaceId, target.matrixId);
    const template = matrix ? getTemplate(input.workspaceId, matrix.templateId) : null;
    const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
    if (
      !matrix
      || !template
      || !cell
      || (matrix.revision ?? 0) !== target.sourceRevision.matrixRevision
      || (template.revision ?? 0) !== target.sourceRevision.templateRevision
      || (cell.revision ?? 0) !== target.sourceRevision.cellRevision + 1
      || cell.briefId !== item.briefId
      || cell.postId !== item.postId
    ) {
      throw new MatrixGenerationRevisionConflictError('item', input.itemId);
    }
    const post = replacePostWithSnapshot(
      input.workspaceId,
      input.replacement,
      input.expectedPostRevision,
      'bulk_regenerate',
      `matrix_generation_item:${item.id}`,
      input.provenance,
    );
    finishMatrixGenerationAttempt({
      workspaceId: input.workspaceId,
      itemId: item.id,
      attemptId: input.attemptId,
      nextStatus: 'completed',
      provenance: input.provenance,
    });
    const updatedItem = writeMatrixGenerationItem({
      workspaceId: input.workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'auditing_deterministic',
      auditReport: null,
      automaticRevisionCount: 1,
      error: null,
    });
    return { item: updatedItem, post };
  }).immediate();
}

/**
 * Persists a future paid-ready run. M0 intentionally exposes no route or job;
 * callers must already hold a non-empty previewed selection.
 */
export function createMatrixGenerationRun(
  request: CreateMatrixGenerationRunRequest,
): CreateMatrixGenerationRunResult {
  const validated = assertCreateRequest(request);
  const create = (): CreateMatrixGenerationRunResult => {
    const replay = stmts().selectByIdempotency.get(
      request.workspaceId,
      request.matrixId,
      request.idempotencyKey,
    ) as MatrixGenerationRunRow | undefined;
    if (replay) {
      const persisted = rowToRun(replay);
      if (replay.selection_fingerprint !== request.selectionFingerprint
        || replay.template_id !== request.templateId
        || canonicalGenerationFingerprint(persisted.selections)
          !== canonicalGenerationFingerprint(validated.selections)) {
        throw new MatrixGenerationRunIdempotencyConflictError(
          request.workspaceId,
          request.matrixId,
          request.idempotencyKey,
        );
      }
      return { run: persisted, existing: true };
    }

    const runId = `mgr_${randomUUID()}`;
    const now = new Date().toISOString();
    stmts().insertRun.run({
      id: runId,
      workspace_id: request.workspaceId,
      matrix_id: request.matrixId,
      template_id: request.templateId,
      idempotency_key: request.idempotencyKey,
      selection_fingerprint: request.selectionFingerprint,
      job_id: request.jobId ?? null,
      accepted_budget: validated.acceptedBudget
        ? JSON.stringify(validated.acceptedBudget)
        : null,
      selected_count: validated.selections.length,
      queued_count: validated.selections.length,
      created_by: JSON.stringify(validated.createdBy),
      mcp_execution_context: validated.mcpExecutionContext
        ? JSON.stringify(validated.mcpExecutionContext)
        : null,
      created_at: now,
      updated_at: now,
    });

    validated.selections.forEach((selection, index) => {
      stmts().insertItem.run({
        id: `mgi_${runId.slice(4)}_${String(index).padStart(5, '0')}`,
        run_id: runId,
        workspace_id: request.workspaceId,
        matrix_id: request.matrixId,
        cell_id: selection.cellId,
        matrix_revision: selection.sourceRevision.matrixRevision,
        template_revision: selection.sourceRevision.templateRevision,
        cell_revision: selection.sourceRevision.cellRevision,
        structural_fingerprint: selection.structuralFingerprint,
        preview_fingerprint: selection.previewFingerprint,
        created_at: now,
        updated_at: now,
      });
    });

    const row = stmts().selectById.get(runId, request.workspaceId) as MatrixGenerationRunRow;
    return { run: rowToRun(row), existing: false };
  };
  return db.inTransaction ? create() : db.transaction(create).immediate();
}
