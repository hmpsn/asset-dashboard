import { expect } from 'vitest';
import { axe } from 'vitest-axe';

export async function expectNoA11yViolations(container: HTMLElement): Promise<void> {
  expect(await axe(container, {
    rules: {
      // jsdom does not implement canvas getContext(), which axe uses for color-contrast.
      // Keep browser-level contrast validation in visual/manual review; enforce every other
      // axe rule in the CI component suite.
      'color-contrast': { enabled: false },
    },
  })).toHaveNoViolations();
}
