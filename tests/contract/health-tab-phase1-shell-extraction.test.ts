import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const HEALTH_TAB_PATH = 'src/components/client/HealthTab.tsx';
const HEALTH_TAB_SHELL_PATH = 'src/components/client/health-tab/useHealthTabShell.ts';
const HEALTH_TAB_SECTIONS_PATH = 'src/components/client/health-tab/HealthTabSections.tsx';

describe('HealthTab phase-1 shell extraction contract', () => {
  it('wires HealthTab root to extracted shell hook and section components', () => {
    const source = readFileSync(HEALTH_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: HealthTab root must compose from extracted shell + sections.

    expect(source).toContain("from './health-tab/useHealthTabShell'");
    expect(source).toContain("from './health-tab/HealthTabSections'");
    expect(source).toContain('const shell = useHealthTabShell({');
    expect(source).toContain('<HealthHeaderSection');
    expect(source).toContain('<HealthScoreSummarySection');
    expect(source).toContain('<HealthAllPagesSection');
    expect(source).toContain('<HealthHistorySection');
  });

  it('keeps shell orchestration out of HealthTab root', () => {
    const source = readFileSync(HEALTH_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: state/effects should remain in extracted shell hook.

    expect(source).not.toContain('const [expandedSections, setExpandedSections]');
    expect(source).not.toContain('const [shareOpen, setShareOpen]');
    expect(source).not.toContain('document.addEventListener(');
    expect(source).not.toContain('getSafe<Array<');
    expect(source).not.toContain('const filteredPages =');
  });

  it('keeps shell state/effects in extracted hook module and rendering sections in section module', () => {
    const shellSource = readFileSync(HEALTH_TAB_SHELL_PATH, 'utf-8'); // readFile-ok - migration guard: shell module should own state/effects and derived data.
    const sectionsSource = readFileSync(HEALTH_TAB_SECTIONS_PATH, 'utf-8'); // readFile-ok - migration guard: section module should own detailed audit-detail rendering blocks.

    expect(shellSource).toContain('export function useHealthTabShell');
    expect(shellSource).toContain('const [expandedSections, setExpandedSections]');
    expect(shellSource).toContain('const [shareOpen, setShareOpen]');
    expect(shellSource).toContain("document.addEventListener('mousedown'");
    expect(shellSource).toContain('const filteredPages = useMemo(');

    expect(sectionsSource).toContain('export function HealthHeaderSection');
    expect(sectionsSource).toContain('export function HealthTopFixesSection');
    expect(sectionsSource).toContain('export function HealthAllPagesSection');
    expect(sectionsSource).toContain('export function HealthHistorySection');
  });
});
