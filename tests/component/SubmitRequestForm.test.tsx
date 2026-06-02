/**
 * Item 1 — SubmitRequestForm component test. The form was EXTRACTED from RequestsTab so BOTH the
 * legacy tab AND the unified-inbox chooser mount the SAME form. Asserts:
 *  - the pre-filled category options render (Content Update / Design Change / Bug Report / SEO /
 *    New Feature / Other) in the Category select;
 *  - the quick-template buttons render;
 *  - submitting POSTs the free-form request via the public requests route + reports onSubmitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockPost = vi.fn();
const mockPostForm = vi.fn();
vi.mock('../../src/api/client', () => ({
  post: (...args: unknown[]) => mockPost(...args),
  postForm: (...args: unknown[]) => mockPostForm(...args),
}));

import { SubmitRequestForm } from '../../src/components/client/SubmitRequestForm';

const baseProps = () => ({
  workspaceId: 'ws-1',
  clientUser: { id: 'u1', name: 'Casey Client', email: 'casey@example.com', role: 'client' },
  setToast: vi.fn(),
  onSubmitted: vi.fn(),
  onCancel: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue({ id: 'req-1' });
  mockPostForm.mockResolvedValue({});
});

describe('SubmitRequestForm', () => {
  it('renders the pre-filled category options', () => {
    render(<SubmitRequestForm {...baseProps()} />);
    const select = screen.getByRole('combobox');
    const labels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual([
      'Content Update',
      'Design Change',
      'Bug Report',
      'SEO',
      'New Feature',
      'Other',
    ]);
  });

  it('renders the quick-template buttons', () => {
    render(<SubmitRequestForm {...baseProps()} />);
    for (const t of ['Content Update', 'Bug Report', 'Design Change', 'New Page', 'SEO Update']) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
  });

  it('submits via the public requests route and calls onSubmitted with the created request', async () => {
    const props = baseProps();
    render(<SubmitRequestForm {...props} />);

    fireEvent.change(screen.getByPlaceholderText('Brief summary of your request...'), {
      target: { value: 'Update the hero copy' },
    });
    fireEvent.change(screen.getByPlaceholderText('Describe what you need in detail...'), {
      target: { value: 'Please change the headline on the homepage.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/public/requests/ws-1',
        expect.objectContaining({
          title: 'Update the hero copy',
          description: 'Please change the headline on the homepage.',
          category: 'other',
          submittedBy: 'Casey Client',
        }),
      );
    });
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledWith({ id: 'req-1' }));
  });

  it('does not submit when title or description is empty', () => {
    const props = baseProps();
    render(<SubmitRequestForm {...props} />);
    // Submit button is disabled with empty required fields.
    expect(screen.getByRole('button', { name: /submit request/i })).toBeDisabled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('logged-in client → the "Your Name" field is hidden (submitter inferred from clientUser)', () => {
    render(<SubmitRequestForm {...baseProps()} />);
    expect(screen.queryByPlaceholderText('So we know who to follow up with...')).not.toBeInTheDocument();
  });

  it('no clientUser → the "Your Name" field is shown', () => {
    render(<SubmitRequestForm {...baseProps()} clientUser={null} />);
    expect(screen.getByPlaceholderText('So we know who to follow up with...')).toBeInTheDocument();
  });
});
