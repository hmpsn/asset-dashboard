import { randomUUID } from 'node:crypto';
import type {
  CreateMatrixGenerationRunRequest,
  MatrixGenerationItem,
  MatrixGenerationReadySelectionItem,
  MatrixGenerationRun,
  MatrixGenerationSelection,
  PersistedMatrixGenerationRun,
  PublicMatrixGenerationCreatorAttribution,
} from '../../../../shared/types/matrix-generation.js';
import { normalizeMatrixGenerationSchemaTypes } from '../../../../shared/types/matrix-generation.js';
import type {
  GenerationResolverAttribution,
  GenerationRunCounts,
} from '../../../../shared/types/generation-evidence.js';
import {
  AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES,
  GENERATION_EVIDENCE_SOURCE_TYPES,
  STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES,
} from '../../../../shared/types/generation-evidence.js';
import {
  AUTHENTIC_VOICE_SAMPLE_SOURCES,
  BRAND_DELIVERABLE_TYPES,
} from '../../../../shared/types/brand-engine.js';
import db from '../../../db/index.js';
import { parseJsonSafe } from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { z } from '../../../middleware/validate.js';
import {
  canonicalGenerationFingerprint,
  computeBlockManifestFingerprint,
  computeStructuralTargetFingerprint,
} from './fingerprint.js';

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
  attempt_count: number;
  automatic_revision_count: 0 | 1;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const resolverAttributionSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp', 'system']),
  actorId: z.string().min(1),
  actorLabel: z.string().optional(),
}).strict();

const operatorAttributionSchema = resolverAttributionSchema.extend({
  actorType: z.literal('operator'),
});

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
    totalWordCountTarget: z.number().nonnegative(),
    fingerprint: z.string().min(1),
  }),
  generationContractVersion: z.number().int().positive(),
  structuralRequirements: z.array(evidenceRequirementSchema),
  structuralBlockingRequirementIds: z.array(z.string()),
  structuralFingerprint: z.string().min(1),
});

const previewTargetSchema = resolvedStructuralTargetSchema.extend({
  voiceSnapshot: z.object({
    voiceProfileId: z.string().min(1),
    voiceVersion: z.number().int().nonnegative(),
    finalizedBy: operatorAttributionSchema,
    finalizedAt: z.string().min(1),
    fingerprint: z.string().min(1),
    anchorEvidenceRefs: z.array(z.union([
      z.object({
        sourceType: z.enum(AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES)
          .refine(sourceType => sourceType !== 'voice_sample'),
        sourceId: z.string().min(1),
        sourceRevision: z.number().int().nonnegative().optional(),
        fieldPath: z.string().optional(),
        label: z.string().optional(),
        uri: z.string().optional(),
        capturedAt: z.string().min(1),
        selectedBy: operatorAttributionSchema,
        selectedAt: z.string().min(1),
      }).strict(),
      z.object({
        sourceType: z.literal('voice_sample'),
        sourceId: z.string().min(1),
        sourceRevision: z.number().int().nonnegative().optional(),
        fieldPath: z.string().optional(),
        label: z.string().optional(),
        uri: z.string().optional(),
        capturedAt: z.string().min(1),
        voiceSampleSource: z.enum(AUTHENTIC_VOICE_SAMPLE_SOURCES),
        selectedBy: operatorAttributionSchema,
        selectedAt: z.string().min(1),
      }).strict(),
    ])).min(1),
  }),
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
  insertRun: db.prepare(`
    INSERT INTO content_matrix_generation_runs (
      id, workspace_id, matrix_id, template_id, status, revision,
      idempotency_key, selection_fingerprint, job_id,
      selected_count, queued_count, running_count,
      ready_for_human_review_count, needs_attention_count, blocked_count,
      conflict_count, failed_count, cancelled_count, created_by,
      mcp_execution_context, created_at, updated_at, completed_at
    ) VALUES (
      @id, @workspace_id, @matrix_id, @template_id, 'queued', 0,
      @idempotency_key, @selection_fingerprint, NULL,
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
      structural_target, preview_target, brief_id, post_id, audit_report,
      attempt_count, automatic_revision_count, error,
      created_at, updated_at, completed_at
    ) VALUES (
      @id, @run_id, @workspace_id, @matrix_id, @cell_id,
      @matrix_revision, @template_revision, @cell_revision,
      @structural_fingerprint, @preview_fingerprint, 'queued', 0,
      NULL, NULL, NULL, NULL, NULL,
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

/**
 * Persists a future paid-ready run. M0 intentionally exposes no route or job;
 * callers must already hold a non-empty previewed selection.
 */
export function createMatrixGenerationRun(
  request: CreateMatrixGenerationRunRequest,
): CreateMatrixGenerationRunResult {
  const validated = assertCreateRequest(request);
  const create = db.transaction((): CreateMatrixGenerationRunResult => {
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
  });
  return create.immediate();
}
