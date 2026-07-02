// tests/contract/ws-events-parity.test.ts
//
// CONTRACT: server/ws-events.ts and src/lib/wsEvents.ts are a MANUAL lockstep
// mirror (see the header comment in both files: "Keep in sync with ..."). There
// was previously no automated parity check, so a server-only event addition
// (or a frontend-only addition) could slip through every existing contract net
// — ws-invalidation-coverage.test.ts only checks that frontend WS_EVENTS keys
// have invalidation handlers; it says nothing about whether the frontend copy
// matches the server source of truth.
//
// This test runtime-imports BOTH modules (no source-text parsing) and asserts
// the FULL key→value entry maps of WS_EVENTS and ADMIN_EVENTS are identical on
// both sides, modulo an explicit per-registry DOCUMENTED_EXCEPTIONS record
// (empty to start — every entry must round-trip through both files today).
//
// Entry-level comparison (not value sets) is deliberate: it catches key
// renames that preserve the wire value, same-key value divergence, AND
// duplicate-value additions that a value-set comparison would collapse.
//
// Both directions are checked independently so a failure message always names
// exactly which entries are missing and from which side. The fixture-copy
// regression tests exercise the SAME diffEventEntries helper as the real
// assertions, so the mechanism itself is proven non-vacuous.

import { describe, expect, it } from 'vitest';
import {
  ADMIN_EVENTS as SERVER_ADMIN_EVENTS,
  WS_EVENTS as SERVER_WS_EVENTS,
} from '../../server/ws-events.js';
import {
  ADMIN_EVENTS as FRONTEND_ADMIN_EVENTS,
  WS_EVENTS as FRONTEND_WS_EVENTS,
} from '../../src/lib/wsEvents.js';

// ---------------------------------------------------------------------------
// Documented exceptions — per registry
//
// Maps event string VALUE → rationale for values intentionally allowed to
// diverge between the two modules. Empty by design: both registries are meant
// to be exact mirrors. The Record<value, rationale> shape makes it impossible
// to add an exception without writing down why. Exceptions are per-registry
// because some values (e.g. 'workspace:updated', 'request:created')
// legitimately appear in BOTH WS_EVENTS and ADMIN_EVENTS — a shared map would
// leak an exception from one registry into the other.
//
// Add an entry ONLY after a reviewed decision — this test must never be
// weakened silently to paper over real drift.
// ---------------------------------------------------------------------------

const WS_EVENTS_DOCUMENTED_EXCEPTIONS: Readonly<Record<string, string>> = {};
const ADMIN_EVENTS_DOCUMENTED_EXCEPTIONS: Readonly<Record<string, string>> = {};

// ---------------------------------------------------------------------------
// Shared comparison helper — used by BOTH the real parity assertions and the
// fixture-copy regression tests below, so the fixtures exercise the actual
// production comparison path.
// ---------------------------------------------------------------------------

interface EventValueMismatch {
  key: string;
  serverValue: string;
  frontendValue: string;
}

interface EventEntryDiff {
  /** Server entries after removing excepted values. */
  filteredServer: Record<string, string>;
  /** Frontend entries after removing excepted values. */
  filteredFrontend: Record<string, string>;
  /** [key, value] entries present in server but whose key is absent from frontend. */
  onlyInServer: Array<[key: string, value: string]>;
  /** [key, value] entries present in frontend but whose key is absent from server. */
  onlyInFrontend: Array<[key: string, value: string]>;
  /** Keys present on both sides but mapping to different string values. */
  valueMismatches: EventValueMismatch[];
}

function omitExceptedValues(
  entries: Record<string, string>,
  exceptions: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => !Object.hasOwn(exceptions, value)));
}

function diffEventEntries(
  server: Record<string, string>,
  frontend: Record<string, string>,
  exceptions: Readonly<Record<string, string>>,
): EventEntryDiff {
  const filteredServer = omitExceptedValues(server, exceptions);
  const filteredFrontend = omitExceptedValues(frontend, exceptions);

  const onlyInServer: Array<[string, string]> = [];
  const onlyInFrontend: Array<[string, string]> = [];
  const valueMismatches: EventValueMismatch[] = [];

  for (const [key, value] of Object.entries(filteredServer)) {
    if (!(key in filteredFrontend)) {
      onlyInServer.push([key, value]);
    } else if (filteredFrontend[key] !== value) {
      valueMismatches.push({ key, serverValue: value, frontendValue: filteredFrontend[key] });
    }
  }

  for (const [key, value] of Object.entries(filteredFrontend)) {
    if (!(key in filteredServer)) {
      onlyInFrontend.push([key, value]);
    }
  }

  return { filteredServer, filteredFrontend, onlyInServer, onlyInFrontend, valueMismatches };
}

function formatEntries(entries: Array<[string, string]>): string {
  return entries.map(([key, value]) => `  ${key}: '${value}'`).join('\n');
}

// ---------------------------------------------------------------------------
// Parity assertions — run identically for WS_EVENTS and ADMIN_EVENTS
// ---------------------------------------------------------------------------

interface RegistryCase {
  name: string;
  serverRegistry: Record<string, string>;
  frontendRegistry: Record<string, string>;
  exceptions: Readonly<Record<string, string>>;
}

const REGISTRY_CASES: RegistryCase[] = [
  {
    name: 'WS_EVENTS',
    serverRegistry: SERVER_WS_EVENTS,
    frontendRegistry: FRONTEND_WS_EVENTS,
    exceptions: WS_EVENTS_DOCUMENTED_EXCEPTIONS,
  },
  {
    name: 'ADMIN_EVENTS',
    serverRegistry: SERVER_ADMIN_EVENTS,
    frontendRegistry: FRONTEND_ADMIN_EVENTS,
    exceptions: ADMIN_EVENTS_DOCUMENTED_EXCEPTIONS,
  },
];

describe.each(REGISTRY_CASES)(
  '$name server/frontend mirror parity contract',
  ({ name, serverRegistry, frontendRegistry, exceptions }) => {
    const diff = diffEventEntries(serverRegistry, frontendRegistry, exceptions);

    it('imports a non-empty entry map from both modules (sanity check)', () => {
      expect(Object.keys(serverRegistry).length).toBeGreaterThan(0);
      expect(Object.keys(frontendRegistry).length).toBeGreaterThan(0);
    });

    it('has no server-only entries missing from the frontend mirror', () => {
      if (diff.onlyInServer.length > 0) {
        throw new Error(
          `The following ${name} entries exist in server/ws-events.ts but are missing from ` +
          `src/lib/wsEvents.ts:\n\n` +
          formatEntries(diff.onlyInServer) +
          `\n\nAdd the matching constant(s) to src/lib/wsEvents.ts (same key AND same string value), ` +
          `or add the event value to ${name}_DOCUMENTED_EXCEPTIONS in this test with a rationale ` +
          `if the divergence is intentional.`,
        );
      }

      expect(diff.onlyInServer).toHaveLength(0);
    });

    it('has no frontend-only entries missing from the server registry', () => {
      if (diff.onlyInFrontend.length > 0) {
        throw new Error(
          `The following ${name} entries exist in src/lib/wsEvents.ts but are missing from ` +
          `server/ws-events.ts:\n\n` +
          formatEntries(diff.onlyInFrontend) +
          `\n\nAdd the matching constant(s) to server/ws-events.ts (same key AND same string value), ` +
          `or add the event value to ${name}_DOCUMENTED_EXCEPTIONS in this test with a rationale ` +
          `if the divergence is intentional.`,
        );
      }

      expect(diff.onlyInFrontend).toHaveLength(0);
    });

    it('has no same-key value mismatches between the two modules', () => {
      if (diff.valueMismatches.length > 0) {
        throw new Error(
          `The following ${name} keys exist on both sides but map to DIFFERENT string values — ` +
          `likely a wire-format rename applied to only one file:\n\n` +
          diff.valueMismatches
            .map((m) => `  ${m.key}: server '${m.serverValue}' vs frontend '${m.frontendValue}'`)
            .join('\n') +
          `\n\nAlign the value in server/ws-events.ts and src/lib/wsEvents.ts (the server file is ` +
          `the source of truth).`,
        );
      }

      expect(diff.valueMismatches).toHaveLength(0);
    });

    it('exports identical key→value entry maps (modulo documented exceptions)', () => {
      // Never a vacuous pass on empty collections (house rule).
      expect(Object.keys(diff.filteredServer).length).toBeGreaterThan(0);
      expect(Object.keys(diff.filteredFrontend).length).toBeGreaterThan(0);
      // Full entry-map equality: catches missing keys, extra keys, key renames
      // that preserve values, duplicate-value collapse, and value divergence
      // in one cardinality-sensitive comparison.
      expect(diff.filteredServer).toEqual(diff.filteredFrontend);
    });

    it('documented exceptions reference only values involved in real divergence (no stale exemptions)', () => {
      const rawDiff = diffEventEntries(serverRegistry, frontendRegistry, {});
      const divergentValues = new Set<string>([
        ...rawDiff.onlyInServer.map(([, value]) => value),
        ...rawDiff.onlyInFrontend.map(([, value]) => value),
        ...rawDiff.valueMismatches.flatMap((m) => [m.serverValue, m.frontendValue]),
      ]);

      const stale = Object.keys(exceptions).filter((value) => !divergentValues.has(value));

      if (stale.length > 0) {
        throw new Error(
          `${name}_DOCUMENTED_EXCEPTIONS lists values that no longer diverge between ` +
          `server/ws-events.ts and src/lib/wsEvents.ts (or never existed on either side):\n\n` +
          stale.map((value) => `  '${value}'`).join('\n') +
          `\n\nRemove stale entries to keep the exemption list accurate.`,
        );
      }

      expect(stale).toHaveLength(0);
    });
  },
);

// ---------------------------------------------------------------------------
// Regression guards on the comparison mechanism itself — every fixture goes
// through the SAME diffEventEntries helper as the real assertions above, so a
// weakening of the helper fails these tests too.
// ---------------------------------------------------------------------------

describe('diffEventEntries mechanism regression guards (fixture copies, real modules untouched)', () => {
  it('detects a server-only addition', () => {
    const fixtureServer = { ...SERVER_WS_EVENTS, FIXTURE_ONLY: 'fixture-only:server-added' };
    const diff = diffEventEntries(fixtureServer, FRONTEND_WS_EVENTS, {});

    expect(diff.onlyInServer).toEqual([['FIXTURE_ONLY', 'fixture-only:server-added']]);
    expect(diff.onlyInFrontend).toEqual([]);
    expect(diff.valueMismatches).toEqual([]);
    expect(diff.filteredServer).not.toEqual(diff.filteredFrontend);
  });

  it('detects a frontend-only addition', () => {
    const fixtureFrontend = { ...FRONTEND_WS_EVENTS, FIXTURE_ONLY: 'fixture-only:frontend-added' };
    const diff = diffEventEntries(SERVER_WS_EVENTS, fixtureFrontend, {});

    expect(diff.onlyInFrontend).toEqual([['FIXTURE_ONLY', 'fixture-only:frontend-added']]);
    expect(diff.onlyInServer).toEqual([]);
    expect(diff.valueMismatches).toEqual([]);
    expect(diff.filteredServer).not.toEqual(diff.filteredFrontend);
  });

  it('detects a key rename that preserves the wire value (value-set comparison would miss this)', () => {
    const fixtureServer: Record<string, string> = { ...SERVER_WS_EVENTS };
    delete fixtureServer.JOB_CREATED;
    fixtureServer.JOB_CREATED_RENAMED = SERVER_WS_EVENTS.JOB_CREATED;

    const diff = diffEventEntries(fixtureServer, FRONTEND_WS_EVENTS, {});

    expect(diff.onlyInServer).toEqual([['JOB_CREATED_RENAMED', SERVER_WS_EVENTS.JOB_CREATED]]);
    expect(diff.onlyInFrontend).toEqual([['JOB_CREATED', SERVER_WS_EVENTS.JOB_CREATED]]);
    expect(diff.filteredServer).not.toEqual(diff.filteredFrontend);
  });

  it('detects a duplicate-value alias key (value-set comparison would collapse the cardinality)', () => {
    const fixtureServer = { ...SERVER_WS_EVENTS, JOB_CREATED_ALIAS: SERVER_WS_EVENTS.JOB_CREATED };
    const diff = diffEventEntries(fixtureServer, FRONTEND_WS_EVENTS, {});

    expect(diff.onlyInServer).toEqual([['JOB_CREATED_ALIAS', SERVER_WS_EVENTS.JOB_CREATED]]);
    expect(diff.filteredServer).not.toEqual(diff.filteredFrontend);
  });

  it('detects a same-key value divergence', () => {
    const fixtureFrontend = { ...FRONTEND_WS_EVENTS, JOB_CREATED: 'job:created-v2' };
    const diff = diffEventEntries(SERVER_WS_EVENTS, fixtureFrontend, {});

    expect(diff.valueMismatches).toEqual([
      { key: 'JOB_CREATED', serverValue: SERVER_WS_EVENTS.JOB_CREATED, frontendValue: 'job:created-v2' },
    ]);
    expect(diff.filteredServer).not.toEqual(diff.filteredFrontend);
  });

  it('a documented exception silences exactly the excepted divergence and nothing else', () => {
    const fixtureServer = { ...SERVER_WS_EVENTS, FIXTURE_ONLY: 'fixture-only:server-added' };
    const diff = diffEventEntries(fixtureServer, FRONTEND_WS_EVENTS, {
      'fixture-only:server-added': 'fixture rationale — proves the exception mechanism works',
    });

    expect(diff.onlyInServer).toEqual([]);
    expect(diff.onlyInFrontend).toEqual([]);
    expect(diff.valueMismatches).toEqual([]);
    expect(diff.filteredServer).toEqual(diff.filteredFrontend);
  });
});
