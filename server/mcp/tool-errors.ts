import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import type { ZodError } from 'zod';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolErrorEnvelope,
} from '../../shared/types/mcp-runtime.js';

export const MCP_TOOL_ERROR_CONTRACTS = Object.freeze({
  LEGACY_TEXT: 'legacy_text',
  JSON_V1: 'json_v1',
} as const);

export type McpToolErrorContract =
  (typeof MCP_TOOL_ERROR_CONTRACTS)[keyof typeof MCP_TOOL_ERROR_CONTRACTS];

export type McpToolErrorDetailScalar = string | number | boolean | null;

export type McpToolErrorDetailValue =
  | McpToolErrorDetailScalar
  | readonly McpToolErrorDetailValue[]
  | { readonly [key: string]: McpToolErrorDetailValue };

export type McpToolErrorDetails = Readonly<Record<string, McpToolErrorDetailValue>>;

export interface McpToolErrorDescriptor<
  TDetails extends McpToolErrorDetails = McpToolErrorDetails,
> {
  /** Exact historical text for a legacy tool. Never pass an Error or raw input. */
  readonly legacyText: string;
  /** Stable, client-safe contract used by new json_v1 tools. */
  readonly envelope: McpToolErrorEnvelope<TDetails>;
}

const MAX_DETAIL_DEPTH = 4;
const MAX_DETAIL_ENTRIES = 100;
const MAX_DETAIL_ITEMS = 50;
const MAX_DETAIL_KEY_LENGTH = 100;
const MAX_DETAIL_STRING_LENGTH = 1_000;
const MAX_MESSAGE_LENGTH = 500;

const JSON_V1_ERROR_RESULTS = new WeakSet<object>();
const SUPPORTED_ERROR_CODES = new Set(Object.values(MCP_TOOL_ERROR_CODES));

const PROHIBITED_DETAIL_KEY_PARTS = new Set([
  'api_key',
  'auth',
  'argument',
  'arguments',
  'args',
  'authorization',
  'bearer',
  'cookie',
  'credential',
  'credentials',
  'error',
  'evidence',
  'key',
  'key_hash',
  'password',
  'plaintext',
  'plaintext_key',
  'private',
  'private_key',
  'prompt',
  'raw',
  'secret',
  'stack',
  'system_prompt',
  'token',
  'user_prompt',
]);

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[^\s,;]+/giu,
  /\bmcp_[A-Za-z0-9_-]{12,}\b/gu,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gu,
];

function normalizedKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
}

function isProhibitedDetailKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (PROHIBITED_DETAIL_KEY_PARTS.has(normalized)) return true;
  return normalized
    .split('_')
    .some(part => PROHIBITED_DETAIL_KEY_PARTS.has(part));
}

function redactLikelySecrets(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (safe, pattern) => safe.replace(pattern, '[REDACTED]'),
    value,
  );
}

function boundedPublicString(value: string, maxLength: number): string {
  const redacted = redactLikelySecrets(value);
  return redacted.length <= maxLength
    ? redacted
    : `${redacted.slice(0, maxLength - 1)}…`;
}

function sanitizeDetailValue(
  value: McpToolErrorDetailValue,
  depth: number,
  state: { readonly seen: WeakSet<object>; remainingEntries: number },
): McpToolErrorDetailValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return boundedPublicString(value, MAX_DETAIL_STRING_LENGTH);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || value instanceof Error || depth >= MAX_DETAIL_DEPTH) {
    return undefined;
  }
  if (state.seen.has(value)) return undefined;
  state.seen.add(value);

  if (Array.isArray(value)) {
    const sanitized: McpToolErrorDetailValue[] = [];
    for (const item of value.slice(0, MAX_DETAIL_ITEMS)) {
      if (state.remainingEntries <= 0) break;
      state.remainingEntries -= 1;
      const safeItem = sanitizeDetailValue(item, depth + 1, state);
      if (safeItem !== undefined) sanitized.push(safeItem);
    }
    return sanitized;
  }

  const sanitized: Record<string, McpToolErrorDetailValue> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_DETAIL_ITEMS)) {
    if (
      state.remainingEntries <= 0
      || key.length > MAX_DETAIL_KEY_LENGTH
      || isProhibitedDetailKey(key)
    ) {
      continue;
    }
    state.remainingEntries -= 1;
    const safeItem = sanitizeDetailValue(item, depth + 1, state);
    if (safeItem !== undefined) sanitized[key] = safeItem;
  }
  return sanitized;
}

function sanitizeDetails<TDetails extends McpToolErrorDetails>(
  details: TDetails | undefined,
): McpToolErrorDetails | undefined {
  if (!details) return undefined;
  const sanitized = sanitizeDetailValue(details, 0, {
    seen: new WeakSet(),
    remainingEntries: MAX_DETAIL_ENTRIES,
  });
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') {
    return undefined;
  }
  return Object.keys(sanitized).length > 0
    ? sanitized as McpToolErrorDetails
    : undefined;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function genericJsonV1Envelope(): McpToolErrorEnvelope {
  return {
    code: MCP_TOOL_ERROR_CODES.INTERNAL_ERROR,
    message: 'The tool could not complete because of an internal error.',
    retryable: false,
  };
}

function isValidEnvelope(envelope: McpToolErrorEnvelope<McpToolErrorDetails>): boolean {
  return (
    envelope !== null
    && typeof envelope === 'object'
    && SUPPORTED_ERROR_CODES.has(envelope.code)
    && typeof envelope.message === 'string'
    && envelope.message.length > 0
    && typeof envelope.retryable === 'boolean'
  );
}

/**
 * Build the stable error payload for all new json_v1 tools.
 *
 * This boundary deliberately accepts a typed, public envelope rather than an
 * unknown exception. Sensitive/raw diagnostic material belongs in structured
 * server logs, never in an MCP response. Detail keys are filtered recursively
 * as defense in depth and likely bearer/API-key values are redacted.
 */
export function mcpJsonV1Error<TDetails extends McpToolErrorDetails>(
  envelope: McpToolErrorEnvelope<TDetails>,
): CallToolResult {
  const publicEnvelope = isValidEnvelope(envelope)
    ? envelope
    : genericJsonV1Envelope();
  const details = sanitizeDetails(publicEnvelope.details);
  const safeEnvelope: McpToolErrorEnvelope<McpToolErrorDetails> = {
    code: publicEnvelope.code,
    message: boundedPublicString(publicEnvelope.message, MAX_MESSAGE_LENGTH),
    retryable: publicEnvelope.retryable,
    ...(details ? { details } : {}),
  };

  const result: CallToolResult = {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(safeEnvelope) }],
  };
  JSON_V1_ERROR_RESULTS.add(result);
  return deepFreeze(result);
}

function zodFieldPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return 'input';
  return path.reduce<string>((result, segment) => (
    typeof segment === 'number'
      ? `${result}[${segment}]`
      : result.length > 0
        ? `${result}.${segment}`
        : segment
  ), '');
}

/** Public, field-addressed validation error without echoing rejected input. */
export function mcpZodValidationError(error: ZodError): CallToolResult {
  const issue = error.issues[0];
  const issuePath = issue?.path.length
    ? issue.path
    : issue?.code === 'unrecognized_keys'
      ? [issue.keys[0] ?? 'input']
      : [];
  const fieldPath = zodFieldPath(issuePath);
  const constraint = issue?.message ?? 'The supplied value is invalid.';
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
    message: `Invalid tool input at ${fieldPath}: ${constraint}`,
    retryable: false,
    details: {
      field_path: fieldPath,
      constraint,
      issue_code: issue?.code ?? 'invalid_input',
    },
  });
}

/**
 * Runtime proof that a json_v1 error crossed the sanitizing constructor.
 *
 * The private WeakSet cannot be recreated by copying JSON or spreading a
 * result, and the constructor deep-freezes branded results before returning.
 */
export function isValidatedMcpJsonV1ErrorResult(
  result: unknown,
): result is CallToolResult {
  return (
    result !== null
    && typeof result === 'object'
    && JSON_V1_ERROR_RESULTS.has(result)
  );
}

/** Select a registered tool's compatibility contract at the MCP boundary. */
export function mcpToolError<TDetails extends McpToolErrorDetails>(
  contract: McpToolErrorContract,
  descriptor: McpToolErrorDescriptor<TDetails>,
): CallToolResult {
  if (contract === MCP_TOOL_ERROR_CONTRACTS.LEGACY_TEXT) {
    return {
      isError: true,
      content: [{ type: 'text', text: descriptor.legacyText }],
    };
  }
  return mcpJsonV1Error(descriptor.envelope);
}

/**
 * Convert an unexpected failure without accepting the thrown value. Callers
 * log only a safe failure classification, so neither the response nor registry
 * logs can echo exception text, stack data, or raw inputs.
 */
export function mcpUnexpectedToolError(
  contract: McpToolErrorContract,
): CallToolResult {
  return mcpToolError(contract, {
    legacyText: 'Internal error: tool execution failed.',
    envelope: {
      code: MCP_TOOL_ERROR_CODES.INTERNAL_ERROR,
      message: 'The tool could not complete because of an internal error.',
      retryable: false,
    },
  });
}
