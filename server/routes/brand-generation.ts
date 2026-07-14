/**
 * Grounded brand-generation HTTP adapters.
 *
 * @reads workspaces, brand_intake_revisions, voice_profile_finalizations,
 *   brand_identity, brand_generation_runs, brand_generation_items,
 *   brand_generation_commands, brand_generation_attempts, jobs
 * @writes brand_generation_runs, brand_generation_items,
 *   brand_generation_commands, brand_generation_attempts, brand_identity,
 *   brand_identity_versions, jobs, activity_log, intelligence_cache
 */
import { Router, type Request, type Response } from 'express';

import {
  BRAND_DELIVERABLE_TARGET_POLICY,
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_LIMITS,
  BRAND_GENERATION_PRESETS,
  type BrandGenerationAtomicTarget,
  type BrandGenerationPreset,
  type GetBrandGenerationRequest,
  type GetBrandGenerationResult,
  type ResumeBrandGenerationRequest,
  type ResumeBrandGenerationResult,
  type ReviseBrandGenerationItemRequest,
  type ReviseBrandGenerationItemResult,
  type StartBrandGenerationRequest,
  type StartBrandGenerationResult,
} from '../../shared/types/brand-generation.js';
import type { GenerationOperatorAttribution } from '../../shared/types/generation-evidence.js';
import { requireWorkspaceAccess } from '../auth.js';
import {
  BrandGenerationApprovedDeliverableError,
  BrandGenerationBudgetExceededError,
  BrandGenerationConcurrencyLimitError,
  BrandGenerationCursorError,
  BrandGenerationIdempotencyConflictError,
  BrandGenerationNotFoundError,
  BrandGenerationPreconditionError,
  BrandGenerationRevisionConflictError,
} from '../domains/brand/generation/errors.js';
import {
  getBrandGeneration,
  resumeBrandGeneration,
  reviseBrandGenerationItem,
  startBrandGeneration,
} from '../domains/brand/generation/service.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';

const log = createLogger('brand-generation-routes');
const utf8Encoder = new TextEncoder();

const durableIdSchema = z.string().trim().min(1).max(BRAND_GENERATION_LIMITS.maxIdLength);
const idempotencyKeySchema = z.string().trim().min(1)
  .max(BRAND_GENERATION_LIMITS.maxIdempotencyKeyLength);
const fingerprintSchema = z.string().regex(
  /^[a-f0-9]{64}$/,
  'must be a lowercase SHA-256 fingerprint',
);

const selectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('atomic'),
    target: z.enum(BRAND_GENERATION_ATOMIC_TARGETS),
  }).strict(),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(BRAND_GENERATION_PRESETS),
  }).strict(),
]);

const budgetSchema = z.object({
  maxProviderCalls: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxProviderCalls),
  maxInputTokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxInputTokens),
  maxOutputTokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxOutputTokens),
  maxEstimatedCostMicros: z.number().int().min(1)
    .max(BRAND_GENERATION_LIMITS.maxEstimatedUsdMicros),
  maxConcurrency: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxConcurrency),
}).strict();

const startBrandGenerationBodySchema = z.object({
  intakeRevisionId: durableIdSchema,
  expectedIntakeRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedIntakeFingerprint: fingerprintSchema,
  selection: selectionSchema,
  expectedVoiceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  expectedVoiceFingerprint: fingerprintSchema.optional(),
  budget: budgetSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine((value, ctx) => {
  const bootstrap = value.selection.kind === 'atomic'
    ? BRAND_DELIVERABLE_TARGET_POLICY[value.selection.target].voicePolicy === 'bootstrap'
    : value.selection.preset === 'full_brand_system';
  const hasVoiceVersion = value.expectedVoiceVersion !== undefined;
  const hasVoiceFingerprint = value.expectedVoiceFingerprint !== undefined;
  if (bootstrap && (hasVoiceVersion || hasVoiceFingerprint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expectedVoiceVersion'],
      message: 'bootstrap starts must not claim finalized voice authority',
    });
  }
  if (!bootstrap && (!hasVoiceVersion || !hasVoiceFingerprint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expectedVoiceVersion'],
      message: 'durable brand generation requires exact finalized voice authority',
    });
  }
});

const resumeBrandGenerationBodySchema = z.object({
  expectedRunRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedVoiceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedVoiceFingerprint: fingerprintSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

const reviseBrandGenerationBodySchema = z.object({
  expectedRunRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedItemRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  deliverableId: durableIdSchema,
  expectedDeliverableVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  direction: z.string().trim().min(1).refine(
    value => utf8Encoder.encode(value).byteLength <= BRAND_GENERATION_LIMITS.maxDirectionBytes,
    `direction must not exceed ${BRAND_GENERATION_LIMITS.maxDirectionBytes} UTF-8 bytes`,
  ),
  idempotencyKey: idempotencyKeySchema,
}).strict();

const getBrandGenerationQuerySchema = z.object({
  itemCursor: z.string().trim().min(1).max(BRAND_GENERATION_LIMITS.maxCursorLength)
    .regex(/^[A-Za-z0-9_-]+$/).optional(),
  itemLimit: z.coerce.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxItemPageSize)
    .optional(),
}).strict();

type MaybePromise<T> = T | Promise<T>;

export interface BrandGenerationRouteDependencies {
  startBrandGeneration: (
    request: StartBrandGenerationRequest,
  ) => MaybePromise<StartBrandGenerationResult>;
  getBrandGeneration: (
    request: GetBrandGenerationRequest,
  ) => MaybePromise<GetBrandGenerationResult>;
  resumeBrandGeneration: (
    request: ResumeBrandGenerationRequest,
  ) => MaybePromise<ResumeBrandGenerationResult>;
  reviseBrandGenerationItem: (
    request: ReviseBrandGenerationItemRequest,
  ) => MaybePromise<ReviseBrandGenerationItemResult>;
}

const defaultDependencies: BrandGenerationRouteDependencies = {
  startBrandGeneration,
  getBrandGeneration,
  resumeBrandGeneration,
  reviseBrandGenerationItem,
};

const PRIVATE_PUBLIC_BOUNDARY_KEYS = new Set([
  'executionActor',
  'execution_actor',
  'idempotencyKey',
  'idempotency_key',
  'mcpExecutionContext',
  'mcp_execution_context',
  'requestSnapshot',
  'request_snapshot',
]);

/** Defense in depth if a service accidentally returns a persisted/internal DTO. */
function projectPublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectPublicValue);
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const actorType = record.actorType ?? record.actor_type;
  if (actorType === 'mcp' || actorType === 'system') {
    return { actorType };
  }

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !PRIVATE_PUBLIC_BOUNDARY_KEYS.has(key))
      .map(([key, child]) => [key, projectPublicValue(child)]),
  );
}

function operatorFromRequest(req: Request): GenerationOperatorAttribution {
  if (req.user) {
    return {
      actorType: 'operator',
      actorId: req.user.id,
      actorLabel: req.user.name,
    };
  }
  return {
    actorType: 'operator',
    actorId: 'admin-hmac',
    actorLabel: 'Admin operator',
  };
}

function sendBrandGenerationError(res: Response, error: unknown): boolean {
  if (error instanceof BrandGenerationCursorError) {
    res.status(400).json({
      error: 'The brand-generation item cursor is invalid or stale',
      code: 'brand_generation_invalid_cursor',
    });
    return true;
  }
  if (error instanceof BrandGenerationNotFoundError) {
    res.status(404).json({
      error: 'The requested brand-generation resource was not found',
      code: 'brand_generation_not_found',
    });
    return true;
  }
  if (error instanceof BrandGenerationRevisionConflictError) {
    res.status(409).json({
      error: 'The brand-generation resource changed; re-read it before retrying',
      code: 'brand_generation_revision_conflict',
      resource: error.resource,
      expectedRevision: error.expectedRevision,
      actualRevision: error.actualRevision,
    });
    return true;
  }
  if (error instanceof BrandGenerationIdempotencyConflictError) {
    res.status(409).json({
      error: 'The idempotency key already represents a different brand-generation command',
      code: 'brand_generation_idempotency_conflict',
    });
    return true;
  }
  if (error instanceof BrandGenerationConcurrencyLimitError) {
    res.status(409).json({
      error: 'The brand-generation concurrency limit is currently full',
      code: 'brand_generation_concurrency_limit',
    });
    return true;
  }
  if (error instanceof BrandGenerationBudgetExceededError) {
    res.status(422).json({
      error: 'The requested brand-generation budget is outside the allowed bounds',
      code: 'brand_generation_budget_exceeded',
      dimension: error.dimension,
      requested: error.requested,
      limit: error.limit,
    });
    return true;
  }
  if (error instanceof BrandGenerationApprovedDeliverableError) {
    res.status(422).json({
      error: 'An approved brand deliverable must be returned to draft before generation',
      code: 'brand_generation_precondition_failed',
    });
    return true;
  }
  if (error instanceof BrandGenerationPreconditionError) {
    res.status(422).json({
      error: 'The brand-generation prerequisites are not satisfied',
      code: 'brand_generation_precondition_failed',
      reason: error.reason,
    });
    return true;
  }
  return false;
}

function validPathIds(...values: string[]): boolean {
  return values.every(value => durableIdSchema.safeParse(value).success);
}

function toStartRequest(
  workspaceId: string,
  body: z.infer<typeof startBrandGenerationBodySchema>,
  createdBy: GenerationOperatorAttribution,
): StartBrandGenerationRequest {
  const common = {
    workspaceId,
    intakeRevisionId: body.intakeRevisionId,
    expectedIntakeRevision: body.expectedIntakeRevision,
    expectedIntakeFingerprint: body.expectedIntakeFingerprint,
    budget: body.budget,
    idempotencyKey: body.idempotencyKey,
    createdBy,
    mcpExecutionContext: null,
  };

  if (body.selection.kind === 'atomic' && body.selection.target === 'voice_foundation') {
    return { ...common, selection: { kind: 'atomic', target: 'voice_foundation' } };
  }
  if (body.selection.kind === 'preset' && body.selection.preset === 'full_brand_system') {
    return { ...common, selection: { kind: 'preset', preset: 'full_brand_system' } };
  }
  if (body.selection.kind === 'atomic') {
    return {
      ...common,
      selection: {
        kind: 'atomic',
        target: body.selection.target as Exclude<BrandGenerationAtomicTarget, 'voice_foundation'>,
      },
      expectedVoiceVersion: body.expectedVoiceVersion as number,
      expectedVoiceFingerprint: body.expectedVoiceFingerprint as string,
    };
  }

  return {
    ...common,
    selection: {
      kind: 'preset',
      preset: body.selection.preset as Exclude<BrandGenerationPreset, 'full_brand_system'>,
    },
    expectedVoiceVersion: body.expectedVoiceVersion as number,
    expectedVoiceFingerprint: body.expectedVoiceFingerprint as string,
  };
}

export function createBrandGenerationRouter(
  dependencies: BrandGenerationRouteDependencies = defaultDependencies,
) {
  const router = Router();

  router.post(
    '/api/brand-generation/:workspaceId/runs',
    requireWorkspaceAccess('workspaceId'),
    validate(startBrandGenerationBodySchema),
    async (req, res) => {
      const workspaceId = req.params.workspaceId;
      try {
        const result = await dependencies.startBrandGeneration(toStartRequest(
          workspaceId,
          req.body,
          operatorFromRequest(req),
        ));
        res.status(result.existing ? 200 : 202).json(projectPublicValue(result));
      } catch (error) {
        if (sendBrandGenerationError(res, error)) return;
        log.error({ workspaceId, failureClass: 'start_failed' }, 'brand generation start failed');
        res.status(500).json({ error: 'Failed to start brand generation' });
      }
    },
  );

  router.get(
    '/api/brand-generation/:workspaceId/runs/:runId',
    requireWorkspaceAccess('workspaceId'),
    async (req, res) => {
      const { workspaceId, runId } = req.params;
      try {
        if (!validPathIds(runId)) {
          return res.status(400).json({ error: 'Invalid brand-generation run ID' });
        }
        const query = getBrandGenerationQuerySchema.safeParse(req.query);
        if (!query.success) {
          return res.status(400).json({ error: 'Invalid brand-generation query' });
        }
        const result = await dependencies.getBrandGeneration({
          workspaceId,
          runId,
          cursor: query.data.itemCursor,
          limit: query.data.itemLimit,
        });
        res.json(projectPublicValue(result));
      } catch (error) {
        if (sendBrandGenerationError(res, error)) return;
        log.error({ workspaceId, runId, failureClass: 'read_failed' }, 'brand generation read failed');
        res.status(500).json({ error: 'Failed to read brand generation' });
      }
    },
  );

  router.post(
    '/api/brand-generation/:workspaceId/runs/:runId/resume',
    requireWorkspaceAccess('workspaceId'),
    validate(resumeBrandGenerationBodySchema),
    async (req, res) => {
      const { workspaceId, runId } = req.params;
      try {
        if (!validPathIds(runId)) {
          return res.status(400).json({ error: 'Invalid brand-generation run ID' });
        }
        const result = await dependencies.resumeBrandGeneration({
          workspaceId,
          runId,
          expectedRunRevision: req.body.expectedRunRevision,
          expectedVoiceVersion: req.body.expectedVoiceVersion,
          expectedVoiceFingerprint: req.body.expectedVoiceFingerprint,
          idempotencyKey: req.body.idempotencyKey,
          resumedBy: operatorFromRequest(req),
          mcpExecutionContext: null,
        });
        res.status(result.existing ? 200 : 202).json(projectPublicValue(result));
      } catch (error) {
        if (sendBrandGenerationError(res, error)) return;
        log.error({ workspaceId, runId, failureClass: 'resume_failed' }, 'brand generation resume failed');
        res.status(500).json({ error: 'Failed to resume brand generation' });
      }
    },
  );

  router.post(
    '/api/brand-generation/:workspaceId/runs/:runId/items/:itemId/revisions',
    requireWorkspaceAccess('workspaceId'),
    validate(reviseBrandGenerationBodySchema),
    async (req, res) => {
      const { workspaceId, runId, itemId } = req.params;
      try {
        if (!validPathIds(runId, itemId)) {
          return res.status(400).json({ error: 'Invalid brand-generation run or item ID' });
        }
        const result = await dependencies.reviseBrandGenerationItem({
          workspaceId,
          runId,
          itemId,
          expectedRunRevision: req.body.expectedRunRevision,
          expectedItemRevision: req.body.expectedItemRevision,
          deliverableId: req.body.deliverableId,
          expectedDeliverableVersion: req.body.expectedDeliverableVersion,
          direction: req.body.direction,
          idempotencyKey: req.body.idempotencyKey,
          requestedBy: operatorFromRequest(req),
          mcpExecutionContext: null,
        });
        res.status(result.existing ? 200 : 202).json(projectPublicValue(result));
      } catch (error) {
        if (sendBrandGenerationError(res, error)) return;
        log.error(
          { workspaceId, runId, itemId, failureClass: 'revision_failed' },
          'brand generation revision failed',
        );
        res.status(500).json({ error: 'Failed to start brand deliverable revision' });
      }
    },
  );

  return router;
}

export default createBrandGenerationRouter();
