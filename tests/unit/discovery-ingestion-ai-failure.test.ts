/**
 * Unit test: discovery-ingestion AI failure retry semantics.
 *
 * When callAI's delegated OpenAI call throws (transient outage, rate limit, etc.), processSource()
 * must reject WITHOUT calling markProcessed. The route can then report failure,
 * while the source remains unprocessed so the next invocation retries it.
 *
 * A provider error must not be collapsed into `[]`: a valid
 * `{ extractions: [] }` envelope is an intentional success, while an exception
 * must remain distinguishable so the route does not emit success side effects.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock heavy dependencies before importing the module ──────────────────────
vi.mock('../../server/openai-helpers.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/openai-helpers.js')>(),
  callOpenAI: vi.fn(),
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue({}),
  formatForPrompt: vi.fn().mockReturnValue(''),
  buildIntelPrompt: vi.fn().mockResolvedValue(''),
}));

import { callOpenAI } from '../../server/openai-helpers.js';
import {
  addSource,
  processSource,
  listExtractionsBySource,
  SourceProcessingConflictError,
  SourceProcessingInProgressError,
} from '../../server/discovery-ingestion.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const mockCallOpenAI = vi.mocked(callOpenAI);
// processSource calls callAI(), whose default OpenAI path delegates to this mocked helper.

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('processSource — AI failure retry semantics', () => {
  let wsId: string;
  let sourceId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallOpenAI.mockReset();
    const ws = createWorkspace('Discovery Ingestion Test');
    wsId = ws.id;
    const src = addSource(wsId, 'test.txt', 'brand_doc', 'Sample brand content');
    sourceId = src.id;
  });

  afterEach(() => {
    deleteWorkspace(wsId);
  });

  it('rejects and leaves source unprocessed when AI throws', async () => {
    mockCallOpenAI.mockRejectedValueOnce(new Error('OpenAI rate limit exceeded'));

    await expect(processSource(wsId, sourceId)).rejects.toThrow('OpenAI rate limit exceeded');

    // Source must remain unprocessed so it retries on the next invocation
    // (verified by attempting to process again without force — if it were
    // marked processed, this would throw SourceAlreadyProcessedError)
    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });
    await expect(processSource(wsId, sourceId)).resolves.toEqual([]);
  });

  it('marks source as processed when AI succeeds with empty extractions', async () => {
    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });

    await processSource(wsId, sourceId);

    // Second call without force should throw SourceAlreadyProcessedError
    // because the source IS now marked processed (AI succeeded)
    mockCallOpenAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });
    await expect(processSource(wsId, sourceId)).rejects.toThrow(/already been processed/i);
  });

  it('does not persist extractions when AI throws', async () => {
    mockCallOpenAI.mockRejectedValueOnce(new Error('Timeout'));

    await expect(processSource(wsId, sourceId)).rejects.toThrow('Timeout');

    const extractions = listExtractionsBySource(wsId, sourceId);
    expect(extractions).toHaveLength(0);
  });

  it('admits only one in-process AI call for an overlapping workspace/source request', async () => {
    const enteredAI = deferred<void>();
    const releaseAI = deferred<void>();
    mockCallOpenAI.mockImplementationOnce(async () => {
      enteredAI.resolve();
      await releaseAI.promise;
      return { text: JSON.stringify({ extractions: [] }) };
    });

    const first = processSource(wsId, sourceId);
    await enteredAI.promise;

    const overlapping = processSource(wsId, sourceId).catch(error => error as unknown);
    await Promise.resolve();
    releaseAI.resolve();
    await expect(first).resolves.toEqual([]);
    expect(await overlapping).toBeInstanceOf(SourceProcessingInProgressError);
    expect(mockCallOpenAI).toHaveBeenCalledTimes(1);
  });

  it('fails closed when another process marks the source processed during the AI call', async () => {
    const enteredAI = deferred<void>();
    const releaseAI = deferred<void>();
    mockCallOpenAI.mockImplementationOnce(async () => {
      enteredAI.resolve();
      await releaseAI.promise;
      return {
        text: JSON.stringify({
          extractions: [{
            extraction_type: 'voice_pattern',
            category: 'tone_marker',
            content: 'This losing result must not be persisted',
          }],
        }),
      };
    });

    const processing = processSource(wsId, sourceId);
    await enteredAI.promise;
    const competingProcessedAt = '2030-01-02T03:04:05.000Z';
    db.prepare('UPDATE discovery_sources SET processed_at = ? WHERE id = ? AND workspace_id = ?')
      .run(competingProcessedAt, sourceId, wsId);
    releaseAI.resolve();

    await expect(processing).rejects.toBeInstanceOf(SourceProcessingConflictError);
    expect(listExtractionsBySource(wsId, sourceId)).toEqual([]);
    const row = db.prepare('SELECT processed_at FROM discovery_sources WHERE id = ? AND workspace_id = ?')
      .get(sourceId, wsId) as { processed_at: string };
    expect(row.processed_at).toBe(competingProcessedAt);
  });

  it('does not overwrite a concurrent force replacement that wins during the AI call', async () => {
    const initialProcessedAt = '2029-01-02T03:04:05.000Z';
    const winningExtractionId = `ext_force_race_${sourceId}`;
    db.prepare('UPDATE discovery_sources SET processed_at = ? WHERE id = ? AND workspace_id = ?')
      .run(initialProcessedAt, sourceId, wsId);
    db.prepare(`
      INSERT INTO discovery_extractions
        (id, source_id, workspace_id, extraction_type, category, content,
         source_quote, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      winningExtractionId, sourceId, wsId, 'voice_pattern', 'tone_marker',
      'Original extraction', null, 'medium', 'pending', initialProcessedAt,
    );

    const enteredAI = deferred<void>();
    const releaseAI = deferred<void>();
    mockCallOpenAI.mockImplementationOnce(async () => {
      enteredAI.resolve();
      await releaseAI.promise;
      return {
        text: JSON.stringify({
          extractions: [{
            extraction_type: 'voice_pattern',
            category: 'tone_marker',
            content: 'Losing force replacement',
          }],
        }),
      };
    });

    const processing = processSource(wsId, sourceId, { force: true });
    await enteredAI.promise;
    const winningProcessedAt = '2030-02-03T04:05:06.000Z';
    db.prepare('UPDATE discovery_sources SET processed_at = ? WHERE id = ? AND workspace_id = ?')
      .run(winningProcessedAt, sourceId, wsId);
    db.prepare('UPDATE discovery_extractions SET content = ? WHERE id = ? AND workspace_id = ?')
      .run('Winning concurrent replacement', winningExtractionId, wsId);
    releaseAI.resolve();

    await expect(processing).rejects.toBeInstanceOf(SourceProcessingConflictError);
    const rows = listExtractionsBySource(wsId, sourceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: winningExtractionId, content: 'Winning concurrent replacement' });
  });
});
