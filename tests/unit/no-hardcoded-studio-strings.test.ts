import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FILES_TO_CHECK = [
  'server/web-scraper.ts',
  'server/routes/webflow-seo.ts',
  'server/routes/jobs.ts',
  'server/brief-export-html.ts',
  'server/post-export-html.ts',
  'server/sales-report-html.ts',
  'server/email-templates.ts',
  'server/routes/public-analytics.ts',
];

// Matches literal hmpsn.studio NOT on a comment-only line
const LITERAL_PATTERN = /^(?!\s*\/\/).*hmpsn\.studio/m;

describe('No hardcoded studio strings', () => {
  for (const file of FILES_TO_CHECK) {
    it(`${file} — no literal hmpsn.studio`, () => {
      const content = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(LITERAL_PATTERN.test(content)).toBe(false);
    });
  }
});
