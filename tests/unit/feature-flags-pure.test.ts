/**
 * Unit tests for server/feature-flags.ts — business logic coverage.
 *
 * These tests exercise the core resolution functions directly against the
 * real SQLite DB (same singleton used by all unit tests). They clean up any
 * overrides they set to avoid polluting sibling test runs.
 *
 * Note: clearFlagOverride is not a distinct export — the module exposes
 * setFlagOverride(key, null) as the canonical way to clear an override.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getAllFlags,
  getAllFlagsWithMeta,
  setFlagOverride,
  isFeatureEnabled,
} from '../../server/feature-flags.js';
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS } from '../../shared/types/feature-flags.js';

// A stable flag key we can safely toggle in tests without risking real behaviour.
// 'copy-engine' is always false by default and not read on hot paths.
const TEST_FLAG = 'copy-engine' as const;
// A second flag for cross-flag isolation tests.
const TEST_FLAG_2 = 'deep-diagnostics' as const;

afterEach(() => {
  // Remove any DB overrides set during tests so subsequent runs start clean.
  setFlagOverride(TEST_FLAG, null);
  setFlagOverride(TEST_FLAG_2, null);
});

// ── getAllFlags() ─────────────────────────────────────────────────────────────

describe('getAllFlags()', () => {
  it('returns an object containing every key defined in FEATURE_FLAGS', () => {
    const flags = getAllFlags();
    for (const key of FEATURE_FLAG_KEYS) {
      expect(key in flags).toBe(true);
    }
  });

  it('returns no extra keys beyond FEATURE_FLAG_KEYS', () => {
    const flags = getAllFlags();
    const returnedKeys = Object.keys(flags);
    expect(returnedKeys.length).toBe(FEATURE_FLAG_KEYS.length);
  });

  it('returns boolean values for every flag', () => {
    const flags = getAllFlags();
    for (const key of FEATURE_FLAG_KEYS) {
      expect(typeof flags[key]).toBe('boolean');
    }
  });

  it('reflects default values when no overrides are set', () => {
    // Ensure no override for TEST_FLAG.
    setFlagOverride(TEST_FLAG, null);
    const flags = getAllFlags();
    expect(flags[TEST_FLAG]).toBe(FEATURE_FLAGS[TEST_FLAG]);
  });

  it('reflects a DB override of true after setFlagOverride(key, true)', () => {
    setFlagOverride(TEST_FLAG, true);
    const flags = getAllFlags();
    expect(flags[TEST_FLAG]).toBe(true);
  });

  it('reflects a DB override of false after setFlagOverride(key, false)', () => {
    setFlagOverride(TEST_FLAG, false);
    const flags = getAllFlags();
    expect(flags[TEST_FLAG]).toBe(false);
  });

  it('reverts to default after clearing a DB override via setFlagOverride(key, null)', () => {
    setFlagOverride(TEST_FLAG, true);
    setFlagOverride(TEST_FLAG, null);
    const flags = getAllFlags();
    expect(flags[TEST_FLAG]).toBe(FEATURE_FLAGS[TEST_FLAG]);
  });
});

// ── isFeatureEnabled() ────────────────────────────────────────────────────────

describe('isFeatureEnabled()', () => {
  it('returns boolean for any valid flag key', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(typeof isFeatureEnabled(key)).toBe('boolean');
    }
  });

  it('returns true after setFlagOverride(key, true)', () => {
    setFlagOverride(TEST_FLAG, true);
    expect(isFeatureEnabled(TEST_FLAG)).toBe(true);
  });

  it('returns false after setFlagOverride(key, false)', () => {
    setFlagOverride(TEST_FLAG, false);
    expect(isFeatureEnabled(TEST_FLAG)).toBe(false);
  });

  it('returns to the hardcoded default after clearing the override', () => {
    setFlagOverride(TEST_FLAG, true);
    setFlagOverride(TEST_FLAG, null);
    expect(isFeatureEnabled(TEST_FLAG)).toBe(FEATURE_FLAGS[TEST_FLAG]);
  });

  it('does not affect other flags when one is overridden', () => {
    const before = isFeatureEnabled(TEST_FLAG_2);
    setFlagOverride(TEST_FLAG, true);
    expect(isFeatureEnabled(TEST_FLAG_2)).toBe(before);
  });
});

// ── getAllFlagsWithMeta() ─────────────────────────────────────────────────────

describe('getAllFlagsWithMeta()', () => {
  it('returns one entry per flag key', () => {
    const meta = getAllFlagsWithMeta();
    expect(meta.length).toBe(FEATURE_FLAG_KEYS.length);
  });

  it('every entry has the correct shape', () => {
    const meta = getAllFlagsWithMeta();
    for (const entry of meta) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.enabled).toBe('boolean');
      expect(typeof entry.source).toBe('string');
      expect(typeof entry.default).toBe('boolean');
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.group).toBe('string');
      expect(typeof entry.lifecycle).toBe('object');
      expect(entry.lifecycle).not.toBeNull();
    }
  });

  it('source is one of "db" | "env" | "default" for every entry', () => {
    const validSources = new Set(['db', 'env', 'default']);
    const meta = getAllFlagsWithMeta();
    for (const entry of meta) {
      expect(validSources.has(entry.source)).toBe(true);
    }
  });

  it('entry for TEST_FLAG has source "default" when no override is set', () => {
    setFlagOverride(TEST_FLAG, null);
    const meta = getAllFlagsWithMeta();
    const entry = meta.find(e => e.key === TEST_FLAG);
    expect(entry).toBeDefined();
    // If no env var is set for this flag the source must be 'default'.
    // (Tests run without FEATURE_COPY_ENGINE env var.)
    expect(entry!.source).toBe('default');
  });

  it('entry for TEST_FLAG has source "db" and enabled=true after setting a DB override', () => {
    setFlagOverride(TEST_FLAG, true);
    const meta = getAllFlagsWithMeta();
    const entry = meta.find(e => e.key === TEST_FLAG);
    expect(entry).toBeDefined();
    expect(entry!.source).toBe('db');
    expect(entry!.enabled).toBe(true);
  });

  it('entry for TEST_FLAG has source "db" and enabled=false after setting override to false', () => {
    setFlagOverride(TEST_FLAG, false);
    const meta = getAllFlagsWithMeta();
    const entry = meta.find(e => e.key === TEST_FLAG);
    expect(entry).toBeDefined();
    expect(entry!.source).toBe('db');
    expect(entry!.enabled).toBe(false);
  });

  it('reverts source to "default" and enabled to default value after clearing the override', () => {
    setFlagOverride(TEST_FLAG, true);
    setFlagOverride(TEST_FLAG, null);
    const meta = getAllFlagsWithMeta();
    const entry = meta.find(e => e.key === TEST_FLAG);
    expect(entry).toBeDefined();
    expect(entry!.source).toBe('default');
    expect(entry!.enabled).toBe(FEATURE_FLAGS[TEST_FLAG]);
  });

  it('default field always equals FEATURE_FLAGS default regardless of override', () => {
    setFlagOverride(TEST_FLAG, true);
    const meta = getAllFlagsWithMeta();
    const entry = meta.find(e => e.key === TEST_FLAG);
    expect(entry).toBeDefined();
    // .default should reflect the hardcoded default, not the DB override.
    expect(entry!.default).toBe(FEATURE_FLAGS[TEST_FLAG]);
  });

  it('covers all flag keys — no key is missing from the returned array', () => {
    const meta = getAllFlagsWithMeta();
    const returnedKeys = new Set(meta.map(e => e.key));
    for (const key of FEATURE_FLAG_KEYS) {
      expect(returnedKeys.has(key)).toBe(true);
    }
  });
});

// ── setFlagOverride() — idempotency and upsert behaviour ────────────────────

describe('setFlagOverride()', () => {
  it('can be called twice with different values — last write wins', () => {
    setFlagOverride(TEST_FLAG, true);
    setFlagOverride(TEST_FLAG, false);
    expect(isFeatureEnabled(TEST_FLAG)).toBe(false);
  });

  it('calling with null when no override exists does not throw', () => {
    // Ensure clean state.
    setFlagOverride(TEST_FLAG, null);
    expect(() => setFlagOverride(TEST_FLAG, null)).not.toThrow();
  });

  it('invalidates the in-memory cache so the next read reflects the new value', () => {
    // Read once to warm the cache.
    isFeatureEnabled(TEST_FLAG);
    setFlagOverride(TEST_FLAG, true);
    // Must reflect the new value immediately — no TTL delay.
    expect(isFeatureEnabled(TEST_FLAG)).toBe(true);
  });
});
