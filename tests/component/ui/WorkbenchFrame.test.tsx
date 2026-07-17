// @ds-rebuilt
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchFrame } from '../../../src/components/ui/layout/WorkbenchFrame';
import { expectNoA11yViolations } from '../a11y';

afterEach(() => {
  cleanup();
});

describe('WorkbenchFrame', () => {
  it('bounds the page and gives exactly one region collection overflow', () => {
    const { container } = render(
      <WorkbenchFrame pinned={<div>Decision controls</div>} collectionLabel="Audit issues">
        <div>Issue collection</div>
      </WorkbenchFrame>,
    );

    const frame = screen.getByTestId('workbench-frame');
    expect(frame).toHaveClass('flex', 'min-h-0', 'flex-col', 'overflow-hidden');
    expect(frame).toHaveStyle({
      height: 'calc(100vh - var(--shell-topbar) - var(--page-pad-y) - var(--page-pad-bottom))',
    });

    const pinned = screen.getByTestId('workbench-pinned');
    expect(pinned).toHaveClass('flex-none');

    const collections = container.querySelectorAll('[data-workbench-collection]');
    expect(collections).toHaveLength(1);
    expect(collections[0]).toHaveClass('min-h-0', 'flex-1', 'overflow-auto');
    expect(screen.getByRole('region', { name: 'Audit issues' })).toBe(collections[0]);
  });

  it('meets the rebuilt accessibility floor', async () => {
    const { container } = render(
      <WorkbenchFrame pinned={<div>Decision controls</div>} collectionLabel="Audit issues">
        <div>Issue collection</div>
      </WorkbenchFrame>,
    );

    await expectNoA11yViolations(container);
  });
});
