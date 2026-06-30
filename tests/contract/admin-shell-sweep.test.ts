import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { NAV_REGISTRY_BY_ID } from '../../src/lib/navRegistry';
import { isPaletteNavEntryAvailable } from '../../src/components/CommandPalette';

const ROOT = join(__dirname, '../..');

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('admin shell simplification sweep contracts', () => {
  it('keeps workspace-scoped palette nav entries unavailable without a workspace', () => {
    expect(isPaletteNavEntryAvailable(NAV_REGISTRY_BY_ID['seo-audit'], null)).toBe(false);
    expect(isPaletteNavEntryAvailable(NAV_REGISTRY_BY_ID['settings'], null)).toBe(true);
  });

  it('keeps WorkspaceHome site health metrics on the shared StatCard primitive', () => {
    const source = read('src/components/WorkspaceHome.tsx'); // readFile-ok — source contract for admin shell primitive cleanup.
    expect(source).toContain('<StatCard');
    expect(source).toContain('label="Site Health"');
    expect(source).toContain('trailing={<MetricRing');
    expect(source).not.toContain('animationDelay: \'0ms\'');
  });

  it('does not reintroduce the audited raw overlay z-index literals', () => {
    const auditedFiles = [
      'src/components/CommandPalette.tsx',
      'src/components/Toast.tsx',
      'src/components/MobileGuard.tsx',
      'src/components/client/ClientOnboardingQuestionnaire.tsx',
      'src/components/client/OnboardingWizard.tsx',
      'src/components/client/PricingConfirmationModal.tsx',
      'src/components/client/SeoCart.tsx',
    ];

    for (const file of auditedFiles) {
      const source = read(file); // readFile-ok — source contract for z-index token migration.
      expect(source).not.toMatch(/\bz-\[(?:60|61|70|80|100|200|9999)\]/);
      expect(source).not.toContain('z-index-ok');
    }
  });

  it('documents the extended z-index scale in both token files', () => {
    const srcTokens = read('src/tokens.css'); // readFile-ok — token mirror contract.
    const publicTokens = read('public/tokens.css'); // readFile-ok — token mirror contract.
    for (const token of [
      '--z-commerce-backdrop',
      '--z-commerce-drawer',
      '--z-takeover',
      '--z-client-toast',
      '--z-command-palette',
      '--z-system-toast',
      '--z-critical-system',
    ]) {
      expect(srcTokens).toContain(token);
      expect(publicTokens).toContain(token);
    }
  });
});
