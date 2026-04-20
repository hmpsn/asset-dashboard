/**
 * Contract test: WorkspaceOverview re-exports AIUsageSection.
 *
 * App.tsx lazy-loads AIUsageSection through WorkspaceOverview:
 *
 *   const AIUsagePage = lazyWithRetry(() =>
 *     import('./components/WorkspaceOverview').then(m => ({ default: m.AIUsageSection }))
 *   );
 *
 * This is a runtime contract with no compile-time guard — TypeScript only
 * sees the dynamic import return type as `any`. If WorkspaceOverview ever
 * stops re-exporting AIUsageSection, the lazy load silently resolves to
 * `{ default: undefined }` and renders nothing.
 *
 * This test statically verifies the three-node chain:
 *   1. AIUsageSection.tsx exports a named `AIUsageSection` symbol
 *   2. WorkspaceOverview.tsx re-exports it (from './AIUsageSection')
 *   3. App.tsx consumes it via the lazy import pattern
 *
 * readFile-ok — intentional static analysis of module re-export chain
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

const AIUSAGE_FILE = join(SRC, 'components', 'AIUsageSection.tsx');
const WORKSPACE_OVERVIEW_FILE = join(SRC, 'components', 'WorkspaceOverview.tsx');
const APP_FILE = join(SRC, 'App.tsx');

describe('WorkspaceOverview → AIUsageSection re-export contract', () => {
  it('AIUsageSection.tsx exists', () => {
    expect(existsSync(AIUSAGE_FILE)).toBe(true);
  });

  it('AIUsageSection.tsx exports a named AIUsageSection function/const', () => {
    const content = readFileSync(AIUSAGE_FILE, 'utf8'); // readFile-ok
    // Match: export function AIUsageSection  OR  export { AIUsageSection }  OR  export const AIUsageSection
    const hasNamedExport =
      /export\s+function\s+AIUsageSection\b/.test(content) ||
      /export\s+const\s+AIUsageSection\b/.test(content) ||
      /export\s+\{[^}]*\bAIUsageSection\b[^}]*\}/.test(content);

    expect(hasNamedExport).toBe(true);
  });

  it('WorkspaceOverview.tsx exists', () => {
    expect(existsSync(WORKSPACE_OVERVIEW_FILE)).toBe(true);
  });

  it('WorkspaceOverview.tsx re-exports AIUsageSection', () => {
    const content = readFileSync(WORKSPACE_OVERVIEW_FILE, 'utf8'); // readFile-ok
    // Match: export { AIUsageSection } from './AIUsageSection'
    // or:    export { AIUsageSection, ... } from './AIUsageSection'
    const hasReexport = /export\s+\{[^}]*\bAIUsageSection\b[^}]*\}\s+from\s+['"]\.\/AIUsageSection['"]/.test(content);
    expect(hasReexport).toBe(true);
  });

  it('WorkspaceOverview.tsx re-export sources from the correct relative path', () => {
    const content = readFileSync(WORKSPACE_OVERVIEW_FILE, 'utf8'); // readFile-ok
    // The re-export must point to ./AIUsageSection (same directory)
    const lines = content.split('\n');
    const reexportLine = lines.find(l => l.includes('AIUsageSection') && l.includes('export'));
    expect(reexportLine).toBeDefined();
    // Must be a re-export FROM ./AIUsageSection, not an import + separate export
    expect(reexportLine).toMatch(/from\s+['"]\.\/AIUsageSection['"]/);
  });

  it('App.tsx lazy-loads AIUsageSection via WorkspaceOverview', () => {
    const content = readFileSync(APP_FILE, 'utf8'); // readFile-ok
    // Match the lazy import pattern:
    // lazyWithRetry(() => import('./components/WorkspaceOverview').then(m => ({ default: m.AIUsageSection })))
    const hasLazyLoad =
      /import\(['"]\.\/components\/WorkspaceOverview['"]\)\s*\.then\([^)]*m\.AIUsageSection/.test(content);
    expect(hasLazyLoad).toBe(true);
  });

  it('the lazy-loaded symbol name in App.tsx matches AIUsageSection', () => {
    const content = readFileSync(APP_FILE, 'utf8'); // readFile-ok
    // The AIUsagePage assignment must pull m.AIUsageSection from WorkspaceOverview.
    // There are two lazy imports from WorkspaceOverview — find the one assigned to AIUsagePage.
    const match = content.match(
      /const\s+AIUsagePage\s*=\s*lazyWithRetry\([^;]+AIUsageSection[^;]+\);/,
    );
    expect(match).not.toBeNull();
    // The matched line must reference m.AIUsageSection
    expect(match![0]).toContain('m.AIUsageSection');
    // And it must import from WorkspaceOverview (not directly from AIUsageSection)
    expect(match![0]).toContain('./components/WorkspaceOverview');
  });
});
