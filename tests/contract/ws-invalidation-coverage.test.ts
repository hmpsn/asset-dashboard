// tests/contract/ws-invalidation-coverage.test.ts
//
// CONTRACT: every WS_EVENTS entry must be centrally handled.
//
// Every workspace-scoped WS_EVENTS constant must either:
//   (a) have a handler registered in useWsInvalidation.ts, OR
//   (b) be listed in LOCAL_ONLY_EVENTS below with a rationale comment
//       explaining why a centralized React Query invalidation is not needed.
//
// This test does NOT exercise runtime behavior — it statically verifies:
//   1. Parses all WS_EVENTS keys from src/lib/wsEvents.ts
//   2. Parses all [WS_EVENTS.<NAME>]: handler keys from src/hooks/useWsInvalidation.ts
//   3. Asserts the uncovered set is a subset of LOCAL_ONLY_EVENTS
//
// Fail-closed: adding a new WS_EVENTS entry without either (a) or (b) causes this test
// to fail with a clear, actionable error message.
//
// Complements pr-check's inline-handler rule:
//   - pr-check catches reintroduction of inline useWorkspaceEvents handlers (forward drift)
//   - this test catches absence of any handler entirely (absence drift)
//
// readFile-ok — this test intentionally reads source files for static analysis

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, '../..');
const WS_EVENTS_FILE = join(ROOT, 'src/lib/wsEvents.ts');
const USE_WS_INVALIDATION_FILE = join(ROOT, 'src/hooks/useWsInvalidation.ts');

// ---------------------------------------------------------------------------
// LOCAL_ONLY_EVENTS — events intentionally excluded from useWsInvalidation.ts
//
// These events have no centralized React Query cache to invalidate and are
// handled locally within the components that subscribe to them. Each entry
// is documented with a rationale to prevent silent removal.
// ---------------------------------------------------------------------------

const LOCAL_ONLY_EVENTS = new Set<string>([
  // Bulk operation progress/completion events are keyed off component-local
  // state (e.g. in SeoEditor's BulkKeywordWorkflow). They drive UI progress
  // bars and inline status, not React Query caches. Centralizing them would
  // invalidate nothing useful and could trigger spurious re-fetches mid-batch.
  'BULK_OPERATION_PROGRESS',
  'BULK_OPERATION_COMPLETE',
  'BULK_OPERATION_FAILED',

  // SCHEMA_PLAN_SENT is an admin-side fire-and-forget confirmation event —
  // the server emits it after sending a schema plan to the client. There is
  // no React Query consumer for schema plan status; the SeoEditor handles this
  // event locally to show a success toast. Task 1 investigation confirmed no
  // client-visible React Query query is gated on this event.
  'SCHEMA_PLAN_SENT',
]);

// ---------------------------------------------------------------------------
// Parse WS_EVENTS keys from wsEvents.ts
// ---------------------------------------------------------------------------

/**
 * Extract the set of WS_EVENTS key names from wsEvents.ts.
 * Matches lines like:   SOME_EVENT_NAME: 'some:event-string',
 */
function parseWsEventKeys(source: string): Set<string> {
  const keys = new Set<string>();
  // Match top-level property names inside the WS_EVENTS object.
  // Pattern: optional whitespace, then UPPER_SNAKE_CASE key, then colon.
  // We stop parsing at the closing `} as const` to avoid picking up ADMIN_EVENTS keys.
  const wsEventsBlockMatch = source.match(/export const WS_EVENTS\s*=\s*\{([\s\S]*?)\}\s*as\s*const/);
  if (!wsEventsBlockMatch) return keys;

  const block = wsEventsBlockMatch[1];
  const keyRe = /^\s+([A-Z][A-Z0-9_]+)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(block)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Parse handler keys from useWsInvalidation.ts
// ---------------------------------------------------------------------------

/**
 * Extract the set of WS_EVENTS key names that have handlers in useWsInvalidation.ts.
 * Matches lines like:   [WS_EVENTS.SOME_EVENT_NAME]: () => {
 */
function parseCoveredEventKeys(source: string): Set<string> {
  const covered = new Set<string>();
  // Match computed property keys using WS_EVENTS:  [WS_EVENTS.<NAME>]:
  const handlerRe = /\[WS_EVENTS\.([A-Z][A-Z0-9_]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = handlerRe.exec(source)) !== null) {
    covered.add(m[1]);
  }
  return covered;
}

// ---------------------------------------------------------------------------
// Load sources once
// ---------------------------------------------------------------------------

const wsEventsSource = readFileSync(WS_EVENTS_FILE, 'utf8'); // readFile-ok — intentional static analysis of event registry
const useWsInvalidationSource = readFileSync(USE_WS_INVALIDATION_FILE, 'utf8'); // readFile-ok — intentional static analysis of handler registry

const expectedEvents = parseWsEventKeys(wsEventsSource);
const coveredEvents = parseCoveredEventKeys(useWsInvalidationSource);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WS_EVENTS invalidation coverage contract', () => {
  it('parses at least 30 WS_EVENTS keys (sanity check)', () => {
    // If parsing fails, this catches it before the main assertion
    expect(expectedEvents.size).toBeGreaterThan(30);
  });

  it('useWsInvalidation.ts covers at least 30 events (sanity check)', () => {
    expect(coveredEvents.size).toBeGreaterThan(30);
  });

  it('every WS_EVENTS key is either centralized in useWsInvalidation.ts or listed in LOCAL_ONLY_EVENTS', () => {
    // Events that are neither centralized nor explicitly exempted
    const uncovered = [...expectedEvents].filter(
      (key) => !coveredEvents.has(key) && !LOCAL_ONLY_EVENTS.has(key),
    );

    if (uncovered.length > 0) {
      throw new Error(
        `The following WS_EVENTS keys have no centralized handler and are not in LOCAL_ONLY_EVENTS:\n\n` +
        uncovered.map((key) => `  WS_EVENTS.${key}`).join('\n') +
        `\n\nTo fix, do ONE of the following for each event:\n` +
        `  (a) Add a handler in src/hooks/useWsInvalidation.ts:\n` +
        `        [WS_EVENTS.${uncovered[0]}]: () => {\n` +
        `          if (!workspaceId) return;\n` +
        `          qc.invalidateQueries({ queryKey: queryKeys.<namespace>.<queryName>(workspaceId) });\n` +
        `        },\n` +
        `  (b) Add the key to LOCAL_ONLY_EVENTS in this test file with a rationale comment\n` +
        `      explaining why a centralized invalidation is not needed.\n` +
        `\n` +
        `See src/hooks/useWsInvalidation.ts for the list of existing handlers.`,
      );
    }

    expect(uncovered).toHaveLength(0);
  });

  it('LOCAL_ONLY_EVENTS contains only valid WS_EVENTS keys (no stale exemptions)', () => {
    // Catch stale entries in LOCAL_ONLY_EVENTS after a WS_EVENTS rename/removal
    const stale = [...LOCAL_ONLY_EVENTS].filter((key) => !expectedEvents.has(key));

    if (stale.length > 0) {
      throw new Error(
        `LOCAL_ONLY_EVENTS in this test references WS_EVENTS keys that no longer exist:\n\n` +
        stale.map((key) => `  '${key}'`).join('\n') +
        `\n\nRemove stale entries from LOCAL_ONLY_EVENTS to keep the exemption list accurate.`,
      );
    }

    expect(stale).toHaveLength(0);
  });

  it('covered events in useWsInvalidation.ts are all valid WS_EVENTS keys (no phantom handlers)', () => {
    // Catch handlers referencing removed WS_EVENTS constants
    const phantom = [...coveredEvents].filter((key) => !expectedEvents.has(key));

    if (phantom.length > 0) {
      throw new Error(
        `useWsInvalidation.ts references WS_EVENTS keys that no longer exist in wsEvents.ts:\n\n` +
        phantom.map((key) => `  WS_EVENTS.${key}`).join('\n') +
        `\n\nRemove or rename these handlers to match the current WS_EVENTS constants.`,
      );
    }

    expect(phantom).toHaveLength(0);
  });
});
