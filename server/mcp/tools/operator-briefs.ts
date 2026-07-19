import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import type { z } from 'zod';
import {
  clientViewOutputSchema,
  getClientViewInputSchema,
  getPortfolioBriefInputSchema,
  getWorkspaceDecisionBriefInputSchema,
  portfolioBriefOutputSchema,
  workspaceDecisionBriefOutputSchema,
} from '../../../shared/types/mcp-operator-briefs.js';
import {
  buildOperatorClientView,
  buildOperatorPortfolioBrief,
  buildOperatorWorkspaceDecisionBrief,
} from '../../domains/analytics-intelligence/operator-read-models.js';
import { createLogger } from '../../logger.js';
import { toMcpCompactOutputSchema, toMcpJsonSchema } from '../json-schema.js';
import {
  mcpInternalError,
  mcpNotFoundError,
  zodErrorToMcp,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-operator-briefs');

export const operatorBriefTools: Tool[] = [
  {
    name: 'get_portfolio_brief',
    description: 'Get a compact, deterministically ordered portfolio attention queue.',
    inputSchema: toMcpJsonSchema(getPortfolioBriefInputSchema),
    outputSchema: toMcpCompactOutputSchema(portfolioBriefOutputSchema),
  },
  {
    name: 'get_workspace_decision_brief',
    description: 'Get bounded blockers, decisions, risks, and next-safe-action codes for one workspace.',
    inputSchema: toMcpJsonSchema(getWorkspaceDecisionBriefInputSchema),
    outputSchema: toMcpCompactOutputSchema(workspaceDecisionBriefOutputSchema),
  },
  {
    name: 'get_client_view',
    description: 'Get the exact tier-gated, client-safe intelligence projection for one workspace.',
    inputSchema: toMcpJsonSchema(getClientViewInputSchema),
    outputSchema: toMcpCompactOutputSchema(clientViewOutputSchema),
  },
];

function structuredSuccess<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  data: unknown,
): CallToolResult {
  const parsed = schema.safeParse({ data });
  if (!parsed.success) {
    log.error(
      { failure_class: 'operator_brief_output_contract' },
      'Operator brief output failed its declared contract',
    );
    return mcpInternalError();
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(parsed.data.data) }],
    structuredContent: parsed.data,
  };
}

async function handlePortfolioBrief(args: Record<string, unknown>): Promise<CallToolResult> {
  const parsed = getPortfolioBriefInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const data = buildOperatorPortfolioBrief(parsed.data.limit);
  return structuredSuccess(portfolioBriefOutputSchema, data);
}

async function handleWorkspaceDecisionBrief(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = getWorkspaceDecisionBriefInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const data = await buildOperatorWorkspaceDecisionBrief(
    parsed.data.workspace_id,
    parsed.data.queue_limit,
  );
  if (!data) {
    return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });
  }
  return structuredSuccess(workspaceDecisionBriefOutputSchema, data);
}

async function handleClientView(args: Record<string, unknown>): Promise<CallToolResult> {
  const parsed = getClientViewInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const data = await buildOperatorClientView(parsed.data.workspace_id);
  if (!data) {
    return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });
  }
  return structuredSuccess(clientViewOutputSchema, data);
}

export async function handleOperatorBriefTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  switch (name) {
    case 'get_portfolio_brief':
      return handlePortfolioBrief(args);
    case 'get_workspace_decision_brief':
      return handleWorkspaceDecisionBrief(args);
    case 'get_client_view':
      return handleClientView(args);
    default:
      return mcpNotFoundError('Tool not found.', { resource_type: 'tool' });
  }
}
