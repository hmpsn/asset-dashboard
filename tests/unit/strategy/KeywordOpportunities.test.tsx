import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeywordOpportunities } from '../../../src/components/strategy/KeywordOpportunities';

const opportunities = ['Target long-tail blog keywords', 'Optimize for featured snippets', 'Build local landing pages'];

describe('KeywordOpportunities', () => {
  it('renders the heading and each opportunity string', () => {
    render(<KeywordOpportunities opportunities={opportunities} />);
    expect(screen.getByText('Keyword Opportunities')).toBeInTheDocument();
    expect(screen.getByText('Target long-tail blog keywords')).toBeInTheDocument();
    expect(screen.getByText('Optimize for featured snippets')).toBeInTheDocument();
    expect(screen.getByText('Build local landing pages')).toBeInTheDocument();
  });

  it('renders nothing when opportunities is empty', () => {
    const { container } = render(<KeywordOpportunities opportunities={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders NO "Explore in Hub" affordance without workspaceId/navigate (legacy parity)', () => {
    render(<KeywordOpportunities opportunities={opportunities} />);
    expect(screen.queryByTitle('Explore in Hub')).not.toBeInTheDocument();
  });

  it('renders a per-row "Explore in Hub" deep-link when workspaceId + navigate are provided', () => {
    const navigate = vi.fn();
    render(<KeywordOpportunities opportunities={opportunities} workspaceId="ws1" navigate={navigate} />);
    const buttons = screen.getAllByTitle('Explore in Hub');
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('seo-keywords'));
  });
});
