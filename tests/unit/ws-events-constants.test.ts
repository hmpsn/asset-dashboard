import { describe, it, expect } from 'vitest';
import { WS_EVENTS, ADMIN_EVENTS } from '../../server/ws-events.js';

describe('WS_EVENTS contract', () => {
  it('CLIENT_SIGNAL_CREATED is client-signal:created', () => {
    expect(WS_EVENTS.CLIENT_SIGNAL_CREATED).toBe('client-signal:created');
  });

  it('CLIENT_SIGNAL_UPDATED is client-signal:updated', () => {
    expect(WS_EVENTS.CLIENT_SIGNAL_UPDATED).toBe('client-signal:updated');
  });

  it('WORKSPACE_UPDATED is workspace:updated', () => {
    expect(WS_EVENTS.WORKSPACE_UPDATED).toBe('workspace:updated');
  });

  it('APPROVAL_UPDATE is approval:update', () => {
    expect(WS_EVENTS.APPROVAL_UPDATE).toBe('approval:update');
  });

  it('REQUEST_CREATED is request:created', () => {
    expect(WS_EVENTS.REQUEST_CREATED).toBe('request:created');
  });

  it('INTELLIGENCE_CACHE_UPDATED is intelligence:cache_updated', () => {
    expect(WS_EVENTS.INTELLIGENCE_CACHE_UPDATED).toBe('intelligence:cache_updated');
  });
});

describe('ADMIN_EVENTS contract', () => {
  it('QUEUE_UPDATE is queue:update', () => {
    expect(ADMIN_EVENTS.QUEUE_UPDATE).toBe('queue:update');
  });

  it('WORKSPACE_CREATED is workspace:created', () => {
    expect(ADMIN_EVENTS.WORKSPACE_CREATED).toBe('workspace:created');
  });

  it('WORKSPACE_UPDATED is workspace:updated', () => {
    expect(ADMIN_EVENTS.WORKSPACE_UPDATED).toBe('workspace:updated');
  });

  it('REQUEST_CREATED is request:created', () => {
    expect(ADMIN_EVENTS.REQUEST_CREATED).toBe('request:created');
  });

  it('FILES_UPLOADED is files:uploaded', () => {
    expect(ADMIN_EVENTS.FILES_UPLOADED).toBe('files:uploaded');
  });
});

describe('WS_EVENTS completeness', () => {
  it('all values in WS_EVENTS are strings', () => {
    const values = Object.values(WS_EVENTS);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(v => typeof v === 'string')).toBe(true);
  });

  it('all values in ADMIN_EVENTS are strings', () => {
    const values = Object.values(ADMIN_EVENTS);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(v => typeof v === 'string')).toBe(true);
  });
});

describe('no duplicate event name strings', () => {
  it('WS_EVENTS has no duplicate values within the object', () => {
    const values = Object.values(WS_EVENTS);
    expect(values.length).toBeGreaterThan(0);
    expect(values.length).toBe(new Set(values).size);
  });

  it('ADMIN_EVENTS has no duplicate values within the object', () => {
    const values = Object.values(ADMIN_EVENTS);
    expect(values.length).toBeGreaterThan(0);
    expect(values.length).toBe(new Set(values).size);
  });
});
