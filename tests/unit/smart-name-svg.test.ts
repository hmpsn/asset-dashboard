/**
 * Unit tests for suggestSvgFilename (SVG-aware asset renaming).
 *
 * Bug this covers: `/api/smart-name` used to skip vision for SVGs and fall straight
 * to a filename-only text prompt, so SVGs with generic filenames got generic names —
 * the model never saw the SVG's content. SVGs are XML, not pixels: their
 * <title>/<desc>/<text>/aria-label describe what they are. This helper feeds the SVG
 * SOURCE to the model so it can derive a real, specific name.
 *
 * fetch + the OpenAI client are mocked (mirrors alttext-pure.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { suggestSvgFilename } from '../../server/domains/webflow-assets/svg-naming.js';

const mockCreate = vi.fn();
const client = { chat: { completions: { create: mockCreate } } };

describe('suggestSvgFilename', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'company-logo' } }] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('feeds the SVG source markup to the model and returns the suggested slug', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Company Logo</title><text>Acme</text></svg>';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => svg });
    vi.stubGlobal('fetch', mockFetch);

    const result = await suggestSvgFilename(client, 'https://cdn.example.com/hashed-no-extension', 'Suggest a name.');

    expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/hashed-no-extension');
    const arg = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
    // The model must actually receive the SVG's content (title/text) — not just a filename.
    expect(arg.messages[0].content).toContain('Company Logo');
    expect(arg.messages[0].content).toContain('Acme');
    expect(result).toBe('company-logo');
  });

  it('strips verbose path data before sending, to control token count', async () => {
    const longPath = 'M0 0 ' + 'L1 1 '.repeat(100); // > 200 chars
    const svg = `<svg><title>Icon</title><path d="${longPath}"/></svg>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => svg }));

    await suggestSvgFilename(client, 'https://cdn/x', 'name it');

    const arg = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(arg.messages[0].content).toContain('d="..."');
    expect(arg.messages[0].content).not.toContain(longPath);
    // Structural/text content is preserved.
    expect(arg.messages[0].content).toContain('<title>Icon</title>');
  });

  it('returns null when the SVG fetch fails, so the caller can fall back to filename-only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await suggestSvgFilename(client, 'https://cdn/missing', 'name it');

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
