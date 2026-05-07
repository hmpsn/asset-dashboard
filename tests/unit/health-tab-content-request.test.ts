/**
 * Unit tests for src/lib/health-tab-content-request.ts.
 * Verifies the word-count regex, content-issue predicate, and the request
 * payload composition that the HealthTab "request improvement" button posts.
 */
import { describe, it, expect } from 'vitest';
import {
  hasContentIssues,
  extractWordCountFromIssues,
  buildContentImprovementRequest,
  type HealthTabIssue,
  type HealthTabPage,
} from '../../src/lib/health-tab-content-request';

const issue = (over: Partial<HealthTabIssue>): HealthTabIssue => ({
  check: '',
  message: '',
  severity: 'warning',
  ...over,
});

describe('hasContentIssues', () => {
  it('returns false for an empty list', () => {
    expect(hasContentIssues([])).toBe(false);
  });

  it('matches issues whose check name includes a content-issue token', () => {
    expect(hasContentIssues([issue({ check: 'content-length' })])).toBe(true);
    expect(hasContentIssues([issue({ check: 'h1' })])).toBe(true);
    expect(hasContentIssues([issue({ check: 'h1-missing' })])).toBe(true);
    expect(hasContentIssues([issue({ check: 'h1-multiple' })])).toBe(true);
    expect(hasContentIssues([issue({ check: 'heading' })])).toBe(true);
    expect(hasContentIssues([issue({ check: 'word-count' })])).toBe(true);
  });

  it('matches issues whose message mentions thin content', () => {
    expect(hasContentIssues([issue({ check: 'meta', message: 'page has thin content' })])).toBe(true);
  });

  it('matches issues whose message mentions "word"', () => {
    expect(hasContentIssues([issue({ check: 'misc', message: 'only 60 words found' })])).toBe(true);
  });

  it('is case-insensitive on both check and message', () => {
    expect(hasContentIssues([issue({ check: 'CONTENT-LENGTH' })])).toBe(true);
    expect(hasContentIssues([issue({ check: 'Heading' })])).toBe(true);
    expect(hasContentIssues([issue({ message: 'Thin Content' })])).toBe(true);
  });

  it('does NOT match unrelated checks', () => {
    expect(hasContentIssues([issue({ check: 'meta-description', message: 'too short' })])).toBe(false);
    expect(hasContentIssues([issue({ check: 'canonical' })])).toBe(false);
  });

  it('returns true if ANY issue in the list matches', () => {
    expect(hasContentIssues([
      issue({ check: 'canonical' }),
      issue({ check: 'meta-description' }),
      issue({ check: 'h1-missing' }),
    ])).toBe(true);
  });
});

describe('extractWordCountFromIssues', () => {
  it('returns undefined when there is no content-length issue', () => {
    expect(extractWordCountFromIssues([
      issue({ check: 'meta-description', message: 'missing description' }),
    ])).toBeUndefined();
  });

  it('returns undefined when the content-length message has no word number', () => {
    expect(extractWordCountFromIssues([
      issue({ check: 'content-length', message: 'page is too short' }),
    ])).toBeUndefined();
  });

  it('parses "<n> words" out of the message', () => {
    expect(extractWordCountFromIssues([
      issue({ check: 'content-length', message: 'Only 137 words on this page' }),
    ])).toBe(137);
  });

  it('parses "<n> word" (singular) out of the message', () => {
    expect(extractWordCountFromIssues([
      issue({ check: 'content-length', message: 'just 1 word' }),
    ])).toBe(1);
  });

  it('matches case-insensitively', () => {
    expect(extractWordCountFromIssues([
      issue({ check: 'content-length', message: 'PAGE HAS 250 WORDS' }),
    ])).toBe(250);
  });

  it('handles a content-length check with a longer name (e.g. content-length-warning)', () => {
    expect(extractWordCountFromIssues([
      issue({ check: 'content-length-warning', message: 'only 80 words' }),
    ])).toBe(80);
  });

  it('returns the FIRST content-length issue when there are multiple', () => {
    expect(extractWordCountFromIssues([
      issue({ check: 'content-length', message: '60 words' }),
      issue({ check: 'content-length', message: '90 words' }),
    ])).toBe(60);
  });

  it('returns NaN-free results — never propagates NaN out', () => {
    const result = extractWordCountFromIssues([
      issue({ check: 'content-length', message: 'no number here' }),
    ]);
    expect(result).toBeUndefined();
    // Belt-and-braces: ensure we never returned NaN by accident.
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe('buildContentImprovementRequest', () => {
  const page = (over: Partial<HealthTabPage> = {}): HealthTabPage => ({
    pageId: 'p1',
    page: 'Home',
    slug: 'home',
    issues: [],
    ...over,
  });

  it('forwards page identity fields verbatim', () => {
    const body = buildContentImprovementRequest(page({
      pageId: 'p9', page: 'About Us', slug: 'about-us',
    }));
    expect(body.pageSlug).toBe('about-us');
    expect(body.pageName).toBe('About Us');
  });

  it('filters issues down to content-related messages', () => {
    const body = buildContentImprovementRequest(page({
      issues: [
        issue({ check: 'content-length', message: '60 words' }),
        issue({ check: 'meta-description', message: 'missing meta description' }),
        issue({ check: 'h1-missing', message: 'page has no H1' }),
        issue({ check: 'canonical', message: 'no canonical tag' }),
      ],
    }));
    expect(body.issues).toEqual(['60 words', 'page has no H1']);
  });

  it('emits an empty issues array when no issue qualifies', () => {
    const body = buildContentImprovementRequest(page({
      issues: [
        issue({ check: 'meta-description' }),
        issue({ check: 'canonical' }),
      ],
    }));
    expect(body.issues).toEqual([]);
  });

  it('attaches wordCount when a content-length issue carries a number', () => {
    const body = buildContentImprovementRequest(page({
      issues: [issue({ check: 'content-length', message: '120 words' })],
    }));
    expect(body.wordCount).toBe(120);
  });

  it('omits wordCount when it cannot be parsed', () => {
    const body = buildContentImprovementRequest(page({
      issues: [issue({ check: 'content-length', message: 'too short' })],
    }));
    expect(body.wordCount).toBeUndefined();
  });

  it('produces a stable shape that the API handler can rely on', () => {
    const body = buildContentImprovementRequest(page({
      issues: [issue({ check: 'h1-missing', message: 'no H1' })],
    }));
    expect(Object.keys(body).sort()).toEqual(['issues', 'pageName', 'pageSlug', 'wordCount']);
  });
});
