/**
 * keywordCommandCenter API client — request construction.
 *
 * Regression guard: the rows() builder must forward the `direction` query param.
 * Task 1 added asc/desc direction to the type, server comparator, route schema,
 * and the frontend rowsQuery — but the API client dropped it, so the chevron
 * flipped while the server always used the natural (descending) default. The
 * integration test hit the route URL directly and never exercised this client,
 * so the gap shipped. This test goes through the real client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  get: (...args: unknown[]) => getMock(...args),
  post: vi.fn(),
  del: vi.fn(),
}));

import { keywordCommandCenter } from '../../src/api/keywordCommandCenter';

describe('keywordCommandCenter.rows — request params', () => {
  beforeEach(() => getMock.mockReset());

  it('forwards the sort direction to the server', () => {
    keywordCommandCenter.rows('ws-1', { sort: 'clicks', direction: 'asc', page: 1, pageSize: 50 });
    const url = getMock.mock.calls[0][0] as string;
    expect(url).toContain('sort=clicks');
    expect(url).toContain('direction=asc');
  });

  it('forwards direction=desc too', () => {
    keywordCommandCenter.rows('ws-1', { sort: 'volume', direction: 'desc' });
    expect(getMock.mock.calls[0][0] as string).toContain('direction=desc');
  });

  it('omits direction when not provided (server falls back to the natural default)', () => {
    keywordCommandCenter.rows('ws-1', { sort: 'clicks' });
    expect(getMock.mock.calls[0][0] as string).not.toContain('direction=');
  });
});
