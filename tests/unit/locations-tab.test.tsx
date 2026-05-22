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
