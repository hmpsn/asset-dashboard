import type { Tool } from '@modelcontextprotocol/sdk/types';
import { describe, expect, it } from 'vitest';
import {
  MCP_API_KEY_PROFILES,
} from '../../shared/types/mcp-api-keys.js';
import {
  MCP_SERVER_PROFILES,
} from '../../shared/types/mcp-runtime.js';
import {
  MCP_CLIENT_PROFILE_INSTRUCTIONS,
  MCP_CLIENT_TOOL_NAMES,
} from '../../server/mcp/profiles.js';
import {
  listMcpToolDefinitions,
  listMcpToolDefinitionsForProfile,
} from '../../server/mcp/tool-registry.js';

function clientDefinitions(): Tool[] {
  return listMcpToolDefinitionsForProfile(MCP_SERVER_PROFILES.CLIENT);
}

describe('MCP client read-only profile contracts', () => {
  it('keeps credential and transport vocabulary intentionally narrow', () => {
    expect(MCP_API_KEY_PROFILES).toEqual({ FULL: 'full', CLIENT: 'client' });
    expect(MCP_SERVER_PROFILES).toEqual({
      FULL: 'full',
      OPERATOR: 'operator',
      CLIENT: 'client',
    });
  });

  it('activates only the existing GSC read in PR1', () => {
    expect(MCP_CLIENT_TOOL_NAMES).toEqual(['get_search_performance']);
    expect(new Set(MCP_CLIENT_TOOL_NAMES).size).toBe(1);

    const registered = new Set(listMcpToolDefinitions().map(tool => tool.name));
    expect(MCP_CLIENT_TOOL_NAMES.every(name => registered.has(name))).toBe(true);
    expect(clientDefinitions().map(tool => tool.name)).toEqual(MCP_CLIENT_TOOL_NAMES);
  });

  it('advertises a workspace-free, explicitly structured, read-only surface', () => {
    expect(MCP_CLIENT_PROFILE_INSTRUCTIONS).not.toContain('workspace_id');
    expect(MCP_CLIENT_PROFILE_INSTRUCTIONS).not.toContain('workspaceId');

    for (const definition of clientDefinitions()) {
      const input = definition.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(input.properties).not.toHaveProperty('workspace_id');
      expect(input.properties).not.toHaveProperty('workspaceId');
      expect(input.required ?? []).not.toContain('workspace_id');
      expect(input.required ?? []).not.toContain('workspaceId');
      expect(definition.outputSchema).toMatchObject({
        type: 'object',
        required: ['data'],
      });
      expect(definition.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });
});
