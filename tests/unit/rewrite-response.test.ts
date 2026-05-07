import { describe, expect, it } from 'vitest';

import { extractRewriteOnly, parseRewriteSectionTarget } from '../../src/lib/rewriteResponse';

describe('rewriteResponse helpers', () => {
  it('extracts only delimited rewrite prose for editor apply paths', () => {
    const response = `**Rewriting: Intro**

BEGIN_REWRITE
This is the replacement paragraph that should enter the editor.
END_REWRITE

**Rationale:** This should stay out of the editor.`;

    expect(parseRewriteSectionTarget(response)).toBe('Intro');
    expect(extractRewriteOnly(response)).toBe('This is the replacement paragraph that should enter the editor.');
  });

  it('strips common rationale labels from legacy responses', () => {
    const response = `Rewriting: Services
Replacement copy.

Why this works:
This explanation should not be applied.`;

    expect(extractRewriteOnly(response)).toBe('Replacement copy.');
  });

  it('tolerates leading whitespace before the rewrite label', () => {
    const response = `  **Rewriting: Hero Copy**
BEGIN_REWRITE
Replacement copy.
END_REWRITE`;

    expect(parseRewriteSectionTarget(response)).toBe('Hero Copy');
    expect(extractRewriteOnly(response)).toBe('Replacement copy.');
  });
});
