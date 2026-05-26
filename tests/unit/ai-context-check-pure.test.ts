// tests/unit/ai-context-check-pure.test.ts
// Pure unit tests for server/ai-context-check.ts
//
// checkAIContext assembles a ContextCompleteness object by checking eight
// sources for a given workspace.  We exercise:
//   • score / connected / total calculation
//   • each individual source status (connected vs missing)
//   • the missing-workspace early exit (score 0, empty sources)
//   • partial knowledge-base / brand-voice coverage via inline text vs files

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── DB mock (required by transitive imports) ──────────────────────────────────
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      run: vi.fn().mockReturnValue({ changes: 0 }),
    }),
  },
}));

// ── errors mock ───────────────────────────────────────────────────────────────
vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn().mockReturnValue(false),
}));

// ── Mocked dependency: getWorkspace ──────────────────────────────────────────
const mockGetWorkspace = vi.fn();
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: (...args: unknown[]) => mockGetWorkspace(...args),
}));

// ── Mocked dependency: countPageKeywords ─────────────────────────────────────
const mockCountPageKeywords = vi.fn().mockReturnValue(0);
vi.mock('../../server/page-keywords.js', () => ({
  countPageKeywords: (...args: unknown[]) => mockCountPageKeywords(...args),
}));

// ── Mocked dependency: isAnyProviderConfigured ────────────────────────────────
const mockIsAnyProviderConfigured = vi.fn().mockReturnValue(false);
vi.mock('../../server/seo-data-provider.js', () => ({
  isAnyProviderConfigured: () => mockIsAnyProviderConfigured(),
}));

// ── Mocked dependency: getUploadRoot ─────────────────────────────────────────
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: vi.fn().mockReturnValue('/tmp/test-uploads'),
}));

// ── FS mock — controls whether knowledge/brand directories appear to exist ───
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReaddirSync = vi.fn().mockReturnValue([]);
vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

// ── Import module under test ──────────────────────────────────────────────────
import { checkAIContext } from '../../server/ai-context-check.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialWorkspace = {
  id: string;
  folder?: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  knowledgeBase?: string;
  brandVoice?: string;
  personas?: unknown[];
};

function makeWorkspace(overrides: Partial<PartialWorkspace> = {}): PartialWorkspace {
  return {
    id: 'ws-test',
    folder: undefined,
    webflowSiteId: undefined,
    webflowSiteName: undefined,
    gscPropertyUrl: undefined,
    ga4PropertyId: undefined,
    knowledgeBase: undefined,
    brandVoice: undefined,
    personas: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
  mockCountPageKeywords.mockReturnValue(0);
  mockIsAnyProviderConfigured.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Early exit: workspace not found
// ---------------------------------------------------------------------------
describe('checkAIContext — missing workspace', () => {
  it('returns score 0 and empty sources when workspace does not exist', () => {
    mockGetWorkspace.mockReturnValue(undefined);
    const result = checkAIContext('ws-missing');
    expect(result.score).toBe(0);
    expect(result.connected).toBe(0);
    expect(result.total).toBe(0);
    expect(result.sources).toHaveLength(0);
    expect(result.workspaceId).toBe('ws-missing');
  });
});

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------
describe('checkAIContext — score calculation', () => {
  it('returns score 0 when no sources are connected', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    const result = checkAIContext('ws-test');
    expect(result.score).toBe(0);
    expect(result.connected).toBe(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('returns score 100 when all sources are connected', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      webflowSiteId: 'site-1',
      webflowSiteName: 'My Site',
      gscPropertyUrl: 'https://example.com',
      ga4PropertyId: 'G-12345',
      knowledgeBase: 'Some knowledge base content',
      brandVoice: 'Friendly and professional',
      personas: [{ name: 'Persona A' }],
    }));
    mockCountPageKeywords.mockReturnValue(5);
    mockIsAnyProviderConfigured.mockReturnValue(true);

    const result = checkAIContext('ws-test');
    expect(result.score).toBe(100);
    expect(result.connected).toBe(result.total);
  });

  it('calculates a partial score correctly', () => {
    // Connect: webflow + gsc = 2 out of 8 → 25%
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      webflowSiteId: 'site-1',
      gscPropertyUrl: 'https://example.com',
    }));

    const result = checkAIContext('ws-test');
    expect(result.total).toBe(8);
    expect(result.connected).toBe(2);
    expect(result.score).toBe(25);
  });

  it('exposes exactly 8 sources', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    const result = checkAIContext('ws-test');
    expect(result.sources).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Webflow source
// ---------------------------------------------------------------------------
describe('checkAIContext — webflow source', () => {
  it('is "missing" when webflowSiteId is not set', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ webflowSiteId: undefined }));
    const result = checkAIContext('ws-test');
    const src = result.sources.find(s => s.key === 'webflow')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when webflowSiteId is set', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ webflowSiteId: 'site-xyz' }));
    const result = checkAIContext('ws-test');
    const src = result.sources.find(s => s.key === 'webflow')!;
    expect(src.status).toBe('connected');
  });

  it('includes the site name in the detail when available', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      webflowSiteId: 'site-xyz',
      webflowSiteName: 'My Webflow Site',
    }));
    const result = checkAIContext('ws-test');
    const src = result.sources.find(s => s.key === 'webflow')!;
    expect(src.detail).toContain('My Webflow Site');
  });

  it('lists expected fixAction', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'webflow')!;
    expect(src.fixAction).toBe('workspace-settings');
  });
});

// ---------------------------------------------------------------------------
// GSC source
// ---------------------------------------------------------------------------
describe('checkAIContext — gsc source', () => {
  it('is "missing" when gscPropertyUrl is not set', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ gscPropertyUrl: undefined }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'gsc')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when gscPropertyUrl is set', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ gscPropertyUrl: 'https://example.com' }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'gsc')!;
    expect(src.status).toBe('connected');
  });

  it('includes the property URL in the detail', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ gscPropertyUrl: 'sc-domain:example.com' }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'gsc')!;
    expect(src.detail).toContain('sc-domain:example.com');
  });
});

// ---------------------------------------------------------------------------
// GA4 source
// ---------------------------------------------------------------------------
describe('checkAIContext — ga4 source', () => {
  it('is "missing" when ga4PropertyId is not set', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ ga4PropertyId: undefined }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'ga4')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when ga4PropertyId is set', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ ga4PropertyId: 'G-ABC123' }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'ga4')!;
    expect(src.status).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// Knowledge Base source
// ---------------------------------------------------------------------------
describe('checkAIContext — knowledge-base source', () => {
  it('is "missing" when no inline content and no docs directory', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ knowledgeBase: '' }));
    mockExistsSync.mockReturnValue(false);
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'knowledge-base')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when inline knowledgeBase text is provided', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ knowledgeBase: 'We are a dental practice...' }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'knowledge-base')!;
    expect(src.status).toBe('connected');
  });

  it('is "connected" when knowledge-docs directory has .txt files', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ knowledgeBase: '' }));
    mockExistsSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('knowledge-docs'),
    );
    mockReaddirSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('knowledge-docs') ? ['doc1.txt', 'doc2.txt'] : [],
    );
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'knowledge-base')!;
    expect(src.status).toBe('connected');
  });

  it('is "connected" when knowledge-docs directory has .md files', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ knowledgeBase: undefined }));
    mockExistsSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('knowledge-docs'),
    );
    mockReaddirSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('knowledge-docs') ? ['README.md'] : [],
    );
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'knowledge-base')!;
    expect(src.status).toBe('connected');
  });

  it('ignores non-text files in the knowledge-docs directory', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ knowledgeBase: '' }));
    mockExistsSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('knowledge-docs'),
    );
    // Only a PDF — should not count
    mockReaddirSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('knowledge-docs') ? ['document.pdf'] : [],
    );
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'knowledge-base')!;
    expect(src.status).toBe('missing');
  });
});

// ---------------------------------------------------------------------------
// Brand Voice source
// ---------------------------------------------------------------------------
describe('checkAIContext — brand-voice source', () => {
  it('is "missing" when no inline voice and no brand-docs directory', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ brandVoice: '' }));
    mockExistsSync.mockReturnValue(false);
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'brand-voice')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when inline brandVoice text is provided', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ brandVoice: 'Warm and empathetic tone.' }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'brand-voice')!;
    expect(src.status).toBe('connected');
  });

  it('is "connected" when brand-docs directory has files', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ brandVoice: undefined }));
    mockExistsSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('brand-docs'),
    );
    mockReaddirSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('brand-docs') ? ['voice-guide.txt'] : [],
    );
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'brand-voice')!;
    expect(src.status).toBe('connected');
  });

  it('detail mentions "Voice guidelines set" when inline voice is present', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ brandVoice: 'Professional voice.' }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'brand-voice')!;
    expect(src.detail).toContain('Voice guidelines set');
  });
});

// ---------------------------------------------------------------------------
// Personas source
// ---------------------------------------------------------------------------
describe('checkAIContext — personas source', () => {
  it('is "missing" when personas array is empty', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ personas: [] }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'personas')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when personas array has entries', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ personas: [{ name: 'P1' }, { name: 'P2' }] }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'personas')!;
    expect(src.status).toBe('connected');
  });

  it('detail reflects the correct persona count', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ personas: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }] }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'personas')!;
    expect(src.detail).toContain('3 persona');
  });

  it('uses singular "persona" for exactly 1', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ personas: [{ name: 'Only One' }] }));
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'personas')!;
    expect(src.detail).toMatch(/1 persona(?!s)/);
  });
});

// ---------------------------------------------------------------------------
// Keyword Strategy source
// ---------------------------------------------------------------------------
describe('checkAIContext — keyword-strategy source', () => {
  it('is "missing" when countPageKeywords returns 0', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockCountPageKeywords.mockReturnValue(0);
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'keyword-strategy')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when countPageKeywords returns > 0', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockCountPageKeywords.mockReturnValue(12);
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'keyword-strategy')!;
    expect(src.status).toBe('connected');
  });

  it('detail includes the page count', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockCountPageKeywords.mockReturnValue(7);
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'keyword-strategy')!;
    expect(src.detail).toContain('7 pages');
  });
});

// ---------------------------------------------------------------------------
// SEO Data Provider source
// ---------------------------------------------------------------------------
describe('checkAIContext — semrush/seo-provider source', () => {
  it('is "missing" when no provider is configured', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockIsAnyProviderConfigured.mockReturnValue(false);
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'semrush')!;
    expect(src.status).toBe('missing');
  });

  it('is "connected" when a provider is configured', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockIsAnyProviderConfigured.mockReturnValue(true);
    const src = checkAIContext('ws-test').sources.find(s => s.key === 'semrush')!;
    expect(src.status).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// Source metadata
// ---------------------------------------------------------------------------
describe('checkAIContext — source metadata', () => {
  it('every source has a key, label, status, detail, and impacts array', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    const { sources } = checkAIContext('ws-test');
    for (const src of sources) {
      expect(src.key).toBeTruthy();
      expect(src.label).toBeTruthy();
      expect(['connected', 'missing', 'partial']).toContain(src.status);
      expect(typeof src.detail).toBe('string');
      expect(Array.isArray(src.impacts)).toBe(true);
      expect(src.impacts.length).toBeGreaterThan(0);
    }
  });

  it('workspaceId in result matches the input argument', () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ id: 'ws-abc' }));
    const result = checkAIContext('ws-abc');
    expect(result.workspaceId).toBe('ws-abc');
  });
});
