import { describe, it, expect } from 'vitest';
import { inferPageType, isIntentMismatch } from '../../server/recommendations.js';

describe('inferPageType', () => {
  it('detects blog pages', () => {
    expect(inferPageType('blog/plumbing-tips')).toBe('blog');
    expect(inferPageType('articles/guide-to-hvac')).toBe('blog');
  });
  it('detects service pages', () => {
    expect(inferPageType('services/plumbing')).toBe('service');
    expect(inferPageType('solutions/hvac-repair')).toBe('service');
  });
  it('falls back to other', () => {
    expect(inferPageType('about')).toBe('other');
  });
});

describe('isIntentMismatch', () => {
  it('flags service/product pages targeting informational intent', () => {
    const r = isIntentMismatch('service', 'informational');
    expect(r.mismatch).toBe(true);
    expect(r.reason).toContain('blog post');
  });
  it('flags blog posts targeting transactional intent', () => {
    const r = isIntentMismatch('blog', 'transactional');
    expect(r.mismatch).toBe(true);
    expect(r.reason).toContain('service/product page');
  });
  it('does not flag well-matched pairs', () => {
    expect(isIntentMismatch('service', 'commercial').mismatch).toBe(false);
    expect(isIntentMismatch('blog', 'informational').mismatch).toBe(false);
  });
});
