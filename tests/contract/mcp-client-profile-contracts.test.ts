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

  it('activates exactly the six approved aggregate analytics reads', () => {
    expect(MCP_CLIENT_TOOL_NAMES).toEqual([
      'get_search_performance',
      'get_ga4_campaign_performance',
      'get_ga4_period_comparison',
      'get_ga4_traffic_sources',
      'get_ga4_key_events',
      'get_ga4_content_performance',
    ]);
    expect(new Set(MCP_CLIENT_TOOL_NAMES).size).toBe(6);

    const registered = new Set(listMcpToolDefinitions().map(tool => tool.name));
    expect(MCP_CLIENT_TOOL_NAMES.length).toBeGreaterThan(0);
    expect(MCP_CLIENT_TOOL_NAMES.every(name => registered.has(name))).toBe(true); // every-ok — non-empty asserted above
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

    const search = clientDefinitions().find(tool => tool.name === 'get_search_performance');
    const serializedSearchOutput = JSON.stringify(search?.outputSchema);
    expect(serializedSearchOutput).toContain(
      'Click-through rate as percentage points (for example, 6.3 means 6.3%, not 0.063).',
    );

    const keyEvents = clientDefinitions().find(tool => tool.name === 'get_ga4_key_events');
    expect(JSON.stringify(keyEvents?.outputSchema)).toContain(
      'Share of period users who triggered the key event, in percentage points.',
    );

    const content = clientDefinitions().find(tool => tool.name === 'get_ga4_content_performance');
    const serializedContentOutput = JSON.stringify(content?.outputSchema);
    expect(serializedContentOutput).toContain('pages_by_views');
    expect(serializedContentOutput).toContain('landing_pages_by_sessions');
  });
});
