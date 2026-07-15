/**
 * Brand-intake → brand → content orchestration adapters.
 *
 * @reads brand_intake_revisions, brand_content_onboarding_runs,
 *   brand_generation_runs, client_deliverable, voice_profile_finalizations,
 *   brand_identity_deliverables, content_matrix_generation_runs, content_posts
 * @writes brand_content_onboarding_runs, activity_log
 */
import { Router, type Request, type Response } from 'express';

import { BRAND_CONTENT_ONBOARDING_STATUSES } from '../../shared/types/brand-content-onboarding.js';
import { BRAND_GENERATION_LIMITS } from '../../shared/types/brand-generation.js';
import {
  MATRIX_GENERATION_BATCH_LIMITS,
  MATRIX_READ_LIMITS,
} from '../../shared/types/matrix-generation.js';
import { requireWorkspaceAccess } from '../auth.js';
import {
  authorizeBrandContentGeneration,
  BrandContentOnboardingServiceError,
  getBrandContentOnboarding,
  resumeBrandContentOnboarding,
  startBrandContentOnboarding,
} from '../domains/brand-content-onboarding/service.js';
import {
  BrandContentOnboardingIdempotencyConflictError,
  BrandContentOnboardingNotFoundError,
  BrandContentOnboardingResumeIdempotencyConflictError,
  BrandContentOnboardingRevisionConflictError,
} from '../domains/brand-content-onboarding/repository.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';

const log = createLogger('brand-content-onboarding-routes');
const idSchema = z.string().trim().min(1).max(128);
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencySchema = z.string().trim().min(1).max(128);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const sourceRevisionSchema = z.object({
  matrixRevision: revisionSchema,
  templateRevision: revisionSchema,
  cellRevision: revisionSchema,
}).strict();

const matrixSelectionSchema = z.array(z.object({
  matrixId: idSchema,
  cellId: idSchema,
  sourceRevision: sourceRevisionSchema,
  structuralFingerprint: fingerprintSchema,
  previewFingerprint: fingerprintSchema.nullable(),
}).strict()).min(1).max(MATRIX_READ_LIMITS.maxResolveSelection);

const brandBudgetSchema = z.object({
  maxProviderCalls: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxProviderCalls),
  maxInputTokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxInputTokens),
  maxOutputTokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxOutputTokens),
  maxEstimatedCostMicros: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxEstimatedUsdMicros),
  maxConcurrency: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxConcurrency),
}).strict();

const matrixBudgetSchema = z.object({
  maxProviderCalls: z.number().int().min(1).max(MATRIX_GENERATION_BATCH_LIMITS.maxProviderCalls),
  maxInputTokens: z.number().int().min(1).max(MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens),
  maxOutputTokens: z.number().int().min(1).max(MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens),
  maxEstimatedUsd: z.number().positive().max(MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd),
  maxConcurrency: z.number().int().min(1).max(MATRIX_GENERATION_BATCH_LIMITS.maxConcurrency),
}).strict();

const startSchema = z.object({
  intakeRevisionId: idSchema,
  expectedIntakeRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedIntakeFingerprint: fingerprintSchema,
  matrixSelection: matrixSelectionSchema,
  brandBudget: brandBudgetSchema,
  idempotencyKey: idempotencySchema,
}).strict();

const resumeSchema = z.object({
  expectedRevision: revisionSchema,
  expectedStatus: z.enum(BRAND_CONTENT_ONBOARDING_STATUSES),
  gateEvidenceId: idSchema,
  idempotencyKey: idempotencySchema,
}).strict();

const authorizationSchema = z.object({
  expectedRevision: revisionSchema,
  expectedStatus: z.literal('awaiting_content_authorization'),
  authorizationId: idSchema,
  expectedMatrixSelectionFingerprint: fingerprintSchema,
  acceptedBudget: matrixBudgetSchema,
  idempotencyKey: idempotencySchema,
}).strict();

function operatorFromRequest(req: Request) {
  return req.user ? {
    actorType: 'operator' as const,
    actorId: req.user.id,
    actorLabel: req.user.name,
  } : {
    actorType: 'operator' as const,
    actorId: 'admin-hmac',
    actorLabel: 'Admin operator',
  };
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof BrandContentOnboardingServiceError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  if (error instanceof BrandContentOnboardingNotFoundError) {
    res.status(404).json({ error: error.message, code: error.code });
    return true;
  }
  if (error instanceof BrandContentOnboardingRevisionConflictError) {
    res.status(409).json({
      error: error.message,
      code: error.code,
      expectedRevision: error.expectedRevision,
      actualRevision: error.actualRevision,
    });
    return true;
  }
  if (error instanceof BrandContentOnboardingIdempotencyConflictError
    || error instanceof BrandContentOnboardingResumeIdempotencyConflictError) {
    res.status(409).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export function createBrandContentOnboardingRoutes(): Router {
  const router = Router();

  router.post(
    '/api/brand-content-onboarding/:workspaceId/runs',
    requireWorkspaceAccess('workspaceId'),
    validate(startSchema),
    (req, res) => {
      const workspaceId = req.params.workspaceId;
      try {
        const body = startSchema.parse(req.body);
        const matrixSelection = [
          body.matrixSelection[0]!,
          ...body.matrixSelection.slice(1),
        ] as const;
        const result = startBrandContentOnboarding({
          workspaceId,
          ...body,
          matrixSelection,
          startedBy: operatorFromRequest(req),
          mcpExecutionContext: null,
        });
        res.status(result.replayed ? 200 : 202).json(result);
      } catch (error) {
        if (sendError(res, error)) return;
        log.error({ error, workspaceId }, 'failed to start brand-content onboarding');
        res.status(500).json({ error: 'Failed to start brand-content onboarding' });
      }
    },
  );

  router.get(
    '/api/brand-content-onboarding/:workspaceId/runs/:runId',
    requireWorkspaceAccess('workspaceId'),
    (req, res) => {
      const { workspaceId, runId } = req.params;
      if (!idSchema.safeParse(runId).success) {
        return res.status(400).json({ error: 'Invalid onboarding run ID' });
      }
      try {
        res.json(getBrandContentOnboarding({ workspaceId, runId }));
      } catch (error) {
        if (sendError(res, error)) return;
        log.error({ error, workspaceId, runId }, 'failed to read brand-content onboarding');
        res.status(500).json({ error: 'Failed to read brand-content onboarding' });
      }
    },
  );

  router.post(
    '/api/brand-content-onboarding/:workspaceId/runs/:runId/resume',
    requireWorkspaceAccess('workspaceId'),
    validate(resumeSchema),
    (req, res) => {
      const { workspaceId, runId } = req.params;
      if (!idSchema.safeParse(runId).success) {
        return res.status(400).json({ error: 'Invalid onboarding run ID' });
      }
      try {
        const body = resumeSchema.parse(req.body);
        const result = resumeBrandContentOnboarding({
          workspaceId,
          runId,
          ...body,
          resumedBy: operatorFromRequest(req),
          mcpExecutionContext: null,
        });
        res.status(result.paidJobId ? 202 : 200).json(result);
      } catch (error) {
        if (sendError(res, error)) return;
        log.error({ error, workspaceId, runId }, 'failed to resume brand-content onboarding');
        res.status(500).json({ error: 'Failed to resume brand-content onboarding' });
      }
    },
  );

  router.post(
    '/api/brand-content-onboarding/:workspaceId/runs/:runId/content-authorization',
    requireWorkspaceAccess('workspaceId'),
    validate(authorizationSchema),
    async (req, res) => {
      const { workspaceId, runId } = req.params;
      if (!idSchema.safeParse(runId).success) {
        return res.status(400).json({ error: 'Invalid onboarding run ID' });
      }
      try {
        const body = authorizationSchema.parse(req.body);
        const result = await authorizeBrandContentGeneration({
          workspaceId,
          runId,
          ...body,
          authorizedBy: operatorFromRequest(req),
        });
        res.status(result.replayed ? 200 : 202).json(result);
      } catch (error) {
        if (sendError(res, error)) return;
        log.error({ error, workspaceId, runId }, 'failed to authorize onboarding content');
        res.status(500).json({ error: 'Failed to authorize onboarding content' });
      }
    },
  );

  return router;
}

export default createBrandContentOnboardingRoutes();
