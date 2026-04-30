import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { useDeepLinkFocus } from '../../src/hooks/useDeepLinkFocus';

function Probe() {
  useDeepLinkFocus();
  const [sp] = useSearchParams();
  return (
    <>
      <input data-schema-deeplink="brandLogoUrl" data-testid="logo-input" />
      <div data-schema-deeplink="address" data-testid="address-row" />
      <span data-testid="focus-param">{sp.get('focus') ?? 'none'}</span>
    </>
  );
}

describe('useDeepLinkFocus', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('focuses an input matching ?focus=<fieldId> and clears the param', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=brandLogoUrl']}>
        <Probe />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(document.activeElement).toBe(getByTestId('logo-input'));
    expect(getByTestId('focus-param').textContent).toBe('none');
  });

  it('scrolls a non-input element into view when matched', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=address']}>
        <Probe />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(getByTestId('address-row').scrollIntoView).toHaveBeenCalled();
    expect(getByTestId('focus-param').textContent).toBe('none');
  });

  it('does nothing when no matching element', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=nothingMatching']}>
        <Probe />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(getByTestId('focus-param').textContent).toBe('nothingMatching');
  });
});
