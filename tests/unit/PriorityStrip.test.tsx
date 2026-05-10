// tests/unit/PriorityStrip.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityStrip } from '../../src/components/client/PriorityStrip';
import { Inbox } from 'lucide-react';

describe('PriorityStrip', () => {
  it('renders null when items is empty', () => {
    const { container } = render(<PriorityStrip items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each item title', () => {
    render(
      <PriorityStrip
        items={[
          {
            id: 'a1',
            icon: Inbox,
            title: 'Review schema plan',
            section: 'reviews',
            ctaLabel: 'Review →',
            onCta: vi.fn(),
          },
        ]}
      />,
    );
    expect(screen.getByText('Review schema plan')).toBeInTheDocument();
    expect(screen.getByText('Review →')).toBeInTheDocument();
    expect(screen.getByText('Reviews')).toBeInTheDocument();
  });

  it('shows all caught up state when items empty and showAllCaughtUp=true', () => {
    render(<PriorityStrip items={[]} showAllCaughtUp />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('calls onCta when CTA button clicked', async () => {
    const onCta = vi.fn();
    const { getByRole } = render(
      <PriorityStrip
        items={[{ id: 'x', icon: Inbox, title: 'Test', section: 'decisions', ctaLabel: 'Act', onCta }]}
      />,
    );
    getByRole('button', { name: 'Act Test' }).click();
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('applies section-specific icon color class', () => {
    const { container } = render(
      <PriorityStrip
        items={[
          { id: 'a', icon: Inbox, title: 'Review item', section: 'reviews', ctaLabel: 'Go', onCta: vi.fn() },
          { id: 'b', icon: Inbox, title: 'Conversation item', section: 'conversations', ctaLabel: 'Go', onCta: vi.fn() },
          { id: 'c', icon: Inbox, title: 'Decision item', section: 'decisions', ctaLabel: 'Go', onCta: vi.fn() },
        ]}
      />,
    );
    // Each li has exactly one svg descendant; check for section color classes on the icon wrapper
    const icons = container.querySelectorAll('li svg');
    expect(icons).toHaveLength(3);
    // Spot-check that icon color classes differ per section by checking wrapper spans
    const iconWrappers = container.querySelectorAll('li [class*="text-accent"]');
    const classes = Array.from(iconWrappers).map(el => el.className);
    expect(classes.some(c => c.includes('text-accent-brand'))).toBe(true);   // reviews
    expect(classes.some(c => c.includes('text-accent-info'))).toBe(true);    // conversations
    expect(classes.some(c => c.includes('text-accent-warning'))).toBe(true); // decisions
  });
});
