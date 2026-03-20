import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileGuard } from '../../src/components/MobileGuard';

describe('MobileGuard', () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    // Clear sessionStorage
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  function setWindowWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
  }

  it('renders children on desktop (>= 768px)', () => {
    setWindowWidth(1024);
    render(
      <MobileGuard>
        <p>Dashboard</p>
      </MobileGuard>
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Best on desktop.')).toBeNull();
  });

  it('shows banner on mobile (< 768px)', () => {
    setWindowWidth(375);
    render(
      <MobileGuard>
        <p>Dashboard</p>
      </MobileGuard>
    );
    expect(screen.getByText('Best on desktop.')).toBeInTheDocument();
    expect(screen.getByLabelText('Dismiss mobile warning')).toBeInTheDocument();
  });

  it('dismisses banner and shows children when dismiss button is clicked', () => {
    setWindowWidth(375);
    render(
      <MobileGuard>
        <p>Dashboard</p>
      </MobileGuard>
    );

    fireEvent.click(screen.getByLabelText('Dismiss mobile warning'));
    expect(screen.queryByText('Best on desktop.')).toBeNull();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('persists dismissal in sessionStorage', () => {
    setWindowWidth(375);
    render(
      <MobileGuard>
        <p>Dashboard</p>
      </MobileGuard>
    );

    fireEvent.click(screen.getByText('Continue anyway'));
    expect(sessionStorage.getItem('mobile_guard_dismissed')).toBe('1');
  });

  it('skips interstitial if already dismissed in sessionStorage', () => {
    setWindowWidth(375);
    sessionStorage.setItem('mobile_guard_dismissed', '1');

    render(
      <MobileGuard>
        <p>Dashboard</p>
      </MobileGuard>
    );

    expect(screen.queryByText('Best on desktop.')).toBeNull();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('shows limited editing tools message in banner', () => {
    setWindowWidth(375);
    render(
      <MobileGuard>
        <p>Content</p>
      </MobileGuard>
    );
    expect(screen.getByText(/Editing tools are limited on mobile/)).toBeInTheDocument();
  });
});
