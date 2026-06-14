/**
 * Unit tests for src/lib/client-dashboard-tab.ts. Covers the tab resolution
 * edge cases that previously lived inline in ClientDashboard.tsx — legacy
 * performance aliases and the unknown-tab fallback.
 */
import { describe, it, expect } from 'vitest';
import { resolveClientTab, KNOWN_CLIENT_TABS } from '../../src/lib/client-dashboard-tab';

describe('resolveClientTab', () => {
  // ── Legacy aliases ──

  it('redirects "search" to "performance"', () => {
    expect(resolveClientTab('search')).toBe('performance');
  });

  it('redirects "analytics" to "performance"', () => {
    expect(resolveClientTab('analytics')).toBe('performance');
  });

  it('passes through "brand"', () => {
    expect(resolveClientTab('brand')).toBe('brand');
  });

  // ── Pass-through for known tabs ──

  it('passes through every value in KNOWN_CLIENT_TABS unchanged', () => {
    expect(KNOWN_CLIENT_TABS.length).toBeGreaterThan(0);
    for (const tab of KNOWN_CLIENT_TABS) {
      expect(resolveClientTab(tab)).toBe(tab);
    }
  });

  it('passes through "overview", "performance", "health", "strategy" specifically', () => {
    expect(resolveClientTab('overview')).toBe('overview');
    expect(resolveClientTab('performance')).toBe('performance');
    expect(resolveClientTab('health')).toBe('health');
    expect(resolveClientTab('strategy')).toBe('strategy');
  });

  it('passes through inbox', () => {
    expect(resolveClientTab('inbox')).toBe('inbox');
  });

  it('passes through legacy surface "content-plan"', () => {
    expect(resolveClientTab('content-plan')).toBe('content-plan');
  });

  it('falls back to "overview" for retired inbox route aliases', () => {
    expect(resolveClientTab('approvals')).toBe('overview');
    expect(resolveClientTab('requests')).toBe('overview');
    expect(resolveClientTab('content')).toBe('overview');
    expect(resolveClientTab('schema-review')).toBe('overview');
  });

  // ── Unknown / falsy → "overview" ──

  it('falls back to "overview" for unknown tab values', () => {
    expect(resolveClientTab('made-up-tab')).toBe('overview');
  });

  it('falls back to "overview" for undefined/null/empty', () => {
    expect(resolveClientTab(undefined)).toBe('overview');
    expect(resolveClientTab(null)).toBe('overview');
    expect(resolveClientTab('')).toBe('overview');
  });

  it('is case-sensitive — "Performance" does NOT match "performance"', () => {
    // Tab ids in URLs are kebab-case lowercase, so a capitalized value should
    // not be silently coerced to a known tab.
    expect(resolveClientTab('Performance')).toBe('overview');
    expect(resolveClientTab('OVERVIEW')).toBe('overview'); // happens to fall back, not match
  });
});
