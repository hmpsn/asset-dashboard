import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app: import('express').Express;

beforeAll(async () => {
  const { runMigrations } = await import('../../server/db/index.js');
  runMigrations();
  const mod = await import('../../server/app.js');
  app = mod.createApp();
});

describe('Admin signals inbox workflow', () => {
  it('GET lists signals then PATCH updates to reviewed', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    const signal = createClientSignal({
      workspaceId: 'ws-inbox-test',
      workspaceName: 'Inbox Test WS',
      type: 'service_interest',
      chatContext: [
        { role: 'user', content: 'I want to talk to someone' },
        { role: 'assistant', content: 'Sure, I will connect you.' },
      ],
      triggerMessage: 'I want to talk to someone',
    });

    // List
    const listRes = await request(app)
      .get('/api/client-signals/ws-inbox-test')
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((s: { id: string }) => s.id === signal.id)).toBe(true);

    // Verify chatContext is included
    const found = listRes.body.find((s: { id: string }) => s.id === signal.id);
    expect(found.chatContext).toHaveLength(2);

    // Update to reviewed
    const patchRes = await request(app)
      .patch(`/api/client-signals/${signal.id}/status`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test')
      .send({ status: 'reviewed' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('reviewed');

    // Update to actioned
    const actionRes = await request(app)
      .patch(`/api/client-signals/${signal.id}/status`)
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test')
      .send({ status: 'actioned' });
    expect(actionRes.status).toBe(200);
    expect(actionRes.body.status).toBe('actioned');
  });

  it('workspace isolation enforced on list endpoint', async () => {
    const { createClientSignal } = await import('../../server/client-signals-store.js');
    createClientSignal({
      workspaceId: 'ws-isolated-inbox-A',
      workspaceName: 'Isolated A',
      type: 'content_interest',
      chatContext: [],
      triggerMessage: 'test isolation',
    });

    const res = await request(app)
      .get('/api/client-signals/ws-isolated-inbox-B')
      .set('x-auth-token', process.env.APP_PASSWORD ?? 'test');

    expect(res.status).toBe(200);
    expect(res.body.every((s: { workspaceId: string }) => s.workspaceId === 'ws-isolated-inbox-B')).toBe(true);
  });
});
