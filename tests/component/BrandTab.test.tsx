// tests/component/BrandTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrandTab } from '../../src/components/client/BrandTab';

const mockSave = vi.fn().mockResolvedValue(undefined);

const mockBusinessProfile = {
  phone: '+1 (555) 123-4567',
  email: 'hello@example.com',
  address: { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'USA' },
  openingHours: 'Mon-Fri 9am-5pm',
};

function renderBrandTab(overrides?: Partial<React.ComponentProps<typeof BrandTab>>) {
  return render(
    <BrandTab
      businessProfile={mockBusinessProfile}
      brandVoiceSummary="We communicate with clarity and warmth, helping small businesses feel supported."
      onSaveBusinessProfile={mockSave}
      {...overrides}
    />
  );
}

describe('BrandTab', () => {
  beforeEach(() => {
    mockSave.mockClear();
  });

  it('renders business profile contact info in read mode', () => {
    renderBrandTab();
    expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument();
    expect(screen.getByText('hello@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Austin/)).toBeInTheDocument();
  });

  it('renders brand voice summary text in positioning panel', () => {
    renderBrandTab();
    expect(screen.getByText(/communicate with clarity and warmth/)).toBeInTheDocument();
  });

  it('does NOT render full brand voice document (no admin jargon)', () => {
    renderBrandTab();
    expect(screen.queryByText(/calibration score/i)).toBeNull();
    expect(screen.queryByText(/system prompt/i)).toBeNull();
  });

  it('clicking Edit switches to edit mode with input fields', () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByDisplayValue('+1 (555) 123-4567')).toBeInTheDocument();
    expect(screen.getByDisplayValue('hello@example.com')).toBeInTheDocument();
  });

  it('save mutation fires with updated data', async () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 999-0000' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+1 (555) 999-0000' })
      );
    });
  });

  it('cancel restores original values without saving', () => {
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 999-0000' } });
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument();
  });

  it('shows EmptyState when no business profile provided', () => {
    renderBrandTab({ businessProfile: undefined });
    expect(screen.getByText('No business info added yet')).toBeInTheDocument();
  });

  it('shows EmptyState in brand positioning when no summary', () => {
    renderBrandTab({ brandVoiceSummary: undefined });
    expect(screen.getByText('Brand positioning not yet generated')).toBeInTheDocument();
  });

  it('contains no purple color classes (Three Laws compliance)', () => {
    const { container } = renderBrandTab();
    const html = container.innerHTML;
    expect(html).not.toMatch(/purple-/);
  });

  it('shows error message and stays in edit mode when save fails', async () => {
    mockSave.mockRejectedValueOnce(new Error('Network error'));
    renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(screen.getByText('Failed to save. Please try again.')).toBeInTheDocument();
    });
    // Edit mode should remain open — user's changes are preserved
    expect(screen.getByDisplayValue('+1 (555) 123-4567')).toBeInTheDocument();
  });

  it('form re-syncs when businessProfile prop changes while not editing', () => {
    const { rerender } = renderBrandTab();
    // Simulate external update (admin edits via WebSocket → parent re-renders)
    rerender(
      <BrandTab
        businessProfile={{ ...mockBusinessProfile, phone: '+1 (555) 999-9999' }}
        onSaveBusinessProfile={mockSave}
      />
    );
    // Click Edit — form should show the new phone, not the stale mount-time value
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByDisplayValue('+1 (555) 999-9999')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('+1 (555) 123-4567')).toBeNull();
  });

  it('form does NOT re-sync when businessProfile prop changes while editing', () => {
    const { rerender } = renderBrandTab();
    fireEvent.click(screen.getByText('Edit'));
    // User starts typing
    const phoneInput = screen.getByDisplayValue('+1 (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '+1 (555) 777-7777' } });
    // External update arrives — should not clobber user's in-progress edit
    rerender(
      <BrandTab
        businessProfile={{ ...mockBusinessProfile, phone: '+1 (555) 999-9999' }}
        onSaveBusinessProfile={mockSave}
      />
    );
    expect(screen.getByDisplayValue('+1 (555) 777-7777')).toBeInTheDocument();
  });

  it('does not render empty string social profiles as links', () => {
    renderBrandTab({
      businessProfile: { ...mockBusinessProfile, socialProfiles: ['https://twitter.com/test', ''] },
    });
    const links = document.querySelectorAll('a[href=""]');
    expect(links.length).toBe(0);
    // Valid URL still renders
    expect(screen.getByText('https://twitter.com/test')).toBeInTheDocument();
  });
});
