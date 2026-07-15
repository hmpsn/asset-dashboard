import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { getWorkspace } from '../workspaces.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { InvalidTransitionError } from '../state-machines.js';
import { createLogger } from '../logger.js';
import {
  mutationError,
  runWorkspaceMutation,
  WorkspaceMutationError,
} from '../workspace-mutation-helper.js';
import {
  listBlueprints,
  getBlueprint,
  createBlueprint,
  updateBlueprint,
  deleteBlueprint,
  getEntry,
  addEntry,
  updateEntry,
  removeEntry,
  reorderEntries,
  createVersion,
  listVersions,
  getVersion,
} from '../page-strategy.js';
import { getDefaultSectionPlan } from '../blueprint-generator.js';
import { createJob } from '../jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { runBlueprintGenerationJob } from '../blueprint-generation-job.js';
import type { BlueprintGenerationInput } from '../../shared/types/page-strategy.js';
import {
  MATRIX_GENERATION_SOURCE_LIMITS,
  matrixGenerationUtf8Bytes,
} from '../../shared/types/matrix-generation.js';
import {
  createMatrixFromPseoPlan,
  PseoMatrixBridgeError,
} from '../domains/content/matrix-generation/pseo-bridge.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';

const router = Router();
const log = createLogger('page-strategy-routes');

function runPseoRoutePostCommitEffect(
  workspaceId: string,
  entryId: string,
  effect: string,
  callback: () => void,
): void {
  try {
    callback();
  } catch (err) {
    log.warn({ err, workspaceId, entryId, effect }, 'pSEO matrix post-commit effect failed');
  }
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const createBlueprintSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  brandscriptId: z.string().optional(),
  industryType: z.string().optional(),
  notes: z.string().optional(),
});

const updateBlueprintSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  brandscriptId: z.string().nullable().optional(),
  industryType: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const generateBlueprintSchema = z.object({
  industryType: z.string().min(1),
  domain: z.string().optional(),
  brandscriptId: z.string().optional(),
  targetPageCount: z.number().int().positive().optional(),
  includeLocationPages: z.boolean().optional(),
  locationCount: z.number().int().positive().optional(),
  includeContentPages: z.boolean().optional(),
});

const addEntrySchema = z.object({
  name: z.string().min(1),
  pageType: z.string().min(1),
  scope: z.enum(['included', 'recommended']).optional(),
  isCollection: z.boolean().optional(),
  primaryKeyword: z.string().optional(),
  secondaryKeywords: z.array(z.string()).optional(),
  keywordSource: z.enum(['manual', 'ai_suggested', 'semrush', 'dataforseo']).optional(),
  sectionPlan: z.array(z.object({
    id: z.string().optional(),
    sectionType: z.string().min(1),
    narrativeRole: z.string().optional(),
    brandNote: z.string().optional(),
    seoNote: z.string().optional(),
    wordCountTarget: z.number().int().positive().optional(),
    order: z.number().int().min(0).optional(),
  })).optional(),
  templateId: z.string().optional(),
  matrixId: z.string().optional(),
  notes: z.string().optional(),
});

const updateEntrySchema = z.object({
  name: z.string().min(1).optional(),
  pageType: z.string().optional(),
  scope: z.enum(['included', 'recommended']).optional(),
  isCollection: z.boolean().optional(),
  primaryKeyword: z.string().nullable().optional(),
  secondaryKeywords: z.array(z.string()).nullable().optional(),
  keywordSource: z.enum(['manual', 'ai_suggested', 'semrush', 'dataforseo']).nullable().optional(),
  sectionPlan: z.array(z.object({
    id: z.string().optional(),
    sectionType: z.string().min(1),
    narrativeRole: z.string().optional(),
    brandNote: z.string().optional(),
    seoNote: z.string().optional(),
    wordCountTarget: z.number().int().positive().optional(),
    order: z.number().int().min(0).optional(),
  })).optional(),
  templateId: z.string().nullable().optional(),
  matrixId: z.string().nullable().optional(),
  briefId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const reorderEntriesSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

const createVersionSchema = z.object({
  changeNotes: z.string().optional(),
});

const pseoMatrixDimensionSchema = z.object({
  variableName: z.string().trim().min(1).refine(
    value => matrixGenerationUtf8Bytes(value)
      <= MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensionNameBytes,
    'variableName exceeds the matrix source limit',
  ),
  values: z.array(z.string().trim().min(1).refine(
    value => matrixGenerationUtf8Bytes(value)
      <= MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensionValueBytes,
    'dimension value exceeds the matrix source limit',
  )).min(1).max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxValuesPerDimension),
}).strict();

const createPseoMatrixSchema = z.object({
  expectedSourceRevision: z.object({
    entryUpdatedAt: z.string().datetime({ offset: true }),
    templateId: z.string().trim().min(1)
      .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes),
    templateRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  dimensions: z.array(pseoMatrixDimensionSchema)
    .min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensions),
}).strict().superRefine((value, ctx) => {
  let cellCount = 1;
  for (const dimension of value.dimensions) {
    cellCount *= dimension.values.length;
    if (cellCount > MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxGeneratedCells) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions'],
        message: `Dimensions generate more than ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxGeneratedCells} cells`,
      });
      return;
    }
  }
});

// ── Routes ───────────────────────────────────────────────────────────────────

// IMPORTANT: /section-plan-defaults/:pageType must come BEFORE workspace-scoped routes
// to avoid collisions with /:workspaceId param matching.
router.get('/api/page-strategy/section-plan-defaults/:pageType', (req, res) => {
  const { pageType } = req.params;
  const plan = getDefaultSectionPlan(pageType);
  res.json(plan);
});

// ── Blueprints CRUD ──────────────────────────────────────────────────────────

// GET /api/page-strategy/:workspaceId — list blueprints
router.get(
  '/api/page-strategy/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const blueprints = listBlueprints(req.params.workspaceId);
    res.json(blueprints);
  },
);

// IMPORTANT: /generate must come BEFORE /:blueprintId to avoid shadowing
// POST /api/page-strategy/:workspaceId/generate — AI blueprint generation (async)
// Returns { jobId }; poll /api/jobs/:jobId for progress + result (blueprint).
router.post(
  '/api/page-strategy/:workspaceId/generate',
  requireWorkspaceAccess('workspaceId'),
  validate(generateBlueprintSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    const input: BlueprintGenerationInput = req.body;
    const job = createJob(BACKGROUND_JOB_TYPES.BLUEPRINT_GENERATION, { workspaceId });
    setImmediate(() => {
      void runBlueprintGenerationJob({ jobId: job.id, workspaceId, input });
    });
    return res.json({ jobId: job.id });
  },
);

// POST /api/page-strategy/:workspaceId — create blueprint
router.post(
  '/api/page-strategy/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  validate(createBlueprintSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    try {
      const blueprint = runWorkspaceMutation({
        workspaceId,
        defaultErrorMessage: 'Failed to create blueprint',
        mutate: () => createBlueprint({
          workspaceId,
          name: req.body.name,
          status: req.body.status,
          brandscriptId: req.body.brandscriptId,
          industryType: req.body.industryType,
          notes: req.body.notes,
        }),
        onActivity: ({ workspaceId: wsId, result }) => {
          addActivity(wsId, 'blueprint_created', `Created blueprint "${result.name}"`);
        },
        onBroadcast: ({ workspaceId: wsId, result }) => {
          broadcastToWorkspace(wsId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprint: result, action: 'created' });
        },
      });
      res.json(blueprint);
    } catch (err) {
      if (err instanceof WorkspaceMutationError) {
        return res.status(err.status).json({ error: err.message });
      }
      log.error({ err, workspaceId }, 'Create blueprint failed');
      res.status(500).json({ error: 'Failed to create blueprint' });
    }
  },
);

// GET /api/page-strategy/:workspaceId/:blueprintId — get single blueprint
router.get(
  '/api/page-strategy/:workspaceId/:blueprintId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    const blueprint = getBlueprint(workspaceId, blueprintId);
    if (!blueprint) return res.status(404).json({ error: 'Not found' });
    res.json(blueprint);
  },
);

// PUT /api/page-strategy/:workspaceId/:blueprintId — update blueprint
router.put(
  '/api/page-strategy/:workspaceId/:blueprintId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateBlueprintSchema),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    try {
      const blueprint = runWorkspaceMutation({
        workspaceId,
        defaultErrorMessage: 'Failed to update blueprint',
        // An illegal blueprint status transition (draft/active/archived) surfaces as
        // a 409 instead of a generic 500.
        mapError: (err) =>
          err instanceof InvalidTransitionError ? { status: 409, error: err.message } : null,
        mutate: () => {
          const next = updateBlueprint(workspaceId, blueprintId, req.body);
          if (!next) throw mutationError(404, 'Not found');
          return next;
        },
        onActivity: ({ workspaceId: wsId, result }) => {
          addActivity(wsId, 'blueprint_updated', `Updated blueprint "${result.name}"`);
        },
        onBroadcast: ({ workspaceId: wsId, result }) => {
          broadcastToWorkspace(wsId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprint: result, action: 'updated' });
        },
      });
      res.json(blueprint);
    } catch (err) {
      if (err instanceof WorkspaceMutationError) {
        return res.status(err.status).json({ error: err.message });
      }
      log.error({ err, workspaceId, blueprintId }, 'Update blueprint failed');
      res.status(500).json({ error: 'Failed to update blueprint' });
    }
  },
);

// DELETE /api/page-strategy/:workspaceId/:blueprintId — delete blueprint
router.delete(
  '/api/page-strategy/:workspaceId/:blueprintId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    try {
      runWorkspaceMutation({
        workspaceId,
        defaultErrorMessage: 'Failed to delete blueprint',
        readBeforeWrite: () => getBlueprint(workspaceId, blueprintId),
        mutate: ({ existing }) => {
          const ok = deleteBlueprint(workspaceId, blueprintId);
          if (!ok) throw mutationError(404, 'Not found');
          return { existingName: existing?.name ?? null };
        },
        onActivity: ({ workspaceId: wsId, result }) => {
          addActivity(
            wsId,
            'blueprint_deleted',
            result.existingName ? `Deleted blueprint "${result.existingName}"` : 'Deleted blueprint',
          );
        },
        onBroadcast: ({ workspaceId: wsId }) => {
          broadcastToWorkspace(wsId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprintId, deleted: true });
        },
      });
      res.status(204).send();
    } catch (err) {
      if (err instanceof WorkspaceMutationError) {
        return res.status(err.status).json({ error: err.message });
      }
      log.error({ err, workspaceId, blueprintId }, 'Delete blueprint failed');
      res.status(500).json({ error: 'Failed to delete blueprint' });
    }
  },
);

// ── Entries ──────────────────────────────────────────────────────────────────

// POST .../entries/:entryId/content-matrix — materialize one collection entry
router.post(
  '/api/page-strategy/:workspaceId/:blueprintId/entries/:entryId/content-matrix',
  requireWorkspaceAccess('workspaceId'),
  validate(createPseoMatrixSchema),
  async (req, res) => {
    const { workspaceId, blueprintId, entryId } = req.params;
    try {
      const result = await createMatrixFromPseoPlan({
        workspaceId,
        blueprintId,
        entryId,
        expectedSourceRevision: req.body.expectedSourceRevision,
        dimensions: req.body.dimensions,
      });
      if (!result.replayed) {
        runPseoRoutePostCommitEffect(
          workspaceId,
          entryId,
          'invalidate-content-pipeline-intelligence',
          () => invalidateContentPipelineIntelligence(workspaceId),
        );
        runPseoRoutePostCommitEffect(
          workspaceId,
          entryId,
          'broadcast-content-updated',
          () => broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, {
            domain: 'content-plan',
            matrixId: result.matrix.id,
            blueprintId,
            entryId,
            action: 'pseo_matrix_created',
          }),
        );
        runPseoRoutePostCommitEffect(
          workspaceId,
          entryId,
          'broadcast-blueprint-updated',
          () => broadcastToWorkspace(workspaceId, WS_EVENTS.BLUEPRINT_UPDATED, {
            blueprintId,
            entryId,
            matrixId: result.matrix.id,
            action: 'entries_updated',
          }),
        );
        runPseoRoutePostCommitEffect(
          workspaceId,
          entryId,
          'record-activity',
          () => addActivity(
            workspaceId,
            'content_updated',
            `Created content matrix "${result.matrix.name}" from the page blueprint`,
            `${result.matrix.cellCount} planned page${result.matrix.cellCount === 1 ? '' : 's'}`,
            {
              blueprintId,
              entryId,
              matrixId: result.matrix.id,
              action: 'pseo_matrix_created',
            },
          ),
        );
      }
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (err) {
      if (err instanceof PseoMatrixBridgeError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 422;
        return res.status(status).json({ error: err.message });
      }
      log.error({ err, workspaceId, blueprintId, entryId }, 'Create pSEO content matrix failed');
      res.status(500).json({ error: 'Failed to create content matrix from pSEO plan' });
    }
  },
);

// POST /api/page-strategy/:workspaceId/:blueprintId/entries — add entry
router.post(
  '/api/page-strategy/:workspaceId/:blueprintId/entries',
  requireWorkspaceAccess('workspaceId'),
  validate(addEntrySchema),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    try {
      const entry = addEntry(workspaceId, blueprintId, req.body);
      if (!entry) return res.status(404).json({ error: 'Blueprint not found' });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprintId, action: 'entries_updated' });
      addActivity(workspaceId, 'blueprint_entry_added', `Added page "${entry.name}" to blueprint`);
      res.json(entry);
    } catch (err) {
      log.error({ err, workspaceId, blueprintId }, 'Add entry failed');
      res.status(500).json({ error: 'Failed to add entry' });
    }
  },
);

// IMPORTANT: /entries/reorder must come BEFORE /entries/:entryId
// PUT /api/page-strategy/:workspaceId/:blueprintId/entries/reorder — reorder entries
router.put(
  '/api/page-strategy/:workspaceId/:blueprintId/entries/reorder',
  requireWorkspaceAccess('workspaceId'),
  validate(reorderEntriesSchema),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    try {
      const ok = reorderEntries(workspaceId, blueprintId, req.body.orderedIds);
      if (!ok) return res.status(404).json({ error: 'Blueprint not found' });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprintId, action: 'entries_updated' });
      // no addActivity — sort-only operation, no content change
      res.json({ reordered: true });
    } catch (err) {
      log.error({ err, workspaceId, blueprintId }, 'Reorder entries failed');
      res.status(500).json({ error: 'Failed to reorder entries' });
    }
  },
);

// PUT /api/page-strategy/:workspaceId/:blueprintId/entries/:entryId — update entry
router.put(
  '/api/page-strategy/:workspaceId/:blueprintId/entries/:entryId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateEntrySchema),
  (req, res) => {
    const { workspaceId, blueprintId, entryId } = req.params;
    try {
      const entry = updateEntry(workspaceId, blueprintId, entryId, req.body);
      if (!entry) return res.status(404).json({ error: 'Entry not found' });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprintId, action: 'entries_updated' });
      addActivity(workspaceId, 'blueprint_entry_updated', `Updated page "${entry.name}" in blueprint`);
      res.json(entry);
    } catch (err) {
      log.error({ err, workspaceId, blueprintId, entryId }, 'Update entry failed');
      res.status(500).json({ error: 'Failed to update entry' });
    }
  },
);

// DELETE /api/page-strategy/:workspaceId/:blueprintId/entries/:entryId — delete entry
router.delete(
  '/api/page-strategy/:workspaceId/:blueprintId/entries/:entryId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, blueprintId, entryId } = req.params;
    try {
      // Read before delete for activity log context
      const existing = getEntry(workspaceId, blueprintId, entryId);
      const ok = removeEntry(workspaceId, blueprintId, entryId);
      if (!ok) return res.status(404).json({ error: 'Entry not found' });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprintId, action: 'entries_updated' });
      addActivity(
        workspaceId,
        'blueprint_entry_deleted',
        existing ? `Removed page "${existing.name}" from blueprint` : 'Removed page from blueprint',
      );
      res.status(204).send();
    } catch (err) {
      log.error({ err, workspaceId, blueprintId, entryId }, 'Delete entry failed');
      res.status(500).json({ error: 'Failed to delete entry' });
    }
  },
);

// ── Versions ─────────────────────────────────────────────────────────────────

// POST /api/page-strategy/:workspaceId/:blueprintId/versions — create version
router.post(
  '/api/page-strategy/:workspaceId/:blueprintId/versions',
  requireWorkspaceAccess('workspaceId'),
  validate(createVersionSchema),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    try {
      const version = createVersion(workspaceId, blueprintId, req.body.changeNotes);
      if (!version) return res.status(404).json({ error: 'Blueprint not found' });
      broadcastToWorkspace(workspaceId, WS_EVENTS.BLUEPRINT_UPDATED, { blueprintId, action: 'version_created', version: version.version });
      addActivity(workspaceId, 'blueprint_updated', `Saved blueprint version ${version.version}`);
      res.json(version);
    } catch (err) {
      log.error({ err, workspaceId, blueprintId }, 'Create version failed');
      res.status(500).json({ error: 'Failed to create version' });
    }
  },
);

// GET /api/page-strategy/:workspaceId/:blueprintId/versions — list versions
router.get(
  '/api/page-strategy/:workspaceId/:blueprintId/versions',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    const versions = listVersions(workspaceId, blueprintId);
    if (versions === null) return res.status(404).json({ error: 'Blueprint not found' });
    res.json(versions);
  },
);

// GET /api/page-strategy/:workspaceId/:blueprintId/versions/:versionId — get specific version
router.get(
  '/api/page-strategy/:workspaceId/:blueprintId/versions/:versionId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, blueprintId, versionId } = req.params;
    const version = getVersion(workspaceId, blueprintId, versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });
    res.json(version);
  },
);

export default router;
