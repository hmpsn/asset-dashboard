/**
 * SettingsTab is a pure slot-arrangement surface (no hooks, no data fetching). These tests verify:
 *   - the Brand section + brandSlot ALWAYS render
 *   - the "Plans & billing" section + plansSlot render when plansSlot is provided
 *   - the "Plans & billing" section is ABSENT (header and all) when plansSlot is undefined
 *     (the betaMode / external-billing hide path)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsTab } from '../../../src/components/client/SettingsTab';

describe('SettingsTab', () => {
  it('always renders the Brand section + brandSlot', () => {
    render(<SettingsTab brandSlot={<div data-testid="mock-brand">brand surface</div>} />);

    expect(screen.getByText('Brand')).toBeInTheDocument();
    expect(screen.getByTestId('settings-brand-section')).toBeInTheDocument();
    expect(screen.getByTestId('mock-brand')).toBeInTheDocument();
  });

  it('renders the "Plans & billing" section + plansSlot when plansSlot is provided', () => {
    render(
      <SettingsTab
        brandSlot={<div data-testid="mock-brand">brand surface</div>}
        plansSlot={<div data-testid="mock-plans">plans surface</div>}
      />,
    );

    // Brand still renders alongside Plans.
    expect(screen.getByTestId('mock-brand')).toBeInTheDocument();
    // Plans section + slot present.
    expect(screen.getByText('Plans & billing')).toBeInTheDocument();
    expect(screen.getByTestId('settings-plans-section')).toBeInTheDocument();
    expect(screen.getByTestId('mock-plans')).toBeInTheDocument();
  });

  it('omits the "Plans & billing" section entirely when plansSlot is undefined', () => {
    render(<SettingsTab brandSlot={<div data-testid="mock-brand">brand surface</div>} />);

    // Brand still renders.
    expect(screen.getByTestId('mock-brand')).toBeInTheDocument();
    // No Plans header and no Plans section wrapper.
    expect(screen.queryByText('Plans & billing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-plans-section')).not.toBeInTheDocument();
  });
});
