// tests/contract/zombie-route-redirects.test.ts
//
// CONTRACT: Zombie admin routes (removed from nav registry in W3.3) must redirect
// to the correct content-pipeline sub-tab rather than rendering their old components.
//
// seo-briefs → content-pipeline?tab=briefs  (W6.4, D1)
// content    → content-pipeline?tab=posts   (W6.4, D1)
//
// This test does NOT exercise runtime rendering — it statically verifies that
// App.tsx no longer renders the legacy components for these slugs and instead
// emits a Navigate redirect to the correct URL shape.
//
// readFile-ok — this test intentionally reads source files for static analysis.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../..');
const appTsx = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8'); // readFile-ok

describe('zombie route redirects contract', () => {
  it('seo-briefs tab no longer renders ContentBriefs directly', () => {
    // The old pattern was: if (tab === 'seo-briefs') return <ContentBriefs .../>
    // It must now be a Navigate redirect.
    expect(appTsx).not.toMatch(/tab\s*===\s*'seo-briefs'[^}]+<ContentBriefs/);
  });

  it('content tab no longer renders ContentManager directly', () => {
    // The old pattern was: if (tab === 'content') return <ContentManager .../>
    // It must now be a Navigate redirect.
    expect(appTsx).not.toMatch(/tab\s*===\s*'content'[^}]+<ContentManager/);
  });

  it('seo-briefs redirects to content-pipeline with ?tab=briefs', () => {
    // The redirect must target content-pipeline and send tab=briefs.
    // Pattern: tab === 'seo-briefs' ... Navigate ... content-pipeline ... ?tab=briefs
    expect(appTsx).toMatch(/tab\s*===\s*'seo-briefs'[^;]+Navigate[^;]+content-pipeline[^;]+\?tab=briefs/);
  });

  it('content tab redirects to content-pipeline with ?tab=posts', () => {
    // Pattern: tab === 'content' ... Navigate ... content-pipeline ... ?tab=posts
    expect(appTsx).toMatch(/tab\s*===\s*'content'[^;]+Navigate[^;]+content-pipeline[^;]+\?tab=posts/);
  });

  it('seo-briefs and content are still in the Page union (redirect-only; formal deletion is later)', () => {
    // Routes.ts must still include both values so bookmarks produce a redirect,
    // not a 404-style fall-through to the home redirect.
    const routesTsx = readFileSync(join(ROOT, 'src/routes.ts'), 'utf8'); // readFile-ok
    expect(routesTsx).toContain("'seo-briefs'");
    expect(routesTsx).toContain("'content'");
  });

  it('ContentPipeline reads ?tab= param (receiver half of the two-halves contract)', () => {
    // The redirect sender appends ?tab=briefs / ?tab=posts; ContentPipeline must
    // read useSearchParams to honour it. Verify the receiver half is present.
    const pipeline = readFileSync(join(ROOT, 'src/components/ContentPipeline.tsx'), 'utf8'); // readFile-ok
    expect(
      pipeline.includes("searchParams.get('tab')") ||
      pipeline.includes('searchParams.get("tab")')
    ).toBe(true);
  });
});
