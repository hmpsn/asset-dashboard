// tests/contract/tab-deep-link-wiring.test.ts
//
// CONTRACT: ?tab= deep-link senders and receivers must be wired.
//
// When code constructs a URL with ?tab=X targeting an admin page, the
// component that renders that page must read useSearchParams and initialize
// its tab state from the 'tab' query param.
//
// This test does NOT exercise runtime behavior — it statically verifies:
//   1. Builds a page-slug → component-file map from App.tsx imports + routes
//   2. Finds all ?tab= URL constructions (senders)
//   3. Verifies every sender's target component reads searchParams.get('tab')
//
// readFile-ok — this test intentionally reads source files for static analysis

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, '../..');
const SRC_DIR = join(ROOT, 'src');

/** Recursively collect all .tsx files under a directory. */
function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...collectTsxFiles(full));
    else if (entry.endsWith('.tsx')) results.push(full);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Build the admin page-slug → component-file map from App.tsx
// ---------------------------------------------------------------------------

/**
 * Parse App.tsx to build two maps:
 *   1. componentName → file path (from imports and lazyWithRetry declarations)
 *   2. page slug → componentName (from `if (tab === 'X') return <Component`)
 *
 * Combined: page slug → absolute file path.
 */
function buildRouteMap(): Map<string, string> {
  // readFile-ok — intentional static analysis of route table
  const appTsx = readFileSync(join(SRC_DIR, 'App.tsx'), 'utf8');

  // Step 1: component name → import path
  const componentPaths = new Map<string, string>();

  // lazyWithRetry(() => import('./components/Foo').then(...))
  const lazyRe = /const\s+(\w+)\s*=\s*lazyWithRetry\(\(\)\s*=>\s*import\(\s*'([^']+)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = lazyRe.exec(appTsx)) !== null) {
    componentPaths.set(m[1], m[2]);
  }

  // Regular imports: import { Foo } from './components/Foo'
  // (captures first named export — good enough for route components)
  const importRe = /import\s+\{\s*(\w+)[\s,}].*from\s+'([^']+)'/g;
  while ((m = importRe.exec(appTsx)) !== null) {
    if (!componentPaths.has(m[1])) {
      componentPaths.set(m[1], m[2]);
    }
  }

  // Step 2: page slug → component name
  const routeRe = /if\s*\(\s*tab\s*===\s*'([^']+)'\s*\)\s*return\s*<(\w+)/g;
  const routeMap = new Map<string, string>();

  while ((m = routeRe.exec(appTsx)) !== null) {
    const [, pageSlug, componentName] = m;
    const importPath = componentPaths.get(componentName);
    if (!importPath) continue;

    // Resolve relative import to absolute file path
    // Import paths are relative to src/ (e.g., './components/Foo')
    const base = importPath.replace(/^\.\//, '');
    // Try .tsx first, then .ts
    for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
      const resolved = join(SRC_DIR, base + ext);
      if (existsSync(resolved)) {
        routeMap.set(pageSlug, resolved);
        break;
      }
    }
    // Also handle case where import already has extension
    if (!routeMap.has(pageSlug)) {
      const direct = join(SRC_DIR, base);
      if (existsSync(direct)) {
        routeMap.set(pageSlug, direct);
      }
    }
  }

  return routeMap;
}

// ---------------------------------------------------------------------------
// Find all ?tab= senders in src/
// ---------------------------------------------------------------------------

interface TabSender {
  file: string;       // repo-relative path
  line: number;
  targetPage: string; // admin page slug
  tabValue: string;   // the tab ID being sent
}

function findTabSenders(): TabSender[] {
  const allFiles = collectTsxFiles(SRC_DIR);
  const senders: TabSender[] = [];

  // Pattern: adminPath(something, 'page-slug') + '?tab=value'
  // Captures the page slug and the tab value from the URL construction.
  const senderRe = /adminPath\([^,]+,\s*'([^']+)'\)\s*\+\s*['"`]\?tab=([^'"`\s]+)['"`]/g;

  for (const file of allFiles) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      senderRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = senderRe.exec(lines[i])) !== null) {
        senders.push({
          file: relative(ROOT, file),
          line: i + 1,
          targetPage: match[1],
          tabValue: match[2],
        });
      }
    }
  }

  return senders;
}

// ---------------------------------------------------------------------------
// Receiver checks
// ---------------------------------------------------------------------------

/** Check if a component file reads the 'tab' query param via useSearchParams. */
function readsTabParam(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf8');
    return (
      content.includes("searchParams.get('tab')") ||
      content.includes('searchParams.get("tab")')
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const routeMap = buildRouteMap();
const senders = findTabSenders();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('?tab= deep-link wiring contract', () => {
  it('route map is populated (sanity check)', () => {
    // App.tsx should map at least 15 page slugs to component files
    expect(routeMap.size).toBeGreaterThan(15);
  });

  it('finds at least one ?tab= sender', () => {
    expect(senders.length).toBeGreaterThan(0);
  });

  it('every ?tab= sender targets a known admin page', () => {
    const unknown = senders.filter((s) => !routeMap.has(s.targetPage));
    if (unknown.length > 0) {
      throw new Error(
        `?tab= sender(s) target unknown page slugs:\n` +
        unknown
          .map((s) => `  ${s.file}:${s.line} → page '${s.targetPage}' (tab=${s.tabValue})`)
          .join('\n') +
        `\nEither the page slug is wrong or the route map parser needs updating.`
      );
    }
  });

  it('every ?tab= sender targets a component that reads searchParams.get("tab")', () => {
    const broken: string[] = [];

    for (const sender of senders) {
      const componentFile = routeMap.get(sender.targetPage);
      if (!componentFile) {
        // Covered by the "targets a known admin page" test above
        continue;
      }

      if (!readsTabParam(componentFile)) {
        broken.push(
          `${sender.file}:${sender.line} sends ?tab=${sender.tabValue} → ` +
          `page '${sender.targetPage}' (${relative(ROOT, componentFile)}) ` +
          `but that component does NOT read searchParams.get('tab'). ` +
          `The ?tab= param will be silently ignored.`
        );
      }
    }

    if (broken.length > 0) {
      throw new Error(
        `Broken ?tab= deep-links detected (sender constructs URL but receiver ignores param):\n\n` +
        broken.join('\n\n') +
        `\n\nFix: add useSearchParams() to the target component and read the 'tab' ` +
        `param in the useState initializer. See ContentPipeline.tsx or LinksPanel.tsx for the pattern.`
      );
    }
  });

  it('every sender tab value is a valid tab ID in the target component', () => {
    // For each sender, verify the tab value actually exists in the target
    // component's tab definitions (type union or TABS array).
    const mismatches: string[] = [];

    for (const sender of senders) {
      const componentFile = routeMap.get(sender.targetPage);
      if (!componentFile) continue;

      try {
        const content = readFileSync(componentFile, 'utf8');
        // Check if the tab value appears as a string literal in the file
        // (in a type union like 'calendar' | 'briefs' or a TABS array)
        if (
          !content.includes(`'${sender.tabValue}'`) &&
          !content.includes(`"${sender.tabValue}"`)
        ) {
          mismatches.push(
            `${sender.file}:${sender.line} sends ?tab=${sender.tabValue} → ` +
            `${relative(ROOT, componentFile)} but '${sender.tabValue}' ` +
            `does not appear as a string literal in the target file.`
          );
        }
      } catch {
        // File read error — skip (covered by other tests)
      }
    }

    expect(mismatches).toEqual([]);
  });
});
