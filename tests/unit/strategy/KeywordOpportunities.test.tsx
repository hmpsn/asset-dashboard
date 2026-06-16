import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeywordOpportunities } from '../../../src/components/strategy/KeywordOpportunities';

describe('KeywordOpportunities', () => {
  it('renders the heading and each opportunity string', () => {
    const opportunities = ['Target long-tail blog keywords', 'Optimize for featured snippets', 'Build local landing pages'];
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
});
