import { createHash } from 'node:crypto';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import { describe, expect, it, vi } from 'vitest';
import {
  MCP_OPERATOR_PROFILE_INSTRUCTIONS,
  MCP_OPERATOR_TOOL_DESCRIPTIONS,
  MCP_OPERATOR_TOOL_NAMES,
} from '../../server/mcp/profiles.js';
import { MCP_SERVER_INSTRUCTIONS } from '../../server/mcp/instructions.js';
import {
  buildMcpToolRegistry,
  createMcpToolExecutor,
  listMcpToolDefinitions,
  type ExecuteMcpToolRequest,
  type McpToolRegistry,
} from '../../server/mcp/tool-registry.js';
import {
  MCP_SERVER_PROFILES,
  type McpServerProfile,
} from '../../shared/types/mcp-runtime.js';

const registryModule = await import('../../server/mcp/tool-registry.js') as unknown as {
  listMcpToolDefinitionsForProfile?: (profile: McpServerProfile) => Tool[];
};

const FULL_DISCOVERY_BYTES = 168_572;
const FULL_DISCOVERY_SHA256 = 'c1331459b2fa11e9dcbe2a6a88c13070c70998f12f560228ce4df309e56aa806';
const FULL_INSTRUCTIONS_BYTES = 12_151;
const FULL_INSTRUCTIONS_SHA256 = '6e7f8c0c6820bf1881377f5dfbeb7fdd414e1e9ea4048196d6d146e5354ef0f0';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);
const SCHEMA_VALUE_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
  );
}

function stripSchemaDescriptions(value: unknown): unknown {
  if (typeof value === 'boolean' || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripSchemaDescriptions);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'description')
      .map(([key, child]) => {
        if (SCHEMA_MAP_KEYWORDS.has(key) && child && typeof child === 'object' && !Array.isArray(child)) {
          return [key, Object.fromEntries(
            Object.entries(child).map(([mapKey, schema]) => [mapKey, stripSchemaDescriptions(schema)]),
          )];
        }
        if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(child)) {
          return [key, child.map(stripSchemaDescriptions)];
        }
        if (SCHEMA_VALUE_KEYWORDS.has(key)) {
          return [key, Array.isArray(child)
            ? child.map(stripSchemaDescriptions)
            : stripSchemaDescriptions(child)];
        }
        if (key === 'dependencies' && child && typeof child === 'object' && !Array.isArray(child)) {
          return [key, Object.fromEntries(
            Object.entries(child).map(([dependency, schemaOrNames]) => [
              dependency,
              Array.isArray(schemaOrNames)
                ? cloneJsonValue(schemaOrNames)
                : stripSchemaDescriptions(schemaOrNames),
            ]),
          )];
        }
        return [key, cloneJsonValue(child)];
      }),
  );
}

function expandLocalSchemaRefs(schema: unknown): unknown {
  const definitions = new Map<string, Record<string, unknown>>();
  const indexDefinitions = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(indexDefinitions);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.$id === 'string') definitions.set(node.$id, node);
    Object.values(node).forEach(indexDefinitions);
  };
  indexDefinitions(schema);

  const expand = (value: unknown, resolving = new Set<string>()): unknown => {
    if (Array.isArray(value)) return value.map(child => expand(child, resolving));
    if (value === null || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (typeof node.$ref === 'string') {
      const definitionId = node.$ref;
      const target = definitions.get(definitionId);
      if (!target || resolving.has(definitionId)) {
        throw new Error(`Invalid compact schema ref: ${node.$ref}`);
      }
      return expand(target, new Set([...resolving, definitionId]));
    }
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'definitions' && key !== '$id')
        .map(([key, child]) => [key, expand(child, resolving)]),
    );
  };
  return expand(schema);
}

function objectRecord(value: unknown): Record<string, unknown> {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function expectDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

function operatorDefinitions(): Tool[] {
  expect(registryModule.listMcpToolDefinitionsForProfile).toBeTypeOf('function');
  return registryModule.listMcpToolDefinitionsForProfile!(MCP_SERVER_PROFILES.OPERATOR);
}

function parseJsonV1(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).toBe(true);
  expect(result.content).toHaveLength(1);
  const first = result.content[0];
  expect(first?.type).toBe('text');
  return JSON.parse(first?.type === 'text' ? first.text : '{}') as Record<string, unknown>;
}

describe('MCP compact operator profile contract', () => {
  it('activates all 25 unique operator names after P2', () => {
    expect(MCP_OPERATOR_TOOL_NAMES).toHaveLength(25);
    expect(new Set(MCP_OPERATOR_TOOL_NAMES).size).toBe(25);

    const registered = new Set(listMcpToolDefinitions().map(definition => definition.name));
    const activeNames = MCP_OPERATOR_TOOL_NAMES.filter(name => registered.has(name));
    const reservedNames = MCP_OPERATOR_TOOL_NAMES.filter(name => !registered.has(name));

    expect(activeNames).toHaveLength(25);
    expect(new Set(activeNames).size).toBe(25);
    expect(reservedNames).toEqual([]);
  });

  it('preserves the exact full discovery and instruction byte baselines', () => {
    const fullJson = JSON.stringify(listMcpToolDefinitions());
    expect(Buffer.byteLength(fullJson, 'utf8')).toBe(FULL_DISCOVERY_BYTES);
    expect(sha256(fullJson)).toBe(FULL_DISCOVERY_SHA256);

    expect(Buffer.byteLength(MCP_SERVER_INSTRUCTIONS, 'utf8')).toBe(FULL_INSTRUCTIONS_BYTES);
    expect(sha256(MCP_SERVER_INSTRUCTIONS)).toBe(FULL_INSTRUCTIONS_SHA256);
  });

  it('keeps zero-argument full discovery unchanged and returns only the registered operator intersection', () => {
    const canonicalFull = listMcpToolDefinitions();
    const expectedNames = canonicalFull
      .map(definition => definition.name)
      .filter(name => (MCP_OPERATOR_TOOL_NAMES as readonly string[]).includes(name));
    const projected = operatorDefinitions();

    expect(projected).toHaveLength(25);
    expect(new Set(projected.map(definition => definition.name)).size).toBe(25);
    expect(projected.map(definition => definition.name)).toEqual(expectedNames);
    expect(listMcpToolDefinitions()).toEqual(canonicalFull);
  });

  it('uses compact explicit prose and removes only nested schema descriptions without mutating canonical definitions', () => {
    const canonical = listMcpToolDefinitions();
    const canonicalJsonBefore = JSON.stringify(canonical);
    const canonicalByName = new Map(canonical.map(definition => [definition.name, definition]));
    const projected = operatorDefinitions();

    expect(projected.length).toBeGreaterThan(0);
    expectDeeplyFrozen(projected);
    expect(() => projected.push(projected[0]!)).toThrow(TypeError);
    for (const definition of projected) {
      const canonicalDefinition = canonicalByName.get(definition.name);
      expect(canonicalDefinition, `missing canonical ${definition.name}`).toBeDefined();
      expect(definition.description).toBe(
        MCP_OPERATOR_TOOL_DESCRIPTIONS[
          definition.name as keyof typeof MCP_OPERATOR_TOOL_DESCRIPTIONS
        ],
      );
      expect(expandLocalSchemaRefs(definition.inputSchema)).toEqual(
        stripSchemaDescriptions(canonicalDefinition!.inputSchema),
      );
      if (canonicalDefinition!.outputSchema) {
        expect(definition.outputSchema).toEqual(
          stripSchemaDescriptions(canonicalDefinition!.outputSchema),
        );
      }
    }

    const createTemplate = projected.find(
      definition => definition.name === 'create_content_template',
    );
    expect(createTemplate).toBeDefined();
    const rootProperties = objectRecord(createTemplate!.inputSchema.properties);
    const templateSchema = objectRecord(rootProperties.template);
    const templateProperties = objectRecord(templateSchema.properties);
    expect(templateProperties).toHaveProperty('description');
    const variablesSchema = objectRecord(templateProperties.variables);
    const variableItemSchema = objectRecord(variablesSchema.items);
    expect(objectRecord(variableItemSchema.properties)).toHaveProperty('description');

    expect(JSON.stringify(listMcpToolDefinitions())).toBe(canonicalJsonBefore);
  });

  it('fits exact serialized operator discovery plus compact instructions within 32 KiB', () => {
    const projected = operatorDefinitions();
    const bytes = Buffer.byteLength(JSON.stringify(projected), 'utf8')
      + Buffer.byteLength(MCP_OPERATOR_PROFILE_INSTRUCTIONS, 'utf8');

    expect(projected).toHaveLength(25);
    expect(bytes).toBeLessThanOrEqual(32 * 1024);
  });

  it('keeps the executor default/full path and blocks hidden tools before handler dispatch', async () => {
    const handler = vi.fn(async (name: string): Promise<CallToolResult> => ({
      content: [{ type: 'text', text: JSON.stringify({ name }) }],
    }));
    const registry = buildMcpToolRegistry([{
      family: 'operator-profile-fixture',
      tools: [
        {
          name: 'list_workspaces',
          description: 'Allowed operator fixture.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'get_workspace_overview',
          description: 'Registered but hidden operator fixture.',
          inputSchema: {
            type: 'object',
            properties: { workspaceId: { type: 'string' } },
            required: ['workspaceId'],
          },
        },
      ],
      handler,
      globalToolNames: ['list_workspaces'],
      errorContract: 'json_v1',
    }]);
    const executorFactory = createMcpToolExecutor as unknown as (
      targetRegistry: McpToolRegistry,
      profile?: McpServerProfile,
    ) => (request: ExecuteMcpToolRequest) => Promise<CallToolResult>;
    const full = executorFactory(registry);
    const explicitFull = executorFactory(registry, MCP_SERVER_PROFILES.FULL);
    const operator = executorFactory(registry, MCP_SERVER_PROFILES.OPERATOR);
    const baseRequest = {
      auth: { scope: 'all' as const },
      requestId: 'operator-profile-unit-test',
    };

    await expect(full({ ...baseRequest, name: 'get_workspace_overview', args: { workspaceId: 'ws-1' } }))
      .resolves.toEqual({
        content: [{ type: 'text', text: JSON.stringify({ name: 'get_workspace_overview' }) }],
      });
    await expect(explicitFull({ ...baseRequest, name: 'get_workspace_overview', args: { workspaceId: 'ws-1' } }))
      .resolves.toEqual({
        content: [{ type: 'text', text: JSON.stringify({ name: 'get_workspace_overview' }) }],
      });
    expect(handler).toHaveBeenCalledTimes(2);

    const sentinelCollision = await full({
      auth: { scope: 'all', keyId: 'key-sentinel-collision', label: 'Workspace named all' },
      requestId: baseRequest.requestId,
      name: 'get_workspace_overview',
      args: { workspaceId: 'ws-other' },
    });
    expect(parseJsonV1(sentinelCollision)).toEqual({
      code: 'forbidden',
      message: 'This API key cannot operate on the requested workspace.',
      retryable: false,
    });
    expect(handler).toHaveBeenCalledTimes(2);

    const notFoundEnvelope = {
      code: 'not_found',
      message: 'The requested tool does not exist.',
      retryable: false,
    };
    for (const name of [
      'get_workspace_overview',
      'get_portfolio_brief',
      'whsec_abcdefghijklmnopqrstuvwxyz',
    ]) {
      const hidden = await operator({
        ...baseRequest,
        name,
        args: { workspaceId: 'ws-1', workspace_id: 'ws-2' },
      });
      expect(parseJsonV1(hidden)).toEqual(notFoundEnvelope);
    }
    expect(handler).toHaveBeenCalledTimes(2);

    await expect(operator({ ...baseRequest, name: 'list_workspaces', args: {} }))
      .resolves.toEqual({
        content: [{ type: 'text', text: JSON.stringify({ name: 'list_workspaces' }) }],
      });
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
