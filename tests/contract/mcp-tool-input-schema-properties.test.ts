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
  ...jobActionTools,
];

describe('mcp-tool-input-schema-properties', () => {
  it('every object input schema provides a top-level properties map', () => {
    for (const tool of ALL_TOOLS) {
      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      expect(schema, `${tool.name} missing inputSchema`).toBeDefined();
      if (!schema) continue;
      expect(schema.type, `${tool.name} inputSchema.type must be "object"`).toBe('object');
      expect(
        Object.prototype.hasOwnProperty.call(schema, 'properties'),
        `${tool.name} inputSchema must include top-level properties`,
      ).toBe(true);
      const properties = schema.properties as Record<string, unknown> | undefined;
      expect(properties, `${tool.name} inputSchema properties must be an object`).toBeDefined();
      expect(Array.isArray(properties), `${tool.name} properties cannot be an array`).toBe(false);
    }
  });
});

