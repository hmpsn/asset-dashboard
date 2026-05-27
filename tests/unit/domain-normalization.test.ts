import { describe, it, expect } from 'vitest';

import { normalizeDomainHost, normalizeDomainValue } from '../../server/domain-normalization.js';

describe('domain-normalization', () => {
  describe('normalizeDomainValue', () => {
    it('returns undefined for empty input', () => {
      expect(normalizeDomainValue(undefined)).toBeUndefined();
      expect(normalizeDomainValue(null)).toBeUndefined();
      expect(normalizeDomainValue('')).toBeUndefined();
      expect(normalizeDomainValue('   ')).toBeUndefined();
    });

    it('normalizes full URLs to canonical host', () => {
      expect(normalizeDomainValue('https://www.Example.com:8080/path?q=1')).toBe('example.com');
      expect(normalizeDomainValue('http://blog.example.com/seo')).toBe('blog.example.com');
    });

    it('supports option overrides', () => {
      expect(normalizeDomainValue('https://www.Example.com:8080/path', { stripWww: false })).toBe('www.example.com');
      expect(normalizeDomainValue('https://www.Example.com:8080/path', { stripPort: false })).toBe('example.com:8080');
      expect(normalizeDomainValue('https://www.Example.com/path', { lowercase: false })).toBe('Example.com');
    });

    it('uses malformed fallback by default', () => {
      expect(normalizeDomainValue('example.com/not-a-real-url')).toBe('example.com');
      expect(normalizeDomainValue('WWW.Example.com')).toBe('example.com');
    });

    it('can disable malformed fallback', () => {
      expect(normalizeDomainValue('https://example.com')).toBe('example.com');
      expect(normalizeDomainValue('http://')).toBeUndefined();
      expect(normalizeDomainValue('example.com/path', { allowMalformedFallback: false })).toBe('example.com');
    });
  });

  describe('normalizeDomainHost', () => {
    it('normalizes host values without URL parsing', () => {
      expect(normalizeDomainHost('WWW.Example.com.')).toBe('example.com');
      expect(normalizeDomainHost('blog.example.com:3000')).toBe('blog.example.com');
      expect(normalizeDomainHost('blog.example.com:3000', { stripPort: false })).toBe('blog.example.com:3000');
    });
  });
});
