/**
 * Unit tests for humanizeFieldLabel (src/lib/decision-adapters.ts).
 *
 * 2026-06-09 audit (client-ux): the unified inbox rendered raw camelCase payload
 * field identifiers to clients ("HOMEPAGE — SEOTITLE"). The legacy ApprovalBatchCard
 * humanized these inline; the unified-inbox migration dropped that. This helper is
 * the single authority for payload-field display names — no raw camelCase may reach
 * the DOM in client views.
 */
import { describe, expect, it } from 'vitest';
import { humanizeFieldLabel } from '../../src/lib/decision-adapters.js';

describe('humanizeFieldLabel', () => {
  it('maps the known approval-item fields to their canonical display names', () => {
    expect(humanizeFieldLabel('seoTitle')).toBe('SEO Title');
    expect(humanizeFieldLabel('seoDescription')).toBe('Meta Description');
    expect(humanizeFieldLabel('schema')).toBe('Schema Markup');
  });

  it('falls back to a generic camelCase → Title Case split for unknown fields', () => {
    expect(humanizeFieldLabel('targetKeyword')).toBe('Target Keyword');
    expect(humanizeFieldLabel('ogImageUrl')).toBe('Og Image Url');
  });

  it('handles snake_case and kebab-case fallbacks', () => {
    expect(humanizeFieldLabel('internal_link')).toBe('Internal Link');
    expect(humanizeFieldLabel('alt-text')).toBe('Alt Text');
  });

  it('returns null for null/undefined/empty so callers can apply their own default', () => {
    expect(humanizeFieldLabel(null)).toBeNull();
    expect(humanizeFieldLabel(undefined)).toBeNull();
    expect(humanizeFieldLabel('')).toBeNull();
  });
});
