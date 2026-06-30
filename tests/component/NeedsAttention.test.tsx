import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AlertCircle, Info, AlertTriangle } from 'lucide-react';
import type { AttentionItem } from '../../src/components/ui/NeedsAttention';
import { NeedsAttention } from '../../src/components/ui/NeedsAttention';

const criticalItem: AttentionItem = {
  id: 'c1',
  label: 'Critical issue here',
  severity: 'critical',
  icon: AlertCircle,
  onClick: vi.fn(),
};

const warningItem: AttentionItem = {
  id: 'w1',
  label: 'Warning issue here',
  severity: 'warning',
  icon: AlertTriangle,
  onClick: vi.fn(),
};

const infoItem: AttentionItem = {
  id: 'i1',
  label: 'Info item here',
  severity: 'info',
  icon: Info,
  onClick: vi.fn(),
};

describe('NeedsAttention', () => {
  it('showCount → title text matches /Needs Attention · 2/', () => {
    render(
      <NeedsAttention
        items={[criticalItem, warningItem]}
        showCount
      />,
    );
    expect(screen.getByText(/Needs Attention · 2/)).toBeTruthy();
  });

  it('a critical item → container has [data-attention-accent="critical"]', () => {
    const { container } = render(
      <NeedsAttention items={[criticalItem, infoItem]} />,
    );
    const el = container.querySelector('[data-attention-accent="critical"]');
    expect(el).not.toBeNull();
  });

  it('cap=5 with 9 items → a button matching /show .*more/i exists', async () => {
    const manyItems: AttentionItem[] = Array.from({ length: 9 }, (_, i) => ({
      id: `item-${i}`,
      label: `Item ${i}`,
      severity: 'info' as const,
      onClick: vi.fn(),
    }));

    render(<NeedsAttention items={manyItems} cap={5} />);
    const btn = screen.getByRole('button', { name: /show .*more/i });
    expect(btn).toBeTruthy();
  });

  it('rows are clickable controls → getAllByRole("button").length >= items shown', () => {
    render(
      <NeedsAttention items={[criticalItem, warningItem, infoItem]} />,
    );
    const buttons = screen.getAllByRole('button');
    // At minimum one button per visible item row (ClickableRow renders as button)
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('href items render as real client-side links (no window.location reload)', () => {
    const item: AttentionItem = {
      id: 'h1',
      label: 'Go to churn',
      severity: 'critical',
      href: '/ws/123/inbox',
    };
    render(
      <MemoryRouter>
        <NeedsAttention items={[item]} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /go to churn/i });
    expect(link).toHaveAttribute('href', '/ws/123/inbox');
  });
});
