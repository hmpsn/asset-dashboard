import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('keyword strategy follow-ons split', () => {
  it('keeps post-persistence follow-ons shared by direct route and background job generation', () => {
    const generationSrc = readFileSync('server/keyword-strategy-generation.ts', 'utf-8'); // readFile-ok - migration guard: direct route and background jobs must share keyword strategy follow-on side effects through the generation service.
    const followOnsSrc = readFileSync('server/keyword-strategy-follow-ons.ts', 'utf-8'); // readFile-ok - migration guard: rank tracking, recommendations, and llms.txt refresh stay in the extracted follow-on service.

    expect(generationSrc).toContain("from './keyword-strategy-follow-ons.js'");
    expect(generationSrc).toContain('seedKeywordStrategyTrackedKeywords({');
    expect(generationSrc).toContain('queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id })');
    expect(generationSrc).not.toContain("from './rank-tracking.js'");
    expect(generationSrc).not.toContain("from './llms-txt-generator.js'");
    expect(generationSrc).not.toContain("from './recommendations.js'");

    expect(followOnsSrc).toContain("import { addTrackedKeyword } from './rank-tracking.js'");
    expect(followOnsSrc).toContain("import { queueLlmsTxtRegeneration } from './llms-txt-generator.js'");
    expect(followOnsSrc).toContain("import { generateRecommendations } from './recommendations.js'");
    expect(followOnsSrc).toContain("queueLlmsTxtRegeneration(workspaceId, 'keyword_strategy_updated')");
    expect(followOnsSrc).toContain('generateRecommendations(workspaceId)');
  });

  it('queues asynchronous follow-ons only after the route/job response strategy is assembled', () => {
    const generationSrc = readFileSync('server/keyword-strategy-generation.ts', 'utf-8'); // readFile-ok - migration guard: follow-on ordering preserves direct route/background job completion semantics.

    const responseSentIdx = generationSrc.indexOf('responseSent = true');
    const queueIdx = generationSrc.indexOf('queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id })');

    expect(responseSentIdx, 'generation must mark the response safe before detached follow-ons').toBeGreaterThan(0);
    expect(queueIdx, 'post-update follow-ons must remain after responseSent = true').toBeGreaterThan(responseSentIdx);
  });
});
