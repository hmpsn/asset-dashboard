import { describe, expect, it } from 'vitest';
import {
  buildLiveContentUrl,
  normalizeLiveSiteBase,
  normalizeSlug,
  resolveLiveSiteBase,
} from '../../src/components/content-pipeline-rebuilt/contentPipelineFormatters.js';

describe('content pipeline live URL formatting', () => {
  it('prefers a valid live domain over the GSC property', () => {
    expect(resolveLiveSiteBase('live.example.com', 'https://gsc.example.com/')).toBe('https://live.example.com');
  });

  it('falls back to a valid GSC property when liveDomain is malformed', () => {
    expect(resolveLiveSiteBase('javascript:alert(1)', 'sc-domain:gsc.example.com')).toBe('https://gsc.example.com');
  });

  it('rejects malformed, credential-bearing, and non-http site labels', () => {
    expect(normalizeLiveSiteBase('https://user:secret@example.com')).toBeNull();
    expect(normalizeLiveSiteBase('file:///tmp/site')).toBeNull();
    expect(normalizeLiveSiteBase('https://bad\\host.example')).toBeNull();
    expect(resolveLiveSiteBase('not a host', 'also not a host')).toBeNull();
  });

  it('builds the live URL from the validated origin and normalized page path', () => {
    expect(buildLiveContentUrl('https://example.com/property-prefix/', '/guides/implants')).toBe(
      'https://example.com/guides/implants',
    );
    expect(buildLiveContentUrl('sc-domain:example.com', 'https://source.example/guide')).toBe(
      'https://example.com/guide',
    );
  });

  it('rejects unsafe page-address forms', () => {
    expect(normalizeSlug('//other.example/page')).toBe('');
    expect(normalizeSlug('javascript:alert(1)')).toBe('');
    expect(normalizeSlug('folder\\page')).toBe('');
    expect(buildLiveContentUrl('example.com', '//other.example/page')).toBeNull();
  });
});
