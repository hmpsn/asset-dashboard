/**
 * content-templates routes — CRUD for Content Templates (scalable content planning).
 */
import { Router } from 'express';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  contentTemplateGenerationPatternIssues,
  ContentTemplateGenerationContractError,
  ContentTemplateRevisionConflictError,
  ContentTemplateRevisionRequiredError,
  ContentTemplateSourceIntegrityError,
} from '../content-templates.js';
import {
  acceptTemplateGenerationUpgrade,
  TemplateGenerationUpgradeError,
} from '../domains/content/matrix-generation/upgrade-action.js';
import { createLogger } from '../logger.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';
import {
  mutationError,
  runWorkspaceMutation,
  WorkspaceMutationError,
} from '../workspace-mutation-helper.js';

import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { TEMPLATE_INTERNAL_LINK_MINIMUM_LIMIT } from '../../shared/types/content.js';
import {
  MATRIX_GENERATION_CONTRACT_VERSION,
  MATRIX_GENERATION_SOURCE_LIMITS,
  MatrixGenerationSchemaTypeContractError,
  MatrixGenerationSourceLimitError,
  matrixGenerationUtf8Bytes,
} from '../../shared/types/matrix-generation.js';

const router = Router();
const log = createLogger('content-templates-routes');

// ── Validation schemas ──

const contentPageTypeValues = [
  'blog', 'landing', 'service', 'location', 'product',
  'pillar', 'resource', 'provider-profile', 'procedure-guide', 'pricing-page',
  'homepage', 'about', 'contact', 'faq', 'testimonials', 'custom',
] as const;

function boundedUtf8String(limit: number, label: string, minimum = 0) {
  return z.string().min(minimum).refine(
    value => matrixGenerationUtf8Bytes(value) <= limit,
    `${label} exceeds the ${limit}-byte generation-source limit`,
  );
}

const templateLimits = MATRIX_GENERATION_SOURCE_LIMITS.template;

const templateVariableSchema = z.object({
  name: boundedUtf8String(templateLimits.maxVariableNameBytes, 'variable name', 1),
  label: boundedUtf8String(templateLimits.maxVariableLabelBytes, 'variable label', 1),
  description: boundedUtf8String(
    templateLimits.maxVariableDescriptionBytes,
    'variable description',
  ).optional(),
});

const templateSectionSchema = z.object({
  id: boundedUtf8String(templateLimits.maxSectionIdBytes, 'section id', 1),
  name: boundedUtf8String(templateLimits.maxSectionNameBytes, 'section name', 1),
  headingTemplate: boundedUtf8String(
    templateLimits.maxHeadingTemplateBytes,
    'heading template',
  ),
  guidance: boundedUtf8String(templateLimits.maxGuidanceBytes, 'section guidance'),
  wordCountTarget: z.number().int().nonnegative().max(templateLimits.maxSectionWordCountTarget),
  order: z.number().int().nonnegative(),
  cmsFieldSlug: boundedUtf8String(templateLimits.maxCmsFieldKeyBytes, 'CMS field slug').optional(),
  narrativeRole: boundedUtf8String(templateLimits.maxSectionNoteBytes, 'narrative role').optional(),
  brandNote: boundedUtf8String(templateLimits.maxSectionNoteBytes, 'brand note').optional(),
  seoNote: boundedUtf8String(templateLimits.maxSectionNoteBytes, 'SEO note').optional(),
  generationRole: z.enum([
    'body', 'answer_first', 'definition', 'proof', 'process', 'faq', 'cta',
  ]).optional(),
  aeoContract: z.object({
    modes: z.array(z.enum(['answer_first', 'definition', 'faq', 'paa'])).max(4),
    required: z.boolean(),
  }).optional(),
  ctaContract: z.object({
    role: z.enum(['none', 'primary', 'secondary']),
    required: z.boolean(),
  }).optional(),
  optional: z.boolean().optional(),
  renderAs: z.enum(['prose', 'table']).optional(),
  internalLinkContract: z.object({
    minimum: z.number().int().min(1).max(TEMPLATE_INTERNAL_LINK_MINIMUM_LIMIT),
  }).strict().optional(),
});

const cmsFieldMapSchema = z.record(boundedUtf8String(
  templateLimits.maxCmsFieldValueBytes,
  'CMS field value',
)).superRefine((value, ctx) => {
  const entries = Object.entries(value);
  if (entries.length > templateLimits.maxCmsFieldMappings) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      type: 'array',
      inclusive: true,
      maximum: templateLimits.maxCmsFieldMappings,
      message: `CMS field map cannot exceed ${templateLimits.maxCmsFieldMappings} entries`,
    });
  }
  entries.forEach(([key], index) => {
    if (matrixGenerationUtf8Bytes(key) > templateLimits.maxCmsFieldKeyBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'key'],
        message: `CMS field key ${index + 1} exceeds the ${templateLimits.maxCmsFieldKeyBytes}-byte limit`,
      });
    }
  });
});

export const templateWriteFieldsBaseSchema = z.object({
  name: boundedUtf8String(templateLimits.maxNameBytes, 'name', 1),
  description: boundedUtf8String(templateLimits.maxDescriptionBytes, 'description').optional(),
  pageType: z.enum(contentPageTypeValues).optional(),
  variables: z.array(templateVariableSchema).max(templateLimits.maxVariables).optional(),
  sections: z.array(templateSectionSchema).max(templateLimits.maxSections).optional(),
  urlPattern: boundedUtf8String(templateLimits.maxPatternBytes, 'URL pattern').optional(),
  keywordPattern: boundedUtf8String(templateLimits.maxPatternBytes, 'keyword pattern').optional(),
  titlePattern: boundedUtf8String(templateLimits.maxPatternBytes, 'title pattern').optional(),
  metaDescPattern: boundedUtf8String(templateLimits.maxPatternBytes, 'meta description pattern').optional(),
  cmsFieldMap: cmsFieldMapSchema.optional(),
  toneAndStyle: boundedUtf8String(templateLimits.maxToneAndStyleBytes, 'tone and style').optional(),
  schemaTypes: z.array(boundedUtf8String(
    templateLimits.maxSchemaTypeBytes,
    'schema type',
  )).max(templateLimits.maxSchemaTypes).optional(),
  generationContractVersion: z.literal(MATRIX_GENERATION_CONTRACT_VERSION).optional(),
});

function addTotalTemplateWordCountIssue(
  value: { sections?: Array<{ wordCountTarget: number }> },
  ctx: z.RefinementCtx,
): void {
  const totalWordCount = value.sections?.reduce(
    (sum, section) => sum + section.wordCountTarget,
    0,
  ) ?? 0;
  if (totalWordCount > templateLimits.maxTotalWordCountTarget) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: `Total section word-count target cannot exceed ${templateLimits.maxTotalWordCountTarget}`,
    });
  }
}

const templateWriteFieldsSchema = templateWriteFieldsBaseSchema
  .superRefine(addTotalTemplateWordCountIssue);

export const createTemplateSchema = templateWriteFieldsSchema.superRefine((value, ctx) => {
  if (value.sections?.length && value.sections.every(section => section.optional === true)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: 'A content template requires at least one non-optional section',
    });
  }
  if (value.generationContractVersion === undefined) return;
  if (!value.sections || value.sections.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: 'A generation-ready template requires at least one explicit section',
    });
    return;
  }
  value.sections.forEach((section, index) => {
    if (!section.generationRole || !section.aeoContract || !section.ctaContract) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections', index],
        message: 'Generation-ready sections require explicit role, AEO, and CTA contracts',
      });
    }
  });
  for (const issue of contentTemplateGenerationPatternIssues({
    variables: value.variables ?? [],
    urlPattern: value.urlPattern,
    keywordPattern: value.keywordPattern,
    titlePattern: value.titlePattern,
    metaDescPattern: value.metaDescPattern,
  })) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [issue.fieldPath],
      message: issue.constraint,
    });
  }
});

export const updateTemplateFieldsSchema = templateWriteFieldsBaseSchema
  .omit({ generationContractVersion: true })
  .partial();

export const updateTemplateSchema = updateTemplateFieldsSchema.extend({
  expectedTemplateRevision: z.number().int().nonnegative().optional(),
  // Compatibility for the existing editor, which submits the read DTO.
  revision: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => {
    addTotalTemplateWordCountIssue(value, ctx);
    if (value.sections?.length && value.sections.every(section => section.optional === true)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections'],
        message: 'A content template requires at least one non-optional section',
      });
    }
    const generationFields = [
      'pageType', 'variables', 'sections', 'urlPattern', 'keywordPattern',
      'titlePattern', 'metaDescPattern', 'cmsFieldMap', 'toneAndStyle', 'schemaTypes',
    ] as const;
    if (generationFields.some(field => value[field] !== undefined)
      && value.expectedTemplateRevision === undefined
      && value.revision === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedTemplateRevision'],
        message: 'Required for generation-effective template changes',
      });
    }
  });

export const duplicateTemplateSchema = z.object({
  name: boundedUtf8String(templateLimits.maxNameBytes, 'name').optional(),
});

const acceptGenerationUpgradeSchema = z.object({
  expectedTemplateRevision: z.number().int().nonnegative(),
  proposalFingerprint: z.string().regex(
    /^[a-f0-9]{64}$/,
    'proposalFingerprint must be a lowercase SHA-256 fingerprint',
  ),
  decision: z.enum(['accept', 'reject']),
  idempotencyKey: z.string().trim().min(1).max(200),
});

function notifyContentPlanUpdated(workspaceId: string, payload: Record<string, unknown>) {
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-plan', ...payload });
}

function mapTemplateMutationError(err: unknown): { status: number; error: string } | null {
  if (err instanceof ContentTemplateGenerationContractError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof MatrixGenerationSourceLimitError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof MatrixGenerationSchemaTypeContractError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof ContentTemplateRevisionConflictError) {
    return { status: 409, error: err.message };
  }
  if (err instanceof ContentTemplateRevisionRequiredError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof ContentTemplateSourceIntegrityError) {
    return { status: 422, error: err.message };
  }
  if (err instanceof TemplateGenerationUpgradeError) {
    if (err.code === 'not_found') return { status: 404, error: 'Template not found' };
    if (err.code === 'conflict') return { status: 409, error: 'Template or upgrade proposal changed' };
    return { status: 422, error: 'Template generation upgrade prerequisites are not satisfied' };
  }
  return null;
}

// List all templates for a workspace
router.get('/api/content-templates/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const templates = listTemplates(req.params.workspaceId);
    res.json(templates);
  } catch (err) {
    if (err instanceof MatrixGenerationSourceLimitError) {
      return res.status(422).json({ error: err.message });
    }
    throw err;
  }
});

// Get a specific template
router.get('/api/content-templates/:workspaceId/:templateId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const template = getTemplate(req.params.workspaceId, req.params.templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (err) {
    if (err instanceof MatrixGenerationSourceLimitError) {
      return res.status(422).json({ error: err.message });
    }
    throw err;
  }
});

// Create a new template
router.post('/api/content-templates/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createTemplateSchema), (req, res) => {
  try {
    const { name, description, pageType, variables, sections, urlPattern, keywordPattern, titlePattern, metaDescPattern, cmsFieldMap, toneAndStyle, schemaTypes, generationContractVersion } = req.body;

    const template = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to create template',
      mapError: mapTemplateMutationError,
      mutate: ({ workspaceId }) => createTemplate(workspaceId, {
        name,
        description,
        pageType,
        variables,
        sections,
        urlPattern,
        keywordPattern,
        titlePattern,
        metaDescPattern,
        cmsFieldMap,
        toneAndStyle,
        schemaTypes,
        generationContractVersion,
      }),
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Created content template "${result.name}"`,
          `Page type: ${result.pageType}`,
          { templateId: result.id, action: 'template_created' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_created' });
      },
    });

    res.status(201).json(template);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to create template');
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Accept or reject one exact deterministic legacy-template generation upgrade.
router.post(
  '/api/content-templates/:workspaceId/:templateId/accept-generation-upgrade',
  requireWorkspaceAccess('workspaceId'),
  validate(acceptGenerationUpgradeSchema),
  (req, res) => {
    try {
      const result = runWorkspaceMutation({
        workspaceId: req.params.workspaceId,
        defaultErrorMessage: 'Failed to apply template generation upgrade decision',
        mapError: mapTemplateMutationError,
        mutate: ({ workspaceId }) => acceptTemplateGenerationUpgrade({
          workspaceId,
          templateId: req.params.templateId,
          expectedTemplateRevision: req.body.expectedTemplateRevision,
          proposalFingerprint: req.body.proposalFingerprint,
          decision: req.body.decision,
          idempotencyKey: req.body.idempotencyKey,
        }),
        onActivity: ({ workspaceId, result: upgrade }) => {
          if (upgrade.status !== 'accepted' || upgrade.replayed) return;
          addActivity(
            workspaceId,
            'content_updated',
            `Upgraded content template "${upgrade.template.name}" for generation`,
            undefined,
            {
              templateId: upgrade.template.id,
              action: 'template_generation_upgrade_accepted',
            },
          );
        },
        onBroadcast: ({ workspaceId, result: upgrade }) => {
          if (upgrade.status !== 'accepted' || upgrade.replayed) return;
          notifyContentPlanUpdated(workspaceId, {
            templateId: upgrade.template.id,
            action: 'template_generation_upgrade_accepted',
          });
        },
      });
      res.json(result);
    } catch (err) {
      if (err instanceof WorkspaceMutationError) {
        return res.status(err.status).json({ error: err.message });
      }
      log.error(
        { err, workspaceId: req.params.workspaceId, templateId: req.params.templateId },
        'Failed to apply template generation upgrade decision',
      );
      res.status(500).json({ error: 'Failed to apply template generation upgrade decision' });
    }
  },
);

// Update an existing template
router.put('/api/content-templates/:workspaceId/:templateId', requireWorkspaceAccess('workspaceId'), validate(updateTemplateSchema), (req, res) => {
  try {
    const {
      expectedTemplateRevision,
      revision,
      ...updates
    } = req.body;
    const updated = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to update template',
      mapError: mapTemplateMutationError,
      mutate: ({ workspaceId }) => {
        const next = updateTemplate(workspaceId, req.params.templateId, updates, {
          expectedTemplateRevision: expectedTemplateRevision ?? revision,
        });
        if (!next) throw mutationError(404, 'Template not found');
        return next;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Updated content template "${result.name}"`,
          undefined,
          { templateId: result.id, action: 'template_updated' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_updated' });
      },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to update template');
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete a template
router.delete('/api/content-templates/:workspaceId/:templateId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to delete template',
      readBeforeWrite: ({ workspaceId }) => getTemplate(workspaceId, req.params.templateId),
      mutate: ({ workspaceId, existing }) => {
        if (!existing) throw mutationError(404, 'Template not found');
        const deleted = deleteTemplate(workspaceId, req.params.templateId);
        if (!deleted) throw mutationError(404, 'Template not found');
        return existing;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Deleted content template "${result.name}"`,
          undefined,
          { templateId: result.id, action: 'template_deleted' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_deleted', deleted: true });
      },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to delete template');
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Duplicate a template
router.post('/api/content-templates/:workspaceId/:templateId/duplicate', requireWorkspaceAccess('workspaceId'), validate(duplicateTemplateSchema), (req, res) => {
  try {
    const { name } = req.body;
    const copy = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to duplicate template',
      mutate: ({ workspaceId }) => {
        const duplicated = duplicateTemplate(workspaceId, req.params.templateId, name);
        if (!duplicated) throw mutationError(404, 'Template not found');
        return duplicated;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Duplicated content template "${result.name}"`,
          undefined,
          { templateId: result.id, sourceTemplateId: req.params.templateId, action: 'template_duplicated' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { templateId: result.id, action: 'template_duplicated' });
      },
    });
    res.status(201).json(copy);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err, workspaceId: req.params.workspaceId, templateId: req.params.templateId }, 'Failed to duplicate template');
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

export default router;
