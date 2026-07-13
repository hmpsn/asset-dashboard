import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import { workspaceTools } from '../../server/mcp/tools/workspaces.js';
import { intelligenceTools } from '../../server/mcp/tools/intelligence.js';
import { insightTools } from '../../server/mcp/tools/insights.js';
import { contentTools } from '../../server/mcp/tools/content.js';
import { brandTools } from '../../server/mcp/tools/brand.js';
import { clientTools } from '../../server/mcp/tools/clients.js';
import { keywordActionTools } from '../../server/mcp/tools/keyword-actions.js';
import { contentActionTools } from '../../server/mcp/tools/content-actions.js';
import { recommendationActionTools } from '../../server/mcp/tools/recommendation-actions.js';
import { contentGenerationActionTools } from '../../server/mcp/tools/content-generation-actions.js';
import { schemaActionTools } from '../../server/mcp/tools/schema-actions.js';
import { analyticsReadActionTools } from '../../server/mcp/tools/analytics-read-actions.js';
import { jobActionTools } from '../../server/mcp/tools/job-actions.js';

const ALL_TOOLS: Tool[] = [
  ...workspaceTools,
  ...intelligenceTools,
  ...insightTools,
  ...contentTools,
  ...brandTools,
  ...clientTools,
  ...keywordActionTools,
  ...contentActionTools,
  ...recommendationActionTools,
  ...contentGenerationActionTools,
  ...schemaActionTools,
  ...analyticsReadActionTools,
  ...jobActionTools,
];

const GLOBAL_TOOL_NAMES = ['create_workspace', 'list_workspaces'] as const;
const WORKSPACE_ARGUMENT_NAMES = ['workspaceId', 'workspace_id'] as const;

function declaredWorkspaceArguments(tool: Tool): string[] {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
  const properties = schema?.properties ?? {};
  return WORKSPACE_ARGUMENT_NAMES.filter(name => (
    Object.prototype.hasOwnProperty.call(properties, name)
  ));
}

describe('MCP tool workspace-scope schema census', () => {
  it('pins the real registry count and requires unique tool names', () => {
    const names = ALL_TOOLS.map(tool => tool.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    expect(ALL_TOOLS).toHaveLength(61);
    expect(duplicates, `Duplicate MCP tool names: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('reserves zero workspace aliases for global tools and gives every other tool exactly one', () => {
    const globalNames = new Set<string>(GLOBAL_TOOL_NAMES);
    const zeroAliasTools: string[] = [];

    for (const tool of ALL_TOOLS) {
      const aliases = declaredWorkspaceArguments(tool);
      if (aliases.length === 0) zeroAliasTools.push(tool.name);

      if (globalNames.has(tool.name)) {
        expect(
          aliases,
          `${tool.name} is global and must not declare a workspace authorization field`,
        ).toEqual([]);
      } else {
        expect(
          aliases,
          `${tool.name} must declare exactly one of workspaceId or workspace_id`,
        ).toHaveLength(1);
      }
    }

    expect(zeroAliasTools.sort()).toEqual([...GLOBAL_TOOL_NAMES].sort());
  });
});
