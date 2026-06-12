/**
 * Wave 2 T2 — fmtNum + kdColor/kdLabel authority tests.
 *
 * These tests must go RED before the implementation is applied and GREEN after.
 *
 * Decisions pinned here:
 *   - fmtNum canonical: UPPERCASE K/M (src/utils/formatNumbers.ts)
 *   - fmtNumSafe: null-safe wrapper returning '-' for null/undefined
 *   - kdColor/kdLabel bands: 30/50/70 (pageIntelligenceDisplay authority)
 *   - compactNumber in kccDisplayHelpers re-routes to fmtNum + '-' sentinel
 */
import { describe, it, expect } from 'vitest';

// ─── Volume formatter authority ────────────────────────────────────────────

import { fmtNum, fmtNumSafe } from '../../src/utils/formatNumbers';

describe('fmtNum — canonical volume formatter (UPPERCASE K/M)', () => {
  it('formats 1234 as 1.2K (UPPERCASE)', () => {
    expect(fmtNum(1_234)).toBe('1.2K');
  });

  it('formats 1500000 as 1.5M', () => {
    expect(fmtNum(1_500_000)).toBe('1.5M');
  });

  it('formats 999 without suffix', () => {
    const result = fmtNum(999);
    expect(result).not.toContain('K');
    expect(result).not.toContain('k');
    expect(result).not.toContain('M');
    expect(result).not.toContain('m');
  });

  it('formats 0 without suffix', () => {
    const result = fmtNum(0);
    expect(result).not.toContain('K');
    expect(result).not.toContain('M');
  });
});

describe('fmtNumSafe — null-safe wrapper preserving the "-" sentinel', () => {
  it('returns "-" for null', () => {
    expect(fmtNumSafe(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(fmtNumSafe(undefined)).toBe('-');
  });

  it('delegates to fmtNum for a valid number', () => {
    expect(fmtNumSafe(1_234)).toBe('1.2K');
    expect(fmtNumSafe(1_500_000)).toBe('1.5M');
    expect(fmtNumSafe(500)).toBe(fmtNum(500));
  });

  it('formats 0 via fmtNum (not the "-" sentinel)', () => {
    // 0 is a valid volume (very niche term) — it should NOT be treated as null
    expect(fmtNumSafe(0)).toBe(fmtNum(0));
  });
});

// ─── kccDisplayHelpers.compactNumber delegates to fmtNum + preserves sentinel ─

import { compactNumber } from '../../src/components/keyword-command-center/kccDisplayHelpers';

describe('kccDisplayHelpers.compactNumber — delegates to canonical fmtNum + preserves sentinel', () => {
  it('returns "-" for null/undefined (sentinel preserved)', () => {
    expect(compactNumber(undefined)).toBe('-');
    expect(compactNumber(null as unknown as undefined)).toBe('-');
  });

  it('formats 1234 as 1.2K (canonical UPPERCASE form)', () => {
    // Previously this was already UPPERCASE K — verifying the form is unchanged after migration
    expect(compactNumber(1_234)).toBe('1.2K');
  });

  it('formats 1500000 as 1.5M', () => {
    expect(compactNumber(1_500_000)).toBe('1.5M');
  });

  it('formats sub-1000 values as integers (Math.round)', () => {
    expect(compactNumber(500)).toBe('500');
    expect(compactNumber(0)).toBe('0');
  });
});

// ─── strategyKeywordDisplay no longer defines its own fmtNum ──────────────

describe('strategyKeywordDisplay — fmtNum is no longer defined locally', () => {
  it('imports fmtNum from the canonical module (not re-exporting a lowercase-k dup)', async () => {
    // strategyKeywordDisplay must NOT export fmtNum at all after T2.
    // The canonical fmtNum lives in src/utils/formatNumbers.ts.
    // This test imports strategyKeywordDisplay and confirms fmtNum is not exported from it.
    const mod = await import('../../src/components/client/strategy/strategyKeywordDisplay');
    expect((mod as Record<string, unknown>)['fmtNum']).toBeUndefined();
  });

  it('does not export a local kdColor either', async () => {
    // kdColor authority lives in pageIntelligenceDisplay — not in strategyKeywordDisplay.
    const mod = await import('../../src/components/client/strategy/strategyKeywordDisplay');
    expect((mod as Record<string, unknown>)['kdColor']).toBeUndefined();
  });
});

// ─── KD authority — 30/50/70 bands ────────────────────────────────────────

import { kdColor, kdLabel } from '../../src/components/page-intelligence/pageIntelligenceDisplay';

describe('kdColor — canonical 30/50/70 band scheme', () => {
  it('returns muted for undefined', () => {
    expect(kdColor(undefined)).toBe('text-[var(--brand-text-muted)]');
  });

  it('Easy band: kd=0 → success (emerald)', () => {
    // kd=0 must be emerald (success), NOT muted — zero-difficulty is still a valid score
    expect(kdColor(0)).toBe('text-accent-success');
  });

  it('Easy band: kd=30 → success (boundary)', () => {
    expect(kdColor(30)).toBe('text-accent-success');
  });

  it('Medium band: kd=31 → warning (amber)', () => {
    expect(kdColor(31)).toBe('text-accent-warning');
  });

  it('Medium band: kd=50 → warning (boundary)', () => {
    expect(kdColor(50)).toBe('text-accent-warning');
  });

  it('Hard band: kd=51 → orange', () => {
    expect(kdColor(51)).toBe('text-accent-orange');
  });

  it('Hard band: kd=70 → orange (boundary)', () => {
    expect(kdColor(70)).toBe('text-accent-orange');
  });

  it('Very Hard band: kd=71 → danger (red)', () => {
    expect(kdColor(71)).toBe('text-accent-danger');
  });

  it('Very Hard band: kd=100 → danger', () => {
    expect(kdColor(100)).toBe('text-accent-danger');
  });
});

describe('kdLabel — canonical 30/50/70 band labels', () => {
  it('returns empty string for undefined', () => {
    expect(kdLabel(undefined)).toBe('');
  });

  it('kd=0 → Easy', () => {
    expect(kdLabel(0)).toBe('Easy');
  });

  it('kd=30 → Easy (boundary)', () => {
    expect(kdLabel(30)).toBe('Easy');
  });

  it('kd=31 → Medium (boundary)', () => {
    expect(kdLabel(31)).toBe('Medium');
  });

  it('kd=50 → Medium (boundary)', () => {
    expect(kdLabel(50)).toBe('Medium');
  });

  it('kd=51 → Hard (boundary)', () => {
    expect(kdLabel(51)).toBe('Hard');
  });

  it('kd=70 → Hard (boundary)', () => {
    expect(kdLabel(70)).toBe('Hard');
  });

  it('kd=71 → Very Hard (boundary)', () => {
    expect(kdLabel(71)).toBe('Very Hard');
  });

  it('kd=100 → Very Hard', () => {
    expect(kdLabel(100)).toBe('Very Hard');
  });
});
