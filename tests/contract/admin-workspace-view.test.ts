import { describe, it, expect } from 'vitest';
import { toAdminWorkspaceView, ADMIN_VIEW_DENIED_KEYS } from '../../server/serializers/admin-workspace-view.js';
import type { Workspace, AdminWorkspaceView } from '../../shared/types/workspace.js';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-test-1',
    name: 'Test Workspace',
    folder: 'default',
    createdAt: '2025-01-01T00:00:00Z',
    webflowToken: 'secret-token-123',
    clientPassword: '$2a$12$hashedsecret',
    stripeCustomerId: 'cus_secret',
    stripeSubscriptionId: 'sub_secret',
    ...overrides,
  };
}

describe('toAdminWorkspaceView', () => {
  it('includes all AdminWorkspaceView keys', () => {
    const ws = makeWorkspace();
    const view = toAdminWorkspaceView(ws);
    const keys: (keyof AdminWorkspaceView)[] = [
      'id', 'name', 'folder', 'createdAt',
      'hasPassword', 'isTrial', 'trialDaysRemaining', 'effectiveTier',
    ];
    for (const key of keys) {
      expect(view).toHaveProperty(key);
    }
  });

  it('never includes denied keys (secrets)', () => {
    const ws = makeWorkspace();
    const view = toAdminWorkspaceView(ws);
    const raw = view as Record<string, unknown>;
    for (const key of ADMIN_VIEW_DENIED_KEYS) {
      expect(raw[key]).toBeUndefined();
    }
  });

  it('computes hasPassword from clientPassword', () => {
    expect(toAdminWorkspaceView(makeWorkspace({ clientPassword: 'hash' })).hasPassword).toBe(true);
    expect(toAdminWorkspaceView(makeWorkspace({ clientPassword: '' })).hasPassword).toBe(false);
    expect(toAdminWorkspaceView(makeWorkspace({ clientPassword: undefined })).hasPassword).toBe(false);
  });

  it('computes trial state via computeTrialState', () => {
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const view = toAdminWorkspaceView(makeWorkspace({ tier: 'free', trialEndsAt: trialEnd }));
    expect(view.isTrial).toBe(true);
    expect(view.trialDaysRemaining).toBeGreaterThan(0);
    expect(view.effectiveTier).toBe('growth');
  });

  it('reports non-trial for growth-tier workspace', () => {
    const view = toAdminWorkspaceView(makeWorkspace({ tier: 'growth' }));
    expect(view.isTrial).toBe(false);
    expect(view.trialDaysRemaining).toBe(0);
    expect(view.effectiveTier).toBe('growth');
  });

  it('new Workspace fields do not leak automatically (allow-list test)', () => {
    const ws = makeWorkspace() as Record<string, unknown>;
    ws['__futureSecretField'] = 'should-not-leak';
    const view = toAdminWorkspaceView(ws as Workspace);
    expect((view as Record<string, unknown>)['__futureSecretField']).toBeUndefined();
  });
});
