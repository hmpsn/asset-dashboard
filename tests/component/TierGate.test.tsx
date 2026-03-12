import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TierGate, TierBadge } from '../../src/components/ui/TierGate';

describe('TierGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when tier meets required level', () => {
    render(
      <TierGate tier="premium" required="growth" feature="Strategy">
        <p>Premium content</p>
      </TierGate>
    );
    expect(screen.getByText('Premium content')).toBeInTheDocument();
  });

  it('renders children when tier equals required level', () => {
    render(
      <TierGate tier="growth" required="growth" feature="Strategy">
        <p>Growth content</p>
      </TierGate>
    );
    expect(screen.getByText('Growth content')).toBeInTheDocument();
  });

  it('shows overlay when tier is below required', () => {
    render(
      <TierGate tier="free" required="growth" feature="AI Strategy">
        <p>Hidden content</p>
      </TierGate>
    );
    // Feature name shown in overlay
    expect(screen.getByText('AI Strategy')).toBeInTheDocument();
    // Default teaser text
    expect(screen.getByText('Upgrade to Growth to unlock this feature')).toBeInTheDocument();
    // Learn More button
    expect(screen.getByText('Learn More')).toBeInTheDocument();
  });

  it('shows custom teaser text when provided', () => {
    render(
      <TierGate tier="free" required="premium" feature="Reports" teaser="Get detailed analytics">
        <p>Locked</p>
      </TierGate>
    );
    expect(screen.getByText('Get detailed analytics')).toBeInTheDocument();
  });

  it('shows plan badge in overlay', () => {
    render(
      <TierGate tier="free" required="premium" feature="Feature">
        <p>Locked</p>
      </TierGate>
    );
    expect(screen.getByText('Premium Plan')).toBeInTheDocument();
  });

  it('dispatches tier-upgrade custom event on Learn More click', () => {
    const handler = vi.fn();
    window.addEventListener('tier-upgrade', handler as EventListener);

    render(
      <TierGate tier="free" required="growth" feature="Content Briefs">
        <p>Locked</p>
      </TierGate>
    );

    fireEvent.click(screen.getByText('Learn More'));
    expect(handler).toHaveBeenCalledOnce();

    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ required: 'growth', feature: 'Content Briefs' });

    window.removeEventListener('tier-upgrade', handler as EventListener);
  });

  it('renders compact variant with lock icon message', () => {
    render(
      <TierGate tier="free" required="growth" feature="Chat" compact>
        <p>Locked</p>
      </TierGate>
    );
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText(/requires the/)).toBeInTheDocument();
    expect(screen.getByText('Growth')).toBeInTheDocument();
    // No Learn More button in compact mode
    expect(screen.queryByText('Learn More')).toBeNull();
  });

  it('blurs children in non-compact locked mode', () => {
    const { container } = render(
      <TierGate tier="free" required="premium" feature="X">
        <p>Blurred</p>
      </TierGate>
    );
    const blurredDiv = container.querySelector('.blur-\\[6px\\]');
    expect(blurredDiv).not.toBeNull();
  });

  it('free tier does not have access to growth', () => {
    render(
      <TierGate tier="free" required="growth" feature="Feature">
        <p>Content</p>
      </TierGate>
    );
    expect(screen.getByText('Learn More')).toBeInTheDocument();
  });

  it('free tier does not have access to premium', () => {
    render(
      <TierGate tier="free" required="premium" feature="Feature">
        <p>Content</p>
      </TierGate>
    );
    expect(screen.getByText('Premium Plan')).toBeInTheDocument();
  });

  it('growth tier does not have access to premium', () => {
    render(
      <TierGate tier="growth" required="premium" feature="Feature">
        <p>Content</p>
      </TierGate>
    );
    expect(screen.getByText('Premium Plan')).toBeInTheDocument();
  });

  it('premium tier has access to free', () => {
    render(
      <TierGate tier="premium" required="free" feature="Feature">
        <p>Accessible</p>
      </TierGate>
    );
    expect(screen.getByText('Accessible')).toBeInTheDocument();
    expect(screen.queryByText('Learn More')).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(
      <TierGate tier="free" required="growth" feature="X" className="my-gate">
        <p>Locked</p>
      </TierGate>
    );
    expect(container.firstElementChild!.className).toContain('my-gate');
  });
});

describe('TierBadge', () => {
  it('renders Free badge', () => {
    render(<TierBadge tier="free" />);
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('renders Growth badge', () => {
    render(<TierBadge tier="growth" />);
    expect(screen.getByText('Growth')).toBeInTheDocument();
  });

  it('renders Premium badge with sparkle icon', () => {
    const { container } = render(<TierBadge tier="premium" />);
    expect(screen.getByText('Premium')).toBeInTheDocument();
    // Premium has a Sparkles icon (SVG)
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('does not render sparkle icon for non-premium tiers', () => {
    const { container } = render(<TierBadge tier="free" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
