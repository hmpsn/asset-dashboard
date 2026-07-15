import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPaidCallCounterForTests,
  getPaidCallCount,
  recordPaidCall,
  recordPaidCallOnce,
} from '../../server/mcp/paid-call-counter.js';

describe('mcp paid-call-counter', () => {
  beforeEach(() => {
    __resetPaidCallCounterForTests();
    delete process.env.MCP_PAID_CALL_WARN_AFTER;
  });

  it('starts at zero', () => {
    expect(getPaidCallCount()).toBe(0);
  });

  it('increments as calls are recorded', () => {
    recordPaidCall(1);
    recordPaidCall(1);
    recordPaidCall(3);
    expect(getPaidCallCount()).toBe(5);
  });

  it('records a durable namespaced event exactly once globally and per workspace', () => {
    const eventKey = 'mcp:test:accepted-command:job-1';

    expect(recordPaidCallOnce(eventKey, 2, 'ws-paid-once')).toEqual({ count: 2 });
    expect(recordPaidCallOnce(eventKey, 2, 'ws-paid-once')).toEqual({ count: 2 });

    expect(getPaidCallCount()).toBe(2);
    expect(getPaidCallCount('ws-paid-once')).toBe(2);
  });

  it('fails closed when an event key is replayed with different metering inputs', () => {
    const eventKey = 'mcp:test:accepted-command:job-bound';
    recordPaidCallOnce(eventKey, 1, 'ws-original');

    expect(() => recordPaidCallOnce(eventKey, 2, 'ws-original')).toThrow(/different metering inputs/i);
    expect(() => recordPaidCallOnce(eventKey, 1, 'ws-other')).toThrow(/different metering inputs/i);
    expect(getPaidCallCount()).toBe(1);
    expect(getPaidCallCount('ws-original')).toBe(1);
    expect(getPaidCallCount('ws-other')).toBe(0);
  });

  it('counts the first replay when a previously accepted command has no event yet', () => {
    expect(getPaidCallCount()).toBe(0);

    const repaired = recordPaidCallOnce(
      'mcp:brand-generation:accepted-command:job-repaired',
      1,
      'ws-repaired',
    );

    expect(repaired).toEqual({ count: 1 });
    expect(getPaidCallCount('ws-repaired')).toBe(1);
  });

  it('clears paid-call events with the test reset helper', () => {
    const eventKey = 'mcp:test:accepted-command:job-reset';
    recordPaidCallOnce(eventKey, 1, 'ws-reset');

    __resetPaidCallCounterForTests();

    expect(recordPaidCallOnce(eventKey, 1, 'ws-reset')).toEqual({ count: 1 });
    expect(getPaidCallCount('ws-reset')).toBe(1);
  });

  it('does not warn below threshold', () => {
    for (let i = 0; i < 99; i++) {
      expect(recordPaidCall(1).warning).toBeUndefined();
    }
  });

  it('warns at and above threshold', () => {
    for (let i = 0; i < 99; i++) recordPaidCall(1);
    const atThreshold = recordPaidCall(1).warning;
    const pastThreshold = recordPaidCall(1).warning;
    expect(atThreshold).toMatch(/paid_call_count: 100/);
    expect(atThreshold).toMatch(/threshold 100/);
    expect(pastThreshold).toMatch(/paid_call_count: 101/);
  });

  it('uses MCP_PAID_CALL_WARN_AFTER when set', () => {
    process.env.MCP_PAID_CALL_WARN_AFTER = '5';
    __resetPaidCallCounterForTests();
    for (let i = 0; i < 4; i++) {
      expect(recordPaidCall(1).warning).toBeUndefined();
    }
    expect(recordPaidCall(1).warning).toMatch(/paid_call_count: 5/);
  });

  it('preserves the threshold warning when an exactly-once event is replayed', () => {
    process.env.MCP_PAID_CALL_WARN_AFTER = '1';
    const eventKey = 'mcp:test:accepted-command:job-warning';

    const accepted = recordPaidCallOnce(eventKey, 1, 'ws-warning');
    const replayed = recordPaidCallOnce(eventKey, 1, 'ws-warning');

    expect(accepted.warning).toMatch(/paid_call_count: 1/);
    expect(replayed.warning).toMatch(/paid_call_count: 1/);
    expect(getPaidCallCount()).toBe(1);
  });
});
