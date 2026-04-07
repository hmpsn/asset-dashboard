// tests/contract/websocket-event-shapes.test.ts
//
// CONTRACT: WebSocket event names are consistent between the server broadcast
// calls and the registered constants in ws-events.ts.
//
// This test does NOT exercise runtime behavior — it statically verifies the
// shape and completeness of the event registry by:
//   1. Importing WS_EVENTS and ADMIN_EVENTS constants
//   2. Scanning server/ source files for broadcastToWorkspace() and broadcast()
//      call sites that use raw string literals
//   3. Verifying all string literals are registered in the appropriate registry
//   4. Verifying no duplicate values exist across the registry
//   5. Verifying all event name values follow a consistent `entity:action` format
//
// readFile-ok — this test intentionally reads source files for static analysis

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WS_EVENTS, ADMIN_EVENTS } from '../../server/ws-events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract all quoted string literal arguments from a function call pattern.
 * Matches calls like: fn(arg, 'event:name', ...) or fn(arg, "event:name", ...)
 * The event name is the SECOND argument (after the workspaceId / event-type arg).
 */
function extractStringLiterals(source: string, callPattern: RegExp): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(source)) !== null) {
    found.push(match[1]);
  }
  return found;
}

const ROOT = join(__dirname, '../..');
const SERVER_DIR = join(ROOT, 'server');

// All server .ts files (excluding broadcast.ts and websocket.ts themselves
// which define the function signatures, not call sites).
const serverFiles = collectTsFiles(SERVER_DIR).filter(
  (f) => !f.endsWith('/broadcast.ts') && !f.endsWith('/websocket.ts')
);

// ---------------------------------------------------------------------------
// Collect call-site data from source files
// ---------------------------------------------------------------------------

/**
 * String literals used as the event argument in broadcastToWorkspace() calls.
 * Skips WS_EVENTS.* references — those are already type-safe via the constant.
 *
 * Pattern: broadcastToWorkspace(<any>, '<literal>', ...
 * We capture the second argument only when it is a string literal.
 */
const BROADCAST_TO_WS_LITERAL_RE =
  /broadcastToWorkspace\s*\([^,]+,\s*'([^']+)'/g;

/**
 * String literals used as the event argument in broadcast() calls.
 * Skips ADMIN_EVENTS.* references — those are already type-safe via the constant.
 *
 * Pattern: broadcast('<literal>', ...
 */
const BROADCAST_LITERAL_RE = /\bbroadcast\s*\(\s*'([^']+)'/g;

const wsLiteralsBySite: Record<string, string[]> = {};
const adminLiteralsBySite: Record<string, string[]> = {};

for (const file of serverFiles) {
  const src = readFileSync(file, 'utf8');
  const wsLits = extractStringLiterals(src, BROADCAST_TO_WS_LITERAL_RE);
  if (wsLits.length) wsLiteralsBySite[file] = wsLits;

  const adminLits = extractStringLiterals(src, BROADCAST_LITERAL_RE);
  if (adminLits.length) adminLiteralsBySite[file] = adminLits;
}

const allWsLiterals = Object.values(wsLiteralsBySite).flat();
const allAdminLiterals = Object.values(adminLiteralsBySite).flat();

// ---------------------------------------------------------------------------
// Registry values
// ---------------------------------------------------------------------------

const wsEventValues = Object.values(WS_EVENTS) as string[];
const adminEventValues = Object.values(ADMIN_EVENTS) as string[];

// Combined set of ALL registered event names (both registries)
const allRegisteredEvents = new Set([...wsEventValues, ...adminEventValues]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WS_EVENTS registry', () => {
  it('every WS_EVENTS value is a non-empty string', () => {
    expect(wsEventValues.length).toBeGreaterThan(0);
    for (const val of wsEventValues) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });

  it('every ADMIN_EVENTS value is a non-empty string', () => {
    expect(adminEventValues.length).toBeGreaterThan(0);
    for (const val of adminEventValues) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });

  it('no duplicate values within WS_EVENTS', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const val of wsEventValues) {
      if (seen.has(val)) duplicates.push(val);
      seen.add(val);
    }
    expect(duplicates).toEqual([]);
  });

  it('no duplicate values within ADMIN_EVENTS', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const val of adminEventValues) {
      if (seen.has(val)) duplicates.push(val);
      seen.add(val);
    }
    expect(duplicates).toEqual([]);
  });

  it('all WS_EVENTS values follow entity:action format', () => {
    // Allowed format: one or more word chars/hyphens, colon, one or more word chars/hyphens
    const validFormat = /^[a-z][a-z0-9-]*:[a-z][a-z0-9_-]*$/;
    const violations: string[] = [];
    for (const val of wsEventValues) {
      if (!validFormat.test(val)) violations.push(val);
    }
    expect(violations).toEqual([]);
  });

  it('all ADMIN_EVENTS values follow entity:action format', () => {
    const validFormat = /^[a-z][a-z0-9-]*:[a-z][a-z0-9_-]*$/;
    const violations: string[] = [];
    for (const val of adminEventValues) {
      if (!validFormat.test(val)) violations.push(val);
    }
    expect(violations).toEqual([]);
  });
});

describe('broadcastToWorkspace() call sites', () => {
  it('finds at least one broadcastToWorkspace string literal call site', () => {
    // Sanity check that the regex is working and server files were scanned
    expect(allWsLiterals.length).toBeGreaterThan(0);
  });

  it('all broadcastToWorkspace string literals are registered in WS_EVENTS', () => {
    // String literals should use WS_EVENTS constants. Any literal not found in
    // the registry is an untracked event — either add it to WS_EVENTS or
    // convert the call to use WS_EVENTS.<KEY>.
    //
    // KNOWN GAPS (string literals that exist in call sites but are NOT in the
    // registry — these should be fixed by migrating to WS_EVENTS constants):
    const knownUnregisteredLiterals = new Set([
      'feedback:new',     // server/feedback.ts — not yet added to WS_EVENTS
      'feedback:update',  // server/feedback.ts — not yet added to WS_EVENTS
      'post-updated',     // server/routes/content-posts.ts — not yet added to WS_EVENTS
    ]);

    const unregistered = allWsLiterals.filter(
      (ev) => !allRegisteredEvents.has(ev) && !knownUnregisteredLiterals.has(ev)
    );

    expect(unregistered).toEqual([]);
  });

  it('tracks known unregistered broadcastToWorkspace literals so new ones are caught', () => {
    // This test fails when someone adds a NEW string literal call site that
    // isn't in the known-gaps list above. The fix is to either:
    //   a) Add the event to WS_EVENTS and update the call to use the constant, OR
    //   b) Add it to knownUnregisteredLiterals above with a comment
    //
    // This prevents silent proliferation of untracked event names.
    const knownUnregisteredLiterals = new Set([
      'feedback:new',
      'feedback:update',
      'post-updated',
    ]);

    const trulyUnknown = allWsLiterals.filter(
      (ev) => !allRegisteredEvents.has(ev) && !knownUnregisteredLiterals.has(ev)
    );

    if (trulyUnknown.length > 0) {
      throw new Error(
        `New unregistered broadcastToWorkspace event(s) detected: ${JSON.stringify(trulyUnknown)}\n` +
        `Add them to WS_EVENTS in server/ws-events.ts and use the constant, ` +
        `or document them in knownUnregisteredLiterals above with a reason.`
      );
    }
  });

  it('all registered WS_EVENTS values follow entity:action format', () => {
    // Re-verify after the full registry check — belt-and-suspenders
    const validFormat = /^[a-z][a-z0-9-]*:[a-z][a-z0-9_-]*$/;
    const violations = wsEventValues.filter((v) => !validFormat.test(v));
    expect(violations).toEqual([]);
  });
});

describe('broadcast() call sites (admin-global events)', () => {
  it('finds at least one broadcast string literal call site', () => {
    expect(allAdminLiterals.length).toBeGreaterThan(0);
  });

  it('all broadcast() string literals are registered in ADMIN_EVENTS', () => {
    // Same contract as broadcastToWorkspace: string literals used in broadcast()
    // should correspond to a registered ADMIN_EVENTS entry.
    //
    // KNOWN GAPS (string literals not in registry):
    // Currently none — all broadcast() string literals match ADMIN_EVENTS values.
    const knownUnregisteredAdminLiterals = new Set<string>([]);

    const unregistered = allAdminLiterals.filter(
      (ev) => !allRegisteredEvents.has(ev) && !knownUnregisteredAdminLiterals.has(ev)
    );

    expect(unregistered).toEqual([]);
  });

  it('tracks known unregistered broadcast() literals so new ones are caught', () => {
    const knownUnregisteredAdminLiterals = new Set<string>([]);

    const trulyUnknown = allAdminLiterals.filter(
      (ev) => !allRegisteredEvents.has(ev) && !knownUnregisteredAdminLiterals.has(ev)
    );

    if (trulyUnknown.length > 0) {
      throw new Error(
        `New unregistered broadcast() event(s) detected: ${JSON.stringify(trulyUnknown)}\n` +
        `Add them to ADMIN_EVENTS in server/ws-events.ts and use the constant, ` +
        `or document them in knownUnregisteredAdminLiterals above with a reason.`
      );
    }
  });
});

describe('WS_EVENTS completeness vs known broadcast patterns', () => {
  it('WS_EVENTS contains all expected workspace-scoped event categories', () => {
    // Verify the registry contains entries for every major subsystem that
    // uses broadcastToWorkspace. If a subsystem is missing, it signals that
    // a new feature was added without registering its events.
    const expectedPrefixes = [
      'workspace:',
      'approval:',
      'request:',
      'content-request:',
      'activity:',
      'audit:',
      'work-order:',
      'anomalies:',
      'content:',
      'insight:',
      'intelligence:',
      'schema:',
      'outcome:',
      'suggested-brief:',
      'annotation:',
      'client-signal:',
    ];

    const missingPrefixes: string[] = [];
    for (const prefix of expectedPrefixes) {
      const hasCoverage = wsEventValues.some((v) => v.startsWith(prefix));
      if (!hasCoverage) missingPrefixes.push(prefix);
    }

    expect(missingPrefixes).toEqual([]);
  });

  it('ADMIN_EVENTS contains all expected global event categories', () => {
    const expectedPrefixes = [
      'workspace:',
      'files:',
      'request:',
      'queue:',
    ];

    const missingPrefixes: string[] = [];
    for (const prefix of expectedPrefixes) {
      const hasCoverage = adminEventValues.some((v) => v.startsWith(prefix));
      if (!hasCoverage) missingPrefixes.push(prefix);
    }

    expect(missingPrefixes).toEqual([]);
  });
});
