import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from '../../src/components/ui/TabBar';

const tabs = [
  { id: 'home', label: 'Home' },
  { id: 'settings', label: 'Settings' },
  { id: 'reports', label: 'Reports' },
];

describe('TabBar', () => {
  it('renders all tab labels', () => {
    render(<TabBar tabs={tabs} active="home" onChange={() => {}} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('applies active styling to the active tab', () => {
    render(<TabBar tabs={tabs} active="settings" onChange={() => {}} />);
    const settingsBtn = screen.getByText('Settings').closest('button')!;
    expect(settingsBtn.className).toContain('border-teal-500');
    expect(settingsBtn.className).toContain('text-teal-200');
  });

  it('applies inactive styling to non-active tabs', () => {
    render(<TabBar tabs={tabs} active="home" onChange={() => {}} />);
    const settingsBtn = screen.getByText('Settings').closest('button')!;
    expect(settingsBtn.className).toContain('border-transparent');
    expect(settingsBtn.className).toContain('text-zinc-400');
  });

  it('calls onChange with tab id on click', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} active="home" onChange={onChange} />);
    fireEvent.click(screen.getByText('Reports'));
    expect(onChange).toHaveBeenCalledWith('reports');
  });

  it('calls onChange for each tab click', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={tabs} active="home" onChange={onChange} />);
    fireEvent.click(screen.getByText('Home'));
    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(screen.getByText('Reports'));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenNthCalledWith(1, 'home');
    expect(onChange).toHaveBeenNthCalledWith(2, 'settings');
    expect(onChange).toHaveBeenNthCalledWith(3, 'reports');
  });

  it('applies custom className', () => {
    const { container } = render(<TabBar tabs={tabs} active="home" onChange={() => {}} className="mt-4" />);
    expect(container.firstElementChild!.className).toContain('mt-4');
  });

  it('renders tab buttons', () => {
    render(<TabBar tabs={tabs} active="home" onChange={() => {}} />);
    const buttons = screen.getAllByRole('tab');
    expect(buttons.length).toBe(3);
  });
});
