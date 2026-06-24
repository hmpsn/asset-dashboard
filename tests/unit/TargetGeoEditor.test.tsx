import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';
import { TargetGeoEditor } from '../../src/components/settings/TargetGeoEditor';
import { patch } from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  patch: vi.fn().mockResolvedValue({}),
}));

const mockPatch = vi.mocked(patch);

const baseProps = {
  workspaceId: 'ws-geo-1',
  toast: vi.fn(),
  onSave: vi.fn(),
};

function renderInRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('TargetGeoEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the country + language selects and the national-vs-local copy', () => {
    renderInRouter(<TargetGeoEditor {...baseProps} targetGeo={null} />);

    expect(screen.getByLabelText(/country/i)).toBeTruthy();
    expect(screen.getByLabelText(/language/i)).toBeTruthy();
    // Distinguishes the national SERP target from the local Primary market.
    expect(screen.getByText(/national \/ international SERP/i)).toBeTruthy();
    expect(screen.getAllByText(/Primary market/i).length).toBeGreaterThan(0);
  });

  it('shows the current target and preselects the country when targetGeo is set', () => {
    renderInRouter(
      <TargetGeoEditor
        {...baseProps}
        targetGeo={{ locationCode: 2826, languageCode: 'en', countryCode: 'GB', label: 'United Kingdom · English' }}
      />,
    );

    expect(screen.getByText(/Currently targeting/i)).toBeTruthy();
    expect(screen.getByText(/United Kingdom · English/i)).toBeTruthy();
    expect(screen.getByLabelText(/country/i)).toHaveValue('GB');
    expect(screen.getByLabelText(/language/i)).toHaveValue('en');
  });

  it('PATCHes the resolved locationCode + languageCode when a country is chosen and saved', async () => {
    renderInRouter(<TargetGeoEditor {...baseProps} targetGeo={null} />);

    // Germany → location_code 2276, primary language de.
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'DE' } });
    fireEvent.click(screen.getByRole('button', { name: /save target geo/i }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        '/api/workspaces/ws-geo-1',
        { targetGeo: expect.objectContaining({ locationCode: 2276, languageCode: 'de', countryCode: 'DE' }) },
      );
    });
    // Success contract: parent refetch (onSave) + success toast must both fire.
    expect(baseProps.onSave).toHaveBeenCalledTimes(1);
    expect(baseProps.toast).toHaveBeenCalledWith(expect.stringMatching(/saved/i));
  });

  it('clears the target geo (PATCH targetGeo: null) when Clear is clicked', async () => {
    renderInRouter(
      <TargetGeoEditor
        {...baseProps}
        targetGeo={{ locationCode: 2840, languageCode: 'en', countryCode: 'US' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/api/workspaces/ws-geo-1', { targetGeo: null });
    });
    expect(baseProps.onSave).toHaveBeenCalledTimes(1);
    expect(baseProps.toast).toHaveBeenCalledWith(expect.stringMatching(/cleared/i));
  });

  it('falls back to the country primary language when the persisted language is out-of-list', () => {
    // Out-of-band PATCH could persist France (2250) + 'en', which France does not
    // support. The Language select must show France's primary (fr), not blank.
    renderInRouter(
      <TargetGeoEditor
        {...baseProps}
        targetGeo={{ locationCode: 2250, languageCode: 'en', countryCode: 'FR' }}
      />,
    );

    expect(screen.getByLabelText(/country/i)).toHaveValue('FR');
    expect(screen.getByLabelText(/language/i)).toHaveValue('fr');
  });
});
