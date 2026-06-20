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
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  collectFrontendHandlers,
  collectServerBroadcasts,
  parseWsEvents,
} from '../../scripts/ws-contract-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

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
  return parseWsEvents(readFileSync(filePath, 'utf-8')); // readFile-ok — intentional static analysis of WS event constants.
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
  return parseWsEvents(readFileSync(filePath, 'utf-8')); // readFile-ok — intentional static analysis of frontend WS event mirror.
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
  // deliverable:sent / deliverable:updated are now HANDLED by the PR-2a client unified inbox
  // (src/components/client/inbox/UnifiedInbox.tsx wires useWorkspaceEvents for both, invalidating
  // the unified-inbox query). They are intentionally NOT listed here anymore. (The admin inbox
  // half lands in PR-2b; a single frontend handler already satisfies this contract.)

  // job:created / job:update are now HANDLED in ClientDashboard.tsx (R2-B
  // agency work feed wires useWorkspaceEvents for both, invalidating the
  // client work-feed queries) in addition to BackgroundTaskProvider /
  // useBackgroundTasks. They are intentionally NOT listed here anymore.

  // strategy:issue-pushed (The Issue, Phase 3) — the pushed-Issue cron's operator-doorbell signal.
  // The visible NotificationBell entry derives from the polled /api/workspace-overview summary
  // (issue.ready / issue.pushedWeekOf), which self-refreshes every 5 min — the same poll-driven
  // pattern as requests/approvals/rec-responses (none have WS handlers). No frontend handler keys
  // off this broadcast directly; it is intentionally unhandled.
  'strategy:issue-pushed',
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

  // job:created / job:update — handled in ClientDashboard.tsx (R2-B agency
  // work feed). The server emits these through the jobs subsystem dispatcher
  // (server/jobs.ts broadcastJobEvent via initJobs), not a literal
  // broadcastToWorkspace() call, so this static scan cannot see the producer
  // even though the events are live. Same rationale as the
  // KNOWN_CONSTANTS_PENDING_ROUTES entries for these events below.
  'job:created',
  'job:update',

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
const serverBroadcasts = collectServerBroadcasts(ROOT, serverWsEventsMap);
const { handlers: frontendHandlers, registrations: frontendRegistrations } = collectFrontendHandlers(ROOT, frontendWsEventsMap);

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

  const KNOWN_CONSTANTS_PENDING_ROUTES = new Set<string>([
    // Job lifecycle is emitted through the jobs subsystem dispatcher rather
    // than a literal broadcastToWorkspace() call, so this static scan cannot
    // see the producer even though the events are live.
    'job:created',
    'job:update',
  ]);

  it('every WS_EVENTS constant is actually used in a broadcastToWorkspace() call', () => {
    const definedValues = [...serverWsEventsMap.values()];
    expect(definedValues.length).toBeGreaterThan(0);

    const unusedConstants: string[] = [];
    for (const value of definedValues) {
      if (!serverBroadcasts.has(value) && !KNOWN_CONSTANTS_PENDING_ROUTES.has(value)) {
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
