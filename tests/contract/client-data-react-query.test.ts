// CONTRACT: client dashboard data must use focused React Query hooks directly.
//
// The retired useClientData facade used to bridge React Query data through a
// large compatibility object with no-op setters. New client dashboard work
// should import focused hooks from src/hooks/client/ and shared data types from
// src/components/client/types.ts instead.
//
// readFile-ok — this test intentionally reads source files for static analysis

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

function readSource(path: string): string {
  return readFileSync(join(SRC, path), 'utf8');
}

describe('client dashboard React Query data contract', () => {
  it('keeps the retired useClientData facade deleted', () => {
    expect(existsSync(join(SRC, 'hooks/useClientData.ts'))).toBe(false);
  });

  it('does not import client data types from the retired facade path', () => {
    const files = [
      'api/seo.ts',
      'components/ClientDashboard.tsx',
      'components/client/ApprovalsTab.tsx',
      'components/client/InboxTab.tsx',
      'hooks/client/useClientQueries.ts',
    ];

    for (const file of files) {
      expect(readSource(file), file).not.toContain('hooks/useClientData');
      expect(readSource(file), file).not.toContain('../useClientData');
      expect(readSource(file), file).not.toContain('../../hooks/useClientData');
    }
  });

  it('composes ClientDashboard from focused client query hooks', () => {
    const dashboard = readSource('components/ClientDashboard.tsx');

    expect(dashboard).toContain("from '../hooks/client/useClientSearch'");
    expect(dashboard).toContain("from '../hooks/client/useClientGA4'");
    expect(dashboard).toContain("from '../hooks/client/useClientQueries'");
    expect(dashboard).not.toContain('useClientData(');
  });
});
