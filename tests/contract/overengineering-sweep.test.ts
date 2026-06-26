import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('overengineering sweep contracts', () => {
  it('keeps PostEditor editing mode represented by a single target state', () => {
    const source = read('src/components/PostEditor.tsx');

    expect(source).toContain('type EditingTarget =');
    expect(source).toContain('useState<EditingTarget>(null)');
    expect(source).toContain("editingTarget?.type === 'title'");
    expect(source).toContain("editingTarget?.type === 'intro'");
    expect(source).toContain("editingTarget?.type === 'conclusion'");
    expect(source).toContain("editingTarget?.type === 'section'");

    expect(source).not.toMatch(/setEditing(?:Title|Intro|Conclusion|Section)/);
    expect(source).not.toMatch(/const \[editing(?:Title|Intro|Conclusion|Section)\s*,/);
  });

  it('keeps generation context option exports as direct aliases when they add no fields', () => {
    const source = read('server/intelligence/generation-context-builders.ts');

    expect(source).toContain('export interface GenerationContextBuilderOptions');
    expect(source).toContain('export type ContentGenerationContextOptions = GenerationContextBuilderOptions;');
    expect(source).toContain('export type RecommendationGenerationContextOptions = GenerationContextBuilderOptions;');
    expect(source).not.toContain('interface ContentGenerationContextOptions extends GenerationContextBuilderOptions {}');
    expect(source).not.toContain('interface RecommendationGenerationContextOptions extends GenerationContextBuilderOptions {}');
  });

  it('keeps the lone slice timeout wrapper siteHealth-specific', () => {
    const source = read('server/intelligence/slice-metadata-registry.ts');

    expect(source).toContain('async function assembleSiteHealthWithTimeout(');
    expect(source).toContain("log.warn({ workspaceId, slice: 'siteHealth', timeoutMs }, 'siteHealth slice assembly failed");
    expect(source).toContain("log.warn({ workspaceId, slice: 'siteHealth', err }, 'siteHealth slice assembly failed");
    expect(source).not.toContain('async function assembleWithTimeout<T>');
    expect(source).not.toContain('Promise.race<T | undefined>');
  });
});
