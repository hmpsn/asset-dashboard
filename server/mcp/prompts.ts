import {
  ErrorCode,
  McpError,
  type GetPromptResult,
  type Prompt,
} from '@modelcontextprotocol/sdk/types';
import {
  MCP_OPERATOR_PROMPT_NAMES,
  type McpOperatorPromptName,
} from '../../shared/types/mcp-prompts.js';

const WORKSPACE_ID_PATTERN = /^ws_[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const MATRIX_ID_PATTERN = /^mtx_[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const PROMPTS = deepFreeze<Prompt[]>([
  {
    name: 'triage_studio_portfolio',
    title: 'Triage studio portfolio',
    description: 'Read the bounded studio priority queue and propose a safe order of work.',
  },
  {
    name: 'review_workspace_as_client',
    title: 'Review workspace as client',
    description: 'Review exactly the client-safe workspace projection.',
    arguments: [
      {
        name: 'workspace_id',
        description: 'Workspace ID beginning with ws_.',
        required: true,
      },
    ],
  },
  {
    name: 'run_content_matrix_generation_safely',
    title: 'Run content matrix generation safely',
    description: 'Resolve and preview a matrix, then require fresh confirmation before paid work.',
    arguments: [
      {
        name: 'workspace_id',
        description: 'Workspace ID beginning with ws_.',
        required: true,
      },
      {
        name: 'matrix_id',
        description: 'Content matrix ID beginning with mtx_.',
        required: true,
      },
    ],
  },
]);

function invalidPromptArguments(): never {
  throw new McpError(ErrorCode.InvalidParams, 'Invalid prompt arguments.');
}

function ownDataRecord(value: unknown): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      invalidPromptArguments();
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalidPromptArguments();
    }

    const record = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') invalidPromptArguments();
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        invalidPromptArguments();
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    invalidPromptArguments();
  }
}

function parseArguments(
  name: McpOperatorPromptName,
  value: unknown,
): Record<string, string> {
  const record = ownDataRecord(value);
  const keys = Object.keys(record).sort();

  if (name === 'triage_studio_portfolio') {
    if (keys.length !== 0) invalidPromptArguments();
    return {};
  }

  const expectedKeys = name === 'review_workspace_as_client'
    ? ['workspace_id']
    : ['matrix_id', 'workspace_id'];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
  ) {
    invalidPromptArguments();
  }

  const workspaceId = record.workspace_id;
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    invalidPromptArguments();
  }

  if (name === 'review_workspace_as_client') return { workspace_id: workspaceId };

  const matrixId = record.matrix_id;
  if (typeof matrixId !== 'string' || !MATRIX_ID_PATTERN.test(matrixId)) {
    invalidPromptArguments();
  }
  return { workspace_id: workspaceId, matrix_id: matrixId };
}

function isOperatorPromptName(value: string): value is McpOperatorPromptName {
  return (MCP_OPERATOR_PROMPT_NAMES as readonly string[]).includes(value);
}

function userMessage(text: string, description: string): GetPromptResult {
  return deepFreeze({
    description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  });
}

export function listMcpOperatorPrompts(): Prompt[] {
  return PROMPTS;
}

export function getMcpOperatorPrompt(
  name: string,
  args: unknown,
): GetPromptResult {
  if (!isOperatorPromptName(name)) {
    throw new McpError(ErrorCode.InvalidParams, 'Unknown prompt.');
  }
  const parsed = parseArguments(name, args);

  if (name === 'triage_studio_portfolio') {
    return userMessage(
      `Triage the studio portfolio as a read-only workflow.

1. Call get_portfolio_brief with its default bounded limit.
2. Rank the returned workspaces only from its deterministic priority, reason codes, counts, and drill-down IDs.
3. Summarize the top work, why it matters, and the next safe read for each item. Distinguish unavailable data from an empty queue.
4. Do not mutate, send, approve, publish, or start paid work. If I ask to act, first show the exact proposed tool call and wait for separate confirmation.`,
      'Read the bounded portfolio queue and propose a safe order of work.',
    );
  }

  if (name === 'review_workspace_as_client') {
    return userMessage(
      `Review workspace ${parsed.workspace_id} from the client's point of view.

1. Call get_client_view with workspace_id ${parsed.workspace_id}. Treat it as the sole client-safe projection.
2. Explain what the client can see, what appears healthy, what needs attention, and which claims need clarification.
3. Do not substitute get_workspace_decision_brief, raw intelligence, admin learnings, prompts, or evidence when describing the client view.
4. Keep this workflow read-only. Do not mutate, send, approve, publish, or start paid work.`,
      'Review the exact client-safe workspace projection.',
    );
  }

  return userMessage(
    `Safely prepare content matrix ${parsed.matrix_id} in workspace ${parsed.workspace_id} for generation.

1. Read get_brand_voice, get_brand_identity, and get_content_matrix. Confirm finalized voice, approved identity, the current matrix revision, and the available cells. Ask me to choose the exact cells; do not infer a paid target.
2. Call resolve_content_matrix_cells for only those cells with their current expected source revisions. Always stop on blockers. Never invent evidence, facts, links, authority, or replacement authorization. If a requirement needs human input, show its stable requirement ID and wait.
3. When all selected cells resolve, call preview_content_matrix_generation. Preview is free. Do not start generation from resolution alone.
4. Present the exact selected cell IDs, each current fingerprint, the accepted limits, and the maximum estimated cost. Ask for fresh explicit human confirmation of that exact preview immediately before any paid start.
5. Any new preview, cell or template revision, authority drift, changed fingerprint, changed limits, or changed estimate invalidates any prior confirmation. Re-display the new preview and ask again.
6. Only after the fresh confirmation, call start_content_matrix_generation once with the exact preview authority and a caller-stable idempotency key. Poll get_job_status, then read durable outcomes with get_content_matrix_generation.
7. Never retry automatically. Before considering retry_content_matrix_generation, re-read the exact run, failed items, revisions, and checkpoints with get_content_matrix_generation. Show only budget fields the durable run actually returns. If it returns no bounded retry estimate, stop and state that retry cost cannot be estimated; never invent an estimate. If authority changed, do not retry: return to resolution and preview, then request confirmation for a fresh start. A same-authority retry still requires separate fresh explicit human confirmation of the exact selected failed items and available budget fields.
8. Stop at human review. Never approve, send, or publish generated work. Report failed or needs-attention cells truthfully and wait for direction.`,
    'Resolve and preview a matrix, then require fresh confirmation before paid work.',
  );
}
