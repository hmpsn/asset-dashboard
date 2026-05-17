import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('api wrapper domain cleanup', () => {
  it('keeps platform-foundation wrappers in src/api/platform.ts with misc compatibility re-exports', () => {
    const miscApi = readFileSync('src/api/misc.ts', 'utf-8'); // readFile-ok: wrapper ownership contract
    const platformApi = readFileSync('src/api/platform.ts', 'utf-8'); // readFile-ok: wrapper ownership contract

    expect(miscApi).toContain("from './platform'");
    expect(miscApi).not.toContain('/api/workspace-home/');
    expect(miscApi).not.toContain('/api/roadmap');
    expect(miscApi).not.toContain('/api/jobs');

    expect(platformApi).toContain('/api/workspace-home/');
    expect(platformApi).toContain('/api/roadmap');
    expect(platformApi).toContain('/api/jobs');
  });

  it('keeps schema wrappers in src/api/schema.ts with seo compatibility re-exports', () => {
    const seoApi = readFileSync('src/api/seo.ts', 'utf-8'); // readFile-ok: wrapper ownership contract
    const schemaApi = readFileSync('src/api/schema.ts', 'utf-8'); // readFile-ok: wrapper ownership contract

    expect(seoApi).toContain("from './schema'");
    expect(seoApi).not.toContain('/api/webflow/schema-plan/');
    expect(seoApi).not.toContain('/api/schema-impact/');

    expect(schemaApi).toContain('/api/webflow/schema-plan/');
    expect(schemaApi).toContain('/api/schema-impact/');
    expect(schemaApi).toContain('/api/webflow/schema-retract/');
  });
});
