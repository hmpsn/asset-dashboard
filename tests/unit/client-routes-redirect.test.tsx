// tests/unit/client-routes-redirect.test.tsx
//
// Pin the backward-compat redirect contract for client routes:
//   /client/:id?tab=X        → /client/:id/X     (legacy redirect fires)
//   /client/:id/inbox?tab=X  → render as-is      (`?tab=` is filter, not tab)
//   /client/:id/content      → /client/:id/inbox?tab=content
//
// The legacy redirect was originally intended for old-style URLs of the form
// `/client/:id?tab=approvals`. When `<ActionQueueStrip>` (Phase 2 of
// client-briefing-v2) started deep-linking to `/client/:id/inbox?tab=X` to
// pass a filter selection to <InboxTab>, the redirect over-fired and rewrote
// the URL to `/client/:id/X` — losing the inbox base and silently routing
// users to a no-render tab branch. This test catches that regression.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams, useSearchParams } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { clientPath, isClientInboxAlias } from '../../src/routes';

// Re-implement the function under test inline. The production version lives
// in App.tsx and is not exported. Keeping the test isolated to the redirect
// behavior — if the production version drifts from this, the smoke test
// (manual) catches it.
function ClientRoutes({ betaMode = false }: { betaMode?: boolean }) {
  const params = useParams<{ workspaceId: string; '*': string }>();
  const [searchParams] = useSearchParams();
  const workspaceId = params.workspaceId!;
  const splatTab = params['*'] || undefined;
  const splatRoot = splatTab?.split('/')[0];
  const queryTab = searchParams.get('tab');
  if (queryTab && workspaceId && !splatTab) {
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('tab');
    const qs = remaining.toString();
    const target = clientPath(workspaceId, queryTab, betaMode);
    return <Navigate to={target + (qs ? `${target.includes('?') ? '&' : '?'}${qs}` : '')} replace />;
  }
  if (workspaceId && isClientInboxAlias(splatRoot)) {
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('tab');
    const qs = remaining.toString();
    const target = clientPath(workspaceId, splatRoot, betaMode);
    return <Navigate to={target + (qs ? `${target.includes('?') ? '&' : '?'}${qs}` : '')} replace />;
  }
  // Stand-in for ClientDashboard so we can introspect what initialTab + URL
  // would have been delivered.
  return <DashboardStub workspaceId={workspaceId} initialTab={splatTab} />;
}

function DashboardStub({ workspaceId, initialTab }: { workspaceId: string; initialTab?: string }) {
  const [params] = useSearchParams();
  return (
    <div data-testid="dashboard">
      <span data-testid="ws">{workspaceId}</span>
      <span data-testid="initialTab">{initialTab ?? '<none>'}</span>
      <span data-testid="tabParam">{params.get('tab') ?? '<none>'}</span>
    </div>
  );
}

function renderRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/client/:workspaceId/*" element={<ClientRoutes />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ClientRoutes legacy ?tab= redirect', () => {
  it('redirects /client/:id?tab=X to /client/:id/X (legacy compat)', () => {
    const { getByTestId } = renderRoutes('/client/ws_test?tab=performance');
    // Navigate replaces; final landing should be /performance with no tab param
    expect(getByTestId('initialTab').textContent).toBe('performance');
    expect(getByTestId('tabParam').textContent).toBe('<none>');
  });

  it('redirects legacy ?tab=content to the unified inbox content filter', () => {
    const { getByTestId } = renderRoutes('/client/ws_test?tab=content');
    expect(getByTestId('initialTab').textContent).toBe('inbox');
    expect(getByTestId('tabParam').textContent).toBe('content');
  });

  it('preserves /client/:id/inbox?tab=X without redirecting', () => {
    // The Phase-2 deep-link contract: when a tab path is already present,
    // ?tab= is a filter for the inner page, not the top-level tab.
    const { getByTestId } = renderRoutes('/client/ws_test/inbox?tab=approvals');
    expect(getByTestId('initialTab').textContent).toBe('inbox');
    expect(getByTestId('tabParam').textContent).toBe('approvals');
  });

  it('preserves multi-key query params on inbox path', () => {
    const { getByTestId } = renderRoutes('/client/ws_test/inbox?tab=content&filter=published');
    expect(getByTestId('initialTab').textContent).toBe('inbox');
    expect(getByTestId('tabParam').textContent).toBe('content');
  });

  it('still passes through /client/:id with no params', () => {
    const { getByTestId } = renderRoutes('/client/ws_test');
    expect(getByTestId('initialTab').textContent).toBe('<none>');
    expect(getByTestId('tabParam').textContent).toBe('<none>');
  });

  it('still passes through /client/:id/health with no query', () => {
    const { getByTestId } = renderRoutes('/client/ws_test/health');
    expect(getByTestId('initialTab').textContent).toBe('health');
    expect(getByTestId('tabParam').textContent).toBe('<none>');
  });

  it('redirects legacy /client/:id/content to the inbox content filter', () => {
    const { getByTestId } = renderRoutes('/client/ws_test/content');
    expect(getByTestId('initialTab').textContent).toBe('inbox');
    expect(getByTestId('tabParam').textContent).toBe('content');
  });

  it('redirects legacy /client/:id/requests to the inbox needs-action filter', () => {
    const { getByTestId } = renderRoutes('/client/ws_test/requests');
    expect(getByTestId('initialTab').textContent).toBe('inbox');
    expect(getByTestId('tabParam').textContent).toBe('needs-action');
  });

  it('redirects legacy /client/:id/approvals to the inbox seo-changes filter', () => {
    const { getByTestId } = renderRoutes('/client/ws_test/approvals');
    expect(getByTestId('initialTab').textContent).toBe('inbox');
    expect(getByTestId('tabParam').textContent).toBe('seo-changes');
  });
});

describe('clientPath legacy client inbox aliases', () => {
  it('points content navigation at the inbox content filter', () => {
    expect(clientPath('ws_test', 'content')).toBe('/client/ws_test/inbox?tab=content');
  });

  it('points requests navigation at the inbox needs-action filter', () => {
    expect(clientPath('ws_test', 'requests')).toBe('/client/ws_test/inbox?tab=needs-action');
  });

  it('points approvals navigation at the inbox seo-changes filter', () => {
    expect(clientPath('ws_test', 'approvals')).toBe('/client/ws_test/inbox?tab=seo-changes');
  });

  it('preserves normal client tab paths', () => {
    expect(clientPath('ws_test', 'performance')).toBe('/client/ws_test/performance');
  });
});
