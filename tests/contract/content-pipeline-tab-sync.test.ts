// tests/contract/content-pipeline-tab-sync.test.ts
//
// CONTRACT: ContentPipeline must sync its activeTab state when the URL ?tab= param
// changes externally (e.g. ContentCalendar's openItem fires navigate(?tab=posts&post=...))
// while the pipeline component is already mounted.
//
// This is a static-analysis contract test that verifies the implementation wiring
// is present without requiring full component mounting (which would require mocking
// React Query, lazy imports, and workspace context).
//
// readFile-ok — this test intentionally reads source files for static analysis

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../..');
const SRC_DIR = join(ROOT, 'src');

describe('ContentPipeline tab sync contract', () => {
  const pipelineFile = join(SRC_DIR, 'components/ContentPipeline.tsx');

  it('ContentPipeline.tsx exists', () => {
    expect(existsSync(pipelineFile)).toBe(true);
  });

  it('reads searchParams.get("tab") to initialize activeTab (deep-link receive)', () => {
    const src = readFileSync(pipelineFile, 'utf8'); // readFile-ok — intentional static analysis
    expect(
      src.includes("searchParams.get('tab')") ||
      src.includes('searchParams.get("tab")')
    ).toBe(true);
  });

  it('has a useEffect that syncs activeTab from searchParams (mount-already-active fix)', () => {
    const src = readFileSync(pipelineFile, 'utf8'); // readFile-ok — intentional static analysis
    // The sync effect must resolve the ?tab= param (Wave 4 routes it through
    // resolveTabSearchParam so legacy aliases like subscriptions→publish map correctly)
    // and setActiveTab to the resolved value only when it differs from current state.
    expect(src).toMatch(/setActiveTab\((?:param|resolved)\b/);
    // Guard against looping: the effect compares the resolved param against activeTab.
    expect(src).toMatch(/(?:param|resolved) !== activeTab/);
    // Must be inside a useEffect (not just a one-time initializer)
    expect(src).toContain('useEffect(');
  });

  it('ContentCalendar sends ?tab=posts&post=<id> when opening a post item', () => {
    const calendarFile = join(SRC_DIR, 'components/ContentCalendar.tsx');
    expect(existsSync(calendarFile)).toBe(true);
    const calendarSrc = readFileSync(calendarFile, 'utf8'); // readFile-ok — intentional static analysis
    expect(calendarSrc).toContain('?tab=posts&post=');
  });

  it('ContentPipeline tab IDs include "calendar" and "posts" (both are valid targets)', () => {
    const src = readFileSync(pipelineFile, 'utf8'); // readFile-ok — intentional static analysis
    // TABS array must contain both 'calendar' and 'posts' for deep-link navigation to work
    expect(src).toContain("'calendar'");
    expect(src).toContain("'posts'");
  });
});
