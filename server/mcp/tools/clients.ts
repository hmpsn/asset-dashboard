import type { Tool } from '@modelcontextprotocol/sdk/types';

export const clientTools: Tool[] = [];

export async function handleClientTool(
  _name: string,
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return { isError: true, content: [{ type: 'text', text: 'Not implemented' }] };
}
