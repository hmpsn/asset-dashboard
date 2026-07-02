import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Menu, type MenuItem } from '../../src/components/ui/Menu';

function renderMenu(items?: MenuItem[]) {
  const onAlpha = vi.fn();
  const onBeta = vi.fn();
  const list: MenuItem[] = items ?? [
    { label: 'Alpha', onSelect: onAlpha },
    { label: 'Beta', onSelect: onBeta },
  ];
  render(<Menu trigger={<button>Open</button>} items={list} />);
  return { onAlpha, onBeta, trigger: screen.getByText('Open') };
}

describe('Menu (Popover-backed)', () => {
  it('opens on trigger click and renders items as a menu', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Open'));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /alpha/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /beta/i })).toBeInTheDocument();
  });

  it('exposes aria-haspopup + aria-expanded on the (cloned) trigger', async () => {
    const { trigger } = renderMenu();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    await screen.findByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('panel is at the --z-dropdown layer', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Open'));
    const menu = await screen.findByRole('menu');
    expect(menu.style.zIndex).toContain('--z-dropdown');
  });

  it('selecting an item calls onSelect and closes', async () => {
    const { onAlpha } = renderMenu();
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /alpha/i }));
    expect(onAlpha).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Open'));
    await screen.findByRole('menu');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes on outside mousedown', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Open'));
    await screen.findByRole('menu');
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('focuses the first item on open and ArrowDown moves to the next', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Open'));
    const alpha = await screen.findByRole('menuitem', { name: /alpha/i });
    await waitFor(() => expect(alpha).toHaveFocus());
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /beta/i })).toHaveFocus();
  });

  it('renders trailing content for dual-action rows', async () => {
    renderMenu([{ label: 'Export', onSelect: vi.fn(), trailing: <span>CSV</span> }]);
    fireEvent.click(screen.getByText('Open'));
    await screen.findByRole('menu');
    expect(screen.getByText('CSV')).toBeInTheDocument();
  });
});
