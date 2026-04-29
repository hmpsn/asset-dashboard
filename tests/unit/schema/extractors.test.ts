import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/ai.js', () => ({
  callAI: vi.fn(),
}));

import { callAI } from '../../../server/ai.js';
import { extractDescription } from '../../../server/schema/extractors/description.js';

describe('extractDescription', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockReset();
  });

  it('returns existing description without calling AI', async () => {
    const result = await extractDescription({
      existingDescription: 'A real description from page meta',
      title: 'X',
      pageBody: 'body',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect(result).toBe('A real description from page meta');
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns undefined when no body text and no existing description', async () => {
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'X',
      pageBody: '',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect(result).toBeUndefined();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('calls AI exactly once when body present and no existing description', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({
      text: 'A concise generated description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'My Service',
      pageBody: 'Long body about the service... more text...',
      workspace: { name: 'Acme', publisherLogoUrl: null, businessProfile: null },
    });
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(result).toBe('A concise generated description.');
  });

  it('truncates AI output longer than 200 characters', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({
      text: 'A'.repeat(300),
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'X',
      pageBody: 'body',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect((result || '').length).toBeLessThanOrEqual(200);
  });

  it('falls back to undefined when AI throws', async () => {
    vi.mocked(callAI).mockRejectedValueOnce(new Error('AI down'));
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'X',
      pageBody: 'body',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect(result).toBeUndefined();
  });
});
