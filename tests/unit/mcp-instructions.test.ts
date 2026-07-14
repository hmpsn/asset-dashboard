/**
 * Content contract for the server-level MCP instructions string.
 *
 * The instructions are the only guidance every connecting agent receives before
 * its first tool call, so this test pins the load-bearing facts an agent needs
 * (workspace-id-first, the handle pipeline, optimistic-concurrency, the paid-tool
 * and destructive-tool lists, the workspace_id/workspaceId casing split). If a
 * tool/handle/param named here is renamed, update the instructions in the same
 * commit — a stale instruction silently misleads every agent.
 */
import { describe, it, expect } from 'vitest';
import { MCP_SERVER_INSTRUCTIONS } from '../../server/mcp/instructions.js';

describe('MCP server instructions', () => {
  it('is a non-empty, substantial orientation string', () => {
    expect(typeof MCP_SERVER_INSTRUCTIONS).toBe('string');
    expect(MCP_SERVER_INSTRUCTIONS.trim().length).toBeGreaterThan(400);
  });

  it('tells the agent to start from a workspace and names the entry-point tools', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('list_workspaces');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('get_workspace_overview');
  });

  it('documents the workspace_id vs workspaceId casing split', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('workspace_id');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('workspaceId');
  });

  it('explains the content handle pipeline + single-use/expiry contract', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('prepare_brief_context');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('brief_request_handle');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('save_brief');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('send_to_client');
    expect(MCP_SERVER_INSTRUCTIONS.toLowerCase()).toContain('single-use');
  });

  it('explains optimistic-concurrency editing (expected_revision / expectedVersion)', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expected_revision');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expectedVersion');
  });

  it('explains the free, revision-safe content-matrix structural workflow', () => {
    for (const tool of [
      'list_content_matrices',
      'get_content_matrix',
      'resolve_content_matrix_cells',
      'accept_content_template_generation_upgrade',
    ]) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(tool);
    }
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expected_source_revision');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/does not call AI/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/does not.+create a generation run/i);
  });

  it('explains the immutable, evidence-addressed brand-intake workflow', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('get_brand_intake');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('resolve_brand_intake_evidence');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('intake_revision_id');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expected_revision');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('requirement_id');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('field_path');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('idempotency_key');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/correct or evidence-resolve/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/superseding revision/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/never mutates.+in place/i);
  });

  it('explains the human-authorized brand-voice finalization workflow', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('get_brand_voice');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('finalize_brand_voice');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('authorization_token');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/human operator/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/HTTP boundary/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/MCP key is only the executor/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/generated.+forbidden as anchors/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/re-fetch.+new authorization/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/never retry a stale authorization/i);
  });

  it('flags the paid tools and that start_* tools are polled jobs', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('research_keywords');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('start_local_seo_refresh');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('get_job_status');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/paid/i);
  });

  it('lists the destructive / irreversible tools', () => {
    for (const tool of ['delete_workspace', 'delete_brief', 'delete_post', 'replace_keyword_strategy', 'revert_post_version']) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(tool);
    }
  });
});
