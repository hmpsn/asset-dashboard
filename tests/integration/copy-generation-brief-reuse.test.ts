/**
 * Copy generation reuses a persisted brief instead of regenerating one
 * (2026-06-09 audit confirmed #6 — PR 4 Task 1/2).
 *
 * buildCopyGenerationContext Layer 4.5 called generateBrief() unconditionally on
 * every copy generation AND every single-section regenerate — a gpt-5.4 7000-token
 * research-mode call (+ up to 4 context assemblies) discarded except for ~8 summary
 * lines. Blueprint entries already carry a briefId pointing to a persisted brief;
 * the context must reuse it. Section regenerate must skip brief enrichment entirely.
 *
 * Spy strategy: vi.mock content-brief keeping getBrief/upsertBrief REAL (importActual)
 * and only stubbing generateBrief, so we can assert the AI path is not taken.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generateBriefSpy = vi.hoisted(() => vi.fn());

vi.mock('../../server/content-brief.js', async (importActual) => {
  const actual = await importActual<typeof import('../../server/content-brief.js')>();
  return { ...actual, generateBrief: generateBriefSpy };
});

import { buildCopyGenerationContext } from '../../server/copy-generation.js';
import { getBrief, upsertBrief } from '../../server/content-brief.js';
import { createBlueprint, addEntry, updateEntry, getBlueprint } from '../../server/page-strategy.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { ContentBrief } from '../../shared/types/content.js';
import type { SiteBlueprint, BlueprintEntry } from '../../shared/types/page-strategy.js';

let ws: SeededFullWorkspace;

function seedBrief(workspaceId: string, over: Partial<ContentBrief> = {}): ContentBrief {
  const brief: ContentBrief = {
    id: `brief_reuse_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId,
    targetKeyword: 'managed it services',
    secondaryKeywords: ['it support', 'helpdesk'],
    suggestedTitle: 'PERSISTED-BRIEF-TITLE Managed IT Services',
    suggestedMetaDesc: 'meta',
    outline: [],
    wordCountTarget: 1500,
    intent: 'commercial',
    audience: 'SMB owners',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
    executiveSummary: 'Persisted exec summary.',
    toneAndStyle: 'professional',
    ...over,
  };
  upsertBrief(workspaceId, brief);
  return brief;
}

function seedBlueprintWithEntry(workspaceId: string, briefId?: string): { blueprint: SiteBlueprint; entry: BlueprintEntry } {
  const blueprint = createBlueprint({ workspaceId, name: 'Reuse BP' });
  const entry = addEntry(workspaceId, blueprint.id, {
    name: 'Managed IT Services',
    pageType: 'service',
    primaryKeyword: 'managed it services',
  })!;
  if (briefId) updateEntry(workspaceId, blueprint.id, entry.id, { briefId });
  const fresh = getBlueprint(workspaceId, blueprint.id)!;
  return { blueprint: fresh, entry: fresh.entries!.find(e => e.id === entry.id)! };
}

beforeAll(() => { ws = seedWorkspace(); });
afterAll(() => { ws.cleanup(); });
beforeEach(() => { generateBriefSpy.mockReset(); });
afterEach(() => { /* blueprints cleaned by ws.cleanup at end */ });

describe('copy generation brief reuse', () => {
  it('reuses the persisted brief (no generateBrief call) when entry.briefId resolves', async () => {
    const brief = seedBrief(ws.workspaceId);
    const { blueprint, entry } = seedBlueprintWithEntry(ws.workspaceId, brief.id);

    const context = await buildCopyGenerationContext(ws.workspaceId, blueprint, entry);

    expect(generateBriefSpy).not.toHaveBeenCalled();
    expect(context).toContain('PERSISTED-BRIEF-TITLE');
    expect(context).toContain('Persisted exec summary.');
  });

  it('falls back to generateBrief when the entry has no briefId', async () => {
    generateBriefSpy.mockResolvedValue({ suggestedTitle: 'GENERATED-FALLBACK', secondaryKeywords: [] });
    const { blueprint, entry } = seedBlueprintWithEntry(ws.workspaceId);

    const context = await buildCopyGenerationContext(ws.workspaceId, blueprint, entry);

    expect(generateBriefSpy).toHaveBeenCalledTimes(1);
    expect(context).toContain('GENERATED-FALLBACK');
  });

  it('falls back to generateBrief when briefId is stale (getBrief returns undefined)', async () => {
    generateBriefSpy.mockResolvedValue({ suggestedTitle: 'GENERATED-FALLBACK-STALE', secondaryKeywords: [] });
    const { blueprint, entry } = seedBlueprintWithEntry(ws.workspaceId, 'brief_does_not_exist');

    const context = await buildCopyGenerationContext(ws.workspaceId, blueprint, entry);

    expect(getBrief(ws.workspaceId, 'brief_does_not_exist')).toBeUndefined();
    expect(generateBriefSpy).toHaveBeenCalledTimes(1);
    expect(context).toContain('GENERATED-FALLBACK-STALE');
  });

  it('skips brief enrichment entirely when skipBriefEnrichment is set (section regenerate path)', async () => {
    const brief = seedBrief(ws.workspaceId, { suggestedTitle: 'SHOULD-NOT-APPEAR-ON-REGEN' });
    const { blueprint, entry } = seedBlueprintWithEntry(ws.workspaceId, brief.id);

    const context = await buildCopyGenerationContext(ws.workspaceId, blueprint, entry, undefined, { skipBriefEnrichment: true });

    expect(generateBriefSpy).not.toHaveBeenCalled();
    expect(context).not.toContain('SHOULD-NOT-APPEAR-ON-REGEN');
    expect(context).not.toContain('CONTENT BRIEF ENRICHMENT');
  });
});
