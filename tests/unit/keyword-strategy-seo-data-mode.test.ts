/**
 * Unit tests for resolveEffectiveSeoDataMode (server/keyword-strategy-generation.ts).
 *
 * Contract (2026-06-09 audit, confirmed finding #1): the absent-vs-explicit
 * distinction must survive the normalization chain.
 *   - undefined (caller made no choice — MCP/chat path) + configured provider → 'quick'
 *   - undefined + no provider → 'none'
 *   - explicit 'none' → 'none' ALWAYS, even with a configured provider. The admin UI
 *     promises "No DataForSEO credits used" for this option; the pre-a5644282 flag-gated
 *     behavior promoted only the absent case.
 *   - explicit 'quick'/'full' pass through unchanged.
 *   - unrecognized strings are treated as an explicit 'none' (conservative: never
 *     auto-spend on garbage input).
 */
import { describe, expect, it } from 'vitest';
import { resolveEffectiveSeoDataMode } from '../../server/keyword-strategy-generation.js';

describe('resolveEffectiveSeoDataMode', () => {
  it("promotes only the ABSENT case to 'quick' when a provider is configured", () => {
    expect(resolveEffectiveSeoDataMode(undefined, true)).toBe('quick');
  });

  it("resolves absent + no provider to 'none'", () => {
    expect(resolveEffectiveSeoDataMode(undefined, false)).toBe('none');
  });

  it("honors an explicit 'none' even when a provider is configured (no-spend contract)", () => {
    expect(resolveEffectiveSeoDataMode('none', true)).toBe('none');
  });

  it('passes explicit quick/full through unchanged', () => {
    expect(resolveEffectiveSeoDataMode('quick', true)).toBe('quick');
    expect(resolveEffectiveSeoDataMode('quick', false)).toBe('quick');
    expect(resolveEffectiveSeoDataMode('full', true)).toBe('full');
  });

  it("treats unrecognized strings as an explicit 'none' (never auto-spend on garbage)", () => {
    expect(resolveEffectiveSeoDataMode('turbo', true)).toBe('none');
  });
});
