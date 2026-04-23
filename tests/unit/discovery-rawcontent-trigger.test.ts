/**
 * Unit test: migration 067 raw_content size-cap trigger.
 *
 * The route-layer Zod validator rejects oversize pastes at 400 before they
 * reach the DB — so an integration test through the route never exercises
 * the trigger. This test bypasses the route by calling addSource() directly
 * and asserts the trigger throws when the underlying INSERT exceeds 1 MiB.
 *
 * This protects the defense-in-depth property: if someone later calls
 * addSource() from an internal code path without a Zod gate, the DB still
 * refuses to store oversize content.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { addSource } from '../../server/discovery-ingestion.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

describe('migration 067 — discovery_sources.raw_content size trigger', () => {
  let wsId: string;

  beforeEach(() => {
    const ws = createWorkspace('Size-cap trigger test');
    wsId = ws.id;
  });

  afterEach(() => {
    deleteWorkspace(wsId);
  });

  it('accepts a 1 MiB paste directly through addSource()', () => {
    const oneMiB = 'a'.repeat(1024 * 1024);
    expect(() => addSource(wsId, 'ok.txt', 'brand_doc', oneMiB)).not.toThrow();
  });

  it('rejects a 2 MiB paste with a RAISE(ABORT) containing "exceeds 1 MiB limit"', () => {
    const twoMiB = 'a'.repeat(2 * 1024 * 1024);
    expect(() => addSource(wsId, 'too-big.txt', 'brand_doc', twoMiB)).toThrowError(
      /exceeds 1 MiB limit/,
    );
  });

  it('counts bytes, not characters — rejects multi-byte Unicode that exceeds 1 MiB on disk', () => {
    // "é" is 2 bytes in UTF-8. 600,000 × 2 = 1,200,000 bytes > 1,048,576 MiB threshold.
    // String.length / SQLite length() on TEXT both would report 600,000 characters,
    // which is under the cap. Only a byte-count measure catches this.
    const bigUnicode = 'é'.repeat(600_000);
    expect(() => addSource(wsId, 'unicode.txt', 'brand_doc', bigUnicode)).toThrowError(
      /exceeds 1 MiB limit/,
    );
  });
});
