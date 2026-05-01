import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { validateWithSchemaOrg } from '../../../server/schema/schema-org-validator.js';

const VALID_SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'LocalBusiness',
      '@id': 'https://example.com/#localbusiness',
      'name': 'Example Business',
      'url': 'https://example.com',
    },
  ],
};

const INVALID_SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'LocalBusiness',
      // Missing @id and name — should produce errors
    },
  ],
};

describe('validateWithSchemaOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns schema_org_validated when no errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ triples: [], errors: [] }),
    });
    const result = await validateWithSchemaOrg(VALID_SCHEMA);
    expect(result.status).toBe('schema_org_validated');
    expect(result.issues).toHaveLength(0);
  });

  it('returns schema_org_failed with issues when errors present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        triples: [],
        errors: [
          { path: 'LocalBusiness/@id', message: '@id is required' },
          { path: 'LocalBusiness/name', message: 'name is required' },
        ],
      }),
    });
    const result = await validateWithSchemaOrg(INVALID_SCHEMA);
    expect(result.status).toBe('schema_org_failed');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].message).toBe('@id is required');
  });

  it('returns schema_org_validated (passes through) when fetch fails — never blocks generation', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await validateWithSchemaOrg(VALID_SCHEMA);
    expect(result.status).toBe('schema_org_validated');
    expect(result.issues).toHaveLength(0);
  });

  it('returns schema_org_validated when response is not ok — graceful degradation', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const result = await validateWithSchemaOrg(VALID_SCHEMA);
    expect(result.status).toBe('schema_org_validated');
  });
});
