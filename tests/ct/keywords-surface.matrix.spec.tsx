import { test, expect } from '@playwright/experimental-ct-react';
import {
  KeywordsSurfaceVisualFixture,
  type KeywordsSurfaceVisualState,
  type KeywordsSurfaceVisualTheme,
} from './keywords-surface.story';

const visualStates: KeywordsSurfaceVisualState[] = ['populated', 'empty', 'loading', 'error', 'locked'];
const themes: KeywordsSurfaceVisualTheme[] = ['dark', 'light'];

for (const visualState of visualStates) {
  for (const theme of themes) {
    test(`Keywords ${visualState} ${theme}`, async ({ mount }) => {
      const component = await mount(<KeywordsSurfaceVisualFixture state={visualState} theme={theme} />);
      await expect(component).toHaveScreenshot(`keywords-${visualState}-${theme}.png`, {
        animations: 'disabled',
      });
    });
  }
}
