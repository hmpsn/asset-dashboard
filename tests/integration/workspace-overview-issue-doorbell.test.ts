/**
 * Integration test for the admin workspace-overview `issue` doorbell block (The Issue, Phase 3,
 * scaled-review fix #2).
 *
 * The operator doorbell must light the week its Issue is pushed and CLEAR once the operator acts
 * (edits the POV) that week — it must NOT ring forever. The server is now the authority for
 * `issue.ready`: flag ON + ≥1 active rec + pushedWeekOf === current ISO week + POV not edited this
 * week. These cases assert:
 *   - the bell shows the week it's pushed (ready=true, isCurrentWeek=true);
 *   - the bell clears after the operator edits the POV that week (ready=false);
 *   - the bell is absent in a later week until re-pushed (stale pushedWeekOf ⇒ ready=false).
 *
 * In-process server pattern (http.createServer(createApp()) on port 0, APP_PASSWORD unset), mirror
 * of workspace-overview-rec-responses.test.ts.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { createWorkspace, deleteWorkspace, markIssuePushedWeek } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { saveStrategyPov } from '../../server/strategy-pov-store.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { currentWeekOfUTC } from '../../server/strategy-issue-cron.js';
import db from '../../server/db/index.js';
import type { Recommendation } from '../../shared/types/recommendations.js';
import type { StrategyPov } from '../../shared/types/strategy-pov.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';

interface IssueRow {
  id: string;
  issue?: { ready?: boolean; pushedWeekOf?: string | null; isCurrentWeek?: boolean };
}

/** An ACTIVE rec (clientStatus not in {sent,approved,declined} ⇒ isActiveRec → true). */
function seedActiveRec(): void {
  const at = new Date().toISOString();
  const rec: Recommendation = {
    id: 'issue-active', workspaceId: wsId, type: 'content', title: 'Active move', description: 'd',
    insight: 'i', impact: 'high', effort: 'low', impactScore: 60, priority: 'fix_now',
    actionType: 'manual', trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: 'g',
    affectedPages: [], source: 't', clientStatus: 'curated', lifecycle: 'active',
    status: 'pending', createdAt: at, updatedAt: at,
  } as unknown as Recommendation;
  saveRecommendations({
    workspaceId: wsId, generatedAt: at,
    recommendations: [rec],
    summary: {
      fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 60, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: 'issue-active',
    },
  });
}

function savePov(editedAt: string | null): void {
  const pov: StrategyPov = {
    situation: 's', leadMoveRecId: 'issue-active', leadSentence: 'l', wins: [], flags: [],
    version: editedAt ? 1 : 0,
    generatedAt: '2026-06-19T00:00:00.000Z',
    editedAt,
  };
  saveStrategyPov(wsId, pov, 'hash-v1');
}

async function fetchIssueRow(): Promise<IssueRow['issue']> {
  const res = await fetch(`${baseUrl}/api/workspace-overview`);
  expect(res.status).toBe(200);
  const body = await res.json() as IssueRow[];
  return body.find(w => w.id === wsId)?.issue;
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const ws = createWorkspace('Overview Issue Doorbell WS');
  wsId = ws.id;
  setWorkspaceFlagOverride('strategy-the-issue', wsId, true);
}, 60_000);

afterEach(() => {
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM strategy_pov WHERE workspace_id = ?').run(wsId);
  db.prepare('UPDATE workspaces SET last_issue_pushed_week_of = NULL WHERE id = ?').run(wsId);
});

afterAll(async () => {
  setWorkspaceFlagOverride('strategy-the-issue', wsId, null);
  deleteWorkspace(wsId);
  if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
});

describe('GET /api/workspace-overview — The Issue operator doorbell (fix #2)', () => {
  it('shows the bell the week the Issue is pushed (ready=true, isCurrentWeek=true)', async () => {
    seedActiveRec();
    markIssuePushedWeek(wsId, currentWeekOfUTC());
    // No POV edit this week (or no POV at all) ⇒ unacted ⇒ bell lights.
    const issue = await fetchIssueRow();
    expect(issue?.pushedWeekOf).toBe(currentWeekOfUTC());
    expect(issue?.isCurrentWeek).toBe(true);
    expect(issue?.ready).toBe(true);
  });

  it('clears the bell after the operator edits the POV that week (ready=false)', async () => {
    seedActiveRec();
    markIssuePushedWeek(wsId, currentWeekOfUTC());
    // Operator acted this week: POV editedAt within the current ISO week.
    savePov(new Date().toISOString());
    const issue = await fetchIssueRow();
    expect(issue?.isCurrentWeek).toBe(true); // the Issue is still this week's
    expect(issue?.ready).toBe(false);        // but the operator acted ⇒ doorbell silent
  });

  it('is absent in a later week until re-pushed (stale pushedWeekOf ⇒ ready=false)', async () => {
    seedActiveRec();
    // Stamp an OLD week (one ISO week before this Monday) — simulates last week's push never reset.
    const thisMonday = currentWeekOfUTC();
    const lastWeek = new Date(`${thisMonday}T00:00:00.000Z`);
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
    markIssuePushedWeek(wsId, lastWeek.toISOString().slice(0, 10));

    const issue = await fetchIssueRow();
    expect(issue?.pushedWeekOf).not.toBe(thisMonday);
    expect(issue?.isCurrentWeek).toBe(false); // not this week's Issue
    expect(issue?.ready).toBe(false);          // bell does NOT ring forever
  });

  it('does not ring when the flag is OFF even if pushed this week with an active rec', async () => {
    seedActiveRec();
    markIssuePushedWeek(wsId, currentWeekOfUTC());
    setWorkspaceFlagOverride('strategy-the-issue', wsId, false);
    const issue = await fetchIssueRow();
    expect(issue?.ready).toBe(false);
    setWorkspaceFlagOverride('strategy-the-issue', wsId, true); // restore for other cases
  });
});
