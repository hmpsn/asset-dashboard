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
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expected_run_revision');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('separate grouped Inbox reviews');
    expect(MCP_SERVER_INSTRUCTIONS.toLowerCase()).toContain('single-use');
  });

  it('explains optimistic-concurrency editing (expected_revision / expectedVersion)', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expected_revision');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expectedVersion');
  });

  it('explains the previewed, bounded, review-gated content-matrix workflow', () => {
    for (const tool of [
      'get_pseo_matrix_plan',
      'create_content_matrix_from_pseo_plan',
      'update_content_matrix_cell',
      'promote_template_to_library',
      'list_library_templates',
      'get_library_template',
      'instantiate_library_template',
      'list_content_matrices',
      'get_content_matrix',
      'resolve_content_matrix_cells',
      'accept_content_template_generation_upgrade',
      'preview_content_matrix_generation',
      'resolve_content_matrix_evidence',
      'start_content_matrix_generation',
      'get_content_matrix_generation',
      'retry_content_matrix_generation',
    ]) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(tool);
    }
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expected_source_revision');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('expected_cell_revision');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/caller-accepted hard limits/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/cannot approve or publish/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/does not call AI/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/does not.+create a generation run/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/never previews or starts generation/i);
    expect(MCP_SERVER_INSTRUCTIONS).toContain('/{service}-{city}');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/single brace pair/i);
  });

  it('documents one stable error envelope for every tool', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('json_v1');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/every tool/i);
    expect(MCP_SERVER_INSTRUCTIONS).not.toMatch(/legacy text errors/i);
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

  it('explains the paid, pause-and-resume brand-generation workflow', () => {
    for (const tool of [
      'start_brand_deliverable_generation',
      'get_brand_generation',
      'resume_brand_deliverable_generation',
      'start_brand_deliverable_revision',
    ]) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(tool);
    }
    expect(MCP_SERVER_INSTRUCTIONS).toContain('full_brand_system');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('voice_foundation');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('awaiting_voice_finalization');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/creates no dependent deliverables until/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/never auto-approves\/sends\/publishes/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/creative proposals/i);
  });

  it('explains the gated brand-to-content onboarding workflow', () => {
    for (const tool of [
      'start_brand_content_onboarding',
      'get_brand_content_onboarding',
      'resume_brand_content_onboarding',
    ]) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(tool);
    }
    expect(MCP_SERVER_INSTRUCTIONS).toContain('paid_job_id');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/at most one gate/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/cannot provide the human content authorization/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/does not publish anything/i);
  });

  it('flags the paid tools and that start_* tools are polled jobs', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('research_keywords');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('start_local_seo_refresh');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('resume_brand_deliverable_generation');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('get_job_status');
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/paid/i);
  });

  it('lists the destructive / irreversible tools', () => {
    for (const tool of ['delete_workspace', 'delete_brief', 'delete_post', 'replace_keyword_strategy', 'revert_post_version']) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(tool);
    }
  });
});
