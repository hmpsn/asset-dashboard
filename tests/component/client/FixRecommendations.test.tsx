import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FixRecommendations } from '../../../src/components/client/FixRecommendations';
import type { AuditDetail } from '../../../src/components/client/types';

const addItemMock = vi.fn();

vi.mock('../../../src/components/client/useCart', () => ({
  useCart: () => ({
    items: [],
    isOpen: false,
    addItem: addItemMock,
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
    clearCart: vi.fn(),
    openCart: vi.fn(),
    closeCart: vi.fn(),
    toggleCart: vi.fn(),
    totalItems: 0,
    totalPrice: 0,
  }),
}));

vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

const auditDetail: AuditDetail = {
  id: 'audit-1',
  createdAt: '2026-05-16T00:00:00.000Z',
  siteName: 'Acme Co',
  audit: {
    siteScore: 57,
    totalPages: 1,
    errors: 1,
    warnings: 0,
    infos: 0,
    pages: [
      {
        pageId: 'page-1',
        page: 'Home',
        slug: '/',
        url: 'https://acme.test/',
        score: 57,
        issues: [
          {
            check: 'meta-title',
            severity: 'error',
            category: 'content',
            message: 'Missing title tag',
            recommendation: 'Add a descriptive title tag',
          },
        ],
      },
    ],
    siteWideIssues: [],
  },
  scoreHistory: [],
};

describe('FixRecommendations', () => {
  it('renders metadata recommendation and allows add-to-cart', () => {
    addItemMock.mockReset();

    render(<FixRecommendations auditDetail={auditDetail} tier="growth" />);

    expect(screen.getByText('Recommended Fixes')).toBeInTheDocument();
    expect(screen.getByText('Metadata Optimization')).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: /optimize 1 page/i });
    fireEvent.click(cta);

    expect(addItemMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for invalid empty audit data with no recommendations', () => {
    addItemMock.mockReset();
    const emptyAuditDetail: AuditDetail = {
      ...auditDetail,
      audit: {
        ...auditDetail.audit,
        pages: [],
        siteWideIssues: [],
      },
    };

    const { container } = render(<FixRecommendations auditDetail={emptyAuditDetail} tier="growth" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Recommended Fixes')).not.toBeInTheDocument();
  });
});
