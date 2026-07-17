import { expect, test } from '@playwright/experimental-ct-react';
import '../../src/index.css';
import { WorkbenchFrame } from '../../src/components/ui/layout/WorkbenchFrame';

test.use({ viewport: { width: 1440, height: 900 } });

test('bounds its collection when the AppShell-like parent grows with content', async ({ mount }) => {
  const component = await mount(
    <div data-testid="content-sized-main" style={{ display: 'block' }}>
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
      parentClientHeight: parent?.clientHeight ?? 0,
      parentScrollHeight: parent?.scrollHeight ?? 0,
      expectedFrameHeight: window.innerHeight
        - Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shell-topbar'))
        - Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-pad-y'))
        - Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-pad-bottom')),
    };
  });

  expect(measurements.parentClientHeight).toBe(measurements.parentScrollHeight);
  expect(measurements.frameClientHeight).toBe(measurements.expectedFrameHeight);
  expect(measurements.collectionClientHeight).toBeLessThan(measurements.collectionScrollHeight);
});
