import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';
import { LocationsTab } from '../../src/components/settings/LocationsTab';
import {
  useCreateLocation,
  useDeleteLocation,
  useLocalSeoLocations,
  useUpdateLocation,
} from '../../src/hooks/admin/useLocalSeoLocations';

vi.mock('../../src/hooks/admin/useLocalSeoLocations', () => ({
  useLocalSeoLocations: vi.fn(),
  useCreateLocation: vi.fn(),
  useUpdateLocation: vi.fn(),
  useDeleteLocation: vi.fn(),
}));

const mockUseLocalSeoLocations = vi.mocked(useLocalSeoLocations);
const mockUseCreateLocation = vi.mocked(useCreateLocation);
const mockUseUpdateLocation = vi.mocked(useUpdateLocation);
const mockUseDeleteLocation = vi.mocked(useDeleteLocation);

const noopMutation = {
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  isSuccess: false,
  reset: vi.fn(),
};

const defaultProps = {
  workspaceId: 'ws-1',
  workspaceName: 'Acme Corp',
  liveDomain: 'acme.com',
  businessProfile: {
    phone: '+1 512 555 0101',
    address: { street: '123 Main St', city: 'Austin', state: 'TX', country: 'US' },
  },
  toast: vi.fn(),
};

function renderInRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('LocationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCreateLocation.mockReturnValue(noopMutation as unknown as ReturnType<typeof useCreateLocation>);
    mockUseUpdateLocation.mockReturnValue(noopMutation as unknown as ReturnType<typeof useUpdateLocation>);
    mockUseDeleteLocation.mockReturnValue(noopMutation as unknown as ReturnType<typeof useDeleteLocation>);
  });

  it('shows loading skeletons while fetching', () => {
    mockUseLocalSeoLocations.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    const { container } = renderInRouter(<LocationsTab {...defaultProps} />);

    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows auto-seed banner when list is empty and workspace data is present', () => {
    mockUseLocalSeoLocations.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);

    expect(screen.getByRole('alert', { name: /confirm your primary location/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit before confirming/i })).toBeTruthy();
  });

  it('calls createLocation with confirmed status when seed Confirm is clicked', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseCreateLocation.mockReturnValue({ ...noopMutation, mutateAsync } as unknown as ReturnType<typeof useCreateLocation>);
    mockUseLocalSeoLocations.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'confirmed', isPrimary: true, name: 'Acme Corp' }),
      );
    });
  });

  it('prefills the add form from workspace data when editing the seed location', () => {
    mockUseLocalSeoLocations.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit before confirming/i }));

    expect(screen.getByLabelText(/location name/i)).toHaveValue('Acme Corp');
    expect(screen.getByLabelText(/domain/i)).toHaveValue('acme.com');
    expect(screen.getByLabelText(/phone/i)).toHaveValue('+1 512 555 0101');
    expect(screen.getByLabelText(/street address/i)).toHaveValue('123 Main St');
  });

  it('renders needs_review location row with Confirm and Edit actions', () => {
    mockUseLocalSeoLocations.mockReturnValue({
      data: [
        {
          id: 'loc-1',
          workspaceId: 'ws-1',
          name: 'Austin HQ',
          domain: 'austin.acme.com',
          isPrimary: true,
          status: 'needs_review',
          createdAt: '2026-05-22T00:00:00Z',
          updatedAt: '2026-05-22T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);

    expect(screen.getByText('Austin HQ')).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm location Austin HQ/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit location Austin HQ/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove location Austin HQ/i })).toBeTruthy();
  });

  it('sends empty strings when optional fields are cleared while editing', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseUpdateLocation.mockReturnValue({ ...noopMutation, mutateAsync } as unknown as ReturnType<typeof useUpdateLocation>);
    mockUseLocalSeoLocations.mockReturnValue({
      data: [
        {
          id: 'loc-clear',
          workspaceId: 'ws-1',
          name: 'Austin HQ',
          domain: 'austin.acme.com',
          phone: '+1 512 555 0101',
          streetAddress: '123 Main St',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          isPrimary: true,
          status: 'confirmed',
          createdAt: '2026-05-22T00:00:00Z',
          updatedAt: '2026-05-22T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit location Austin HQ/i }));
    fireEvent.change(screen.getByLabelText(/domain/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        locationId: 'loc-clear',
        body: expect.objectContaining({ domain: '' }),
      });
    });
  });

  it('shows a toast when confirming a location fails', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('nope'));
    mockUseUpdateLocation.mockReturnValue({ ...noopMutation, mutateAsync } as unknown as ReturnType<typeof useUpdateLocation>);
    mockUseLocalSeoLocations.mockReturnValue({
      data: [
        {
          id: 'loc-fail',
          workspaceId: 'ws-1',
          name: 'Austin HQ',
          isPrimary: true,
          status: 'needs_review',
          createdAt: '2026-05-22T00:00:00Z',
          updatedAt: '2026-05-22T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm location Austin HQ/i }));

    await waitFor(() => {
      expect(defaultProps.toast).toHaveBeenCalledWith('Failed to confirm location', 'error');
    });
  });

  it('renders confirmed location row without Confirm action', () => {
    mockUseLocalSeoLocations.mockReturnValue({
      data: [
        {
          id: 'loc-2',
          workspaceId: 'ws-1',
          name: 'Dallas Branch',
          isPrimary: false,
          status: 'confirmed',
          createdAt: '2026-05-22T00:00:00Z',
          updatedAt: '2026-05-22T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);

    expect(screen.getByText('Dallas Branch')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /confirm location/i })).toBeNull();
    expect(screen.getByRole('button', { name: /edit location Dallas Branch/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove location Dallas Branch/i })).toBeTruthy();
  });

  it('shows add another location button when locations exist and form is closed', () => {
    mockUseLocalSeoLocations.mockReturnValue({
      data: [
        {
          id: 'loc-3',
          workspaceId: 'ws-1',
          name: 'San Antonio',
          isPrimary: false,
          status: 'confirmed',
          createdAt: '2026-05-22T00:00:00Z',
          updatedAt: '2026-05-22T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);

    expect(screen.getByRole('button', { name: /add another location/i })).toBeTruthy();
  });

  it('shows error state on fetch error', () => {
    mockUseLocalSeoLocations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useLocalSeoLocations>);

    renderInRouter(<LocationsTab {...defaultProps} />);

    expect(screen.getByText(/failed to load locations/i)).toBeTruthy();
  });
});
