import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { meetingBriefRecommendationSchema, meetingBriefMetricsSchema } from './schemas/meeting-brief-schemas.js';
import { z } from 'zod';
import type { MeetingBrief } from '../shared/types/meeting-brief.js';

interface BriefRow {
  workspace_id: string;
  generated_at: string;
  situation_summary: string;
  wins: string;
  attention: string;
  recommendations: string;
  blueprint_progress: string | null;
  prompt_hash: string | null;
  metrics: string;
}

const stmts = createStmtCache(() => ({
  get: db.prepare(
    `SELECT * FROM meeting_briefs WHERE workspace_id = ?`,
  ),
  getHash: db.prepare(
    `SELECT prompt_hash FROM meeting_briefs WHERE workspace_id = ?`,
  ),
  upsert: db.prepare(`
    INSERT INTO meeting_briefs
      (workspace_id, generated_at, situation_summary, wins, attention, recommendations, blueprint_progress, prompt_hash, metrics)
    VALUES
      (@workspace_id, @generated_at, @situation_summary, @wins, @attention, @recommendations, @blueprint_progress, @prompt_hash, @metrics)
    ON CONFLICT(workspace_id) DO UPDATE SET
      generated_at       = excluded.generated_at,
      situation_summary  = excluded.situation_summary,
      wins               = excluded.wins,
      attention          = excluded.attention,
      recommendations    = excluded.recommendations,
      blueprint_progress = excluded.blueprint_progress,
      prompt_hash        = excluded.prompt_hash,
      metrics            = excluded.metrics
  `),
}));

function rowToBrief(row: BriefRow): MeetingBrief {
  return {
    workspaceId: row.workspace_id,
    generatedAt: row.generated_at,
    situationSummary: row.situation_summary,
    wins: parseJsonSafeArray(row.wins, z.string(), { table: 'meeting_briefs', field: 'wins' }),
    attention: parseJsonSafeArray(row.attention, z.string(), { table: 'meeting_briefs', field: 'attention' }),
    recommendations: parseJsonSafeArray(row.recommendations, meetingBriefRecommendationSchema, { table: 'meeting_briefs', field: 'recommendations' }),
    blueprintProgress: row.blueprint_progress ?? null,
    metrics: parseJsonSafe(row.metrics, meetingBriefMetricsSchema, {
      siteHealthScore: null,
      openRankingOpportunities: 0,
      contentInPipeline: 0,
      overallWinRate: null,
      criticalIssues: 0,
    }, { table: 'meeting_briefs', field: 'metrics' }),
  };
}

export function getMeetingBrief(workspaceId: string): MeetingBrief | null {
  const row = stmts().get.get(workspaceId) as BriefRow | undefined;
  return row ? rowToBrief(row) : null;
}

export function upsertMeetingBrief(brief: MeetingBrief, promptHash?: string): void {
  stmts().upsert.run({
    workspace_id: brief.workspaceId,
    generated_at: brief.generatedAt,
    situation_summary: brief.situationSummary,
    wins: JSON.stringify(brief.wins),
    attention: JSON.stringify(brief.attention),
    recommendations: JSON.stringify(brief.recommendations),
    blueprint_progress: brief.blueprintProgress ?? null,
    prompt_hash: promptHash ?? null,
    metrics: JSON.stringify(brief.metrics),
  });
}

export function getMeetingBriefHash(workspaceId: string): string | null {
  const row = stmts().getHash.get(workspaceId) as Pick<BriefRow, 'prompt_hash'> | undefined;
  return row?.prompt_hash ?? null;
}
