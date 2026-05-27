import { describe, it, expect } from 'vitest';
import { slugify } from '../../server/helpers.js';

describe('slugify', () => {
  it('lowercases input', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('foo bar baz')).toBe('foo-bar-baz');
  });

  it('removes non-alphanumeric characters', () => {
    expect(slugify('hello/world')).toBe('hello-world');
    expect(slugify('foo & bar!')).toBe('foo-bar');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo---bar')).toBe('foo-bar');
    expect(slugify('foo   bar')).toBe('foo-bar');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('-hello-')).toBe('hello');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(slugify('   ')).toBe('');
  });

  it('keeps whitespace when keepWhitespace is true', () => {
    const result = slugify('Hello World!', { keepWhitespace: true });
    expect(result).toBe('hello world');
  });

  it('handles unicode/accented chars as hyphens', () => {
    expect(slugify('café latte')).toBe('caf-latte');
  });
});
