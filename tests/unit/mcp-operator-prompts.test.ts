import { describe, expect, it } from 'vitest';
import {
  getMcpOperatorPrompt,
  listMcpOperatorPrompts,
} from '../../server/mcp/prompts.js';
import { MCP_OPERATOR_TOOL_NAMES } from '../../server/mcp/profiles.js';
import { MCP_OPERATOR_PROMPT_NAMES } from '../../shared/types/mcp-prompts.js';

function promptText(name: string, args: Record<string, unknown> = {}): string {
  const result = getMcpOperatorPrompt(name, args);
  expect(result.messages).toHaveLength(1);
  const content = result.messages[0]?.content;
  expect(content?.type).toBe('text');
  return content?.type === 'text' ? content.text : '';
}

describe('MCP operator prompt contracts', () => {
  it('publishes exactly three immutable, unique prompt definitions', () => {
    expect(MCP_OPERATOR_PROMPT_NAMES).toEqual([
      'triage_studio_portfolio',
      'review_workspace_as_client',
      'run_content_matrix_generation_safely',
    ]);
    expect(Object.isFrozen(MCP_OPERATOR_PROMPT_NAMES)).toBe(true);
    expect(new Set(MCP_OPERATOR_PROMPT_NAMES).size).toBe(3);

    const prompts = listMcpOperatorPrompts();
    expect(prompts.map(prompt => prompt.name)).toEqual(MCP_OPERATOR_PROMPT_NAMES);
    expect(Object.isFrozen(prompts)).toBe(true);
    for (const prompt of prompts) {
      expect(Object.isFrozen(prompt)).toBe(true);
      if (prompt.arguments) expect(Object.isFrozen(prompt.arguments)).toBe(true);
    }
  });

  it('strictly validates own arguments without reflecting names or values', () => {
    expect(() => getMcpOperatorPrompt('not_a_real_prompt', {}))
      .toThrow('Unknown prompt.');
    expect(() => getMcpOperatorPrompt('triage_studio_portfolio', { extra: 'secret' }))
      .toThrow('Invalid prompt arguments.');
    expect(() => getMcpOperatorPrompt('review_workspace_as_client', {}))
      .toThrow('Invalid prompt arguments.');
    expect(() => getMcpOperatorPrompt('review_workspace_as_client', { workspace_id: 'bad' }))
      .toThrow('Invalid prompt arguments.');
    expect(() => getMcpOperatorPrompt('run_content_matrix_generation_safely', {
      workspace_id: 'ws_abc',
    })).toThrow('Invalid prompt arguments.');
    expect(() => getMcpOperatorPrompt('run_content_matrix_generation_safely', {
      workspace_id: 'ws_abc',
      matrix_id: 'bad',
    })).toThrow('Invalid prompt arguments.');

    const inherited = Object.create({ workspace_id: 'ws_inherited' }) as Record<string, unknown>;
    expect(() => getMcpOperatorPrompt('review_workspace_as_client', inherited))
      .toThrow('Invalid prompt arguments.');
  });

  it('renders deterministic read-only triage and exact client-safe review workflows', () => {
    const triage = promptText('triage_studio_portfolio');
    expect(triage).toContain('get_portfolio_brief');
    expect(triage).toContain('read-only');
    expect(triage).toContain('Do not mutate');

    const args = { workspace_id: 'ws_abc-123' };
    const first = promptText('review_workspace_as_client', args);
    expect(promptText('review_workspace_as_client', args)).toBe(first);
    expect(first).toContain('get_client_view');
    expect(first).toContain('ws_abc-123');
    expect(first).toContain('sole client-safe projection');
    expect(first).toContain('Do not substitute');
  });

  it('renders a safe matrix workflow using only operator-profile tools', () => {
    const text = promptText('run_content_matrix_generation_safely', {
      workspace_id: 'ws_abc-123',
      matrix_id: 'mtx_def-456',
    });

    for (const tool of [
      'get_brand_identity',
      'get_brand_voice',
      'get_content_matrix',
      'resolve_content_matrix_cells',
      'preview_content_matrix_generation',
      'start_content_matrix_generation',
      'retry_content_matrix_generation',
      'get_job_status',
      'get_content_matrix_generation',
    ]) {
      expect(MCP_OPERATOR_TOOL_NAMES).toContain(tool);
      expect(text).toContain(tool);
    }
    expect(text).toContain('stop on blockers');
    expect(text).toContain('exact selected cell');
    expect(text).toContain('fingerprint');
    expect(text).toContain('accepted limits');
    expect(text).toContain('maximum estimated cost');
    expect(text).toContain('fresh explicit human confirmation');
    expect(text).toContain('invalidates any prior confirmation');
    expect(text).toContain('Never retry automatically');
    expect(text).toContain('Stop at human review');
    expect(text).toContain('Never approve, send, or publish');
  });
});

