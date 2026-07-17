import { expect, test } from '@playwright/experimental-ct-react';
import '../../src/index.css';
import { WorkbenchFrame } from '../../src/components/ui/layout/WorkbenchFrame';

test.use({ viewport: { width: 1440, height: 900 } });

test('bounds its collection when the AppShell-like parent grows with content', async ({ mount }) => {
  const component = await mount(
    <div
      data-testid="content-sized-main"
      style={{
        display: 'block',
        // The @imported :root tokens don't reliably reach the playwright-ct mount iframe,
        // so define them here (matching src/tokens.css) — the WorkbenchFrame's
        // calc(100vh - --shell-topbar - --page-pad-y - --page-pad-bottom) needs them
        // to resolve, exactly as it does against :root in the real app.
        ['--shell-topbar' as string]: '56px',
        ['--page-pad-y' as string]: '24px',
        ['--page-pad-bottom' as string]: '90px',
      }}
    >
      <div style={{ display: 'block' }}>
        <WorkbenchFrame pinned={<div style={{ height: 96 }}>Pinned decisions</div>} collectionLabel="Long collection">
          <div>
            {Array.from({ length: 120 }, (_, index) => (
              <div key={index} style={{ height: 48 }}>
                Collection row {index + 1}
              </div>
            ))}
          </div>
        </WorkbenchFrame>
      </div>
    </div>,
  );

  const measurements = await component.locator('[data-workbench-collection]').evaluate((collection) => {
    const frame = collection.closest('[data-testid="workbench-frame"]');
    const parent = frame?.parentElement;

    return {
      collectionClientHeight: collection.clientHeight,
      collectionScrollHeight: collection.scrollHeight,
      frameClientHeight: frame?.clientHeight ?? 0,
      viewportHeight: window.innerHeight,
      parentClientHeight: parent?.clientHeight ?? 0,
      parentScrollHeight: parent?.scrollHeight ?? 0,
    };
  });

  expect(measurements.parentClientHeight).toBe(measurements.parentScrollHeight);
  // The frame is viewport-bounded, independent of the CT harness resolving the exact
  // --shell-* tokens (an exact-height .toBe was brittle: tokens may be absent in the
  // mount context, making expectedFrameHeight NaN). The load-bearing proof is that the
  // frame is far smaller than its collection's content, so the collection scrolls.
  expect(measurements.frameClientHeight).toBeGreaterThan(0);
  expect(measurements.frameClientHeight).toBeLessThanOrEqual(measurements.viewportHeight);
  expect(measurements.frameClientHeight).toBeLessThan(measurements.collectionScrollHeight);
  expect(measurements.collectionClientHeight).toBeLessThan(measurements.collectionScrollHeight);
});
