import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf-8'); // readFile-ok — contract test verifies stale schema-param wiring cleanup.
}

describe('schema dead-param cleanup contract', () => {
  it('schema-suggester signatures do not expose dead analytics map params', () => {
    const source = readProjectFile('server/schema-suggester.ts');

    expect(source).not.toContain('void gscMap');
    expect(source).not.toContain('void ga4Map');
    expect(source).not.toContain('void queryPageData');
    expect(source).not.toContain('void insightsMap');
    expect(source).not.toContain('void validationsByPageId');
  });

  it('schema generation job and routes do not pass dead params through call chains', () => {
    const jobSource = readProjectFile('server/schema-generation-job.ts');
    const routeSource = readProjectFile('server/routes/webflow-schema.ts');

    expect(jobSource).not.toContain('gscMap');
    expect(jobSource).not.toContain('ga4Map');
    expect(jobSource).not.toContain('queryPageData');
    expect(jobSource).not.toContain('insightsMap');
    expect(jobSource).not.toContain('validationsByPageId');

    expect(routeSource).not.toContain('const { ctx, gscMap');
    expect(routeSource).not.toContain('generateSchemaSuggestions(req.params.siteId, token, ctx, undefined, undefined, gscMap');
    expect(routeSource).not.toContain('generateSchemaForPage(req.params.siteId, pageId, token, ctx, gscMap');
  });
});
