import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RenderMarkdown } from '../../../src/components/client/RenderMarkdown';

describe('RenderMarkdown focused module', () => {
  it('preserves ordinary Markdown structure and inline formatting', () => {
    const { container } = render(
      <RenderMarkdown text={[
        '## **Overview**',
        'Useful **context** with `inline code`.',
        '- First item',
        '1. Next step',
        '| Metric | Value |',
        '| --- | --- |',
        '| Clicks | **42** |',
        '```text',
        'const answer = 42;',
        '```',
      ].join('\n')} />,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Overview' })).toBeInTheDocument();
    expect(container.querySelector('b')).toHaveTextContent('context');
    expect(container.querySelector('code')).toHaveTextContent('inline code');
    expect(screen.getByText('First item')).toBeInTheDocument();
    expect(screen.getByText('Next step')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Metric' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '42' })).toBeInTheDocument();
    expect(screen.getByText('const answer = 42;')).toBeInTheDocument();
  });

  it('renders rich fenced blocks from ChatBlocks', () => {
    render(
      <RenderMarkdown text={[
        '```metric',
        '{"label":"Organic clicks","value":1200,"change":12.5,"changeLabel":"vs. prior period"}',
        '```',
      ].join('\n')} />,
    );

    expect(screen.getByText('Organic clicks')).toBeInTheDocument();
    expect(screen.getByText('1.2K')).toBeInTheDocument();
    expect(screen.getByText('vs. prior period')).toBeInTheDocument();
  });

  it('falls back to a code block when rich-block JSON is invalid', () => {
    render(
      <RenderMarkdown text={[
        '```chart',
        '{"title":"Incomplete chart",',
        '```',
      ].join('\n')} />,
    );

    const fallback = screen.getByText('{"title":"Incomplete chart",');
    expect(fallback.tagName).toBe('CODE');
    expect(fallback.closest('pre')).toBeInTheDocument();
  });
});
