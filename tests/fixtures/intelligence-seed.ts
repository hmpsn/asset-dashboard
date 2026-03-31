// tests/fixtures/intelligence-seed.ts
// Shared test data for intelligence layer tests.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §17

import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';

export interface SeededWorkspace {
  workspaceId: string;
  cleanup: () => void;
}

/**
 * Seeds a test workspace with intelligence-relevant data.
 * Returns the workspace ID and a cleanup function.
 *
 * Note: db-setup.ts disables FK checks for tests, so we can insert
 * insight/action/annotation rows without a real workspace row.
 */
export function seedIntelligenceTestData(): SeededWorkspace {
  const workspaceId = `test-intel-${randomUUID().slice(0, 8)}`;

  // Seed analytics insights (mix of types and severities)
  const insightTypes = ['content_decay', 'ranking_opportunity', 'ctr_opportunity', 'page_health', 'competitor_gap'];
  const severities = ['critical', 'warning', 'opportunity', 'positive'];
  for (let i = 0; i < 10; i++) {
    db.prepare(`
      INSERT INTO analytics_insights (id, workspace_id, page_id, insight_type, data, severity, domain, impact_score, computed_at)
      VALUES (?, ?, ?, ?, '{}', ?, 'search', ?, datetime('now'))
    `).run(
      `insight-${workspaceId}-${i}`,
      workspaceId,
      `/page-${i % 3}`,
      insightTypes[i % insightTypes.length],
      severities[i % severities.length],
      10 - i,
    );
  }

  // Seed tracked actions
  for (let i = 0; i < 5; i++) {
    db.prepare(`
      INSERT INTO tracked_actions (id, workspace_id, action_type, source_type, source_id, page_url, created_at, updated_at)
      VALUES (?, ?, 'content_refreshed', 'insight', ?, '/page-0', datetime('now'), datetime('now'))
    `).run(
      `action-${workspaceId}-${i}`,
      workspaceId,
      `insight-${workspaceId}-${i}`,
    );
  }

  // Seed annotations
  db.prepare(`
    INSERT INTO analytics_annotations (id, workspace_id, date, label, category, created_at)
    VALUES (?, ?, date('now'), 'Test annotation', 'action', datetime('now'))
  `).run(`ann-${workspaceId}-1`, workspaceId);

  const cleanup = () => {
    db.prepare('DELETE FROM analytics_annotations WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(workspaceId);
  };

  return { workspaceId, cleanup };
}
