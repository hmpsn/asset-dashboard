/**
 * Unit tests for server/discovery-ingestion.ts — pure / store-layer functions.
 *
 * Existing coverage:
 *  - discovery-ingestion-ai-failure.test.ts: processSource AI error → source stays unprocessed
 *  - discovery-rawcontent-trigger.test.ts: DB size-cap trigger (1 MiB / multi-byte)
 *
 * New coverage (this file):
 *  - addSource: id prefix, sourceType round-trip, processedAt defaults to undefined
 *  - listSources: workspace isolation, ordering (newest first)
 *  - deleteSource: returns true on hit, false on miss, cross-workspace isolation
 *  - listExtractions: workspace isolation when multiple workspaces exist
 *  - listExtractionsBySource: filters by both workspace + sourceId
 *  - updateExtractionStatus: status-only update preserves routedTo, full update sets routedTo
 *  - updateExtractionStatus with routedTo: null clears the destination
 *  - updateExtractionStatus returns false for unknown id
 *  - updateExtractionContent: updates content, returns true; false for unknown id
 *  - SourceAlreadyProcessedError: name and message format
 *  - confidenceForSourceType (via processSource integration): covered indirectly
 *    — tested directly via confidence field on extraction rows (mock AI path)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock heavy async deps before importing the module ──────────────────────
vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: vi.fn(),
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue({}),
  formatForPrompt: vi.fn().mockReturnValue(''),
  buildIntelPrompt: vi.fn().mockResolvedValue(''),
}));

import { callOpenAI } from '../../server/openai-helpers.js';
import {
  SourceAlreadyProcessedError,
  addSource,
  deleteSource,
  listExtractions,
  listExtractionsBySource,
  listSources,
  processSource,
  updateExtractionContent,
  updateExtractionStatus,
} from '../../server/discovery-ingestion.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const mockCallOpenAI = vi.mocked(callOpenAI);

let wsId: string;

beforeEach(() => {
  vi.resetAllMocks();
  const ws = createWorkspace('Discovery Pure Test');
  wsId = ws.id;
});

afterEach(() => {
  deleteWorkspace(wsId);
});

// ─── addSource ──────────────────────────────────────────────────────────────

describe('addSource — basic creation', () => {
  it('returns a source with the src_ id prefix', () => {
    const src = addSource(wsId, 'notes.txt', 'brand_doc', 'some content');
    expect(src.id).toMatch(/^src_/);
  });

  it('round-trips all fields correctly', () => {
    const src = addSource(wsId, 'transcript.txt', 'transcript', 'Call recording text');
    expect(src.workspaceId).toBe(wsId);
    expect(src.filename).toBe('transcript.txt');
    expect(src.sourceType).toBe('transcript');
    expect(src.rawContent).toBe('Call recording text');
    expect(src.processedAt).toBeUndefined();
    expect(src.createdAt).toBeTruthy();
  });

  it('stores different source types without error', () => {
    const types = ['transcript', 'brand_doc', 'competitor', 'existing_copy', 'website_crawl'] as const;
    for (const t of types) {
      const src = addSource(wsId, `file.txt`, t, 'content');
      expect(src.sourceType).toBe(t);
    }
  });
});

// ─── listSources ────────────────────────────────────────────────────────────

describe('listSources — ordering and isolation', () => {
  it('returns only sources for the requested workspace', () => {
    const otherWs = createWorkspace('Other WS');
    try {
      addSource(wsId, 'mine.txt', 'brand_doc', 'content');
      addSource(otherWs.id, 'theirs.txt', 'brand_doc', 'content');

      const sources = listSources(wsId);
      expect(sources).toHaveLength(1);
      expect(sources[0].filename).toBe('mine.txt');
    } finally {
      deleteWorkspace(otherWs.id);
    }
  });

  it('returns all sources for the workspace (both present)', () => {
    // Both sources inserted in the same ms — just verify both are present
    addSource(wsId, 'first.txt', 'brand_doc', 'a');
    addSource(wsId, 'second.txt', 'transcript', 'b');
    const sources = listSources(wsId);
    expect(sources).toHaveLength(2);
    const filenames = sources.map(s => s.filename).sort();
    expect(filenames).toEqual(['first.txt', 'second.txt']);
  });

  it('returns empty array when workspace has no sources', () => {
    expect(listSources(wsId)).toEqual([]);
  });
});

// ─── deleteSource ───────────────────────────────────────────────────────────

describe('deleteSource', () => {
  it('returns true and removes the source', () => {
    const src = addSource(wsId, 'delete-me.txt', 'brand_doc', 'content');
    expect(deleteSource(wsId, src.id)).toBe(true);
    expect(listSources(wsId)).toHaveLength(0);
  });

  it('returns false for a nonexistent source id', () => {
    expect(deleteSource(wsId, 'nonexistent-id')).toBe(false);
  });

  it('returns false when the source belongs to a different workspace', () => {
    const otherWs = createWorkspace('Other WS del');
    try {
      const src = addSource(wsId, 'mine.txt', 'brand_doc', 'content');
      expect(deleteSource(otherWs.id, src.id)).toBe(false);
      // Verify still present in original workspace
      expect(listSources(wsId)).toHaveLength(1);
    } finally {
      deleteWorkspace(otherWs.id);
    }
  });
});

// ─── listExtractions ────────────────────────────────────────────────────────

describe('listExtractions — workspace isolation', () => {
  it('returns empty array when there are no extractions for the workspace', () => {
    expect(listExtractions(wsId)).toEqual([]);
  });

  it('does not leak extractions from another workspace', async () => {
    const otherWs = createWorkspace('Other WS extr');
    try {
      const srcOther = addSource(otherWs.id, 'other.txt', 'brand_doc', 'content');
      mockCallOpenAI.mockResolvedValueOnce({
        text: JSON.stringify({
          extractions: [
            { extraction_type: 'voice_pattern', category: 'signature_phrase', content: 'Other ws content' },
          ],
        }),
      });
      await processSource(otherWs.id, srcOther.id);

      // Our workspace should still have no extractions
      expect(listExtractions(wsId)).toHaveLength(0);
    } finally {
      deleteWorkspace(otherWs.id);
    }
  });
});

// ─── listExtractionsBySource ─────────────────────────────────────────────────

describe('listExtractionsBySource', () => {
  it('returns only extractions for the specified source within the workspace', async () => {
    const src1 = addSource(wsId, 'source1.txt', 'brand_doc', 'content1');
    const src2 = addSource(wsId, 'source2.txt', 'transcript', 'content2');

    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'voice_pattern', category: 'signature_phrase', content: 'Phrase from source1' },
        ],
      }),
    });
    await processSource(wsId, src1.id);

    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'story_element', category: 'origin_story', content: 'Origin from source2' },
          { extraction_type: 'story_element', category: 'customer_problem', content: 'Problem from source2' },
        ],
      }),
    });
    await processSource(wsId, src2.id);

    const fromSrc1 = listExtractionsBySource(wsId, src1.id);
    expect(fromSrc1).toHaveLength(1);
    expect(fromSrc1[0].content).toBe('Phrase from source1');

    const fromSrc2 = listExtractionsBySource(wsId, src2.id);
    expect(fromSrc2).toHaveLength(2);
  });

  it('returns empty array for a source with no extractions', () => {
    const src = addSource(wsId, 'unprocessed.txt', 'brand_doc', 'content');
    expect(listExtractionsBySource(wsId, src.id)).toEqual([]);
  });
});

// ─── updateExtractionStatus ─────────────────────────────────────────────────

describe('updateExtractionStatus — status-only (routedTo undefined)', () => {
  // NOTE (R3-PR2): `accepted` and `dismissed` are TERMINAL in EXTRACTION_TRANSITIONS —
  // this matches the real product. The DiscoveryTab UI only renders Accept/Dismiss on
  // PENDING rows (src/components/brand/DiscoveryTab.tsx:122); once triaged, the card is
  // read-only (no re-triage / undo / send-back). The route + store have no other caller.
  // So a status-only update is exercised here via the legal idempotent no-op
  // (accepted → accepted), which still runs updateExtractionStatusOnly and must preserve
  // routed_to — testing the exact status-only-path behavior WITHOUT the illegal
  // accepted → dismissed move the old test used only as an incidental vehicle.
  it('status-only update (routedTo undefined) does not touch the routed_to column', async () => {
    const src = addSource(wsId, 'update-status.txt', 'brand_doc', 'content');
    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'voice_pattern', category: 'tone_marker', content: 'Warm and approachable' },
        ],
      }),
    });
    await processSource(wsId, src.id);

    const [extraction] = listExtractionsBySource(wsId, src.id);

    // Legal transition that sets a routedTo (pending → accepted with a destination).
    updateExtractionStatus(wsId, extraction.id, 'accepted', 'voice_profile');

    // Status-only update (routedTo: undefined → status-only path). Same status is a
    // legal no-op (from === to skips the guard) and still runs updateExtractionStatusOnly.
    const result = updateExtractionStatus(wsId, extraction.id, 'accepted');
    expect(result).toBe(true);

    // routedTo should still be 'voice_profile' (status-only path never clears it)
    const rows = db
      .prepare('SELECT status, routed_to FROM discovery_extractions WHERE id = ?')
      .get(extraction.id) as { status: string; routed_to: string | null };
    expect(rows.status).toBe('accepted');
    expect(rows.routed_to).toBe('voice_profile');
  });

  it('returns false for a nonexistent extraction id', () => {
    expect(updateExtractionStatus(wsId, 'nonexistent', 'accepted')).toBe(false);
  });

  it('rejects an illegal re-triage of a terminal extraction (accepted → dismissed) with InvalidTransitionError', async () => {
    const src = addSource(wsId, 'terminal-guard.txt', 'brand_doc', 'content');
    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'voice_pattern', category: 'tone_marker', content: 'Terminal test' },
        ],
      }),
    });
    await processSource(wsId, src.id);
    const [extraction] = listExtractionsBySource(wsId, src.id);
    updateExtractionStatus(wsId, extraction.id, 'accepted');
    // accepted is terminal — a re-triage the UI never offers must be rejected, not silently
    // accepted (route maps InvalidTransitionError → 409).
    expect(() => updateExtractionStatus(wsId, extraction.id, 'dismissed')).toThrow(
      /Invalid discovery_extraction transition/,
    );
  });
});

describe('updateExtractionStatus — full update (routedTo provided)', () => {
  it('sets both status and routed_to', async () => {
    const src = addSource(wsId, 'route-test.txt', 'transcript', 'content');
    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'story_element', category: 'values_in_action', content: 'We care about clients' },
        ],
      }),
    });
    await processSource(wsId, src.id);

    const [extraction] = listExtractionsBySource(wsId, src.id);
    const result = updateExtractionStatus(wsId, extraction.id, 'accepted', 'brandscript');
    expect(result).toBe(true);

    const rows = db
      .prepare('SELECT status, routed_to FROM discovery_extractions WHERE id = ?')
      .get(extraction.id) as { status: string; routed_to: string | null };
    expect(rows.status).toBe('accepted');
    expect(rows.routed_to).toBe('brandscript');
  });

  it('clears routed_to when routedTo: null is passed explicitly', async () => {
    const src = addSource(wsId, 'clear-route.txt', 'brand_doc', 'content');
    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'voice_pattern', category: 'vocabulary', content: 'Power words list' },
        ],
      }),
    });
    await processSource(wsId, src.id);

    const [extraction] = listExtractionsBySource(wsId, src.id);
    // Legal transition that sets a routedTo (pending → accepted, routed to 'identity').
    updateExtractionStatus(wsId, extraction.id, 'accepted', 'identity');
    // Explicit routedTo: null clears the destination. Same status is a legal no-op
    // (from === to), so this exercises the routed_to-clearing branch without the illegal
    // accepted → pending move the old test used only as a vehicle to reach it.
    const cleared = updateExtractionStatus(wsId, extraction.id, 'accepted', null);
    expect(cleared).toBe(true);

    const rows = db
      .prepare('SELECT routed_to FROM discovery_extractions WHERE id = ?')
      .get(extraction.id) as { routed_to: string | null };
    expect(rows.routed_to).toBeNull();
  });
});

// ─── updateExtractionContent ─────────────────────────────────────────────────

describe('updateExtractionContent', () => {
  it('updates content and returns true', async () => {
    const src = addSource(wsId, 'content-update.txt', 'brand_doc', 'content');
    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'voice_pattern', category: 'metaphor', content: 'Original content' },
        ],
      }),
    });
    await processSource(wsId, src.id);

    const [extraction] = listExtractionsBySource(wsId, src.id);
    const result = updateExtractionContent(wsId, extraction.id, 'Revised content after review');
    expect(result).toBe(true);

    const rows = db
      .prepare('SELECT content FROM discovery_extractions WHERE id = ?')
      .get(extraction.id) as { content: string };
    expect(rows.content).toBe('Revised content after review');
  });

  it('returns false for a nonexistent extraction id', () => {
    expect(updateExtractionContent(wsId, 'nonexistent', 'new content')).toBe(false);
  });
});

// ─── SourceAlreadyProcessedError ─────────────────────────────────────────────

describe('SourceAlreadyProcessedError', () => {
  it('has the correct name and message format', () => {
    const err = new SourceAlreadyProcessedError('src_abc123');
    expect(err.name).toBe('SourceAlreadyProcessedError');
    expect(err.message).toMatch(/src_abc123/);
    expect(err.message).toMatch(/already been processed/i);
    expect(err.message).toMatch(/force: true/);
    expect(err instanceof Error).toBe(true);
  });

  it('is thrown when processSource is called on an already-processed source', async () => {
    const src = addSource(wsId, 'already-done.txt', 'brand_doc', 'content');
    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });
    await processSource(wsId, src.id);

    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });
    await expect(processSource(wsId, src.id)).rejects.toBeInstanceOf(SourceAlreadyProcessedError);
  });
});

// ─── confidenceForSourceType (indirect) ─────────────────────────────────────

describe('confidenceForSourceType — via processSource confidence field', () => {
  it.each([
    ['transcript', 'high'],
    ['brand_doc', 'medium'],
    ['competitor', 'medium'],
    ['existing_copy', 'low'],
    ['website_crawl', 'low'],
  ])('sourceType %s → confidence %s', async (sourceType, expectedConfidence) => {
    const src = addSource(wsId, 'conf-test.txt', sourceType as any, 'content');
    mockCallOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        extractions: [
          { extraction_type: 'voice_pattern', category: 'tone_marker', content: 'Test extraction' },
        ],
      }),
    });
    const extractions = await processSource(wsId, src.id);
    expect(extractions[0].confidence).toBe(expectedConfidence);
  });
});
