/**
 * Static analysis test: broadcast ↔ handler pairing audit.
 *
 * Verifies that every broadcastToWorkspace() call on the server has at least
 * one matching frontend WebSocket handler, and that every frontend handler
 * references an event that actually exists in WS_EVENTS.
 *
 * This is a codebase audit test — it reads source files as data strings and
 * does NOT start a server or import application modules. It catches orphaned
 * broadcasts (server sends, nobody listens) and orphaned handlers (frontend
 * listens for an event the server never emits).
 *
 * Known intentional gaps are documented in KNOWN_UNHANDLED_BROADCASTS and
 * KNOWN_UNHANDLED_HANDLERS below. These lists must not grow silently — every
 * new entry requires a comment explaining why no handler/broadcast exists.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/** Recursively collect all files matching an extension under a directory. */
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (exts.some(ext => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

/** Read a file and return its content as a string. */
function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Phase 1: Parse the WS_EVENTS constants file (server — source of truth)
// ---------------------------------------------------------------------------

/**
 * Extract all string values from WS_EVENTS in server/ws-events.ts.
 * We parse the file as text so this test has no runtime dependency on the
 * module itself (which avoids import order / database init issues).
 */
function parseServerWsEvents(): Map<string, string> {
  const filePath = path.join(ROOT, 'server', 'ws-events.ts');
  const content = readFile(filePath);

  const events = new Map<string, string>();

  // Match lines like:   KEY: 'value',
  const lineRe = /^\s{2}([A-Z_]+):\s+'([^']+)'/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(content)) !== null) {
    const [, key, value] = match;
    // Only capture entries inside the WS_EVENTS block (not ADMIN_EVENTS).
    // The WS_EVENTS block starts before ADMIN_EVENTS in the file, so we stop
    // when we hit the ADMIN_EVENTS declaration.
    const keyPosition = match.index;
    const adminEventsPosition = content.indexOf('export const ADMIN_EVENTS');
    if (adminEventsPosition !== -1 && keyPosition > adminEventsPosition) continue;
    events.set(key, value);
  }

  return events;
}

// ---------------------------------------------------------------------------
// Phase 2: Collect all broadcastToWorkspace() event names from server code
// ---------------------------------------------------------------------------

/**
 * Scan all server .ts files for broadcastToWorkspace() call sites and extract
 * the event name argument (second argument).  Handles both:
 *   - WS_EVENTS.SOME_KEY  (resolved via the constants map)
 *   - 'literal-string'    (used directly)
 */
function collectServerBroadcasts(wsEventsMap: Map<string, string>): Map<string, string[]> {
  const serverDir = path.join(ROOT, 'server');
  const files = collectFiles(serverDir, ['.ts']);

  // event name → list of source files that broadcast it
  const broadcasts = new Map<string, string[]>();

  const record = (eventName: string, file: string) => {
    const rel = path.relative(ROOT, file);
    const existing = broadcasts.get(eventName) ?? [];
    existing.push(rel);
    broadcasts.set(eventName, existing);
  };

  // Regex to match broadcastToWorkspace( ... , <event-arg> , ...
  // The event arg is the second argument — either WS_EVENTS.KEY or a string literal.
  // We use a broad pattern then extract the second argument.
  const callRe = /broadcastToWorkspace\s*\([^,]+,\s*([^,)]+)/g;

  // Also capture workspace-scoped broadcasts made via aliased function references.
  // These use the same (workspaceId, event, data) signature as broadcastToWorkspace()
  // but are called through module-local variables:
  //   _broadcastFn?.(workspaceId, event, data)  — activity-log.ts, stripe.ts
  //   _broadcast(workspaceId, event, data)       — anomaly-detection.ts (3-arg workspace form)
  // We distinguish the workspace form from the 2-arg global form (_broadcast(event, data))
  // by requiring that the first argument is an identifier, not a quoted string literal.
  const aliasCallRe = /(?:_broadcastFn\?\.\s*\(|_broadcastFn\s*\(|_broadcast\s*\()\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\s*,\s*([^,)]+)/g;

  /**
   * Process a single regex match and record the extracted event name.
   * Shared by both the main callRe and the aliasCallRe loops.
   *
   * Only records:
   *   - WS_EVENTS.KEY  references (resolved to their string value)
   *   - String literals ('event:name', "event:name")
   *
   * Bare identifiers (e.g. variable names like `event` or `data` in
   * forwarding shims) are intentionally ignored to avoid false positives.
   */
  function processMatch(raw: string, file: string) {
    if (raw.startsWith('WS_EVENTS.')) {
      // Resolve the constant key to its string value
      const key = raw.slice('WS_EVENTS.'.length);
      const value = wsEventsMap.get(key);
      if (value) {
        record(value, file);
      } else {
        // Unknown constant — record it verbatim so the test surfaces the gap
        record(`UNRESOLVED:${raw}`, file);
      }
    } else if (raw.startsWith("'") || raw.startsWith('"') || raw.startsWith('`')) {
      // Strip surrounding quotes from a string literal
      const literal = raw.replace(/^['"`]|['"`]$/g, '');
      if (literal.length > 0) {
        record(literal, file);
      }
    }
    // Bare identifiers (e.g. `event`, `data`) are skipped — they appear in
    // forwarding shims and do not represent concrete event names.
  }

  for (const file of files) {
    const content = readFile(file);
    let match: RegExpExecArray | null;

    callRe.lastIndex = 0;
    while ((match = callRe.exec(content)) !== null) {
      processMatch(match[1].trim(), file);
    }

    // Also scan for aliased workspace broadcast calls
    aliasCallRe.lastIndex = 0;
    while ((match = aliasCallRe.exec(content)) !== null) {
      processMatch(match[1].trim(), file);
    }
  }

  return broadcasts;
}

// ---------------------------------------------------------------------------
// Phase 3: Collect all frontend WebSocket handler event names
// ---------------------------------------------------------------------------

/**
 * Scan all frontend .ts/.tsx files for useWorkspaceEvents / useGlobalAdminEvents
 * handler registrations and extract the event name keys.  Handles both:
 *   - [WS_EVENTS.SOME_KEY]: ...  (resolved via the frontend constants mirror)
 *   - 'literal-string': ...      (used directly)
 *
 * We also track per-file which hook is used so the test can enforce that
 * workspace-scoped events are only registered via `useWorkspaceEvents`. The
 * legacy `useGlobalAdminEvents` hook (formerly `useWebSocket`) does NOT send
 * a `subscribe` action and therefore silently drops workspace-scoped events.
 * This is the root-cause fix for the bug that shipped in PR #162 across the
 * four brand-engine tabs.
 */
function parseFrontendWsEvents(): Map<string, string> {
  const filePath = path.join(ROOT, 'src', 'lib', 'wsEvents.ts');
  const content = readFile(filePath);

  const events = new Map<string, string>();
  const lineRe = /^\s{2}([A-Z_]+):\s+'([^']+)'/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(content)) !== null) {
    const [, key, value] = match;
    // Only capture entries inside the WS_EVENTS block (not ADMIN_EVENTS)
    const keyPosition = match.index;
    const adminEventsPosition = content.indexOf('export const ADMIN_EVENTS');
    if (adminEventsPosition !== -1 && keyPosition > adminEventsPosition) continue;
    events.set(key, value);
  }
  return events;
}

/**
 * Per-file handler registration tracked with which hook was used.
 * Used by the workspace-hook-correctness test below.
 */
interface HandlerRegistration {
  eventName: string;
  file: string;
  hook: 'useWorkspaceEvents' | 'useGlobalAdminEvents' | 'useWsInvalidation' | 'unknown';
}

function collectFrontendHandlers(
  frontendWsEventsMap: Map<string, string>,
): { handlers: Map<string, string[]>; registrations: HandlerRegistration[] } {
  const srcDir = path.join(ROOT, 'src');
  const files = collectFiles(srcDir, ['.ts', '.tsx']);

  // event name → list of source files that handle it
  const handlers = new Map<string, string[]>();
  const registrations: HandlerRegistration[] = [];

  const record = (eventName: string, file: string, hook: HandlerRegistration['hook']) => {
    const rel = path.relative(ROOT, file);
    const existing = handlers.get(eventName) ?? [];
    existing.push(rel);
    handlers.set(eventName, existing);
    registrations.push({ eventName, file: rel, hook });
  };

  // Pattern 1: computed key with WS_EVENTS constant
  //   [WS_EVENTS.KEY]: handler
  const computedKeyRe = /\[WS_EVENTS\.([A-Z_]+)\]/g;

  // Pattern 2: string literal used as an object key in a handler map
  //   'event:name': handler  OR  "event:name": handler
  // We look for quoted strings that precede a colon (object key syntax).
  const literalKeyRe = /['"]([a-z][a-z0-9_:-]+)['"]\s*:/g;

  // Files that contain useWorkspaceEvents / useGlobalAdminEvents / useWsInvalidation calls
  for (const file of files) {
    const content = readFile(file);
    const usesWorkspaceEvents = content.includes('useWorkspaceEvents');
    const usesGlobalAdminEvents = content.includes('useGlobalAdminEvents');
    const usesWsInvalidation = content.includes('useWsInvalidation');
    const usesWsHook = usesWorkspaceEvents || usesGlobalAdminEvents || usesWsInvalidation;

    if (!usesWsHook) continue;

    // Determine the hook used. If a file uses multiple, we prefer useWorkspaceEvents
    // for correctness tracking since that's the "correct" workspace hook. Files that
    // use only useGlobalAdminEvents are tracked as such so we can enforce the rule.
    const hook: HandlerRegistration['hook'] = usesWorkspaceEvents
      ? 'useWorkspaceEvents'
      : usesGlobalAdminEvents
        ? 'useGlobalAdminEvents'
        : usesWsInvalidation
          ? 'useWsInvalidation'
          : 'unknown';

    // Collect computed WS_EVENTS key references
    computedKeyRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = computedKeyRe.exec(content)) !== null) {
      const key = match[1];
      const value = frontendWsEventsMap.get(key);
      if (value) {
        record(value, file, hook);
      } else {
        record(`UNRESOLVED:WS_EVENTS.${key}`, file, hook);
      }
    }

    // Collect string literal keys that look like event names.
    // Require ':' in the middle of the name (not at the end like protocol strings
    // 'wss:' or 'ws:') to avoid false positives from:
    //   - CSS class ternaries: 'text-red-400' : 'text-zinc-500'
    //   - Tab/route names with hyphens: 'content-post-intro'
    //   - Feature label maps: 'seo-rewrite', 'anomaly-detection', etc.
    //   - Protocol strings: 'wss:', 'https:'
    // All real WS event names in this codebase follow the pattern <domain>:<action>
    // where the colon is a separator within the name (e.g. 'activity:new').
    literalKeyRe.lastIndex = 0;
    while ((match = literalKeyRe.exec(content)) !== null) {
      const literal = match[1];
      if (literal.includes(':') && !literal.endsWith(':') && !literal.startsWith('/')) {
        record(literal, file, hook);
      }
    }
  }

  return { handlers, registrations };
}

// ---------------------------------------------------------------------------
// Known intentional gaps
// ---------------------------------------------------------------------------

/**
 * Server broadcasts that intentionally have no frontend handler.
 *
 * Each entry must have a comment explaining why.
 */
const KNOWN_UNHANDLED_BROADCASTS = new Set<string>([
  // feedback:new / feedback:update — internal admin-to-admin signalling.
  // The Feedback feature is an internal tool; the admin panel does not
  // subscribe to these events in the current implementation.  Adding handlers
  // is tracked but not yet done.
  'feedback:new',
  'feedback:update',

  // post-updated — legacy string literal used in content-posts.ts for a draft
  // save flow that predates WS_EVENTS.  No frontend component subscribes to
  // this event; it should be migrated to WS_EVENTS.CONTENT_PUBLISHED.
  'post-updated',

  // schema:plan_sent — the server emits this after sending a schema plan email,
  // but there is no real-time UI reaction needed; the admin navigates away
  // before the event fires.  The constant is defined in WS_EVENTS for future use.
  'schema:plan_sent',

  // content-subscription:* — Stripe webhook events broadcast by stripe.ts via the
  // _broadcastFn alias.  These signal content subscription lifecycle changes but
  // the frontend does not yet subscribe to them; they are candidates for future
  // real-time UX (e.g. showing a "subscription activated" toast).
  'content-subscription:created',
  'content-subscription:updated',
  'content-subscription:renewed',

  // blueprint:updated / blueprint:generated — Page Strategy Engine (Phase 2).
  // Server broadcasts land in PR 2 (server routes); frontend handlers land in
  // PR 3 (PageStrategyTab component). These events are intentionally unhandled
  // until the frontend tab is implemented.
  'blueprint:updated',
  'blueprint:generated',

]);

/**
 * Frontend handlers for events that the server never emits via
 * broadcastToWorkspace().  Each entry must have a comment explaining why.
 */
const KNOWN_UNHANDLED_HANDLERS = new Set<string>([
  // presence:update — handled in WorkspaceOverview.tsx.  The server emits
  // this via a different code path (not broadcastToWorkspace) — it is a
  // direct admin presence broadcast, not a workspace-scoped event.
  'presence:update',

  // lg:grid-cols-5 — Tailwind responsive-prefix class used in a ternary
  // expression inside a template literal in WorkspaceHome.tsx:
  //   `... ? 'lg:grid-cols-5' : 'lg:grid-cols-4' ...`
  // The literalKeyRe scanner mistakes the ternary ' : ' for an object key
  // delimiter, capturing this CSS class as if it were a WS event name.
  // Not a WebSocket event — no server broadcast exists or is needed.
  'lg:grid-cols-5',

  // sm:grid-cols-5 — same false-positive pattern as lg:grid-cols-5 above,
  // occurring in WorkspaceOverview.tsx:
  //   `... ? 'sm:grid-cols-5' : 'sm:grid-cols-4' ...`
  'sm:grid-cols-5',
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const serverWsEventsMap = parseServerWsEvents();
const frontendWsEventsMap = parseFrontendWsEvents();
const serverBroadcasts = collectServerBroadcasts(serverWsEventsMap);
const { handlers: frontendHandlers, registrations: frontendRegistrations } = collectFrontendHandlers(frontendWsEventsMap);

/**
 * Workspace-scoped events: the subset of WS_EVENTS values that are broadcast
 * via `broadcastToWorkspace()` (as opposed to the global `_broadcast()`). Any
 * handler for a workspace-scoped event MUST use `useWorkspaceEvents`, NOT
 * `useGlobalAdminEvents`.
 *
 * We derive this dynamically: an event is "workspace-scoped" iff the server
 * scan found it inside a `broadcastToWorkspace` call. Events that only ever
 * appear in the WS_EVENTS constants map (or in a global `_broadcast`) are not
 * in this set and are legal targets for `useGlobalAdminEvents`.
 */
const workspaceScopedEventNames = new Set(serverBroadcasts.keys());

describe('broadcast ↔ handler pairing audit', () => {
  // ── Preconditions ──────────────────────────────────────────────────────────

  it('server/ws-events.ts defines at least one WS_EVENTS entry', () => {
    expect(serverWsEventsMap.size).toBeGreaterThan(0);
  });

  it('src/lib/wsEvents.ts (frontend mirror) defines at least one WS_EVENTS entry', () => {
    expect(frontendWsEventsMap.size).toBeGreaterThan(0);
  });

  it('server code contains broadcastToWorkspace() calls', () => {
    expect(serverBroadcasts.size).toBeGreaterThan(0);
  });

  it('frontend code registers at least one WebSocket handler', () => {
    expect(frontendHandlers.size).toBeGreaterThan(0);
  });

  // ── Constants mirror ───────────────────────────────────────────────────────

  it('server WS_EVENTS and frontend WS_EVENTS have identical keys', () => {
    const serverKeys = [...serverWsEventsMap.keys()].sort();
    const frontendKeys = [...frontendWsEventsMap.keys()].sort();
    expect(frontendKeys).toEqual(serverKeys);
  });

  it('server WS_EVENTS and frontend WS_EVENTS have identical string values', () => {
    const serverEntries = [...serverWsEventsMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const frontendEntries = [...frontendWsEventsMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(frontendEntries).toEqual(serverEntries);
  });

  // ── No orphaned broadcasts ─────────────────────────────────────────────────

  it('every server broadcast has at least one frontend handler (or is in KNOWN_UNHANDLED_BROADCASTS)', () => {
    const broadcastEventNames = [...serverBroadcasts.keys()];
    expect(broadcastEventNames.length).toBeGreaterThan(0);

    const orphaned: string[] = [];
    for (const eventName of broadcastEventNames) {
      if (KNOWN_UNHANDLED_BROADCASTS.has(eventName)) continue;
      if (!frontendHandlers.has(eventName)) {
        const files = serverBroadcasts.get(eventName)!;
        orphaned.push(`  '${eventName}' — broadcast in: ${files.join(', ')}`);
      }
    }

    if (orphaned.length > 0) {
      throw new Error(
        `Found ${orphaned.length} server broadcast(s) with no frontend handler.\n` +
        `Either add a handler in a useWebSocket/useWorkspaceEvents call, or add the event\n` +
        `name to KNOWN_UNHANDLED_BROADCASTS with a comment explaining why.\n\n` +
        orphaned.join('\n'),
      );
    }
  });

  // ── No orphaned handlers ───────────────────────────────────────────────────

  it('every frontend handler references an event the server actually broadcasts (or is in KNOWN_UNHANDLED_HANDLERS)', () => {
    const handlerEventNames = [...frontendHandlers.keys()];
    expect(handlerEventNames.length).toBeGreaterThan(0);

    // Build the full set of known event strings (WS_EVENTS values + raw literals)
    const knownServerEvents = new Set<string>([
      ...serverBroadcasts.keys(),
    ]);

    const orphaned: string[] = [];
    for (const eventName of handlerEventNames) {
      if (KNOWN_UNHANDLED_HANDLERS.has(eventName)) continue;
      if (!knownServerEvents.has(eventName)) {
        const files = frontendHandlers.get(eventName)!;
        orphaned.push(`  '${eventName}' — handled in: ${files.join(', ')}`);
      }
    }

    if (orphaned.length > 0) {
      throw new Error(
        `Found ${orphaned.length} frontend handler(s) for events the server never broadcasts.\n` +
        `Either add a broadcastToWorkspace() call in the relevant server route, or add the event\n` +
        `name to KNOWN_UNHANDLED_HANDLERS with a comment explaining why.\n\n` +
        orphaned.join('\n'),
      );
    }
  });

  // ── WS_EVENTS definition coverage ─────────────────────────────────────────

  it('every WS_EVENTS constant is actually used in a broadcastToWorkspace() call', () => {
    const definedValues = [...serverWsEventsMap.values()];
    expect(definedValues.length).toBeGreaterThan(0);

    const unusedConstants: string[] = [];
    for (const value of definedValues) {
      if (!serverBroadcasts.has(value)) {
        unusedConstants.push(`  '${value}'`);
      }
    }

    // schema:plan_sent is known to be broadcast — if it appears here it means
    // the static scan missed it.  We treat unused constants as a test failure
    // so that dead constants are cleaned up rather than accumulating.
    if (unusedConstants.length > 0) {
      throw new Error(
        `Found ${unusedConstants.length} WS_EVENTS constant(s) that are never used in broadcastToWorkspace().\n` +
        `Either add a broadcastToWorkspace() call that uses them, or remove the constant.\n\n` +
        unusedConstants.join('\n'),
      );
    }
  });

  it('every WS_EVENTS constant is handled by at least one frontend handler (or is in KNOWN_UNHANDLED_BROADCASTS)', () => {
    const definedValues = [...serverWsEventsMap.values()];
    expect(definedValues.length).toBeGreaterThan(0);

    const unhandled: string[] = [];
    for (const value of definedValues) {
      if (KNOWN_UNHANDLED_BROADCASTS.has(value)) continue;
      if (!frontendHandlers.has(value)) {
        unhandled.push(`  '${value}'`);
      }
    }

    if (unhandled.length > 0) {
      throw new Error(
        `Found ${unhandled.length} WS_EVENTS constant(s) with no matching frontend handler.\n` +
        `Either add a handler in useWsInvalidation.ts or a component, or add the event to\n` +
        `KNOWN_UNHANDLED_BROADCASTS with a comment explaining why.\n\n` +
        unhandled.join('\n'),
      );
    }
  });

  // ── KNOWN_* lists stay accurate ────────────────────────────────────────────

  it('KNOWN_UNHANDLED_BROADCASTS contains only events that are truly unhandled', () => {
    const knownList = [...KNOWN_UNHANDLED_BROADCASTS];
    expect(knownList.length).toBeGreaterThan(0);

    const falsePositives: string[] = [];
    for (const eventName of knownList) {
      if (frontendHandlers.has(eventName)) {
        falsePositives.push(`  '${eventName}' — now has a frontend handler; remove from KNOWN_UNHANDLED_BROADCASTS`);
      }
    }

    if (falsePositives.length > 0) {
      throw new Error(
        `KNOWN_UNHANDLED_BROADCASTS is stale — these events now have frontend handlers:\n\n` +
        falsePositives.join('\n'),
      );
    }
  });

  it('KNOWN_UNHANDLED_HANDLERS contains only events that the server truly never broadcasts', () => {
    const knownList = [...KNOWN_UNHANDLED_HANDLERS];
    expect(knownList.length).toBeGreaterThan(0);

    const falsePositives: string[] = [];
    for (const eventName of knownList) {
      if (serverBroadcasts.has(eventName)) {
        falsePositives.push(`  '${eventName}' — now has a server broadcast; remove from KNOWN_UNHANDLED_HANDLERS`);
      }
    }

    if (falsePositives.length > 0) {
      throw new Error(
        `KNOWN_UNHANDLED_HANDLERS is stale — these events are now broadcast by the server:\n\n` +
        falsePositives.join('\n'),
      );
    }
  });

  // ── Workspace-scoped events must use useWorkspaceEvents ────────────────────
  //
  // Root-cause regression guard for PR #162. Four brand-engine tabs registered
  // handlers for `brandscript:updated` / `discovery:updated` / `voice:updated`
  // / `brand-identity:updated` via `useWebSocket` (the global-events hook,
  // since renamed to `useGlobalAdminEvents`). That hook never sends a
  // `subscribe` action, so the server's `_broadcastToWorkspace` filter
  // excluded the connection and every handler was dead code. This test makes
  // that mistake impossible to repeat: any file that handles a workspace-
  // scoped event via the global hook fails the test.

  it('workspace-scoped events are handled via useWorkspaceEvents, not useGlobalAdminEvents', () => {
    const violations: string[] = [];
    for (const reg of frontendRegistrations) {
      // Only check events the server actually broadcasts as workspace-scoped.
      // A handler for a global-only or unknown event is this test's blind spot
      // and is covered by the other tests above.
      if (!workspaceScopedEventNames.has(reg.eventName)) continue;
      if (reg.hook === 'useGlobalAdminEvents') {
        violations.push(
          `  '${reg.eventName}' — handled via useGlobalAdminEvents in ${reg.file}\n` +
          `    Switch to useWorkspaceEvents(workspaceId, { ... }). useGlobalAdminEvents\n` +
          `    never sends a 'subscribe' action, so this handler will never fire.`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} workspace-scoped event handler(s) registered via\n` +
        `useGlobalAdminEvents. This hook is reserved for non-workspace events\n` +
        `(ADMIN_EVENTS.*, presence:update) and does NOT subscribe to any workspace.\n\n` +
        violations.join('\n'),
      );
    }
  });

  // ── No raw string literals in server broadcasts ────────────────────────────

  it('server broadcastToWorkspace() calls use WS_EVENTS constants, not raw string literals (except known gaps)', () => {
    // Any broadcast event that is NOT a value inside WS_EVENTS is a raw literal
    const wsEventsValues = new Set(serverWsEventsMap.values());

    const rawLiteralBroadcasts: string[] = [];
    for (const [eventName, files] of serverBroadcasts) {
      if (eventName.startsWith('UNRESOLVED:')) continue; // already flagged by other tests
      if (!wsEventsValues.has(eventName) && !KNOWN_UNHANDLED_BROADCASTS.has(eventName)) {
        rawLiteralBroadcasts.push(`  '${eventName}' — in ${files.join(', ')}`);
      }
    }

    // Known raw literals that have not yet been migrated to WS_EVENTS
    const knownRawLiterals = new Set<string>([
      'feedback:new',
      'feedback:update',
      'post-updated',
    ]);

    const unexpected = rawLiteralBroadcasts.filter(line => {
      const eventName = line.match(/'([^']+)'/)?.[1];
      return eventName && !knownRawLiterals.has(eventName);
    });

    if (unexpected.length > 0) {
      throw new Error(
        `Found ${unexpected.length} broadcastToWorkspace() call(s) using a raw string literal\n` +
        `instead of a WS_EVENTS constant.  Add the event to server/ws-events.ts and\n` +
        `src/lib/wsEvents.ts, then use WS_EVENTS.YOUR_KEY.\n\n` +
        unexpected.join('\n'),
      );
    }
  });
});
