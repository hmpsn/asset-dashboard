import { describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import type { McpToolExecutionContext } from '../../shared/types/mcp-runtime.js';
import {
  MCP_TOOL_REGISTRY,
  type McpToolFamilyHandler,
  type McpToolRegistryEntry,
} from '../../server/mcp/tool-registry.js';
import {
  workspaceTools,
  handleWorkspaceTool,
} from '../../server/mcp/tools/workspaces.js';
import {
  intelligenceTools,
  handleIntelligenceTool,
} from '../../server/mcp/tools/intelligence.js';
import {
  insightTools,
  INSIGHT_HANDLED_TOOL_NAMES,
  handleInsightTool,
} from '../../server/mcp/tools/insights.js';
import {
  contentTools,
  CONTENT_HANDLED_TOOL_NAMES,
  handleContentTool,
} from '../../server/mcp/tools/content.js';
import { brandTools, handleBrandTool } from '../../server/mcp/tools/brand.js';
import { clientTools, handleClientTool } from '../../server/mcp/tools/clients.js';
import {
  keywordActionTools,
  handleKeywordActionTool,
} from '../../server/mcp/tools/keyword-actions.js';
import {
  contentActionTools,
  handleContentActionTool,
} from '../../server/mcp/tools/content-actions.js';
import {
  recommendationActionTools,
  handleRecommendationActionTool,
} from '../../server/mcp/tools/recommendation-actions.js';
import {
  contentGenerationActionTools,
  handleContentGenerationActionTool,
} from '../../server/mcp/tools/content-generation-actions.js';
import {
  contentMatrixActionTools,
  handleContentMatrixActionTool,
} from '../../server/mcp/tools/content-matrix-actions.js';
import {
  brandIntakeActionTools,
  handleBrandIntakeActionTool,
} from '../../server/mcp/tools/brand-intake-actions.js';
import {
  brandVoiceActionTools,
  handleBrandVoiceActionTool,
} from '../../server/mcp/tools/brand-voice-actions.js';
import {
  brandGenerationActionTools,
  handleBrandGenerationActionTool,
} from '../../server/mcp/tools/brand-generation-actions.js';
import {
  brandContentOnboardingActionTools,
  handleBrandContentOnboardingActionTool,
} from '../../server/mcp/tools/brand-content-onboarding-actions.js';
import {
  schemaActionTools,
  handleSchemaActionTool,
} from '../../server/mcp/tools/schema-actions.js';
import {
  analyticsReadActionTools,
  handleAnalyticsReadActionTool,
} from '../../server/mcp/tools/analytics-read-actions.js';
import { jobActionTools, handleJobActionTool } from '../../server/mcp/tools/job-actions.js';

interface ExpectedFamilyRegistration {
  readonly family: string;
  readonly toolNames: readonly string[];
  readonly handler: McpToolFamilyHandler;
}

const EXPECTED_FAMILY_REGISTRATIONS: readonly ExpectedFamilyRegistration[] = [
  {
    family: 'workspaces',
    toolNames: workspaceTools.map(tool => tool.name),
    handler: handleWorkspaceTool,
  },
  {
    family: 'intelligence',
    toolNames: intelligenceTools.map(tool => tool.name),
    handler: handleIntelligenceTool,
  },
  {
    family: 'insights',
    toolNames: insightTools.map(tool => tool.name),
    handler: handleInsightTool,
  },
  {
    family: 'content',
    toolNames: contentTools.map(tool => tool.name),
    handler: handleContentTool,
  },
  {
    family: 'brand',
    toolNames: brandTools.map(tool => tool.name),
    handler: handleBrandTool,
  },
  {
    family: 'clients',
    toolNames: clientTools.map(tool => tool.name),
    handler: handleClientTool,
  },
  {
    family: 'keyword-actions',
    toolNames: keywordActionTools.map(tool => tool.name),
    handler: handleKeywordActionTool,
  },
  {
    family: 'content-actions',
    toolNames: contentActionTools.map(tool => tool.name),
    handler: handleContentActionTool,
  },
  {
    family: 'recommendation-actions',
    toolNames: recommendationActionTools.map(tool => tool.name),
    handler: handleRecommendationActionTool,
  },
  {
    family: 'content-generation-actions',
    toolNames: contentGenerationActionTools.map(tool => tool.name),
    handler: handleContentGenerationActionTool,
  },
  {
    family: 'content-matrix-actions',
    toolNames: contentMatrixActionTools.map(tool => tool.name),
    handler: handleContentMatrixActionTool,
  },
  {
    family: 'brand-intake-actions',
    toolNames: brandIntakeActionTools.map(tool => tool.name),
    handler: handleBrandIntakeActionTool,
  },
  {
    family: 'brand-voice-actions',
    toolNames: brandVoiceActionTools.map(tool => tool.name),
    handler: handleBrandVoiceActionTool,
  },
  {
    family: 'brand-generation-actions',
    toolNames: brandGenerationActionTools.map(tool => tool.name),
    handler: handleBrandGenerationActionTool,
  },
  {
    family: 'brand-content-onboarding-actions',
    toolNames: brandContentOnboardingActionTools.map(tool => tool.name),
    handler: handleBrandContentOnboardingActionTool,
  },
  {
    family: 'schema-actions',
    toolNames: schemaActionTools.map(tool => tool.name),
    handler: handleSchemaActionTool,
  },
  {
    family: 'analytics-read-actions',
    toolNames: analyticsReadActionTools.map(tool => tool.name),
    handler: handleAnalyticsReadActionTool,
  },
  {
    family: 'job-actions',
    toolNames: jobActionTools.map(tool => tool.name),
    handler: handleJobActionTool,
  },
];

const inertArgs: Record<string, unknown> = {
  // Empty workspace IDs fail validation/not-found checks before paid or write work.
  workspaceId: '',
  workspace_id: '',
  // create_workspace is global, so give its required write input the wrong type.
  name: 42,
};

function textContent(result: CallToolResult): string {
  return result.content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

function isUnknownToolResult(result: CallToolResult): boolean {
  const text = textContent(result);
  try {
    const envelope = JSON.parse(text) as {
      code?: string;
      details?: { resource_type?: string };
    };
    return envelope.code === 'not_found'
      && (envelope.details?.resource_type === 'tool' || /unknown .*tool/i.test(text));
  } catch {
    return /\bUnknown\b[\s\S]*\btool:/i.test(text);
  }
}

async function assertDefinitionIsDispatched(entry: McpToolRegistryEntry): Promise<void> {
  const context: McpToolExecutionContext = {
    requestId: `dispatch-census:${entry.definition.name}`,
    toolName: entry.definition.name,
    targetWorkspaceId: null,
    caller: {
      kind: 'master_key',
      scope: 'all',
      keyId: null,
      keyLabel: null,
    },
  };

  let result: CallToolResult;
  try {
    result = await entry.handler(entry.definition.name, inertArgs, context);
  } catch (error) {
    const classification = error instanceof Error ? error.message : String(error);
    expect(classification, entry.definition.name).not.toMatch(/\bUnknown\b[\s\S]*\btool:/i);
    return;
  }
  expect(isUnknownToolResult(result), entry.definition.name).toBe(false);
}

describe('MCP definition-to-handler dispatch census', () => {
  it('pairs every production family definition with its exact family handler', () => {
    expect(EXPECTED_FAMILY_REGISTRATIONS).toHaveLength(18);

    for (const expected of EXPECTED_FAMILY_REGISTRATIONS) {
      const entries = [...MCP_TOOL_REGISTRY.values()]
        .filter(entry => entry.family === expected.family);
      expect(
        entries.map(entry => entry.definition.name),
        expected.family,
      ).toEqual(expected.toolNames);
      for (const entry of entries) {
        expect(entry.handler, entry.definition.name).toBe(expected.handler);
      }
    }
  });

  it('keeps pre-dispatch validator manifests equal to their advertised definitions', () => {
    expect(contentTools.map(tool => tool.name)).toEqual(CONTENT_HANDLED_TOOL_NAMES);
    expect(insightTools.map(tool => tool.name)).toEqual(INSIGHT_HANDLED_TOOL_NAMES);
  });

  it('rejects unknown names before argument validation in every family', async () => {
    for (const expected of EXPECTED_FAMILY_REGISTRATIONS) {
      const probeName = `dispatch_probe_${expected.family}`;
      const context: McpToolExecutionContext = {
        requestId: `dispatch-census:${probeName}`,
        toolName: probeName,
        targetWorkspaceId: null,
        caller: {
          kind: 'master_key',
          scope: 'all',
          keyId: null,
          keyLabel: null,
        },
      };
      const result = await expected.handler(probeName, inertArgs, context);
      expect(isUnknownToolResult(result), expected.family).toBe(true);
    }
  });

  it('routes every registered production definition into its family handler', async () => {
    expect(MCP_TOOL_REGISTRY.size).toBe(97);
    for (const entry of MCP_TOOL_REGISTRY.values()) {
      await assertDefinitionIsDispatched(entry);
    }
  });

  it('detects a definition whose family handler lacks a dispatch branch', async () => {
    const fixture: McpToolRegistryEntry = {
      definition: {
        name: 'missing_dispatch_fixture',
        description: 'Fixture proving the census detects an unknown-tool sentinel.',
        inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } } },
      },
      family: 'fixture',
      handler: async () => ({
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({
          code: 'not_found',
          message: 'The requested tool does not exist.',
          retryable: false,
          details: { resource_type: 'tool' },
        }) }],
      }),
      scope: 'workspace',
      workspaceField: 'workspaceId',
      errorContract: 'json_v1',
    };

    await expect(assertDefinitionIsDispatched(fixture)).rejects.toThrow(/missing_dispatch_fixture/);
  });
});
