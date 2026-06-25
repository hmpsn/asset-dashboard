import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const facade = readFileSync('server/keyword-strategy-ai-synthesis.ts', 'utf8'); // readFile-ok: source-boundary contract for decomposition guard
const prompts = readFileSync('server/keyword-strategy-synthesis/prompts.ts', 'utf8'); // readFile-ok: source-boundary contract for prompt ownership
const types = readFileSync('server/keyword-strategy-synthesis/types.ts', 'utf8'); // readFile-ok: source-boundary contract for stage type ownership

describe('keyword strategy synthesis decomposition boundaries', () => {
  it('keeps synthesis-only stage types out of the public facade', () => {
    expect(facade).not.toMatch(/\btype\s+PageMapping\b/);
    expect(facade).not.toMatch(/\binterface\s+PageMapping\b/);
    expect(facade).not.toMatch(/\btype\s+MasterStrategyData\b/);
    expect(facade).not.toMatch(/\binterface\s+MasterStrategyData\b/);
    expect(types).toContain('export interface PageMapping');
    expect(types).toContain('export interface MasterStrategyData');
  });

  it('keeps large AI prompt templates in the prompt stage module', () => {
    expect(facade).not.toContain('Return JSON with this EXACT structure');
    expect(facade).not.toContain('Return a JSON OBJECT (not a bare array)');
    expect(facade).not.toContain('Return a JSON array with one entry per page');
    expect(prompts).toContain('Return JSON with this EXACT structure');
    expect(prompts).toContain('Return a JSON OBJECT (not a bare array)');
    expect(prompts).toContain('Return a JSON array with one entry per page');
  });
});
