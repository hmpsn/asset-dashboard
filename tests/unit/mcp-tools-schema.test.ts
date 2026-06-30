import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
  getTokenForSite: vi.fn(),
  updatePageState: vi.fn(),
}));
vi.mock('../../server/schema-suggester.js', () => ({
  generateSchemaForPage: vi.fn(),
}));
vi.mock('../../server/schema-generation-context.js', () => ({
  prepareSinglePageSchemaGenerationContext: vi.fn(),
}));
vi.mock('../../server/schema-store.js', () => ({
  getSchemaSnapshot: vi.fn(),
  upsertPageResultInSnapshot: vi.fn(),
  updatePageSchemaInSnapshot: vi.fn(),
  recordSchemaPublish: vi.fn(),
}));
vi.mock('../../server/schema-validator.js', () => ({
  validateForGoogleRichResults: vi.fn(),
}));
vi.mock('../../server/schema/validator.js', () => ({
  validateLeanSchema: vi.fn(),
}));
vi.mock('../../server/webflow-pages.js', () => ({
  publishSchemaToPage: vi.fn(),
}));
vi.mock('../../server/routes/webflow-schema.js', () => ({
  publishSchemaToCmsField: vi.fn(),
}));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

import { getWorkspace, getTokenForSite, updatePageState } from '../../server/workspaces.js';
import { generateSchemaForPage } from '../../server/schema-suggester.js';
import { prepareSinglePageSchemaGenerationContext } from '../../server/schema-generation-context.js';
import { upsertPageResultInSnapshot, updatePageSchemaInSnapshot, recordSchemaPublish } from '../../server/schema-store.js';
import { validateForGoogleRichResults } from '../../server/schema-validator.js';
import { validateLeanSchema } from '../../server/schema/validator.js';
import { publishSchemaToPage } from '../../server/webflow-pages.js';
import { publishSchemaToCmsField } from '../../server/routes/webflow-schema.js';
import { invalidateIntelligenceCache } from '../../server/intelligence/cache-invalidation.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { addActivity } from '../../server/activity-log.js';
import { schemaActionTools, handleSchemaActionTool } from '../../server/mcp/tools/schema-actions.js';

const VALID_SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [{ '@type': 'WebPage', name: 'HVAC Services' }],
};

function suggestionWith(schema: Record<string, unknown>) {
  return {
    pageId: 'page_1',
    pageTitle: 'HVAC Services',
    slug: 'hvac-services',
    publishedPath: '/services/hvac',
    url: 'https://example.com/services/hvac',
    existingSchemas: [],
    suggestedSchemas: [{ type: 'WebPage', reason: 'r', priority: 'high' as const, template: schema }],
  };
}

describe('mcp schema action tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'ws-1',
      name: 'Workspace',
      webflowSiteId: 'site-1',
    });
    (getTokenForSite as ReturnType<typeof vi.fn>).mockReturnValue('token-1');
    (prepareSinglePageSchemaGenerationContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      ctx: { workspaceId: 'ws-1' },
    });
    (generateSchemaForPage as ReturnType<typeof vi.fn>).mockResolvedValue(suggestionWith(VALID_SCHEMA));
    (upsertPageResultInSnapshot as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (updatePageSchemaInSnapshot as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (recordSchemaPublish as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'sph_1' });
    (updatePageState as ReturnType<typeof vi.fn>).mockReturnValue(null);
    // Default: valid schema (no structural errors, no google errors).
    (validateLeanSchema as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (validateForGoogleRichResults as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'valid',
      richResults: ['WebPage'],
      errors: [],
      warnings: [],
    });
    // Default: static-page publish path (no CMS field).
    (publishSchemaToCmsField as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (publishSchemaToPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      published: true,
      delivery: { method: 'webflow-api', status: 'published', message: 'Published.', jsonLd: '{}' },
    });
  });

  it('registers schema action tool names', () => {
    expect(schemaActionTools.map(t => t.name)).toEqual([
      'generate_schema',
      'validate_schema',
      'publish_schema',
    ]);
  });

  it('routes each tool name and rejects unknown tools', async () => {
    const gen = await handleSchemaActionTool('generate_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(gen.isError).toBeUndefined();
    const val = await handleSchemaActionTool('validate_schema', { workspace_id: 'ws-1', schema_json: VALID_SCHEMA });
    expect(val.isError).toBeUndefined();
    const pub = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(pub.isError).toBeUndefined();

    const unknown = await handleSchemaActionTool('not_a_schema_tool', { workspace_id: 'ws-1' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain('Unknown schema action tool');
  });

  it('generate_schema generates, persists, broadcasts, and returns the JSON-LD + validation', async () => {
    const result = await handleSchemaActionTool('generate_schema', {
      workspace_id: 'ws-1',
      page_id: 'page_1',
      page_type: 'service',
    });
    expect(result.isError).toBeUndefined();
    expect(prepareSinglePageSchemaGenerationContext).toHaveBeenCalledWith('site-1', 'page_1', 'service');
    expect(generateSchemaForPage).toHaveBeenCalledWith('site-1', 'page_1', 'token-1', { workspaceId: 'ws-1' });
    expect(upsertPageResultInSnapshot).toHaveBeenCalledWith('site-1', 'ws-1', expect.objectContaining({ pageId: 'page_1' }));
    expect(broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'schema:snapshot_updated', expect.objectContaining({ action: 'generated' }));
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'schema_generated',
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ source: 'mcp-chat' }),
    );
    const payload = JSON.parse(result.content[0].text) as {
      schema: Record<string, unknown>;
      validation: { valid: boolean; richResults: string[] };
    };
    expect(payload.schema).toEqual(VALID_SCHEMA);
    expect(payload.validation.valid).toBe(true);
    expect(payload.validation.richResults).toEqual(['WebPage']);
  });

  it('validate_schema validates a raw schema_json object without generating', async () => {
    const result = await handleSchemaActionTool('validate_schema', {
      workspace_id: 'ws-1',
      schema_json: VALID_SCHEMA,
    });
    expect(result.isError).toBeUndefined();
    expect(generateSchemaForPage).not.toHaveBeenCalled();
    expect(validateLeanSchema).toHaveBeenCalledWith(VALID_SCHEMA, 'WebPage');
    const payload = JSON.parse(result.content[0].text) as { source: string; validation: { valid: boolean } };
    expect(payload.source).toBe('schema_json');
    expect(payload.validation.valid).toBe(true);
  });

  it('validate_schema generates fresh when given a page_id', async () => {
    const result = await handleSchemaActionTool('validate_schema', {
      workspace_id: 'ws-1',
      page_id: 'page_1',
    });
    expect(result.isError).toBeUndefined();
    expect(generateSchemaForPage).toHaveBeenCalled();
    const payload = JSON.parse(result.content[0].text) as { source: string };
    expect(payload.source).toBe('page_id');
  });

  it('validate_schema rejects when neither/both of page_id and schema_json are given', async () => {
    const neither = await handleSchemaActionTool('validate_schema', { workspace_id: 'ws-1' });
    expect(neither.isError).toBe(true);
    expect(neither.content[0].text).toContain('Validation failed');

    const both = await handleSchemaActionTool('validate_schema', {
      workspace_id: 'ws-1',
      page_id: 'page_1',
      schema_json: VALID_SCHEMA,
    });
    expect(both.isError).toBe(true);
  });

  it('publish_schema REFUSES to publish when validation has structural errors', async () => {
    (validateLeanSchema as ReturnType<typeof vi.fn>).mockReturnValue([
      { severity: 'error', type: 'WebPage', field: '@context', ruleId: 'required-field-missing', message: 'missing @context' },
    ]);

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Schema validation failed — not publishing');
    // Critical: the publish service functions must NEVER be called on a failed validation.
    expect(publishSchemaToCmsField).not.toHaveBeenCalled();
    expect(publishSchemaToPage).not.toHaveBeenCalled();
    expect(recordSchemaPublish).not.toHaveBeenCalled();
    expect(updatePageState).not.toHaveBeenCalled();
  });

  it('publish_schema REFUSES to publish when Google validation has errors', async () => {
    (validateForGoogleRichResults as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'errors',
      richResults: [],
      errors: [{ type: 'Article', field: 'image', message: 'Missing required property "image" for Article' }],
      warnings: [],
    });

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(publishSchemaToPage).not.toHaveBeenCalled();
    expect(publishSchemaToCmsField).not.toHaveBeenCalled();
  });

  it('publish_schema publishes a valid schema to a static page, records history, tags mcp-chat, broadcasts', async () => {
    const result = await handleSchemaActionTool('publish_schema', {
      workspace_id: 'ws-1',
      page_id: 'page_1',
      publish_after: true,
    });
    expect(result.isError).toBeUndefined();
    expect(publishSchemaToCmsField).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      pageId: 'page_1',
      publishAfter: true,
    }));
    expect(publishSchemaToPage).toHaveBeenCalledWith('site-1', 'page_1', VALID_SCHEMA, 'token-1');
    expect(updatePageSchemaInSnapshot).toHaveBeenCalledWith('site-1', 'page_1', VALID_SCHEMA);
    expect(recordSchemaPublish).toHaveBeenCalledWith('site-1', 'page_1', 'ws-1', VALID_SCHEMA);
    expect(updatePageState).toHaveBeenCalledWith('ws-1', 'page_1', expect.objectContaining({ status: 'live', source: 'schema' }));
    expect(invalidateIntelligenceCache).toHaveBeenCalledWith('ws-1');
    expect(broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'schema:snapshot_updated', expect.objectContaining({ action: 'published' }));
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'schema_published',
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ source: 'mcp-chat', mode: 'page-custom-code' }),
    );
    const payload = JSON.parse(result.content[0].text) as { published: boolean; mode: string };
    expect(payload.published).toBe(true);
    expect(payload.mode).toBe('page-custom-code');
  });

  it('publish_schema writes to a CMS field when the page is CMS-backed', async () => {
    (publishSchemaToCmsField as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'cms-field',
      status: 'written',
      fieldSlug: 'schema-json',
      message: 'CMS field written: schema-json.',
    });

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBeUndefined();
    expect(publishSchemaToCmsField).toHaveBeenCalled();
    // CMS path taken — must NOT also publish to the static page.
    expect(publishSchemaToPage).not.toHaveBeenCalled();
    expect(recordSchemaPublish).toHaveBeenCalled();
    const payload = JSON.parse(result.content[0].text) as { mode: string };
    expect(payload.mode).toBe('cms-field');
  });

  it('publish_schema surfaces a CMS blocked status as an error', async () => {
    (publishSchemaToCmsField as ReturnType<typeof vi.fn>).mockResolvedValue({
      mode: 'cms-field',
      status: 'blocked',
      message: 'CMS publish blocked: no mapped schema field.',
    });

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('CMS publish blocked');
    expect(recordSchemaPublish).not.toHaveBeenCalled();
  });

  it('publish_schema surfaces a manual-required static delivery as an error', async () => {
    (publishSchemaToPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      delivery: { method: 'manual-native-schema-field', status: 'manual-required', message: 'Copy the JSON-LD into Webflow.', jsonLd: '{}' },
    });

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('manual action required');
    expect(recordSchemaPublish).not.toHaveBeenCalled();
  });

  it('returns not-found when the page cannot be generated', async () => {
    (generateSchemaForPage as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await handleSchemaActionTool('generate_schema', { workspace_id: 'ws-1', page_id: 'page_missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Page not found');
  });

  it('returns a workspace-not-found error', async () => {
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const result = await handleSchemaActionTool('generate_schema', { workspace_id: 'ws-missing', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('errors when the workspace has no linked Webflow site', async () => {
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce({ id: 'ws-1', name: 'Workspace' });
    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no linked Webflow site');
    expect(publishSchemaToPage).not.toHaveBeenCalled();
  });

  it('returns validation errors for malformed tool input', async () => {
    const result = await handleSchemaActionTool('generate_schema', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
  });
});
