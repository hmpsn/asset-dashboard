import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  MCP_TOOL_REGISTRY,
  buildMcpToolRegistry,
  createMcpToolExecutor,
  getDeclaredWorkspaceField,
  listMcpToolDefinitions,
  type McpToolFamilyRegistration,
} from '../../server/mcp/tool-registry.js';
import { mcpJsonV1Error } from '../../server/mcp/tool-errors.js';
import { MCP_TOOL_ERROR_CODES } from '../../shared/types/mcp-runtime.js';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => logger,
}));

function tool(
  name: string,
  workspaceField: 'workspaceId' | 'workspace_id' | 'both' | 'none' = 'workspaceId',
): Tool {
  const properties: Record<string, unknown> = {};
  if (workspaceField === 'workspaceId' || workspaceField === 'both') {
    properties.workspaceId = { type: 'string', description: 'Workspace ID.' };
  }
  if (workspaceField === 'workspace_id' || workspaceField === 'both') {
    properties.workspace_id = { type: 'string', description: 'Workspace ID.' };
  }
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties },
  };
}

function registration(
  tools: Tool[],
  globalToolNames: readonly string[] = [],
  family = 'test-family',
  overrides?: McpToolFamilyRegistration['errorContractOverrides'],
): McpToolFamilyRegistration {
  return {
    family,
    tools,
    handler: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
    globalToolNames,
    errorContract: 'legacy_text',
    ...(overrides ? { errorContractOverrides: overrides } : {}),
  };
}

function parseErrorText(result: Awaited<ReturnType<ReturnType<typeof createMcpToolExecutor>>>) {
  const first = result.content[0];
  expect(first?.type).toBe('text');
  return first?.type === 'text' ? first.text : '';
}

const masterAuth = { scope: 'all' as const, label: 'master' };

describe('canonical MCP tool registry', () => {
  it('is the sole 16-family, 69-tool discovery source with exact global tools', () => {
    const definitions = listMcpToolDefinitions();
    expect(definitions).toHaveLength(69);
    expect(new Set([...MCP_TOOL_REGISTRY.values()].map(entry => entry.family)).size).toBe(16);
    expect(
      [...MCP_TOOL_REGISTRY.values()]
        .filter(entry => entry.scope === 'global')
        .map(entry => entry.definition.name)
        .sort(),
    ).toEqual(['create_workspace', 'list_workspaces']);
    expect(definitions.map(definition => definition.name)).toEqual([
      ...MCP_TOOL_REGISTRY.keys(),
    ]);
  });

  it('records each declared workspace field and the explicit legacy/json compatibility split', () => {
    expect(getDeclaredWorkspaceField('get_workspace_overview')).toBe('workspaceId');
    expect(getDeclaredWorkspaceField('update_workspace')).toBe('workspace_id');
    expect(getDeclaredWorkspaceField('get_brand_voice')).toBe('workspace_id');
    expect(getDeclaredWorkspaceField('finalize_brand_voice')).toBe('workspace_id');
    expect(getDeclaredWorkspaceField('list_workspaces')).toBeUndefined();
    const entries = [...MCP_TOOL_REGISTRY.values()];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter(entry => entry.errorContract === 'legacy_text')).toHaveLength(61);
    expect(
      entries
        .filter(entry => entry.errorContract === 'json_v1')
        .map(entry => entry.definition.name),
    ).toEqual([
      'list_content_matrices',
      'get_content_matrix',
      'resolve_content_matrix_cells',
      'accept_content_template_generation_upgrade',
      'get_brand_intake',
      'resolve_brand_intake_evidence',
      'get_brand_voice',
      'finalize_brand_voice',
    ]);
  });

  it('fails fast on duplicate names and missing handlers', () => {
    expect(() => buildMcpToolRegistry([
      registration([tool('duplicate')]),
      registration([tool('duplicate')], [], 'second-family'),
    ])).toThrow(/duplicate/i);

    expect(() => buildMcpToolRegistry([{
      ...registration([tool('no_handler')]),
      handler: undefined as never,
    }])).toThrow(/handler/i);
  });

  it('fails fast on duplicate families and invalid discovery metadata', () => {
    expect(() => buildMcpToolRegistry([
      registration([tool('family_one')]),
      registration([tool('family_two')]),
    ])).toThrow(/family/i);

    expect(() => buildMcpToolRegistry([{
      ...registration([tool('bad_description')]),
      tools: [{ ...tool('bad_description'), description: '' }],
    }])).toThrow(/description/i);

    expect(() => buildMcpToolRegistry([{
      ...registration([tool('bad_contract')]),
      family: 'bad-contract-family',
      errorContract: 'unregistered' as never,
    }])).toThrow(/error contract/i);
  });

  it('supports validated per-tool contracts in a mixed compatibility family', () => {
    const registry = buildMcpToolRegistry([
      registration(
        [tool('legacy_tool'), tool('json_tool')],
        [],
        'mixed-family',
        { json_tool: 'json_v1' },
      ),
    ]);

    expect(registry.get('legacy_tool')?.errorContract).toBe('legacy_text');
    expect(registry.get('json_tool')?.errorContract).toBe('json_v1');

    expect(() => buildMcpToolRegistry([{
      ...registration([tool('known_tool')]),
      errorContractOverrides: { missing_tool: 'json_v1' },
    }])).toThrow(/override.*unknown tool/i);

    expect(() => buildMcpToolRegistry([{
      ...registration([tool('known_tool')]),
      errorContractOverrides: { known_tool: 'future_contract' as never },
    }])).toThrow(/unsupported.*override/i);
  });

  it('fails fast on invalid object schemas and properties maps', () => {
    expect(() => buildMcpToolRegistry([registration([{
      ...tool('wrong_type'),
      inputSchema: { type: 'string', properties: {} },
    }])])).toThrow(/inputSchema/i);

    expect(() => buildMcpToolRegistry([registration([{
      ...tool('missing_properties'),
      inputSchema: { type: 'object' },
    }])])).toThrow(/properties/i);

    expect(() => buildMcpToolRegistry([registration([{
      ...tool('array_properties'),
      inputSchema: { type: 'object', properties: [] },
    }])])).toThrow(/properties/i);
  });

  it('fails fast on ambiguous or undeclared workspace scope', () => {
    expect(() => buildMcpToolRegistry([
      registration([tool('dual_aliases', 'both')]),
    ])).toThrow(/workspaceId.*workspace_id/i);

    expect(() => buildMcpToolRegistry([
      registration([tool('undeclared_scope', 'none')]),
    ])).toThrow(/global/i);

    expect(() => buildMcpToolRegistry([
      registration([tool('bad_global')], ['bad_global']),
    ])).toThrow(/global.*workspace/i);

    expect(() => buildMcpToolRegistry([
      registration([tool('missing_global_declaration', 'none')], ['other_tool']),
    ])).toThrow(/global/i);
  });

  it('snapshots and deep-freezes definitions behind a runtime read-only view', () => {
    const source = tool('immutable_tool');
    const sourceProperties = source.inputSchema.properties as Record<string, unknown>;
    const registry = buildMcpToolRegistry([registration([source])]);
    const entry = registry.get('immutable_tool');
    expect(entry).toBeDefined();

    sourceProperties.workspaceId = { type: 'number' };
    source.description = 'mutated after registration';

    const registeredProperties = entry?.definition.inputSchema.properties as Record<string, unknown>;
    expect(registeredProperties.workspaceId).toEqual({
      type: 'string',
      description: 'Workspace ID.',
    });
    expect(entry?.definition.description).toBe('immutable_tool description');
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry?.definition)).toBe(true);
    expect(Object.isFrozen(entry?.definition.inputSchema)).toBe(true);
    expect(Object.isFrozen(registeredProperties.workspaceId)).toBe(true);
    expect('set' in registry).toBe(false);

    expect(() => {
      registeredProperties.workspaceId = { type: 'boolean' };
    }).toThrow();
    expect(registry.get('immutable_tool')?.workspaceField).toBe('workspaceId');
  });

  it('returns a frozen discovery snapshot whose schemas cannot drift after listing', () => {
    const definitions = listMcpToolDefinitions();
    const overview = definitions.find(item => item.name === 'get_workspace_overview');
    expect(overview).toBeDefined();
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(Object.isFrozen(overview)).toBe(true);
    expect(Object.isFrozen(overview?.inputSchema)).toBe(true);
    expect(() => definitions.push(tool('injected'))).toThrow();
  });

  it('rejects unbranded json_v1 handler errors but accepts sanitized helper results', async () => {
    const rawError = {
      isError: true,
      content: [{ type: 'text' as const, text: '{"code":"conflict","message":"raw"}' }],
    };
    const handler = vi.fn(async (name: string) => (
      name === 'valid_json'
        ? mcpJsonV1Error({
            code: MCP_TOOL_ERROR_CODES.CONFLICT,
            message: 'The source revision changed.',
            retryable: true,
          })
        : rawError
    ));
    const registry = buildMcpToolRegistry([{
      family: 'json-family',
      tools: [tool('raw_json'), tool('valid_json')],
      handler,
      errorContract: 'json_v1',
    }]);
    const execute = createMcpToolExecutor(registry);
    logger.error.mockClear();

    const raw = await execute({
      name: 'raw_json',
      args: { workspaceId: 'ws-1' },
      auth: masterAuth,
      requestId: 'request-raw',
    });
    expect(JSON.parse(parseErrorText(raw))).toEqual({
      code: 'internal_error',
      message: 'The tool could not complete because of an internal error.',
      retryable: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      { tool: 'raw_json', failureClass: 'unvalidated_json_v1_error_result' },
      'MCP json_v1 handler returned an unvalidated error result',
    );

    const valid = await execute({
      name: 'valid_json',
      args: { workspaceId: 'ws-1' },
      auth: masterAuth,
      requestId: 'request-valid',
    });
    expect(JSON.parse(parseErrorText(valid))).toEqual({
      code: 'conflict',
      message: 'The source revision changed.',
      retryable: true,
    });
  });

  it('uses stable json_v1 scope and thrown-error envelopes while preserving legacy throws', async () => {
    const secret = 'must-not-reach-response-or-registry-log';
    const throwingHandler = vi.fn(async () => {
      throw new Error(secret);
    });
    const jsonRegistry = buildMcpToolRegistry([{
      family: 'json-family',
      tools: [tool('json_throw'), tool('json_scope')],
      handler: throwingHandler,
      errorContract: 'json_v1',
    }]);
    const executeJson = createMcpToolExecutor(jsonRegistry);
    logger.error.mockClear();

    const thrown = await executeJson({
      name: 'json_throw',
      args: { workspaceId: 'ws-1' },
      auth: masterAuth,
      requestId: 'request-throw',
    });
    expect(parseErrorText(thrown)).not.toContain(secret);
    expect(JSON.parse(parseErrorText(thrown))).toMatchObject({
      code: 'internal_error',
      retryable: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      { tool: 'json_throw', failureClass: 'handler_exception' },
      'Unexpected MCP json_v1 tool execution failure',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);

    const forbidden = await executeJson({
      name: 'json_scope',
      args: { workspaceId: 'ws-other' },
      auth: {
        scope: 'ws-owned',
        keyId: 'key-1',
        label: 'Workspace key',
      },
      requestId: 'request-scope',
    });
    expect(JSON.parse(parseErrorText(forbidden))).toEqual({
      code: 'forbidden',
      message: 'This API key cannot operate on the requested workspace.',
      retryable: false,
    });
    expect(throwingHandler).toHaveBeenCalledTimes(1);

    const legacyRegistry = buildMcpToolRegistry([{
      family: 'legacy-family',
      tools: [tool('legacy_throw')],
      handler: throwingHandler,
      errorContract: 'legacy_text',
    }]);
    const executeLegacy = createMcpToolExecutor(legacyRegistry);
    const logCallsBeforeLegacyThrow = logger.error.mock.calls.length;
    await expect(executeLegacy({
      name: 'legacy_throw',
      args: { workspaceId: 'ws-1' },
      auth: masterAuth,
      requestId: 'request-legacy',
    })).rejects.toThrow(secret);
    expect(logger.error).toHaveBeenCalledTimes(logCallsBeforeLegacyThrow);
  });

  it('does not log or reflect caller-controlled tool/workspace values on scope rejection', async () => {
    const workspaceSecret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
    const registry = buildMcpToolRegistry([registration([tool('safe_scoped_tool')])]);
    const execute = createMcpToolExecutor(registry);
    logger.warn.mockClear();

    const forbidden = await execute({
      name: 'safe_scoped_tool',
      args: { workspaceId: workspaceSecret },
      auth: { scope: 'ws-owned', keyId: 'key-1', label: 'Workspace key' },
      requestId: 'server-request-id',
    });

    expect(parseErrorText(forbidden)).not.toContain(workspaceSecret);
    expect(logger.warn).toHaveBeenCalledWith(
      { tool: 'safe_scoped_tool', failureClass: 'workspace_scope_mismatch' },
      'Workspace-scoped key attempted cross-workspace access — rejected',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(workspaceSecret);

    const unknownToolSecret = 'sk-proj-AbCdEf0123456789';
    const unknown = await execute({
      name: unknownToolSecret,
      args: {},
      auth: masterAuth,
      requestId: 'server-request-id',
    });
    expect(parseErrorText(unknown)).toBe('Unknown tool.');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(unknownToolSecret);
  });
});
