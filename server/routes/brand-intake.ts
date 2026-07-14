/**
 * Brand intake admin adapters.
 *
 * @reads workspaces, brand_intake_revisions
 * @writes workspaces, brand_intake_revisions, activities, intelligence_cache
 */
import { Router, type Request, type Response } from 'express';

import type { BrandIntakeResolverAttribution } from '../../shared/types/brand-intake.js';
import {
  resolveBrandIntakeEvidenceBodySchema,
  type ResolveBrandIntakeEvidenceBody,
} from '../../shared/types/brand-intake-schemas.js';
import { requireWorkspaceAccess } from '../auth.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import {
  BrandIntakeConflictError,
  BrandIntakeIdempotencyConflictError,
  BrandIntakeNotFoundError,
  getBrandIntakeRevision,
  resolveBrandIntakeEvidence,
  type BrandIntakePostCommitEffect,
} from '../domains/brand/intake/index.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';
import { getWorkspace } from '../workspaces.js';
import { WS_EVENTS } from '../ws-events.js';

const brandIntakeRoutes = Router();
const log = createLogger('brand-intake-routes');

function runPostCommitEffect(
  workspaceId: string,
  effectName: 'activity' | 'workspace-broadcast' | 'intelligence-cache',
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn({ err, workspaceId, effectName }, 'brand intake post-commit effect failed');
  }
}

function applyPostCommitEffect(
  workspaceId: string,
  effect: BrandIntakePostCommitEffect,
  actor?: { id?: string; name?: string },
): void {
  runPostCommitEffect(workspaceId, 'activity', () => {
    addActivity(
      workspaceId,
      effect.activity.type,
      effect.activity.title,
      effect.activity.description,
      { ...effect.workspaceUpdated },
      actor,
    );
  });
  runPostCommitEffect(workspaceId, 'workspace-broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.WORKSPACE_UPDATED, effect.workspaceUpdated);
  });
  runPostCommitEffect(workspaceId, 'intelligence-cache', () => {
    invalidateIntelligenceCache(workspaceId);
  });
}

function resolverFromRequest(req: Request): BrandIntakeResolverAttribution {
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

function sendZodError(res: Response, err: z.ZodError): void {
  const errors = err.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  const first = errors[0];
  const error = first?.path ? `${first.path}: ${first.message}` : first?.message ?? 'Invalid request';
  res.status(400).json({ error, errors });
}

brandIntakeRoutes.get(
  '/api/brand-intake/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    try {
      if (!getWorkspace(req.params.workspaceId)) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      res.json(getBrandIntakeRevision({ workspaceId: req.params.workspaceId }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        sendZodError(res, err);
        return;
      }
      log.error({ err, workspaceId: req.params.workspaceId }, 'failed to read brand intake');
      res.status(500).json({ error: 'Failed to read brand intake' });
    }
  },
);

brandIntakeRoutes.post(
  '/api/brand-intake/:workspaceId/:revisionId/evidence-resolutions',
  requireWorkspaceAccess('workspaceId'),
  validate(resolveBrandIntakeEvidenceBodySchema),
  (req, res) => {
    const workspaceId = req.params.workspaceId;
    try {
      if (!getWorkspace(workspaceId)) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      const body = req.body as ResolveBrandIntakeEvidenceBody;
      const resolvedBy = resolverFromRequest(req);
      const result = resolveBrandIntakeEvidence({
        workspaceId,
        intakeRevisionId: req.params.revisionId,
        expectedRevision: body.expectedRevision,
        requirementId: body.requirementId,
        fieldPath: body.fieldPath,
        value: body.value,
        sourceRef: body.sourceRef,
        resolvedBy,
        idempotencyKey: body.idempotencyKey,
      });

      if (result.created && result.postCommitEffect) {
        applyPostCommitEffect(workspaceId, result.postCommitEffect, {
          id: resolvedBy.actorId,
          name: resolvedBy.actorLabel,
        });
      }
      const { postCommitEffect: _postCommitEffect, ...response } = result;
      res.status(result.created ? 201 : 200).json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        sendZodError(res, err);
        return;
      }
      if (err instanceof BrandIntakeNotFoundError) {
        res.status(404).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof BrandIntakeConflictError) {
        res.status(409).json({
          error: err.message,
          code: err.code,
          expectedRevision: err.expectedRevision,
          actualRevision: err.actualRevision,
        });
        return;
      }
      if (err instanceof BrandIntakeIdempotencyConflictError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      log.error({ err, workspaceId, revisionId: req.params.revisionId }, 'failed to resolve brand intake evidence');
      res.status(500).json({ error: 'Failed to resolve brand intake evidence' });
    }
  },
);

export default brandIntakeRoutes;
