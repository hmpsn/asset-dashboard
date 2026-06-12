/**
 * Component tests: Health Tab purchase surface (R1-B)
 *
 * Covers:
 * - FixableIssueRow — Growth shows price + adds to cart; Premium shows hours framing
 * - HealthImpactLine — renders range + methodology popover; absent without monthlyRangeUsd
 * - HealthCartSummary — mirrors cart contents; pack suggestion at threshold
 * - HealthFixByTypeSection — integration of above for a by-fix-type group
 * - Accessibility: CTA button has aria-label
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FixableIssueRow } from '../../../../src/components/client/health-tab/FixableIssueRow';
import { HealthImpactLine } from '../../../../src/components/client/health-tab/HealthImpactLine';
import { HealthCartSummary } from '../../../../src/components/client/health-tab/HealthCartSummary';
import { HealthFixByTypeSection } from '../../../../src/components/client/health-tab/HealthFixByTypeSection';
import type { AuditDetail } from '../../../../src/components/client/types';
import type { ImpactBand } from '../../../../shared/types/fix-catalog';
import type { HealthTabShell } from '../../../../src/components/client/health-tab/useHealthTabShell';

// ── Mock useCart ──────────────────────────────────────────────────────────────

const mockAddItem = vi.fn();
const mockOpenCart = vi.fn();
let mockCartItems: Array<{
  productType: string;
  displayName: string;
  priceUsd: number;
  quantity: number;
  isFlat?: boolean;
}> = [];
let mockTotalItems = 0;
let mockTotalPrice = 0;

vi.mock('../../../../src/components/client/useCart', () => ({
  useCart: () => ({
    items: mockCartItems,
    totalItems: mockTotalItems,
    totalPrice: mockTotalPrice,
    addItem: mockAddItem,
    openCart: mockOpenCart,
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
    clearCart: vi.fn(),
    isOpen: false,
    closeCart: vi.fn(),
    toggleCart: vi.fn(),
  }),
  CartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWith(ui: React.ReactElement) {
  return render(ui, { wrapper: Wrapper });
}

function makeAuditDetail(): AuditDetail {
  return {
    id: 'audit-1',
    createdAt: '2026-06-01T00:00:00Z',
    siteName: 'Test Site',
    previousScore: undefined,
    audit: {
      siteScore: 60,
      totalPages: 5,
      errors: 2,
      warnings: 3,
      infos: 0,
      pages: [
        {
          pageId: 'pg-1',
          page: 'Home',
          slug: '/',
          url: '/',
          score: 55,
          issues: [
            { check: 'title', severity: 'error', message: 'Missing title' },
            { check: 'meta-description', severity: 'warning', message: 'Missing meta' },
          ],
        },
        {
          pageId: 'pg-2',
          page: 'About',
          slug: '/about',
          url: '/about',
          score: 65,
          issues: [
            { check: 'structured-data', severity: 'warning', message: 'No schema' },
          ],
        },
        {
          pageId: 'pg-3',
          page: 'Contact',
          slug: '/contact',
          url: '/contact',
          score: 70,
          issues: [
            { check: 'img-alt', severity: 'warning', message: 'Missing alt text' },
          ],
        },
      ],
      siteWideIssues: [],
      cwvSummary: undefined,
    },
    scoreHistory: [],
    auditDiff: undefined,
  };
}

function makeFixByTypeShell(): Pick<
  HealthTabShell,
  'severityFilter' | 'showInfoItems' | 'expandedPages' | 'togglePage'
> {
  return {
    severityFilter: 'all',
    showInfoItems: false,
    expandedPages: new Set(['fix-type-title']),
    togglePage: vi.fn(),
  };
}

beforeEach(() => {
  mockAddItem.mockClear();
  mockOpenCart.mockClear();
  mockCartItems = [];
  mockTotalItems = 0;
  mockTotalPrice = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// FixableIssueRow
// ─────────────────────────────────────────────────────────────────────────────

describe('FixableIssueRow', () => {
  it('Growth tier: renders price CTA for a fixable check', () => {
    renderWith(
      <FixableIssueRow
        check="title"
        displayName="Page Titles"
        tier="growth"
      />,
    );
    const btn = screen.getByTestId('fix-row-cta-title');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('$20');
  });

  it('Growth tier: calls addItem with correct shape on click', () => {
    renderWith(
      <FixableIssueRow
        check="title"
        displayName="Page Titles"
        pageIds={['pg-1']}
        tier="growth"
      />,
    );
    fireEvent.click(screen.getByTestId('fix-row-cta-title'));
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    const call = mockAddItem.mock.calls[0][0];
    expect(call.productType).toBe('fix_meta');
    expect(call.priceUsd).toBe(20);
    expect(call.isFlat).toBe(false);
    expect(call.pageIds).toEqual(['pg-1']);
  });

  it('Growth tier: alt-text fix passes isFlat=true', () => {
    renderWith(
      <FixableIssueRow
        check="img-alt"
        displayName="Alt Text"
        tier="growth"
      />,
    );
    fireEvent.click(screen.getByTestId('fix-row-cta-img-alt'));
    const call = mockAddItem.mock.calls[0][0];
    expect(call.productType).toBe('fix_alt');
    expect(call.isFlat).toBe(true);
    expect(call.priceUsd).toBe(50);
  });

  it('Growth tier: schema fix has correct product type and price', () => {
    renderWith(
      <FixableIssueRow
        check="structured-data"
        displayName="Schema"
        tier="growth"
      />,
    );
    fireEvent.click(screen.getByTestId('fix-row-cta-structured-data'));
    const call = mockAddItem.mock.calls[0][0];
    expect(call.productType).toBe('schema_page');
    expect(call.priceUsd).toBe(39);
  });

  it('Growth tier: shows "In cart" state when item is in cart', () => {
    mockCartItems = [{
      productType: 'fix_meta',
      displayName: 'Metadata',
      priceUsd: 20,
      quantity: 1,
    }];
    renderWith(
      <FixableIssueRow
        check="title"
        displayName="Page Titles"
        tier="growth"
      />,
    );
    expect(screen.getByTestId('fix-row-incart-title')).toBeTruthy();
    expect(screen.queryByTestId('fix-row-cta-title')).toBeNull();
  });

  it('Premium tier: renders hours framing — no price visible', () => {
    renderWith(
      <FixableIssueRow
        check="title"
        displayName="Page Titles"
        tier="premium"
      />,
    );
    const row = screen.getByTestId('fix-row-premium-title');
    expect(row.textContent).toContain('hours');
    expect(row.textContent).not.toMatch(/\$\d+/);
    // CTA button should not exist
    expect(screen.queryByTestId('fix-row-cta-title')).toBeNull();
  });

  it('Premium tier: calls onRequestFix when button clicked', () => {
    const onRequestFix = vi.fn();
    renderWith(
      <FixableIssueRow
        check="title"
        displayName="Page Titles"
        tier="premium"
        onRequestFix={onRequestFix}
      />,
    );
    fireEvent.click(screen.getByTestId('fix-row-premium-title').querySelector('button')!);
    expect(onRequestFix).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown / non-purchasable check type', () => {
    const { container } = renderWith(
      <FixableIssueRow
        check="content-length"
        displayName="Content Length"
        tier="growth"
      />,
    );
    // non-fixable check → nothing rendered
    expect(container.firstChild).toBeNull();
  });

  it('CTA button has aria-label', () => {
    renderWith(
      <FixableIssueRow
        check="title"
        displayName="Page Titles"
        tier="growth"
      />,
    );
    const btn = screen.getByTestId('fix-row-cta-title');
    expect(btn.getAttribute('aria-label')).toContain('Page Titles');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HealthImpactLine
// ─────────────────────────────────────────────────────────────────────────────

describe('HealthImpactLine', () => {
  it('renders the monthly range when monthlyRangeUsd is present', () => {
    const band: ImpactBand = { band: 'medium', monthlyRangeUsd: [80, 160] };
    renderWith(<HealthImpactLine impactBand={band} />);
    const line = screen.getByTestId('health-impact-line');
    expect(line.textContent).toContain('$80');
    expect(line.textContent).toContain('$160');
  });

  it('renders nothing when impactBand is undefined', () => {
    const { container } = renderWith(<HealthImpactLine impactBand={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when monthlyRangeUsd is absent (below floor)', () => {
    const band: ImpactBand = { band: 'low' }; // no monthlyRangeUsd
    const { container } = renderWith(<HealthImpactLine impactBand={band} />);
    expect(container.firstChild).toBeNull();
  });

  it('reveals methodology popover on expand', () => {
    const band: ImpactBand = { band: 'high', monthlyRangeUsd: [200, 400] };
    renderWith(<HealthImpactLine impactBand={band} />);
    // methodology section should be hidden initially (details not open)
    const details = screen.getByTestId('health-impact-line');
    expect(details.hasAttribute('open')).toBe(false);
    // Click the summary to open
    fireEvent.click(details.querySelector('summary')!);
    // After opening, methodology section should be present in DOM
    expect(screen.getByTestId('health-impact-methodology')).toBeTruthy();
  });

  it('renders equal bounds as a single value', () => {
    const band: ImpactBand = { band: 'low', monthlyRangeUsd: [50, 50] };
    renderWith(<HealthImpactLine impactBand={band} />);
    const line = screen.getByTestId('health-impact-line');
    expect(line.textContent).toContain('~$50/mo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HealthCartSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('HealthCartSummary', () => {
  it('renders nothing when cart is empty', () => {
    const { container } = renderWith(<HealthCartSummary />);
    expect(container.firstChild).toBeNull();
  });

  it('shows item count and total when cart has items', () => {
    mockTotalItems = 2;
    mockTotalPrice = 59;
    mockCartItems = [
      { productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, quantity: 1 },
      { productType: 'fix_redirect', displayName: 'Redirect', priceUsd: 19, quantity: 1 },
    ];
    renderWith(<HealthCartSummary />);
    const bar = screen.getByTestId('health-cart-summary');
    expect(bar.textContent).toContain('2 fixes');
    expect(bar.textContent).toContain('$59');
  });

  it('calls openCart when "Review cart" button is clicked', () => {
    mockTotalItems = 1;
    mockTotalPrice = 20;
    mockCartItems = [{ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, quantity: 1 }];
    renderWith(<HealthCartSummary />);
    fireEvent.click(screen.getByRole('button', { name: /open seo fix cart/i }));
    expect(mockOpenCart).toHaveBeenCalledTimes(1);
  });

  it('shows pack suggestion when metadata family reaches 10 pages', () => {
    // Simulate 10 fix_meta items in cart → triggers metadata pack suggestion
    mockTotalItems = 10;
    mockTotalPrice = 200;
    mockCartItems = [
      { productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, quantity: 10 },
    ];
    renderWith(<HealthCartSummary />);
    const suggestion = screen.getByTestId('health-pack-suggestion');
    // Pack is $179, savings = 10×20 - 179 = $21
    expect(suggestion.textContent).toContain('Metadata pack');
    expect(suggestion.textContent).toContain('$179');
    expect(suggestion.textContent).toContain('save');
  });

  it('does NOT show pack suggestion at 9 items (threshold is 10)', () => {
    mockTotalItems = 9;
    mockTotalPrice = 180;
    mockCartItems = [
      { productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, quantity: 9 },
    ];
    renderWith(<HealthCartSummary />);
    expect(screen.queryByTestId('health-pack-suggestion')).toBeNull();
  });

  it('suppresses prices when hidePrices is true', () => {
    mockTotalItems = 2;
    mockTotalPrice = 59;
    mockCartItems = [
      { productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, quantity: 1 },
    ];
    renderWith(<HealthCartSummary hidePrices />);
    const bar = screen.getByTestId('health-cart-summary');
    expect(bar.textContent).not.toMatch(/\$\d+/);
  });

  it('shows combined impact estimate when cartImpactBands provided', () => {
    mockTotalItems = 1;
    mockTotalPrice = 20;
    mockCartItems = [{ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, quantity: 1 }];
    const bands: ImpactBand[] = [
      { band: 'medium', monthlyRangeUsd: [80, 160] },
    ];
    renderWith(<HealthCartSummary cartImpactBands={bands} />);
    const bar = screen.getByTestId('health-cart-summary');
    expect(bar.textContent).toContain('$80');
    expect(bar.textContent).toContain('$160');
  });

  it('shows singular "1 fix" for a single item', () => {
    mockTotalItems = 1;
    mockTotalPrice = 50;
    mockCartItems = [{ productType: 'fix_alt', displayName: 'Alt Text', priceUsd: 50, quantity: 1, isFlat: true }];
    renderWith(<HealthCartSummary />);
    expect(screen.getByTestId('health-cart-summary').textContent).toContain('1 fix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HealthFixByTypeSection
// ─────────────────────────────────────────────────────────────────────────────

describe('HealthFixByTypeSection', () => {
  it('Growth: shows fix CTA when group is expanded and check is fixable', () => {
    const detail = makeAuditDetail();
    const shell = makeFixByTypeShell();
    renderWith(
      <HealthFixByTypeSection
        auditDetail={detail}
        shell={shell}
        tier="growth"
      />,
    );
    // "title" group is expanded — should show fix CTA
    expect(screen.getByTestId('fix-row-cta-title')).toBeTruthy();
  });

  it('Premium: shows hours framing instead of price for fixable check', () => {
    const detail = makeAuditDetail();
    const shell = makeFixByTypeShell();
    renderWith(
      <HealthFixByTypeSection
        auditDetail={detail}
        shell={shell}
        tier="premium"
      />,
    );
    const row = screen.getByTestId('fix-row-premium-title');
    expect(row.textContent).toContain('hours');
    expect(row.textContent).not.toMatch(/\$\d+/);
  });

  it('shows impact line when impactBand present for the check', () => {
    const detail = makeAuditDetail();
    const shell = makeFixByTypeShell();
    const impactBandsByCheck: Record<string, ImpactBand> = {
      title: { band: 'medium', monthlyRangeUsd: [100, 200] },
    };
    renderWith(
      <HealthFixByTypeSection
        auditDetail={detail}
        shell={shell}
        tier="growth"
        impactBandsByCheck={impactBandsByCheck}
      />,
    );
    const line = screen.getByTestId('health-impact-line');
    expect(line.textContent).toContain('$100');
    expect(line.textContent).toContain('$200');
  });

  it('does NOT show impact line when impactBand absent for check', () => {
    const detail = makeAuditDetail();
    const shell = makeFixByTypeShell();
    renderWith(
      <HealthFixByTypeSection
        auditDetail={detail}
        shell={shell}
        tier="growth"
      />,
    );
    expect(screen.queryByTestId('health-impact-line')).toBeNull();
  });

  it('renders no-issue state when no groups match filter', () => {
    const detail: AuditDetail = makeAuditDetail();
    // Only info issues
    detail.audit.pages = [
      {
        pageId: 'pg-1',
        page: 'Home',
        slug: '/',
        url: '/',
        score: 90,
        issues: [{ check: 'lang', severity: 'info', message: 'Info' }],
      },
    ];
    const shell = makeFixByTypeShell();
    // showInfoItems = false → no groups match
    renderWith(
      <HealthFixByTypeSection
        auditDetail={detail}
        shell={{ ...shell, showInfoItems: false, severityFilter: 'all' }}
        tier="growth"
      />,
    );
    expect(screen.getByText('No issues match your filters')).toBeTruthy();
  });
});
