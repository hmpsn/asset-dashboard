import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const DASHBOARD_PATH = 'src/components/ClientDashboard.tsx';
const NAV_PATH = 'src/components/client/client-dashboard/clientDashboardNav.ts';
const BOOTSTRAP_PATH = 'src/components/client/client-dashboard/useClientWorkspaceBootstrap.ts';
const TAB_CONTENT_PATH = 'src/components/client/client-dashboard/ClientDashboardTabContent.tsx';

describe('ClientDashboard phase-3 shell extraction contract', () => {
  it('wires ClientDashboard root to extracted nav, bootstrap, and tab composition modules', () => {
    const source = readFileSync(DASHBOARD_PATH, 'utf-8'); // readFile-ok - migration guard for ClientDashboard decomposition wiring.

    expect(source).toContain("from './client/client-dashboard/clientDashboardNav'");
    expect(source).toContain("from './client/client-dashboard/useClientWorkspaceBootstrap'");
    expect(source).toContain("from './client/client-dashboard/ClientDashboardTabContent'");
    expect(source).toContain('useClientWorkspaceBootstrap({');
    expect(source).toContain('const NAV = buildClientDashboardNav({');
    expect(source).toContain('<ClientDashboardTabContent');
  });

  it('keeps bootstrap side-effects and tab composition branching out of the root shell', () => {
    const source = readFileSync(DASHBOARD_PATH, 'utf-8'); // readFile-ok - migration guard: root should defer heavy init + tab branching.

    expect(source).not.toContain("get<WorkspaceInfo>(`/api/public/workspace/${workspaceId}`)");
    expect(source).not.toContain("setMeta('property', 'og:title', portalTitle)");
    expect(source).not.toContain("{tab === 'overview' && (");
    expect(source).not.toContain("{tab === 'inbox' && (");
  });

  it('keeps nav/bootstrap/tab orchestration in dedicated modules', () => {
    const navSource = readFileSync(NAV_PATH, 'utf-8'); // readFile-ok - migration guard for nav derivation extraction.
    const bootstrapSource = readFileSync(BOOTSTRAP_PATH, 'utf-8'); // readFile-ok - migration guard for workspace bootstrap extraction.
    const tabContentSource = readFileSync(TAB_CONTENT_PATH, 'utf-8'); // readFile-ok - migration guard for tab composition extraction.

    expect(navSource).toContain('export function buildClientDashboardNav');
    expect(navSource).toContain('export function hasClientTabData');

    expect(bootstrapSource).toContain('export function useClientWorkspaceBootstrap');
    expect(bootstrapSource).toContain('applyWorkspaceMetadata');
    expect(bootstrapSource).toContain("get<WorkspaceInfo>(`/api/public/workspace/${workspaceId}`)");

    expect(tabContentSource).toContain('export function ClientDashboardTabContent');
    expect(tabContentSource).toContain('const chatFirstTabs = new Set<ClientTab>');
    expect(tabContentSource).toContain('const panel = panels[tab] ?? null');
  });
});
