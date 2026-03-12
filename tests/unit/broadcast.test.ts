/**
 * Unit tests for server/broadcast.ts — broadcast singleton.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setBroadcast, broadcast, broadcastToWorkspace } from '../../server/broadcast.js';

describe('broadcast singleton', () => {
  let mockBroadcast: ReturnType<typeof vi.fn>;
  let mockBroadcastToWorkspace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockBroadcast = vi.fn();
    mockBroadcastToWorkspace = vi.fn();
    setBroadcast(mockBroadcast, mockBroadcastToWorkspace);
  });

  it('broadcast() delegates to the registered function', () => {
    broadcast('test:event', { foo: 'bar' });
    expect(mockBroadcast).toHaveBeenCalledWith('test:event', { foo: 'bar' });
  });

  it('broadcastToWorkspace() delegates to the registered function', () => {
    broadcastToWorkspace('ws_123', 'activity:new', { id: 'act_1' });
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith('ws_123', 'activity:new', { id: 'act_1' });
  });

  it('setBroadcast replaces previous functions', () => {
    const newBc = vi.fn();
    const newBcWs = vi.fn();
    setBroadcast(newBc, newBcWs);

    broadcast('event', {});
    expect(newBc).toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledTimes(0);
  });
});
