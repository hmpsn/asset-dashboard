/**
 * Component tests for the unified CannibalizationAlert (#14, Wave 2 T5).
 *
 * Three assertion groups:
 *   (a) detailed variant — rich entries (positions + remediation) render per-page rows + action label
 *   (b) minimal variant — string-derived paths (no positions) render without error
 *   (c) gating — tier provided + non-qualifying tier → TierGate overlay;
 *               no tier → ungated (renders regardless of content)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CannibalizationAlert } from '../../src/components/ui/CannibalizationAlert';
import type { CannibalizationEntry } from '../../shared/types/intelligence';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const richEntries: CannibalizationEntry[] = [
  {
    keyword: 'seo services',
    severity: 'high',
    pages: [
      { path: '/seo', position: 3, impressions: 500, clicks: 42, source: 'gsc' },
      { path: '/services/seo', position: 8, impressions: 120, clicks: 10, source: 'keyword_map' },
    ],
    recommendation: 'Consolidate to /seo as the canonical page.',
    action: 'canonical_tag',
    canonicalPath: '/seo',
  },
];

/** Minimal entries derived from string-paths (no positions, no remediation). */
const minimalEntries: CannibalizationEntry[] = [
  {
    keyword: 'web design',
    severity: 'medium',
    pages: [
      { path: '/web-design' },
      { path: '/services/web-design' },
    ],
  },
];

// ── (a) Detailed variant: per-page rows + remediation action label ─────────────

describe('CannibalizationAlert — detailed (rich entries)', () => {
  it('renders the keyword heading', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    // &ldquo; and &rdquo; render as typographic quotes in the DOM
    expect(screen.getByText(/seo services/)).toBeInTheDocument();
  });

  it('renders per-page path rows', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    expect(screen.getByText('/seo')).toBeInTheDocument();
    expect(screen.getByText('/services/seo')).toBeInTheDocument();
  });

  it('renders position data for pages that have it', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    // position 3 → "pos #3"
    expect(screen.getByText(/pos #3/)).toBeInTheDocument();
  });

  it('renders the action label for canonical_tag action', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    expect(screen.getByText(/Canonical Tag/i)).toBeInTheDocument();
  });

  it('renders the canonicalPath alongside the action label', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    expect(screen.getByText(/→ \/seo/)).toBeInTheDocument();
  });

  it('renders the recommendation text', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    expect(screen.getByText(/Consolidate to \/seo as the canonical page/)).toBeInTheDocument();
  });

  it('renders severity badge', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });
});

// ── (b) Minimal variant: string-derived paths, no positions ───────────────────

describe('CannibalizationAlert — minimal (string-derived paths)', () => {
  it('renders without throwing', () => {
    expect(() => render(<CannibalizationAlert entries={minimalEntries} />)).not.toThrow();
  });

  it('renders the keyword', () => {
    render(<CannibalizationAlert entries={minimalEntries} />);
    expect(screen.getByText(/web design/)).toBeInTheDocument();
  });

  it('renders paths from minimal entries', () => {
    render(<CannibalizationAlert entries={minimalEntries} />);
    expect(screen.getByText('/web-design')).toBeInTheDocument();
    expect(screen.getByText('/services/web-design')).toBeInTheDocument();
  });

  it('does not render position data when absent', () => {
    render(<CannibalizationAlert entries={minimalEntries} />);
    expect(screen.queryByText(/pos #/)).toBeNull();
  });

  it('does not render action label when action is absent', () => {
    render(<CannibalizationAlert entries={minimalEntries} />);
    expect(screen.queryByText(/Canonical Tag|301 Redirect|Differentiate|Noindex/)).toBeNull();
  });
});

// ── (c) Gating: tier provided vs. no tier ─────────────────────────────────────

describe('CannibalizationAlert — TierGate behaviour', () => {
  it('renders content when no tier is provided (ungated)', () => {
    render(<CannibalizationAlert entries={richEntries} />);
    // Content visible — no TierGate overlay
    expect(screen.getByText(/seo services/)).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to/)).toBeNull();
  });

  it('renders content when tier qualifies (growth tier, growth required)', () => {
    render(<CannibalizationAlert entries={richEntries} tier="growth" />);
    expect(screen.getByText(/seo services/)).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to/)).toBeNull();
  });

  it('renders content when tier qualifies (premium tier, growth required)', () => {
    render(<CannibalizationAlert entries={richEntries} tier="premium" />);
    expect(screen.getByText(/seo services/)).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to/)).toBeNull();
  });

  it('renders TierGate overlay when tier does not qualify (free, growth required)', () => {
    render(<CannibalizationAlert entries={richEntries} tier="free" />);
    // TierGate shows upgrade prompt — the keyword content is blurred behind the overlay
    expect(screen.getByText(/Upgrade to Growth/)).toBeInTheDocument();
  });

  it('ungated rendering does NOT show upgrade overlay even for large entry lists', () => {
    const manyEntries: CannibalizationEntry[] = Array.from({ length: 5 }, (_, i) => ({
      keyword: `keyword-${i}`,
      severity: 'low' as const,
      pages: [{ path: `/page-${i}` }, { path: `/other-${i}` }],
    }));
    render(<CannibalizationAlert entries={manyEntries} />);
    expect(screen.queryByText(/Upgrade to/)).toBeNull();
    expect(screen.getByText(/keyword-0/)).toBeInTheDocument();
  });
});

// ── (d) Empty list → render nothing ──────────────────────────────────────────

describe('CannibalizationAlert — empty state', () => {
  it('renders nothing when entries array is empty', () => {
    const { container } = render(<CannibalizationAlert entries={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
