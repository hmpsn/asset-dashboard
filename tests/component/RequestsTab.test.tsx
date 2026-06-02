/**
 * Item 1 — RequestsTab byte-identical guard. The "Submit a Request" form was extracted to
 * SubmitRequestForm; RequestsTab now mounts that component. This test proves the legacy tab still
 * renders the SAME form (same SectionCard title, same pre-filled category options, same quick
 * templates) when "New Request" is clicked — the extraction is additive, not a behavior change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../src/api/client', () => ({
  post: vi.fn().mockResolvedValue({ id: 'req-1' }),
  postForm: vi.fn().mockResolvedValue({}),
}));

import { RequestsTab } from '../../src/components/client/RequestsTab';

const baseProps = () => ({
  workspaceId: 'ws-1',
  requests: [],
  requestsLoading: false,
  clientUser: { id: 'u1', name: 'Casey', email: 'casey@example.com', role: 'client' },
  loadRequests: vi.fn(),
  setToast: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

describe('RequestsTab — SubmitRequestForm extraction (byte-identical guard)', () => {
  it('the form is hidden until "New Request" is clicked, then renders the extracted SubmitRequestForm', () => {
    render(<RequestsTab {...baseProps()} />);
    // Collapsed initially.
    expect(screen.queryByText('Submit a Request')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new request/i }));
    // The extracted SectionCard form renders with the SAME title.
    expect(screen.getByText('Submit a Request')).toBeInTheDocument();
  });

  it('renders the SAME pre-filled category options as before the extraction', () => {
    render(<RequestsTab {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /new request/i }));

    const select = screen.getByRole('combobox');
    const labels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Content Update', 'Design Change', 'Bug Report', 'SEO', 'New Feature', 'Other']);
  });

  it('renders the quick-template buttons', () => {
    render(<RequestsTab {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /new request/i }));
    for (const t of ['Content Update', 'Bug Report', 'Design Change', 'New Page', 'SEO Update']) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
  });

  it('Cancel collapses the form again', () => {
    render(<RequestsTab {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /new request/i }));
    expect(screen.getByText('Submit a Request')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Submit a Request')).not.toBeInTheDocument();
  });
});
