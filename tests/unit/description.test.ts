import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(),
}));

import { callAI } from '../../server/ai.js';
import { extractDescription } from '../../server/schema/extractors/description.js';

const workspace = {
  name: 'Acme Dental',
  publisherLogoUrl: null,
  businessProfile: null,
  defaultLocale: 'en',
};

describe('extractDescription', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockReset();
  });

  it('short-circuits to existingDescription and does not call AI', async () => {
    const result = await extractDescription({
      existingDescription: '  Existing page description  ',
      title: 'Invisalign for Adults',
      pageBody: 'Body content that should not be used.',
      workspace,
    });

    expect(result).toBe('Existing page description');
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns undefined when pageBody is empty and no existing description exists', async () => {
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'Invisalign for Adults',
      pageBody: '   ',
      workspace,
    });

    expect(result).toBeUndefined();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('cleans, trims, and truncates successful AI output', async () => {
    const longText = `   "${'A'.repeat(220)}"   `;
    vi.mocked(callAI).mockResolvedValueOnce({
      text: longText,
      tokens: { prompt: 10, completion: 20, total: 30 },
    });

    const result = await extractDescription({
      existingDescription: undefined,
      title: 'Invisalign for Adults',
      pageBody: 'Detailed clinical page content.',
      workspace,
    });

    expect(callAI).toHaveBeenCalledTimes(1);
    expect(result).toBe('A'.repeat(200));
  });

  it('returns undefined when AI call fails', async () => {
    vi.mocked(callAI).mockRejectedValueOnce(new Error('AI unavailable'));

    const result = await extractDescription({
      existingDescription: undefined,
      title: 'Invisalign for Adults',
      pageBody: 'Detailed clinical page content.',
      workspace,
    });

    expect(result).toBeUndefined();
  });
});
