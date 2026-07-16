import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
  getTokenForSite: vi.fn(),
}));
vi.mock('../../server/schema-suggester.js', () => ({
  generateSchemaForPage: vi.fn(),
}));
vi.mock('../../server/schema-generation-context.js', () => ({
  prepareSinglePageSchemaGenerationContext: vi.fn(),
}));
vi.mock('../../server/schema-store.js', () => ({
  upsertPageResultInSnapshot: vi.fn(),
}));
vi.mock('../../server/schema-validator.js', () => ({
  validateForGoogleRichResults: vi.fn(),
}));
vi.mock('../../server/schema/validator.js', () => ({
  validateLeanSchema: vi.fn(),
}));
// The MCP publish tool delegates the entire publish + follow-on set to the
// shared `publishSchemaToLive` domain service. Mock IT (not the low-level
// publishSchemaToPage / publishSchemaToCmsField primitives) so the test asserts
// the tool routes through the shared service — closing the parity gap.
vi.mock('../../server/domains/schema/publish-schema-to-live.js', () => ({
  publishSchemaToLive: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

import { getWorkspace, getTokenForSite } from '../../server/workspaces.js';
import { generateSchemaForPage } from '../../server/schema-suggester.js';
import { prepareSinglePageSchemaGenerationContext } from '../../server/schema-generation-context.js';
import { upsertPageResultInSnapshot } from '../../server/schema-store.js';
import { validateForGoogleRichResults } from '../../server/schema-validator.js';
import { validateLeanSchema } from '../../server/schema/validator.js';
import { publishSchemaToLive } from '../../server/domains/schema/publish-schema-to-live.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { addActivity } from '../../server/activity-log.js';
import { schemaActionTools, handleSchemaActionTool } from '../../server/mcp/tools/schema-actions.js';

function errorEnvelope(result: Awaited<ReturnType<typeof handleSchemaActionTool>>) {
  return JSON.parse(result.content[0]?.text ?? '{}') as {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

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
    // Default: valid schema (no structural errors, no google errors).
    (validateLeanSchema as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (validateForGoogleRichResults as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'valid',
      richResults: ['WebPage'],
      errors: [],
      warnings: [],
    });
    // Default: static-page publish path succeeds via the shared domain service.
    (publishSchemaToLive as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      mode: 'page-custom-code',
      deliveryStatus: 'published',
      deliveryMessage: 'Published.',
      pageResult: {
        success: true,
        published: true,
        delivery: { method: 'webflow-api', status: 'published', message: 'Published.', jsonLd: '{}' },
      },
      published: true,
      sitePublished: false,
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
    expect(errorEnvelope(unknown)).toMatchObject({
      code: 'not_found',
      details: { resource_type: 'tool' },
    });
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
    expect(errorEnvelope(neither)).toMatchObject({ code: 'validation_failed' });

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
    expect(errorEnvelope(result)).toMatchObject({
      code: 'precondition_failed',
      details: { validation_errors: expect.any(Array) },
    });
    // Critical: the shared publish service (and thus its follow-ons) must NEVER
    // be called on a failed validation. The VALIDATE-FIRST guard sits before it.
    expect(publishSchemaToLive).not.toHaveBeenCalled();
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
    expect(publishSchemaToLive).not.toHaveBeenCalled();
  });

  it('publish_schema delegates to the shared publishSchemaToLive service (closing the route/MCP parity gap), tags mcp-chat, returns mode', async () => {
    const result = await handleSchemaActionTool('publish_schema', {
      workspace_id: 'ws-1',
      page_id: 'page_1',
      publish_after: true,
    });
    expect(result.isError).toBeUndefined();
    // The tool routes the whole publish + follow-on set through the shared
    // domain service — it no longer hand-rolls publishSchemaToCmsField /
    // publishSchemaToPage / recordSchemaPublish / recordSeoChange / llms.txt /
    // rec-regen inline. publishSchemaToLive runs that canonical set internally.
    expect(publishSchemaToLive).toHaveBeenCalledTimes(1);
    expect(publishSchemaToLive).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      pageId: 'page_1',
      schema: VALID_SCHEMA,
      workspaceId: 'ws-1',
      token: 'token-1',
      publishAfter: true,
    }));
    // The tool adds the MCP-tagged activity on top of the service's generic one.
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

  it('publish_schema returns mode=cms-field when the shared service reports a CMS write', async () => {
    (publishSchemaToLive as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      mode: 'cms-field',
      deliveryStatus: 'written',
      deliveryMessage: 'CMS field written: schema-json.',
      cmsDelivery: { mode: 'cms-field', status: 'written', fieldSlug: 'schema-json', message: 'CMS field written: schema-json.' },
      published: false,
      sitePublished: false,
    });

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBeUndefined();
    expect(publishSchemaToLive).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(result.content[0].text) as { mode: string };
    expect(payload.mode).toBe('cms-field');
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1', 'schema_published', expect.any(String), expect.anything(),
      expect.objectContaining({ source: 'mcp-chat', mode: 'cms-field' }),
    );
  });

  it('publish_schema surfaces a CMS blocked status from the service as an error', async () => {
    (publishSchemaToLive as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      kind: 'cms-blocked',
      message: 'CMS publish blocked: no mapped schema field.',
      cmsDelivery: { mode: 'cms-field', status: 'blocked', message: 'CMS publish blocked: no mapped schema field.' },
    });

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(errorEnvelope(result)).toMatchObject({ code: 'precondition_failed' });
    expect(result.content[0].text).not.toContain('CMS publish blocked');
    // No mcp-chat success activity when the publish failed.
    expect(addActivity).not.toHaveBeenCalled();
  });

  it('publish_schema surfaces a manual-required delivery from the service as an error', async () => {
    (publishSchemaToLive as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      kind: 'manual-required',
      message: 'Copy the JSON-LD into Webflow.',
      pageResult: {
        success: false,
        delivery: { method: 'manual-native-schema-field', status: 'manual-required', message: 'Copy the JSON-LD into Webflow.', jsonLd: '{}' },
      },
    });

    const result = await handleSchemaActionTool('publish_schema', { workspace_id: 'ws-1', page_id: 'page_1' });
    expect(result.isError).toBe(true);
    expect(errorEnvelope(result)).toMatchObject({ code: 'precondition_failed' });
    expect(errorEnvelope(result).message).toMatch(/manual Webflow publish/i);
    expect(addActivity).not.toHaveBeenCalled();
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
    expect(publishSchemaToLive).not.toHaveBeenCalled();
  });

  it('returns validation errors for malformed tool input', async () => {
    const result = await handleSchemaActionTool('generate_schema', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(errorEnvelope(result)).toMatchObject({ code: 'validation_failed' });
  });
});
