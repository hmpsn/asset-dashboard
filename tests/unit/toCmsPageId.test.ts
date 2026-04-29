/**
 * Unit tests for toCmsPageId canonical helper.
 * Contract test: locks in format so future refactors don't break backward compat.
 */
import { describe, it, expect } from 'vitest';
import { toCmsPageId } from '../../server/webflow-pages.js';

describe('toCmsPageId', () => {
  it('converts /blog/my-post to cms-blog-my-post', () => {
    expect(toCmsPageId('/blog/my-post')).toBe('cms-blog-my-post');
  });

  it('strips leading slash before converting interior slashes', () => {
    // This is the key contract: no double-dash
    expect(toCmsPageId('/about/team')).toBe('cms-about-team');
  });

  it('handles homepage / edge case', () => {
    expect(toCmsPageId('/')).toBe('cms-');
  });

  it('handles deeply nested paths', () => {
    expect(toCmsPageId('/a/b/c')).toBe('cms-a-b-c');
  });

  it('handles path without leading slash (idempotent safe)', () => {
    expect(toCmsPageId('blog/my-post')).toBe('cms-blog-my-post');
  });

  it('does NOT produce double-dash (regression guard)', () => {
    expect(toCmsPageId('/blog/my-post')).not.toContain('--');
  });
});
