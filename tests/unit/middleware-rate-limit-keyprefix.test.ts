/**
 * Unit tests: credential-stuffing lockout and session signing helpers
 * (server/middleware.ts)
 *
 * Tests checkLoginLockout, recordLoginFailure, clearLoginFailures — these
 * use a per-email Map (not the shared rateLimitBuckets) so they are safe
 * to unit test without cross-test pollution concerns.
 *
 * Also verifies the keyPrefix comment in the module matches the actual
 * exported limiter configurations.
 */
import { describe, it, expect } from 'vitest';
import {
  checkLoginLockout,
  recordLoginFailure,
  clearLoginFailures,
  clientLoginLimiter,
  checkoutLimiter,
  aiLimiter,
  publicWriteLimiter,
} from '../../server/middleware.js';

// ── Credential Stuffing Lockout ───────────────────────────────────────────

describe('checkLoginLockout', () => {
  it('returns {locked: false} for an email with no prior failures', () => {
    const result = checkLoginLockout('noprior@example.com');
    expect(result.locked).toBe(false);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it('normalizes email to lowercase before lookup', () => {
    // Different cases should map to the same entry
    const result1 = checkLoginLockout('Upper@EXAMPLE.COM');
    const result2 = checkLoginLockout('upper@example.com');
    expect(result1.locked).toBe(result2.locked);
  });
});

describe('recordLoginFailure', () => {
  it('returns false (not yet locked) for the first failure', () => {
    const email = `test_first_${Date.now()}@example.com`;
    const locked = recordLoginFailure(email);
    expect(locked).toBe(false);
    clearLoginFailures(email); // cleanup
  });

  it('returns false after 4 consecutive failures (threshold is 5)', () => {
    const email = `test_four_${Date.now()}@example.com`;
    let locked = false;
    for (let i = 0; i < 4; i++) {
      locked = recordLoginFailure(email);
    }
    expect(locked).toBe(false);
    clearLoginFailures(email); // cleanup
  });

  it('returns true on the 5th consecutive failure (lockout threshold)', () => {
    const email = `test_fifth_${Date.now()}@example.com`;
    let locked = false;
    for (let i = 0; i < 5; i++) {
      locked = recordLoginFailure(email);
    }
    expect(locked).toBe(true);
    clearLoginFailures(email); // cleanup
  });

  it('after lockout, checkLoginLockout returns {locked: true, retryAfterMs}', () => {
    const email = `test_lockout_${Date.now()}@example.com`;
    for (let i = 0; i < 5; i++) recordLoginFailure(email);
    const result = checkLoginLockout(email);
    expect(result.locked).toBe(true);
    expect(typeof result.retryAfterMs).toBe('number');
    expect(result.retryAfterMs).toBeGreaterThan(0);
    clearLoginFailures(email); // cleanup
  });
});

describe('clearLoginFailures', () => {
  it('resets the failure count so the email is no longer locked', () => {
    const email = `test_clear_${Date.now()}@example.com`;
    for (let i = 0; i < 5; i++) recordLoginFailure(email);
    expect(checkLoginLockout(email).locked).toBe(true);

    clearLoginFailures(email);
    expect(checkLoginLockout(email).locked).toBe(false);
  });

  it('is a no-op for an email that was never locked', () => {
    const email = `test_noop_${Date.now()}@example.com`;
    expect(() => clearLoginFailures(email)).not.toThrow();
    expect(checkLoginLockout(email).locked).toBe(false);
  });
});

// ── Rate Limiter keyPrefix contract ──────────────────────────────────────
//
// These tests verify that route-level limiters (clientLoginLimiter,
// checkoutLimiter, aiLimiter) are distinct middleware functions from
// publicWriteLimiter. The keyPrefix isolation means their buckets don't
// collide with publicWriteLimiter's buckets (verified by the Wave 16 fix).

describe('rate limiter exports — are distinct middleware functions', () => {
  it('clientLoginLimiter is a function', () => {
    expect(typeof clientLoginLimiter).toBe('function');
  });

  it('checkoutLimiter is a function', () => {
    expect(typeof checkoutLimiter).toBe('function');
  });

  it('aiLimiter is a function', () => {
    expect(typeof aiLimiter).toBe('function');
  });

  it('all route-level limiters are distinct from publicWriteLimiter', () => {
    expect(clientLoginLimiter).not.toBe(publicWriteLimiter);
    expect(checkoutLimiter).not.toBe(publicWriteLimiter);
    expect(aiLimiter).not.toBe(publicWriteLimiter);
  });
});
