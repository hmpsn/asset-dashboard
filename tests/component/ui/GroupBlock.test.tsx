import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GroupBlock } from '../../../src/components/ui/layout/GroupBlock';
import { expectNoA11yViolations } from '../a11y';

afterEach(() => {
  cleanup();
});

describe('GroupBlock', () => {
  it('renders the title at the default heading level (h3)', () => {
    render(<GroupBlock title="Keyword Cluster">Body</GroupBlock>);
    const heading = screen.getByRole('heading', { level: 3, name: 'Keyword Cluster' });
    expect(heading).toBeInTheDocument();
  });

  it('renders the title at a custom heading level', () => {
    render(
      <GroupBlock title="Brand Personas" headingLevel="h2">
        Body
      </GroupBlock>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Brand Personas' })).toBeInTheDocument();
  });

  it('renders body children by default (defaultOpen)', () => {
    render(<GroupBlock title="Group">Row content</GroupBlock>);
    expect(screen.getByText('Row content')).toBeInTheDocument();
  });

  it('toggles body visibility and aria-expanded when collapsible', () => {
    render(
      <GroupBlock title="Group" collapsible>
        Row content
      </GroupBlock>,
    );
    const toggle = screen.getByRole('button', { name: /Group/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Row content')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Row content')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Row content')).toBeInTheDocument();
  });

  it('respects defaultOpen={false} for a collapsible block', () => {
    render(
      <GroupBlock title="Group" collapsible defaultOpen={false}>
        Row content
      </GroupBlock>,
    );
    expect(screen.getByRole('button', { name: /Group/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Row content')).not.toBeInTheDocument();
  });

  it('renders header stats', () => {
    render(
      <GroupBlock title="Group" stats={[{ label: 'Keywords', value: 42 }]}>
        Body
      </GroupBlock>,
    );
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Keywords')).toBeInTheDocument();
  });

  it('renders a flag', () => {
    render(
      <GroupBlock title="Group" flag={{ label: 'Needs review' }}>
        Body
      </GroupBlock>,
    );
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<GroupBlock title="Keyword Cluster">Body</GroupBlock>);
    await expectNoA11yViolations(container);
  }, 15_000);
});
