// server/outcome-playbooks.ts
// Action Playbooks — discovers and surfaces multi-action patterns that correlate with wins.

import crypto from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { getActionsByWorkspace, getOutcomesForAction } from './outcome-tracking.js';
import { rowToActionPlaybook } from './db/outcome-mappers.js';
import type { ActionPlaybookRow } from './db/outcome-mappers.js';
import type { ActionPlaybook } from '../shared/types/outcome-tracking.js';

const log = createLogger('outcome-playbooks');

const stmts = createStmtCache(() => ({
  getByWorkspace: db.prepare('SELECT * FROM action_playbooks WHERE workspace_id = ? ORDER BY historical_win_rate DESC'),
  upsert: db.prepare(`
    INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence, historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
    VALUES (@id, @workspace_id, @name, @trigger_condition, @action_sequence, @historical_win_rate, @sample_size, @confidence, @average_outcome, @enabled, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      trigger_condition = excluded.trigger_condition,
      action_sequence = excluded.action_sequence,
      historical_win_rate = excluded.historical_win_rate,
      sample_size = excluded.sample_size,
      confidence = excluded.confidence,
      average_outcome = excluded.average_outcome,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `),
}));

export function getPlaybooks(workspaceId: string): ActionPlaybook[] {
  const rows = stmts().getByWorkspace.all(workspaceId) as ActionPlaybookRow[];
  return rows.map(rowToActionPlaybook);
}

export function detectPlaybookPatterns(workspaceId: string): { discovered: number } {
  // Analyze multi-action pages and common action sequences
  const actions = getActionsByWorkspace(workspaceId);

  // Group actions by page URL to find pages with multiple tracked actions
  const actionsByPage = new Map<string, typeof actions>();
  for (const action of actions) {
    if (!action.pageUrl) continue;
    if (!actionsByPage.has(action.pageUrl)) actionsByPage.set(action.pageUrl, []);
    actionsByPage.get(action.pageUrl)!.push(action);
  }

  // Find pages with 2+ actions — candidates for pattern detection
  const multiActionPages = [...actionsByPage.entries()].filter(([, acts]) => acts.length >= 2);

  if (multiActionPages.length < 3) {
    log.info({ workspaceId, multiActionPages: multiActionPages.length }, 'Not enough multi-action pages for pattern detection');
    return { discovered: 0 };
  }

  // Count action-type sequences on pages that had winning outcomes
  const sequenceCounts = new Map<string, { count: number; winCount: number }>();
  for (const [, acts] of multiActionPages) {
    // Sort by created_at to get chronological sequence
    const sorted = [...acts].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const sequence = sorted.map(a => a.actionType).join('+');

    // Check if any action on this page had a win
    let hasWin = false;
    for (const act of sorted) {
      if (!act.measurementComplete) continue;
      const outcomes = getOutcomesForAction(act.id);
      if (outcomes.some(o => o.score === 'win' || o.score === 'strong_win')) {
        hasWin = true;
        break;
      }
    }

    const current = sequenceCounts.get(sequence) ?? { count: 0, winCount: 0 };
    sequenceCounts.set(sequence, {
      count: current.count + 1,
      winCount: current.winCount + (hasWin ? 1 : 0),
    });
  }

  // Find sequences with >3 occurrences and compute win rates
  let discovered = 0;
  const now = new Date().toISOString();

  for (const [sequence, stats] of sequenceCounts.entries()) {
    if (stats.count < 3) continue;

    const winRate = Math.round((stats.winCount / stats.count) * 100) / 100;
    const steps = sequence.split('+');

    const id = crypto.createHash('sha256').update(`${workspaceId}:${sequence}`).digest('hex').slice(0, 36);
    const confidence = stats.count >= 10 ? 'high' : stats.count >= 5 ? 'medium' : 'low';
    const name = `${steps.map(s => s.replace(/_/g, ' ')).join(' → ')}`;

    stmts().upsert.run({
      id,
      workspace_id: workspaceId,
      name,
      trigger_condition: steps[0],
      action_sequence: JSON.stringify(steps.map((type) => ({ actionType: type }))),
      historical_win_rate: winRate,
      sample_size: stats.count,
      confidence,
      average_outcome: JSON.stringify({ metric: 'win_rate', avgImprovement: winRate, avgDaysToResult: 0 }),
      enabled: 1,
      created_at: now,
      updated_at: now,
    });

    discovered++;
    log.info({ workspaceId, sequence, winRate, sampleSize: stats.count }, 'Playbook pattern recorded');
  }

  log.info({ workspaceId, discovered }, 'Playbook pattern detection ran');
  return { discovered };
}

export function suggestPlaybook(workspaceId: string, trigger: string): ActionPlaybook | null {
  const playbooks = getPlaybooks(workspaceId);
  return playbooks.find(p => p.enabled && p.triggerCondition === trigger) ?? null;
}
