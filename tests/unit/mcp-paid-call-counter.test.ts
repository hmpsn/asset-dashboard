import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPaidCallCounterForTests,
  getPaidCallCount,
  recordPaidCall,
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
});
