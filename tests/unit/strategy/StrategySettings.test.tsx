import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategySettings } from '../../../src/components/strategy/StrategySettings';

const defaultProps = {
  workspaceId: 'ws1',
  isAuxLoading: false,
  settingsOpen: true,
  setSettingsOpen: vi.fn(),
  seoDataAvailable: true,
  seoDataMode: 'quick' as const,
  setSeoDataMode: vi.fn(),
  maxPages: 200,
  setMaxPages: vi.fn(),
  competitors: '',
  setCompetitors: vi.fn(),
  businessContext: '',
  setBusinessContext: vi.fn(),
  contextOpen: false,
  setContextOpen: vi.fn(),
  discoveringCompetitors: false,
  discoverError: null,
  onDiscoverCompetitors: vi.fn(),
};

describe('StrategySettings', () => {
  it('renders "Strategy Settings" label', () => {
    render(<StrategySettings {...defaultProps} />);
    expect(screen.getByText('Strategy Settings')).toBeInTheDocument();
  });

  it('calls setSettingsOpen when header row is clicked', () => {
    const setSettingsOpen = vi.fn();
    render(<StrategySettings {...defaultProps} setSettingsOpen={setSettingsOpen} />);
    // The ClickableRow header contains the "Strategy Settings" span
    fireEvent.click(screen.getByText('Strategy Settings'));
    expect(setSettingsOpen).toHaveBeenCalledWith(false); // settingsOpen=true → toggles to false
  });

  it('exposes disclosure and pressed state without color-only selection', () => {
    render(<StrategySettings {...defaultProps} />);

    expect(screen.getByRole('button', { name: /Strategy Settings/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: /SEO data mode/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /full/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: /Page analysis limit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /200/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls setMaxPages when a Page Limit option is clicked', () => {
    const setMaxPages = vi.fn();
    render(<StrategySettings {...defaultProps} setMaxPages={setMaxPages} />);
    // Click the "500" page limit button
    fireEvent.click(screen.getByText('500'));
    expect(setMaxPages).toHaveBeenCalledWith(500);
  });

  it('calls onDiscoverCompetitors when Auto-Discover is clicked', () => {
    const onDiscoverCompetitors = vi.fn();
    render(<StrategySettings {...defaultProps} onDiscoverCompetitors={onDiscoverCompetitors} />);
    fireEvent.click(screen.getByText('Auto-Discover'));
    expect(onDiscoverCompetitors).toHaveBeenCalledOnce();
  });

  it('body does not render when settingsOpen=false', () => {
    render(<StrategySettings {...defaultProps} settingsOpen={false} />);
    expect(screen.queryByText('Page Limit')).not.toBeInTheDocument();
  });
});
