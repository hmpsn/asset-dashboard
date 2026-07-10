/**
 * Unit tests for alttext.ts.
 *
 * generateAltText is async and calls OpenAI — external dependencies are mocked.
 * The module-level `client` cache in alttext.ts means all tests share a single
 * mocked client instance. We control responses via a shared `mockCreate` spy
 * that is configured per-test with `mockResolvedValue`.
 *
 * Tests verify:
 *  - null-path when OPENAI_API_KEY is absent
 *  - null when the API returns no choices
 *  - SVG path sends a text message (not image_url content)
 *  - Context is injected into SVG and raster prompts
 *  - Raster path sends an image_url content part
 *  - Return value is trimmed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── shared mock spy ──
const mockCreate = vi.fn();

// ── module mocks (must be hoisted before imports) ──

vi.mock('openai', () => {
  // Class-based mock so `new OpenAI(...)` is callable as a constructor.
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockOpenAI };
});

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  }),
}));

// fs mock: differentiate SVG (utf-8) vs raster (Buffer) reads by encoding arg.
vi.mock('fs', () => {
  const readFileSync = vi.fn().mockImplementation((_path: unknown, encoding?: unknown) => {
    if (encoding === 'utf-8' || encoding === 'utf8') {
      return '<svg><text>Logo</text></svg>';
    }
    return Buffer.from('fake-jpeg-data');
  });
  const unlinkSync = vi.fn();
  return {
    default: { readFileSync, unlinkSync },
    readFileSync,
    unlinkSync,
  };
});

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return { ...actual, default: actual };
});

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn().mockReturnValue(false),
}));

// ── imports (after mocks) ──
import { generateAltText } from '../../server/alttext.js';

// ── tests ──

describe('generateAltText', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    // Default happy-path response for all tests
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A descriptive alt text' } }],
    });
  });

  it('returns null when OPENAI_API_KEY is not set', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await generateAltText('/tmp/some-image.jpg');
      expect(result).toBeNull();
      // mockCreate must not have been called when there is no API key
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      if (saved) process.env.OPENAI_API_KEY = saved;
    }
  });

  it('returns null when the API response has no choices', async () => {
    process.env.OPENAI_API_KEY = 'test-key-abc';
    mockCreate.mockResolvedValue({ choices: [] });

    const result = await generateAltText('/tmp/photo.jpg');
    expect(result).toBeNull();
  });

  it('handles SVG files with a text-only message (no image_url)', async () => {
    process.env.OPENAI_API_KEY = 'test-key-abc';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Company logo SVG' } }],
    });

    const result = await generateAltText('/tmp/logo.svg');

    expect(mockCreate).toHaveBeenCalledOnce();
    const arg = mockCreate.mock.calls[0][0] as { messages: Array<{ content: unknown }> };
    // SVG path sends a plain string message — not an array content block
    expect(typeof arg.messages[0].content).toBe('string');
    expect(result).toBe('Company logo SVG');
  });

  it('SVG prompt includes context when provided', async () => {
    process.env.OPENAI_API_KEY = 'test-key-abc';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Circular diagram' } }],
    });

    await generateAltText('/tmp/icon.svg', 'Used in the hero section of the homepage');

    const arg = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(arg.messages[0].content).toContain('Used in the hero section of the homepage');
  });

  it('raster images send an image_url content part', async () => {
    process.env.OPENAI_API_KEY = 'test-key-abc';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Photo description' } }],
    });

    await generateAltText('/tmp/photo.png');

    expect(mockCreate).toHaveBeenCalledOnce();
    const arg = mockCreate.mock.calls[0][0] as {
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    const content = arg.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((c) => c.type === 'image_url')).toBe(true);
  });

  it('raster prompt includes context in the text content part', async () => {
    process.env.OPENAI_API_KEY = 'test-key-abc';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Team photo' } }],
    });

    await generateAltText('/tmp/team.png', 'Annual company offsite 2026');

    const arg = mockCreate.mock.calls[0][0] as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    const textPart = arg.messages[0].content.find((c) => c.type === 'text');
    expect(textPart?.text).toContain('Annual company offsite 2026');
  });

  it('returns the trimmed response text', async () => {
    process.env.OPENAI_API_KEY = 'test-key-abc';
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '  Photo of mountains at sunset.  ' } }],
    });

    const result = await generateAltText('/tmp/mountains.jpg');
    expect(result).toBe('Photo of mountains at sunset.');
  });

  it('detects SVG by content even when the tmp file has a non-svg extension (hashed CDN URL case)', async () => {
    // Repro: the alt-text routes name the tmp file from the asset URL. A hashed/
    // extensionless Webflow CDN URL yields `.jpg`, so an SVG's bytes land in a
    // `.jpg`-named tmp file. Extension-only routing sent those bytes to sharp →
    // null alt text ("can't see the image"). generateAltText must sniff content.
    process.env.OPENAI_API_KEY = 'test-key-abc';
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><title>Company logo</title></svg>';
    const { readFileSync } = await import('fs');
    vi.mocked(readFileSync).mockImplementation((_path: unknown, encoding?: unknown) => {
      if (encoding === 'utf-8' || encoding === 'utf8') return svg;
      return Buffer.from(svg, 'utf-8');
    });
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Company logo' } }],
    });

    const result = await generateAltText('/tmp/alt_gen_1720000000000.jpg');

    expect(mockCreate).toHaveBeenCalledOnce();
    const arg = mockCreate.mock.calls[0][0] as { messages: Array<{ content: unknown }> };
    // Must take the SVG text branch (string content), NOT the raster image_url branch.
    expect(typeof arg.messages[0].content).toBe('string');
    expect(result).toBe('Company logo');
  });

  it('truncates overlong SVG content before sending to API', async () => {
    process.env.OPENAI_API_KEY = 'test-key-abc';

    const { readFileSync } = await import('fs');
    // Override readFileSync to return a very large SVG string for this test only
    vi.mocked(readFileSync).mockImplementationOnce((_path: unknown, encoding: unknown) => {
      if (encoding === 'utf-8' || encoding === 'utf8') {
        return '<svg>' + 'x'.repeat(60000) + '</svg>';
      }
      return Buffer.from('data');
    });

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Large SVG icon' } }],
    });

    const result = await generateAltText('/tmp/large.svg');

    // Should still succeed — content truncated to ~50K chars
    const arg = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(arg.messages[0].content.length).toBeLessThanOrEqual(52000); // prompt header + 50K content
    expect(result).toBe('Large SVG icon');
  });
});
