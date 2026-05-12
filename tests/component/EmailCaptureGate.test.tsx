import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailCaptureGate } from '../../src/components/client/EmailCaptureGate';
import { post } from '../../src/api/client';
import type { WorkspaceInfo } from '../../src/components/client/types';

vi.mock('../../src/api/client', () => ({
  post: vi.fn(),
}));

const mockPost = vi.mocked(post);

const workspace: WorkspaceInfo = {
  id: 'ws-1',
  name: 'Acme Studio',
};

describe('EmailCaptureGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('keeps submit disabled until Zod validates the email field', async () => {
    const user = userEvent.setup();
    render(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={workspace}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    const submit = screen.getByRole('button', { name: 'Continue to Dashboard' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/Email address/), 'not-an-email');
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email address/)).toHaveAttribute('aria-invalid', 'true');
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText(/Email address/));
    await user.type(screen.getByLabelText(/Email address/), 'client@example.com');
    expect(await screen.findByText('Email looks good')).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('submits trimmed values and stores the captured portal email', async () => {
    mockPost.mockResolvedValueOnce({});
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(
      <EmailCaptureGate
        workspaceId="ws-1"
        ws={workspace}
        onComplete={onComplete}
        onSkip={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('Your name'), '  Avery Client  ');
    await user.type(screen.getByLabelText(/Email address/), '  client@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Continue to Dashboard' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/public/capture-email/ws-1', {
        email: 'client@example.com',
        name: 'Avery Client',
      });
    });
    expect(localStorage.getItem('portal_email_ws-1')).toBe('client@example.com');
    expect(onComplete).toHaveBeenCalled();
  });
});
