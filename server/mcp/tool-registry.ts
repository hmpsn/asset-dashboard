import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import type {
  McpServerProfile,
  McpToolDefinition,
  McpToolExecutionContext,
} from '../../shared/types/mcp-runtime.js';
import {
  MCP_SERVER_PROFILES,
  MCP_TOOL_ERROR_CODES,
} from '../../shared/types/mcp-runtime.js';
import { createLogger } from '../logger.js';
import { isMcpMasterKeyAuth, type McpAuthContext } from './auth.js';
import {
  MCP_TOOL_ERROR_CONTRACTS,
  type McpToolErrorContract,
  isValidatedMcpJsonV1ErrorResult,
  mcpToolError,
  mcpUnexpectedToolError,
} from './tool-errors.js';
import { runWithMcpToolExecutionContext } from './tool-execution-context.js';
import {
  isMcpToolAllowedInProfile,
  operatorToolDescription,
  type McpOperatorToolName,
} from './profiles.js';
import { workspaceTools, handleWorkspaceTool } from './tools/workspaces.js';
import { intelligenceTools, handleIntelligenceTool } from './tools/intelligence.js';
import { insightTools, handleInsightTool } from './tools/insights.js';
import { contentTools, handleContentTool } from './tools/content.js';
import { brandTools, handleBrandTool } from './tools/brand.js';
import { clientTools, handleClientTool } from './tools/clients.js';
import { keywordActionTools, handleKeywordActionTool } from './tools/keyword-actions.js';
import { contentActionTools, handleContentActionTool } from './tools/content-actions.js';
import {
  recommendationActionTools,
  handleRecommendationActionTool,
} from './tools/recommendation-actions.js';
import {
  contentGenerationActionTools,
  handleContentGenerationActionTool,
} from './tools/content-generation-actions.js';
import {
  CONTENT_MATRIX_GLOBAL_TOOL_NAMES,
  contentMatrixActionTools,
  handleContentMatrixActionTool,
} from './tools/content-matrix-actions.js';
import {
  brandIntakeActionTools,
  handleBrandIntakeActionTool,
} from './tools/brand-intake-actions.js';
import {
  brandVoiceActionTools,
  handleBrandVoiceActionTool,
} from './tools/brand-voice-actions.js';
import {
  brandGenerationActionTools,
  handleBrandGenerationActionTool,
} from './tools/brand-generation-actions.js';
import {
  brandContentOnboardingActionTools,
  handleBrandContentOnboardingActionTool,
} from './tools/brand-content-onboarding-actions.js';
import { schemaActionTools, handleSchemaActionTool } from './tools/schema-actions.js';
import {
  analyticsReadActionTools,
  handleAnalyticsReadActionTool,
} from './tools/analytics-read-actions.js';
import { jobActionTools, handleJobActionTool } from './tools/job-actions.js';

const log = createLogger('mcp-tool-registry');

export type McpWorkspaceField = 'workspaceId' | 'workspace_id';
export type McpToolScope = 'global' | 'workspace';

export type McpToolFamilyHandler = (
  name: string,
  args: Record<string, unknown>,
  context: McpToolExecutionContext,
) => Promise<CallToolResult>;

export interface McpToolFamilyRegistration {
  readonly family: string;
  readonly tools: readonly Tool[];
  readonly handler: McpToolFamilyHandler;
  readonly globalToolNames?: readonly string[];
  readonly errorContract: McpToolErrorContract;
  /** Narrow opt-in for a new json_v1 tool inside an otherwise legacy family. */
  readonly errorContractOverrides?: Readonly<Record<string, McpToolErrorContract>>;
}

export interface McpToolRegistryEntry {
  readonly definition: McpToolDefinition<Tool['inputSchema']>;
  readonly family: string;
  readonly handler: McpToolFamilyHandler;
  readonly scope: McpToolScope;
  readonly workspaceField?: McpWorkspaceField;
  readonly errorContract: McpToolErrorContract;
}

/** Runtime read-only facade: no mutable Map reference escapes the builder. */
export interface McpToolRegistry extends Iterable<readonly [string, McpToolRegistryEntry]> {
  readonly size: number;
  get(name: string): McpToolRegistryEntry | undefined;
  has(name: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<McpToolRegistryEntry>;
  entries(): IterableIterator<readonly [string, McpToolRegistryEntry]>;
}

export interface ExecuteMcpToolRequest {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly auth: McpAuthContext;
  readonly requestId: string;
}

const WORKSPACE_FIELDS = ['workspaceId', 'workspace_id'] as const;

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertInputSchema(tool: Tool): Record<string, unknown> {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`MCP tool "${tool.name}" inputSchema must be an object.`);
  }

  const objectSchema = schema as Record<string, unknown>;
  if (objectSchema.type !== 'object') {
    throw new Error(`MCP tool "${tool.name}" inputSchema.type must be "object".`);
  }

  const properties = objectSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`MCP tool "${tool.name}" inputSchema.properties must be an object.`);
  }

  return properties as Record<string, unknown>;
}

function workspaceFields(properties: Record<string, unknown>): McpWorkspaceField[] {
  return WORKSPACE_FIELDS.filter(field => hasOwn(properties, field));
}

function snapshotValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;

  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(snapshotValue(item, seen));
    return Object.freeze(copy) as T;
  }

  const copy: Record<PropertyKey, unknown> = {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) continue;
    copy[key] = snapshotValue(descriptor.value, seen);
  }
  return Object.freeze(copy) as T;
}

function snapshotDefinition(
  definition: Tool,
): McpToolDefinition<Tool['inputSchema']> {
  return snapshotValue(definition) as McpToolDefinition<Tool['inputSchema']>;
}

function readonlyRegistryView(
  registry: ReadonlyMap<string, McpToolRegistryEntry>,
): McpToolRegistry {
  const view: McpToolRegistry = {
    size: registry.size,
    get: name => registry.get(name),
    has: name => registry.has(name),
    keys: () => registry.keys(),
    values: () => registry.values(),
    entries: () => registry.entries(),
    [Symbol.iterator]: () => registry.entries(),
  };
  return Object.freeze(view);
}

/**
 * Build and validate one canonical MCP registry.
 *
 * Validation happens eagerly at module load for the production registrations,
 * so discovery, authorization, and dispatch cannot silently drift apart.
 */
export function buildMcpToolRegistry(
  registrations: readonly McpToolFamilyRegistration[],
): McpToolRegistry {
  const registry = new Map<string, McpToolRegistryEntry>();
  const registeredFamilies = new Set<string>();
  const supportedErrorContracts = new Set<McpToolErrorContract>(
    Object.values(MCP_TOOL_ERROR_CONTRACTS),
  );

  for (const registration of registrations) {
    if (typeof registration.family !== 'string' || registration.family.length === 0) {
      throw new Error('MCP tool family identifiers must be non-empty strings.');
    }
    if (registeredFamilies.has(registration.family)) {
      throw new Error(`Duplicate MCP tool family: ${registration.family}`);
    }
    registeredFamilies.add(registration.family);

    if (typeof registration.handler !== 'function') {
      throw new Error(`MCP tool family "${registration.family}" is missing a callable handler.`);
    }
    if (!supportedErrorContracts.has(registration.errorContract)) {
      throw new Error(
        `MCP tool family "${registration.family}" declares an unsupported error contract.`,
      );
    }

    const declaredGlobals = new Set(registration.globalToolNames ?? []);
    const familyToolNames = new Set(registration.tools.map(tool => tool.name));
    for (const globalName of declaredGlobals) {
      if (!familyToolNames.has(globalName)) {
        throw new Error(
          `MCP tool family "${registration.family}" declares unknown global tool "${globalName}".`,
        );
      }
    }

    const errorContractOverrides = registration.errorContractOverrides;
    if (
      errorContractOverrides !== undefined
      && (
        errorContractOverrides === null
        || typeof errorContractOverrides !== 'object'
        || Array.isArray(errorContractOverrides)
      )
    ) {
      throw new Error(
        `MCP tool family "${registration.family}" error-contract overrides must be an object.`,
      );
    }
    for (const [toolName, contract] of Object.entries(errorContractOverrides ?? {})) {
      if (!familyToolNames.has(toolName)) {
        throw new Error(
          `MCP tool family "${registration.family}" declares an error-contract override for unknown tool "${toolName}".`,
        );
      }
      if (!supportedErrorContracts.has(contract)) {
        throw new Error(
          `MCP tool "${toolName}" declares an unsupported error-contract override.`,
        );
      }
    }

    for (const definition of registration.tools) {
      if (!definition || typeof definition.name !== 'string' || definition.name.length === 0) {
        throw new Error(`MCP tool family "${registration.family}" contains a tool without a name.`);
      }
      if (
        typeof definition.description !== 'string'
        || definition.description.trim().length === 0
      ) {
        throw new Error(`MCP tool "${definition.name}" must declare a non-empty description.`);
      }
      if (registry.has(definition.name)) {
        throw new Error(`Duplicate MCP tool name: ${definition.name}`);
      }

      const properties = assertInputSchema(definition);
      const fields = workspaceFields(properties);
      if (fields.length === 2) {
        throw new Error(
          `MCP tool "${definition.name}" must not declare both workspaceId and workspace_id.`,
        );
      }

      const isGlobal = declaredGlobals.has(definition.name);
      if (isGlobal && fields.length > 0) {
        throw new Error(
          `Global MCP tool "${definition.name}" must not declare a workspace field.`,
        );
      }
      if (!isGlobal && fields.length === 0) {
        throw new Error(
          `MCP tool "${definition.name}" has no workspace field and must be explicitly declared global.`,
        );
      }

      const definitionSnapshot = snapshotDefinition(definition);
      const resolvedErrorContract = errorContractOverrides?.[definition.name]
        ?? registration.errorContract;
      registry.set(definition.name, Object.freeze({
        definition: definitionSnapshot,
        family: registration.family,
        handler: registration.handler,
        scope: isGlobal ? 'global' : 'workspace',
        ...(fields[0] ? { workspaceField: fields[0] } : {}),
        errorContract: resolvedErrorContract,
      }));
    }
  }

  return readonlyRegistryView(registry);
}

const jsonV1Contract = MCP_TOOL_ERROR_CONTRACTS.JSON_V1;

const MCP_TOOL_FAMILY_REGISTRATIONS: readonly McpToolFamilyRegistration[] = Object.freeze([
  {
    family: 'workspaces',
    tools: workspaceTools,
    handler: handleWorkspaceTool,
    globalToolNames: ['create_workspace', 'list_workspaces'],
    errorContract: jsonV1Contract,
  },
  {
    family: 'intelligence',
    tools: intelligenceTools,
    handler: handleIntelligenceTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'insights',
    tools: insightTools,
    handler: handleInsightTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'content',
    tools: contentTools,
    handler: handleContentTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'brand',
    tools: brandTools,
    handler: handleBrandTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'clients',
    tools: clientTools,
    handler: handleClientTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'keyword-actions',
    tools: keywordActionTools,
    handler: handleKeywordActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'content-actions',
    tools: contentActionTools,
    handler: handleContentActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'recommendation-actions',
    tools: recommendationActionTools,
    handler: handleRecommendationActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'content-generation-actions',
    tools: contentGenerationActionTools,
    handler: handleContentGenerationActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'content-matrix-actions',
    tools: contentMatrixActionTools,
    handler: handleContentMatrixActionTool,
    globalToolNames: CONTENT_MATRIX_GLOBAL_TOOL_NAMES,
    errorContract: jsonV1Contract,
  },
  {
    family: 'brand-intake-actions',
    tools: brandIntakeActionTools,
    handler: handleBrandIntakeActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'brand-voice-actions',
    tools: brandVoiceActionTools,
    handler: handleBrandVoiceActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'brand-generation-actions',
    tools: brandGenerationActionTools,
    handler: handleBrandGenerationActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'brand-content-onboarding-actions',
    tools: brandContentOnboardingActionTools,
    handler: handleBrandContentOnboardingActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'schema-actions',
    tools: schemaActionTools,
    handler: handleSchemaActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'analytics-read-actions',
    tools: analyticsReadActionTools,
    handler: handleAnalyticsReadActionTool,
    errorContract: jsonV1Contract,
  },
  {
    family: 'job-actions',
    tools: jobActionTools,
    handler: handleJobActionTool,
    errorContract: jsonV1Contract,
  },
]);

export const MCP_TOOL_REGISTRY = buildMcpToolRegistry(MCP_TOOL_FAMILY_REGISTRATIONS);

export function listMcpToolDefinitions(): Tool[] {
  return Object.freeze(
    [...MCP_TOOL_REGISTRY.values()].map(entry => entry.definition as Tool),
  ) as Tool[];
}

const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);

const SCHEMA_ARRAY_KEYWORDS = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
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

function snapshotSchemaMap<T>(
  value: T,
  seen: WeakMap<object, unknown>,
): T {
  if (value === null || typeof value !== 'object') return value;

  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;

  if (Array.isArray(value)) return snapshotValue(value, seen);

  const copy: Record<PropertyKey, unknown> = {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) continue;
    copy[key] = snapshotSchemaNode(descriptor.value, seen);
  }
  return Object.freeze(copy) as T;
}

function snapshotSchemaArray<T>(
  value: T,
  seen: WeakMap<object, unknown>,
): T {
  if (!Array.isArray(value)) return snapshotSchemaNode(value, seen);

  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;

  const copy: unknown[] = [];
  seen.set(value, copy);
  for (const item of value) copy.push(snapshotSchemaNode(item, seen));
  return Object.freeze(copy) as T;
}

function snapshotDependencies<T>(
  value: T,
  seen: WeakMap<object, unknown>,
): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return snapshotValue(value, seen);
  }

  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;

  const copy: Record<PropertyKey, unknown> = {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) continue;
    copy[key] = Array.isArray(descriptor.value)
      ? snapshotValue(descriptor.value, seen)
      : snapshotSchemaNode(descriptor.value, seen);
  }
  return Object.freeze(copy) as T;
}

/**
 * Compact one JSON Schema node without changing its validation contract.
 *
 * `description` is removed only when it is the annotation keyword on a schema
 * node. Schema-map entries are arbitrary caller field/definition names, so a
 * property literally named `description` must survive. Non-schema values such
 * as defaults, examples, const values, and enum members are copied verbatim.
 */
function snapshotSchemaNode<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (value === null || typeof value !== 'object') return value;

  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;
  if (Array.isArray(value)) return snapshotValue(value, seen);

  const copy: Record<PropertyKey, unknown> = {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'description') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) continue;

    if (typeof key === 'string' && SCHEMA_MAP_KEYWORDS.has(key)) {
      copy[key] = snapshotSchemaMap(descriptor.value, seen);
    } else if (typeof key === 'string' && SCHEMA_ARRAY_KEYWORDS.has(key)) {
      copy[key] = snapshotSchemaArray(descriptor.value, seen);
    } else if (typeof key === 'string' && SCHEMA_VALUE_KEYWORDS.has(key)) {
      copy[key] = snapshotSchemaArray(descriptor.value, seen);
    } else if (key === 'dependencies') {
      copy[key] = snapshotDependencies(descriptor.value, seen);
    } else {
      copy[key] = snapshotValue(descriptor.value, seen);
    }
  }
  return Object.freeze(copy) as T;
}

function operatorDefinition(definition: Tool): Tool {
  return snapshotValue({
    ...definition,
    description: operatorToolDescription(definition.name as McpOperatorToolName),
    inputSchema: snapshotSchemaNode(definition.inputSchema),
  });
}

const OPERATOR_TOOL_DEFINITIONS = Object.freeze(
  [...MCP_TOOL_REGISTRY.values()]
    .filter(entry => isMcpToolAllowedInProfile(
      MCP_SERVER_PROFILES.OPERATOR,
      entry.definition.name,
    ))
    .map(entry => operatorDefinition(entry.definition as Tool)),
) as Tool[];

/**
 * Return the immutable discovery surface for one server profile.
 *
 * The full profile intentionally delegates to the historical zero-argument
 * discovery function. The operator profile creates an independent compact
 * projection, so reducing its prose can never mutate the canonical catalog.
 */
export function listMcpToolDefinitionsForProfile(
  profile: McpServerProfile,
): Tool[] {
  if (profile === MCP_SERVER_PROFILES.FULL) return listMcpToolDefinitions();

  return OPERATOR_TOOL_DEFINITIONS;
}

export function getDeclaredWorkspaceField(
  toolName: string,
): McpWorkspaceField | undefined {
  return MCP_TOOL_REGISTRY.get(toolName)?.workspaceField;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function registeredContract(entry: McpToolRegistryEntry | undefined): McpToolErrorContract {
  return entry?.errorContract ?? MCP_TOOL_ERROR_CONTRACTS.LEGACY_TEXT;
}

function safeToolLogFields(
  entry: McpToolRegistryEntry | undefined,
): Readonly<{ tool: string } | { knownTool: false }> {
  return entry
    ? { tool: entry.definition.name }
    : { knownTool: false };
}

function validationError(contract: McpToolErrorContract): CallToolResult {
  return mcpToolError(contract, {
    legacyText: 'Validation failed: workspaceId and workspace_id must match when both are provided.',
    envelope: {
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: 'workspaceId and workspace_id must match when both are provided.',
      retryable: false,
    },
  });
}

function forbiddenError(
  contract: McpToolErrorContract,
  legacyText: string,
  message: string,
): CallToolResult {
  return mcpToolError(contract, {
    legacyText,
    envelope: {
      code: MCP_TOOL_ERROR_CODES.FORBIDDEN,
      message,
      retryable: false,
    },
  });
}

function operatorNotFoundError(): CallToolResult {
  return mcpToolError(MCP_TOOL_ERROR_CONTRACTS.JSON_V1, {
    legacyText: 'Unknown tool.',
    envelope: {
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'The requested tool does not exist.',
      retryable: false,
    },
  });
}

/** Build an executor around an immutable registry (production or isolated test fixture). */
export function createMcpToolExecutor(
  registry: McpToolRegistry,
  profile: McpServerProfile = MCP_SERVER_PROFILES.FULL,
): (request: ExecuteMcpToolRequest) => Promise<CallToolResult> {
  return request => {
    if (
      profile === MCP_SERVER_PROFILES.OPERATOR
      && (
        !isMcpToolAllowedInProfile(profile, request.name)
        || !registry.has(request.name)
      )
    ) {
      return Promise.resolve(operatorNotFoundError());
    }
    return executeRegisteredMcpTool(registry, request);
  };
}

/** Authorize, attribute, and dispatch one tool through the supplied registry. */
async function executeRegisteredMcpTool(
  registry: McpToolRegistry,
  request: ExecuteMcpToolRequest,
): Promise<CallToolResult> {
  const { name, args, auth, requestId } = request;
  const entry = registry.get(name);
  const contract = registeredContract(entry);
  const toolLogFields = safeToolLogFields(entry);
  const isMasterKey = isMcpMasterKeyAuth(auth);
  const camelWorkspaceId = readNonEmptyString(args.workspaceId);
  const snakeWorkspaceId = readNonEmptyString(args.workspace_id);

  if (
    camelWorkspaceId !== undefined
    && snakeWorkspaceId !== undefined
    && camelWorkspaceId !== snakeWorkspaceId
  ) {
    log.warn(
      { ...toolLogFields, failureClass: 'conflicting_workspace_aliases' },
      'MCP tool call supplied conflicting workspace aliases — rejected',
    );
    return validationError(contract);
  }

  const targetWorkspaceId = entry?.workspaceField
    ? readNonEmptyString(args[entry.workspaceField])
    : undefined;

  if (!isMasterKey) {
    if (
      typeof auth.keyId !== 'string'
      || auth.keyId.length === 0
      || typeof auth.label !== 'string'
      || auth.label.length === 0
    ) {
      log.warn(
        { ...toolLogFields, failureClass: 'incomplete_key_identity' },
        'Workspace-scoped MCP key identity is incomplete — rejected',
      );
      return forbiddenError(
        contract,
        'Forbidden: workspace-scoped API key identity is incomplete.',
        'The workspace-scoped API key identity is incomplete.',
      );
    }

    if (targetWorkspaceId === undefined) {
      log.warn(
        { ...toolLogFields, failureClass: 'missing_workspace_scope' },
        'Workspace-scoped key called a tool without a workspace_id argument — rejected',
      );
      return forbiddenError(
        contract,
        'Forbidden: this API key is scoped to a single workspace and cannot call a tool that is not workspace-scoped.',
        'This API key cannot call a tool without a matching workspace scope.',
      );
    }
    if (targetWorkspaceId !== auth.scope) {
      log.warn(
        { ...toolLogFields, failureClass: 'workspace_scope_mismatch' },
        'Workspace-scoped key attempted cross-workspace access — rejected',
      );
      return forbiddenError(
        contract,
        'Forbidden: this API key cannot operate on the requested workspace.',
        'This API key cannot operate on the requested workspace.',
      );
    }
  }

  if (!entry) {
    return mcpToolError(MCP_TOOL_ERROR_CONTRACTS.LEGACY_TEXT, {
      legacyText: 'Unknown tool.',
      envelope: {
        code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
        message: 'The requested tool does not exist.',
        retryable: false,
      },
    });
  }

  const context: McpToolExecutionContext = isMasterKey
    ? {
        requestId,
        toolName: name,
        targetWorkspaceId: targetWorkspaceId ?? null,
        caller: {
          kind: 'master_key',
          scope: 'all',
          keyId: null,
          keyLabel: null,
        },
      }
    : {
        requestId,
        toolName: name,
        targetWorkspaceId: targetWorkspaceId ?? null,
        caller: {
          kind: 'workspace_key',
          scope: auth.scope,
          workspaceId: auth.scope,
          keyId: auth.keyId as string,
          keyLabel: auth.label as string,
        },
      };

  try {
    const result = await runWithMcpToolExecutionContext(
      context,
      () => entry.handler(name, args, context),
    );
    if (
      entry.errorContract === MCP_TOOL_ERROR_CONTRACTS.JSON_V1
      && result.isError === true
      && !isValidatedMcpJsonV1ErrorResult(result)
    ) {
      log.error(
        { tool: name, failureClass: 'unvalidated_json_v1_error_result' },
        'MCP json_v1 handler returned an unvalidated error result',
      );
      return mcpUnexpectedToolError(entry.errorContract);
    }
    return result;
  } catch (err) {
    // The generic builder still supports isolated legacy compatibility fixtures;
    // production families use json_v1 and receive a safe envelope here.
    if (entry.errorContract === MCP_TOOL_ERROR_CONTRACTS.LEGACY_TEXT) throw err;
    log.error(
      { tool: name, failureClass: 'handler_exception' },
      'Unexpected MCP json_v1 tool execution failure',
    );
    return mcpUnexpectedToolError(entry.errorContract);
  }
}

/** Production executor backed by the canonical immutable registry snapshot. */
export const executeMcpTool = createMcpToolExecutor(MCP_TOOL_REGISTRY);

/** Compact operator executor with invocation-enforced allowlisting. */
export const executeOperatorMcpTool = createMcpToolExecutor(
  MCP_TOOL_REGISTRY,
  MCP_SERVER_PROFILES.OPERATOR,
);
