/**
 * Unit tests for admin chat question classification and routing.
 *
 * Tests that classifyQuestion() maps different question types to the
 * correct ContextCategory set, which drives which data sources are
 * fetched when assembling the admin chat context.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// ── Shared import ──────────────────────────────────────────────────────────

let classifyQuestion: (question: string) => Set<string>;

beforeAll(async () => {
  const mod = await import('../../server/admin-chat-context.js');
  classifyQuestion = mod.classifyQuestion;
});

// ── SEO / Search questions → 'search' category ────────────────────────────

describe('SEO / search question routing', () => {
  it('detects "impressions" as search', () => {
    const cats = classifyQuestion('Why are my impressions dropping?');
    expect(cats.has('search')).toBe(true);
  });

  it('detects "clicks" as search', () => {
    const cats = classifyQuestion('How many clicks did we get this month?');
    expect(cats.has('search')).toBe(true);
  });

  it('detects "CTR" as search', () => {
    const cats = classifyQuestion('What is our CTR for the homepage?');
    expect(cats.has('search')).toBe(true);
  });

  it('detects "GSC" as search', () => {
    const cats = classifyQuestion('Show me the GSC data for last week');
    expect(cats.has('search')).toBe(true);
  });

  it('detects "SERP" as search', () => {
    const cats = classifyQuestion('What does our SERP presence look like?');
    expect(cats.has('search')).toBe(true);
  });

  it('detects "position" as search', () => {
    const cats = classifyQuestion('What position are we ranking at for this keyword?');
    expect(cats.has('search')).toBe(true);
  });

  it('detects "queries" as search', () => {
    const cats = classifyQuestion('What are our top search queries?');
    expect(cats.has('search')).toBe(true);
  });
});

// ── Analytics questions → 'analytics' category ────────────────────────────

describe('analytics question routing', () => {
  it('detects "analytics" as analytics', () => {
    const cats = classifyQuestion('Show me the analytics for this week');
    expect(cats.has('analytics')).toBe(true);
  });

  it('detects "GA4" as analytics', () => {
    const cats = classifyQuestion('What does GA4 show for organic traffic?');
    expect(cats.has('analytics')).toBe(true);
  });

  it('detects "traffic" as analytics', () => {
    const cats = classifyQuestion('How is our traffic trending?');
    expect(cats.has('analytics')).toBe(true);
  });

  it('detects "bounce" as analytics', () => {
    const cats = classifyQuestion('Our bounce rate seems high — what is it?');
    expect(cats.has('analytics')).toBe(true);
  });

  it('detects "sessions" as analytics', () => {
    const cats = classifyQuestion('How many sessions did we have last month?');
    expect(cats.has('analytics')).toBe(true);
  });

  it('detects "conversions" as analytics', () => {
    const cats = classifyQuestion('Which pages are driving the most conversions?');
    expect(cats.has('analytics')).toBe(true);
  });

  it('detects "visitors" as analytics', () => {
    const cats = classifyQuestion('Are we getting new visitors from organic?');
    expect(cats.has('analytics')).toBe(true);
  });

  it('detects "pageviews" as analytics', () => {
    const cats = classifyQuestion('What are our top pageviews this month?');
    expect(cats.has('analytics')).toBe(true);
  });
});

// ── Content questions → 'content' category ────────────────────────────────

describe('content question routing', () => {
  it('detects "content" as content', () => {
    const cats = classifyQuestion('What content pieces are in progress?');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "brief" as content', () => {
    const cats = classifyQuestion('Do we have any briefs ready for review?');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "pipeline" as content', () => {
    const cats = classifyQuestion('What is in the content pipeline right now?');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "blog" as content', () => {
    const cats = classifyQuestion('What blog posts are we working on?');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "article" as content', () => {
    const cats = classifyQuestion('Can you summarize the article deliverables?');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "draft" as content', () => {
    const cats = classifyQuestion('Is the draft ready for the homepage rewrite?');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "template" as content', () => {
    const cats = classifyQuestion('Show me our content templates');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "matrix" as content', () => {
    const cats = classifyQuestion('What does the content matrix look like?');
    expect(cats.has('content')).toBe(true);
  });

  it('detects "content plan" as content', () => {
    const cats = classifyQuestion('Walk me through the content plan');
    expect(cats.has('content')).toBe(true);
  });
});

// ── Strategy questions → 'strategy' category ──────────────────────────────

describe('strategy question routing', () => {
  it('detects "strategy" as strategy', () => {
    const cats = classifyQuestion('What does our keyword strategy look like?');
    expect(cats.has('strategy')).toBe(true);
  });

  it('detects "keyword" as strategy', () => {
    const cats = classifyQuestion('Which keywords should we target next quarter?');
    expect(cats.has('strategy')).toBe(true);
  });

  it('detects "content gap" as strategy', () => {
    const cats = classifyQuestion('Are there content gaps we are missing?');
    expect(cats.has('strategy')).toBe(true);
  });

  it('detects "target" as strategy', () => {
    const cats = classifyQuestion('What terms are we targeting on the services page?');
    expect(cats.has('strategy')).toBe(true);
  });

  it('detects "quick win" as strategy (also matches insights)', () => {
    const cats = classifyQuestion('What are the quick wins we can pursue?');
    expect(cats.has('strategy')).toBe(true);
  });
});

// ── Insights questions → 'insights' category ──────────────────────────────

describe('insights question routing', () => {
  it('detects "what should I work on" as insights', () => {
    const cats = classifyQuestion('What should I work on this week?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "priorities" as insights', () => {
    const cats = classifyQuestion('What are the highest priorities right now?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "declining" as insights', () => {
    const cats = classifyQuestion('Which pages are declining in traffic?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "cannibalization" as insights', () => {
    const cats = classifyQuestion('Do we have keyword cannibalization issues?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "page health" as insights', () => {
    const cats = classifyQuestion('Can you show me page health scores?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "health score" as insights', () => {
    const cats = classifyQuestion('What is the health score for our blog?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "biggest impact" as insights', () => {
    const cats = classifyQuestion('What would have the biggest impact right now?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "what should I focus on" as insights', () => {
    const cats = classifyQuestion('What should I focus on for SEO this month?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "opportunities" as insights (also matches strategy)', () => {
    const cats = classifyQuestion('What are our biggest opportunities?');
    expect(cats.has('insights')).toBe(true);
  });
});

// ── Performance questions → 'performance' category ────────────────────────

describe('performance question routing', () => {
  it('detects "pagespeed" as performance', () => {
    const cats = classifyQuestion('What is our pagespeed score?');
    expect(cats.has('performance')).toBe(true);
  });

  it('detects "core web vitals" as performance', () => {
    const cats = classifyQuestion('How are our core web vitals looking?');
    expect(cats.has('performance')).toBe(true);
  });

  it('detects "load time" as performance', () => {
    const cats = classifyQuestion('Why is the load time so high on mobile?');
    expect(cats.has('performance')).toBe(true);
  });

  it('detects "lighthouse" as performance', () => {
    const cats = classifyQuestion('What did the lighthouse audit show?');
    expect(cats.has('performance')).toBe(true);
  });
});

// ── Audit / SEO health questions → 'audit' category ──────────────────────

describe('audit question routing', () => {
  it('detects "audit" as audit', () => {
    const cats = classifyQuestion('Can you run a site audit?');
    expect(cats.has('audit')).toBe(true);
  });

  it('detects "SEO issue" as audit', () => {
    const cats = classifyQuestion('Are there any SEO issues on the site?');
    expect(cats.has('audit')).toBe(true);
  });

  it('detects "broken" as audit', () => {
    const cats = classifyQuestion('Are there any broken links we need to fix?');
    expect(cats.has('audit')).toBe(true);
  });

  it('detects "error" as audit', () => {
    const cats = classifyQuestion('Show me any crawl errors');
    expect(cats.has('audit')).toBe(true);
  });

  it('detects "score" as audit', () => {
    const cats = classifyQuestion('What is our overall SEO score?');
    // 'score' matches both audit and potentially insights (health score)
    expect(cats.has('audit')).toBe(true);
  });
});

// ── Competitor questions → 'competitors' category ─────────────────────────

describe('competitor question routing', () => {
  it('detects "competitor" as competitors', () => {
    const cats = classifyQuestion('What are our competitors doing differently?');
    expect(cats.has('competitors')).toBe(true);
  });

  it('detects "vs" as competitors', () => {
    const cats = classifyQuestion('How do we stack up vs Acme Corp?');
    expect(cats.has('competitors')).toBe(true);
  });

  it('detects "benchmark" as competitors', () => {
    const cats = classifyQuestion('How do our rankings benchmark against the industry?');
    expect(cats.has('competitors')).toBe(true);
  });

  it('detects "compare" as competitors', () => {
    const cats = classifyQuestion('Compare our traffic to last year');
    expect(cats.has('competitors')).toBe(true);
  });
});

// ── Rank tracking questions → 'ranks' category ───────────────────────────

describe('rank tracking question routing', () => {
  it('detects "rank" as ranks', () => {
    const cats = classifyQuestion('What keywords are we ranking for?');
    expect(cats.has('ranks')).toBe(true);
  });

  it('detects "tracking" as ranks', () => {
    const cats = classifyQuestion('Show me the rank tracking report');
    expect(cats.has('ranks')).toBe(true);
  });

  it('detects "climbing" as ranks', () => {
    const cats = classifyQuestion('Which keywords are climbing this month?');
    expect(cats.has('ranks')).toBe(true);
  });

  it('detects "dropping" as ranks', () => {
    const cats = classifyQuestion('Why are our rankings dropping?');
    expect(cats.has('ranks')).toBe(true);
  });
});

// ── Client questions → 'client' category ─────────────────────────────────

describe('client question routing', () => {
  it('detects "client" as client', () => {
    const cats = classifyQuestion('What should I tell the client about this month?');
    expect(cats.has('client')).toBe(true);
  });

  it('detects "churn" as client', () => {
    const cats = classifyQuestion('Are there any churn signals I should be aware of?');
    expect(cats.has('client')).toBe(true);
  });

  it('detects "update client" as client', () => {
    const cats = classifyQuestion('Help me update the client on progress');
    expect(cats.has('client')).toBe(true);
  });
});

// ── Activity / timeline questions → 'activity' category ──────────────────

describe('activity question routing', () => {
  it('detects "recent" as activity', () => {
    const cats = classifyQuestion('What has happened recently?');
    expect(cats.has('activity')).toBe(true);
  });

  it('detects "what changed" as activity', () => {
    const cats = classifyQuestion('What changed on the site last week?');
    expect(cats.has('activity')).toBe(true);
  });

  it('detects "history" as activity', () => {
    const cats = classifyQuestion('Show me the history of changes');
    expect(cats.has('activity')).toBe(true);
  });

  it('detects "timeline" as activity', () => {
    const cats = classifyQuestion('Give me a timeline of what has happened this month');
    expect(cats.has('activity')).toBe(true);
  });
});

// ── Page analysis (URL in question) → 'page_analysis' category ───────────

describe('page analysis routing (URL detection)', () => {
  it('detects a full https URL as page_analysis', () => {
    const cats = classifyQuestion('Can you analyze https://example.com/blog/seo-tips?');
    expect(cats.has('page_analysis')).toBe(true);
  });

  it('detects a www URL as page_analysis', () => {
    const cats = classifyQuestion('What is wrong with www.example.com/services?');
    expect(cats.has('page_analysis')).toBe(true);
  });

  it('detects a relative path as page_analysis', () => {
    const cats = classifyQuestion('Review the page at /services/seo');
    expect(cats.has('page_analysis')).toBe(true);
  });

  it('does not tag plain questions without URLs as page_analysis', () => {
    const cats = classifyQuestion('How is our overall site performing?');
    expect(cats.has('page_analysis')).toBe(false);
  });
});

// ── Content review (long pasted text) → 'content_review' category ─────────

describe('content review routing (word-count detection)', () => {
  it('classifies a message over 150 words as content_review', () => {
    const longText = Array(160).fill('word').join(' ');
    const cats = classifyQuestion(`Please review this: ${longText}`);
    expect(cats.has('content_review')).toBe(true);
  });

  it('does not classify a short question as content_review', () => {
    const cats = classifyQuestion('Can you review my homepage copy?');
    expect(cats.has('content_review')).toBe(false);
  });
});

// ── General / ambiguous questions ─────────────────────────────────────────

describe('general / ambiguous question routing', () => {
  it('returns general + core data sources when nothing specific matches', () => {
    const cats = classifyQuestion('Hey, what can you tell me?');
    expect(cats.has('general')).toBe(true);
    // General queries expand to core data sources
    expect(cats.has('search')).toBe(true);
    expect(cats.has('analytics')).toBe(true);
    expect(cats.has('audit')).toBe(true);
    expect(cats.has('content')).toBe(true);
    expect(cats.has('ranks')).toBe(true);
    expect(cats.has('activity')).toBe(true);
    expect(cats.has('client')).toBe(true);
  });

  it('expands a status report to core sources', () => {
    const cats = classifyQuestion('Can you give me a full status report?');
    expect(cats.has('general')).toBe(true);
    expect(cats.has('search')).toBe(true);
    expect(cats.has('analytics')).toBe(true);
  });

  it('summary question includes general and expands to core sources', () => {
    const cats = classifyQuestion('Give me a summary of everything');
    expect(cats.has('general')).toBe(true);
    expect(cats.has('search')).toBe(true);
    expect(cats.has('analytics')).toBe(true);
  });

  it('"this week" triggers general category', () => {
    const cats = classifyQuestion('How are we doing this week?');
    expect(cats.has('general')).toBe(true);
  });

  it('"ROI" triggers general category', () => {
    const cats = classifyQuestion('What is the ROI of our SEO so far?');
    expect(cats.has('general')).toBe(true);
  });

  it('"highest priority" triggers general category', () => {
    const cats = classifyQuestion('What is the highest priority thing to do?');
    expect(cats.has('general')).toBe(true);
  });
});

// ── Multi-category questions ───────────────────────────────────────────────

describe('multi-category / overlapping question routing', () => {
  it('a question about keyword rankings includes both search and ranks', () => {
    const cats = classifyQuestion('What position are we in the search results for our tracking keywords?');
    expect(cats.has('search')).toBe(true);
    expect(cats.has('ranks')).toBe(true);
  });

  it('a content strategy question includes both content and strategy', () => {
    const cats = classifyQuestion('What keywords should we target in our next blog article?');
    expect(cats.has('content')).toBe(true);
    expect(cats.has('strategy')).toBe(true);
  });

  it('a quick wins question includes both insights and strategy', () => {
    const cats = classifyQuestion('What quick wins do we have in our keyword strategy?');
    expect(cats.has('insights')).toBe(true);
    expect(cats.has('strategy')).toBe(true);
  });

  it('a competitor analytics question includes both analytics and competitors', () => {
    const cats = classifyQuestion('How does our traffic compare to competitors?');
    expect(cats.has('analytics')).toBe(true);
    expect(cats.has('competitors')).toBe(true);
  });

  it('an audit question with a URL includes both audit and page_analysis', () => {
    const cats = classifyQuestion('Are there any SEO issues on https://example.com/services?');
    expect(cats.has('audit')).toBe(true);
    expect(cats.has('page_analysis')).toBe(true);
  });

  it('a content health question includes both content and insights', () => {
    const cats = classifyQuestion('Which content pieces are declining and need attention?');
    expect(cats.has('content')).toBe(true);
    expect(cats.has('insights')).toBe(true);
  });
});

// ── Return type and basic shape ────────────────────────────────────────────

describe('classifyQuestion return type', () => {
  it('always returns a Set', () => {
    const result = classifyQuestion('any question');
    expect(result).toBeInstanceOf(Set);
  });

  it('never returns an empty Set — falls back to general', () => {
    const cats = classifyQuestion('zzz gibberish xkcd plzklpq');
    expect(cats.size).toBeGreaterThan(0);
    expect(cats.has('general')).toBe(true);
  });

  it('categories are strings', () => {
    const cats = classifyQuestion('How is our SEO doing?');
    expect(cats.size).toBeGreaterThan(0);
    for (const cat of cats) {
      expect(typeof cat).toBe('string');
    }
  });
});
