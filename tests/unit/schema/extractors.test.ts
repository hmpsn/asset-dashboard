import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/ai.js', () => ({
  callAI: vi.fn(),
}));

import { callAI } from '../../../server/ai.js';
import { extractDescription } from '../../../server/schema/extractors/description.js';
import { extractFaq } from '../../../server/schema/extractors/faq.js';

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

describe('extractFaq', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockReset();
  });

  it('extracts FAQs from <details>/<summary> structure', async () => {
    const html = `
      <details>
        <summary>What is your turnaround time?</summary>
        <div>Usually 2 weeks.</div>
      </details>
      <details>
        <summary>Do you offer refunds?</summary>
        <p>Yes, within 30 days.</p>
      </details>
    `;
    const result = await extractFaq(html);
    expect(result).toEqual([
      { question: 'What is your turnaround time?', answer: 'Usually 2 weeks.' },
      { question: 'Do you offer refunds?', answer: 'Yes, within 30 days.' },
    ]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns empty array when no accordion structure', async () => {
    const html = '<p>No FAQ here</p>';
    const result = await extractFaq(html);
    expect(result).toEqual([]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns empty array when only one Q&A (FAQPage requires 2+)', async () => {
    const html = '<details><summary>Q</summary><p>A</p></details>';
    const result = await extractFaq(html);
    expect(result).toEqual([]);
  });

  it('skips entries with empty question or answer', async () => {
    const html = `
      <details><summary></summary><p>Orphan answer</p></details>
      <details><summary>Real Q</summary><p>Real A</p></details>
      <details><summary>Q with empty answer</summary><p></p></details>
    `;
    const result = await extractFaq(html);
    expect(result).toEqual([]); // < 2 valid pairs after filtering
  });
});
