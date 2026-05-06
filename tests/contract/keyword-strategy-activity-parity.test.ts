import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('keyword strategy activity parity', () => {
  it('logs strategy generation activity in the shared generation service', () => {
    const serviceSrc = readFileSync('server/keyword-strategy-generation.ts', 'utf-8'); // readFile-ok - migration guard: direct SSE and background jobs must share strategy_generated activity logging through the generation service.
    const persistenceSrc = readFileSync('server/keyword-strategy-persistence.ts', 'utf-8'); // readFile-ok - migration guard: direct SSE and background jobs must share persistence, activity, and broadcast side effects through the extracted service.

    expect(serviceSrc).toContain("import { persistKeywordStrategy } from './keyword-strategy-persistence.js'");
    expect(serviceSrc).toContain('persistKeywordStrategy({');
    expect(persistenceSrc).toContain("import { addActivity } from './activity-log.js'");
    expect(persistenceSrc).toContain("addActivity(ws.id, 'strategy_generated'");

    const updateIdx = persistenceSrc.indexOf('updateWorkspace(ws.id, { keywordStrategy');
    const activityIdx = persistenceSrc.indexOf("addActivity(ws.id, 'strategy_generated'");
    const broadcastIdx = persistenceSrc.indexOf('broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED');

    expect(updateIdx, 'strategy persistence must stay in the shared generation path').toBeGreaterThan(0);
    expect(activityIdx, 'strategy_generated activity must be logged after strategy persistence succeeds').toBeGreaterThan(updateIdx);
    expect(broadcastIdx, 'strategy update broadcasts should run after activity parity logging').toBeGreaterThan(activityIdx);
  });

  it('does not double-log keyword strategy activity from the background job wrapper', () => {
    const jobsSrc = readFileSync('server/routes/jobs.ts', 'utf-8'); // readFile-ok - migration guard: job wrapper delegates strategy_generated logging to the shared generation service to keep direct/background parity without duplicates.
    const keywordJobStart = jobsSrc.indexOf(`case BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY`);
    const schemaJobStart = jobsSrc.indexOf(`case 'schema-generator':`, keywordJobStart);

    expect(keywordJobStart, 'keyword-strategy job case must exist').toBeGreaterThan(0);
    expect(schemaJobStart, 'schema-generator job case must remain after keyword-strategy case').toBeGreaterThan(keywordJobStart);
    expect(jobsSrc.slice(keywordJobStart, schemaJobStart)).not.toContain("'strategy_generated'");
  });
});
