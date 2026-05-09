/**
 * Unit tests for src/lib/client-dashboard-tab.ts. Covers the tab resolution
 * edge cases that previously lived inline in ClientDashboard.tsx — legacy
 * aliases, the brand-tab feature flag, and the unknown-tab fallback.
 */
import { describe, it, expect } from 'vitest';
import { resolveClientTab, KNOWN_CLIENT_TABS } from '../../src/lib/client-dashboard-tab';

describe('resolveClientTab', () => {
  // ── Legacy aliases ──

  it('redirects "search" to "performance"', () => {
    expect(resolveClientTab('search', false)).toBe('performance');
    expect(resolveClientTab('search', true)).toBe('performance');
  });

  it('redirects "analytics" to "performance"', () => {
    expect(resolveClientTab('analytics', false)).toBe('performance');
    expect(resolveClientTab('analytics', true)).toBe('performance');
  });

  // ── Brand-tab feature flag ──

  it('returns "brand" when brandTabEnabled is true', () => {
    expect(resolveClientTab('brand', true)).toBe('brand');
  });

  it('falls back to "overview" when brandTabEnabled is false', () => {
    expect(resolveClientTab('brand', false)).toBe('overview');
  });

  // ── Pass-through for known tabs ──

  it('passes through every value in KNOWN_CLIENT_TABS unchanged', () => {
    expect(KNOWN_CLIENT_TABS.length).toBeGreaterThan(0);
    for (const tab of KNOWN_CLIENT_TABS) {
      // 'brand' is special-cased above (depends on flag); skip it here.
      if (tab === 'brand') continue;
      expect(resolveClientTab(tab, true)).toBe(tab);
      expect(resolveClientTab(tab, false)).toBe(tab);
    }
  });

  it('passes through "overview", "performance", "health", "strategy" specifically', () => {
    expect(resolveClientTab('overview', false)).toBe('overview');
    expect(resolveClientTab('performance', false)).toBe('performance');
    expect(resolveClientTab('health', false)).toBe('health');
    expect(resolveClientTab('strategy', false)).toBe('strategy');
  });

  it('passes through inbox/approvals/requests/content', () => {
    expect(resolveClientTab('inbox', false)).toBe('inbox');
    expect(resolveClientTab('approvals', false)).toBe('approvals');
    expect(resolveClientTab('requests', false)).toBe('requests');
    expect(resolveClientTab('content', false)).toBe('content');
  });

  it('passes through legacy surface "content-plan"', () => {
    expect(resolveClientTab('content-plan', false)).toBe('content-plan');
  });

  it('redirects retired "schema-review" tab to inbox', () => {
    expect(resolveClientTab('schema-review', false)).toBe('inbox');
    expect(resolveClientTab('schema-review', true)).toBe('inbox');
  });

  // ── Unknown / falsy → "overview" ──

  it('falls back to "overview" for unknown tab values', () => {
    expect(resolveClientTab('made-up-tab', false)).toBe('overview');
    expect(resolveClientTab('made-up-tab', true)).toBe('overview');
  });

  it('falls back to "overview" for undefined/null/empty', () => {
    expect(resolveClientTab(undefined, true)).toBe('overview');
    expect(resolveClientTab(null, true)).toBe('overview');
    expect(resolveClientTab('', true)).toBe('overview');
  });

  it('is case-sensitive — "Performance" does NOT match "performance"', () => {
    // Tab ids in URLs are kebab-case lowercase, so a capitalized value should
    // not be silently coerced to a known tab.
    expect(resolveClientTab('Performance', false)).toBe('overview');
    expect(resolveClientTab('OVERVIEW', false)).toBe('overview'); // happens to fall back, not match
  });

  // ── Brand-tab + alias don't bleed into each other ──

  it('does not let brandTabEnabled affect non-brand tabs', () => {
    expect(resolveClientTab('overview', true)).toBe('overview');
    expect(resolveClientTab('performance', true)).toBe('performance');
    expect(resolveClientTab('search', true)).toBe('performance');
  });
});
