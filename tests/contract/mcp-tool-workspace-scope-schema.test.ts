import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  MCP_TOOL_REGISTRY,
  listMcpToolDefinitions,
} from '../../server/mcp/tool-registry.js';

const ALL_TOOLS: Tool[] = listMcpToolDefinitions();

const GLOBAL_TOOL_NAMES = [
  'create_workspace',
  'get_portfolio_brief',
  'get_library_template',
  'instantiate_library_template',
  'list_library_templates',
  'list_workspaces',
  'promote_template_to_library',
] as const;
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

    expect(ALL_TOOLS).toHaveLength(110);
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
    expect(
      [...MCP_TOOL_REGISTRY.values()]
        .filter(entry => entry.scope === 'global')
        .map(entry => entry.definition.name)
        .sort(),
    ).toEqual([...GLOBAL_TOOL_NAMES].sort());
  });
});
