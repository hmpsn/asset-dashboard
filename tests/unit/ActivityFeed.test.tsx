import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActivityFeed } from '../../src/components/workspace-home/ActivityFeed';

const baseEntry = {
  id: 'a1',
  type: 'brief_generated',
  title: 'Brief generated',
  description: undefined,
  createdAt: new Date().toISOString(),
};

describe('ActivityFeed chat badge', () => {
  it('renders a chat badge for entries with metadata.source = "mcp-chat"', () => {
    render(<ActivityFeed activity={[{ ...baseEntry, metadata: { source: 'mcp-chat' } }]} />);
    expect(screen.getByText('chat')).toBeInTheDocument();
  });

  it('does NOT render a chat badge for entries without that metadata source', () => {
    render(<ActivityFeed activity={[{ ...baseEntry, metadata: { source: 'local_seo' } }]} />);
    expect(screen.queryByText('chat')).not.toBeInTheDocument();
  });

  it('does NOT render a chat badge for entries with no metadata at all', () => {
    render(<ActivityFeed activity={[baseEntry]} />);
    expect(screen.queryByText('chat')).not.toBeInTheDocument();
  });

  it('renders multiple chat badges when multiple chat-sourced entries are present', () => {
    render(
      <ActivityFeed
        activity={[
          { ...baseEntry, id: 'a1', metadata: { source: 'mcp-chat' } },
          { ...baseEntry, id: 'a2', metadata: { source: 'admin' } },
          { ...baseEntry, id: 'a3', metadata: { source: 'mcp-chat' } },
        ]}
      />,
    );
    expect(screen.getAllByText('chat')).toHaveLength(2);
  });
});
