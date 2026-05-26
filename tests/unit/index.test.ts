import { describe, expect, it } from 'vitest';
import { classifyPage, generateLeanSchema, validateLeanSchema } from '../../server/schema/index.js';

describe('schema index exports', () => {
  it('re-exports key schema APIs', () => {
    expect(typeof classifyPage).toBe('function');
    expect(typeof generateLeanSchema).toBe('function');
    expect(typeof validateLeanSchema).toBe('function');
  });

  it('classifyPage covers representative routing categories', () => {
    expect(classifyPage('https://example.com/', 'https://example.com').kind).toBe('Homepage');
    expect(classifyPage('https://example.com/blog/how-to-rank', 'https://example.com').kind).toBe('BlogPosting');
    expect(classifyPage('https://example.com/services/seo-audit', 'https://example.com').kind).toBe('Service');
    expect(classifyPage('https://example.com/privacy-policy', 'https://example.com').kind).toBe('Legal');
  });
});
