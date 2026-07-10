import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CannibalizationItem } from '../../../shared/types/workspace';
import { KeeperSelector } from '../../../src/components/strategy/issue/KeeperSelector';

vi.mock('../../../src/hooks/admin/useKeeperOverride', () => ({
  useKeeperOverride: () => ({
    setKeeper: vi.fn(),
    isSettingKeeper: false,
  }),
}));

const duplicateRootPages: CannibalizationItem = {
  keyword: 'rinse dental',
  severity: 'high',
  recommendation: 'Choose one canonical page.',
  canonicalPath: '/',
  pages: [
    { path: '/', position: 1, source: 'gsc' },
    { path: '/', position: 4, source: 'keyword_map' },
    { path: '/about', position: 9, source: 'gsc' },
  ],
};

describe('KeeperSelector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders repeated page paths without duplicate React keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <KeeperSelector
        item={duplicateRootPages}
        workspaceId="ws-engine"
        urlSetKey="|about"
        currentKeeperPath="/"
      />,
    );

    expect(screen.getAllByText('/')).toHaveLength(1);
    expect(consoleError.mock.calls.some(([message]) => (
      String(message).includes('Encountered two children with the same key')
    ))).toBe(false);
  });
});
