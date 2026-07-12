import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

function usageTierArguments(source: string): string[] {
  return [...source.matchAll(
    /(?:incrementIfAllowed|checkUsageLimit)\(\s*[^,]+,\s*([^,]+),/g,
  )].map(match => match[1].trim());
}

describe('effective-tier usage gate contract', () => {
  it('keeps keyword strategy reservations on the canonical resolver', () => {
    const source = readFileSync('server/keyword-strategy-generation.ts', 'utf-8'); // readFile-ok — canonical effective-tier usage boundary
    expect(source).toContain('const effectiveTier = computeEffectiveTier(ws);');
    expect(usageTierArguments(source)).toEqual(['effectiveTier']);
  });

  it('keeps single and bulk alt-text gates on the canonical resolver', () => {
    const source = readFileSync('server/routes/webflow-alt-text.ts', 'utf-8'); // readFile-ok — canonical effective-tier usage boundary
    expect(source).toContain('const effectiveTier = computeEffectiveTier(ws);');
    expect(source).toContain('const bulkEffectiveTier = computeEffectiveTier(bulkWs);');
    expect(usageTierArguments(source)).toEqual([
      'effectiveTier',
      'bulkEffectiveTier',
      'bulkEffectiveTier',
    ]);
  });

  it('keeps workspace-context reservations on the canonical resolver', () => {
    const source = readFileSync('server/workspace-context-generation-job.ts', 'utf-8'); // readFile-ok — canonical effective-tier usage boundary
    expect(source).toContain('computeEffectiveTier(ws)');
    expect(usageTierArguments(source)).toEqual(['computeEffectiveTier(ws)']);
  });
});
