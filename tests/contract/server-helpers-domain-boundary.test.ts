import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildSchemaContext as facadeBuildSchemaContext,
  normalizePageUrl as facadeNormalizePageUrl,
  sanitizeForPromptInjection as facadeSanitizeForPromptInjection,
  stripCodeFences as facadeStripCodeFences,
  applySuppressionsToAudit as facadeApplySuppressionsToAudit,
} from '../../server/helpers.js';
import { buildSchemaContext } from '../../server/schema/context-builder.js';
import { applySuppressionsToAudit } from '../../server/seo-audit-suppressions.js';
import { normalizePageUrl } from '../../server/utils/page-address.js';
import { sanitizeForPromptInjection, stripCodeFences } from '../../server/utils/text.js';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8'); // readFile-ok - source contract checks server helper/domain ownership.
}

function listServerProductionFiles(dir = 'server'): string[] {
  const entries = readdirSync(new URL(`${dir}/`, repoRoot), { withFileTypes: true }); // readdir-ok - source contract checks server helper/domain ownership.
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...listServerProductionFiles(relativePath));
      continue;
    }
    if (!entry.isFile() || !relativePath.endsWith('.ts')) continue;
    files.push(relativePath);
  }

  return files;
}

function resolvesToRootHelpers(fromFile: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const sourcePath = path.resolve(process.cwd(), fromFile);
  const resolved = path.resolve(path.dirname(sourcePath), specifier.replace(/\.js$/, '.ts'));
  return resolved === path.resolve(process.cwd(), 'server/helpers.ts');
}

describe('server helpers domain boundary', () => {
  it('keeps helpers.ts as a thin compatibility facade', () => {
    const facade = readRepoFile('server/helpers.ts');

    expect(facade).toContain("from './utils/page-address.js'");
    expect(facade).toContain("from './utils/text.js'");
    expect(facade).toContain("from './schema/context-builder.js'");
    expect(facade).toContain("from './seo-audit-suppressions.js'");
    expect(facade).not.toMatch(/export function \w+/);
    expect(facade).not.toMatch(/import .* from /);
    expect(facade.split('\n').length).toBeLessThan(80);
  });

  it('keeps facade exports identity-equal to leaf owners', () => {
    expect(facadeNormalizePageUrl).toBe(normalizePageUrl);
    expect(facadeSanitizeForPromptInjection).toBe(sanitizeForPromptInjection);
    expect(facadeStripCodeFences).toBe(stripCodeFences);
    expect(facadeApplySuppressionsToAudit).toBe(applySuppressionsToAudit);
    expect(facadeBuildSchemaContext).toBe(buildSchemaContext);
  });

  it('keeps production server consumers off the root helpers facade', () => {
    const offenders = listServerProductionFiles()
      .filter((file) => file !== 'server/helpers.ts')
      .flatMap((file) => {
        const source = readRepoFile(file);
        const imports = [...source.matchAll(/from\s+['"]([^'"]*helpers\.js)['"]/g)];
        return imports
          .map((match) => String(match[1]))
          .filter((specifier) => resolvesToRootHelpers(file, specifier))
          .map((specifier) => `${file}: ${specifier}`);
      });

    expect(offenders).toEqual([]);
  });
});
