import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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
    await waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('logo-input'));
    });
    await waitFor(() => {
      expect(getByTestId('focus-param').textContent).toBe('none');
    });
  });

  it('scrolls a non-input element into view when matched', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=address']}>
        <Probe />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(getByTestId('address-row').scrollIntoView).toHaveBeenCalled();
    });
    expect(getByTestId('focus-param').textContent).toBe('none');
  });

  it('does nothing when no matching element', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=nothingMatching']}>
        <Probe />
      </MemoryRouter>,
    );
    // Wait long enough for the hook's 50ms timer to have fired
    await new Promise(r => setTimeout(r, 100));
    expect(getByTestId('focus-param').textContent).toBe('nothingMatching');
  });
});
