import { describe, expect, it, vi } from 'vitest';
import {
  mcpAuthMiddleware,
  mcpMasterKeyOnlyMiddleware,
} from '../../server/mcp/auth.js';

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('mcp auth middleware', () => {
  it('rejects when MCP_API_KEY is missing', () => {
    const prev = process.env.MCP_API_KEY;
    delete process.env.MCP_API_KEY;

    const req = { headers: {} };
    const res = createRes();
    const next = vi.fn();
    mcpAuthMiddleware(req as never, res as never, next as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();

    if (prev === undefined) {
      delete process.env.MCP_API_KEY;
    } else {
      process.env.MCP_API_KEY = prev;
    }
  });

  it('rejects when authorization header is missing or not bearer', () => {
    process.env.MCP_API_KEY = 'secret';

    const req1 = { headers: {} };
    const res1 = createRes();
    mcpAuthMiddleware(req1 as never, res1 as never, vi.fn() as never);
    expect(res1.status).toHaveBeenCalledWith(401);

    const req2 = { headers: { authorization: 'Basic abc' } };
    const res2 = createRes();
    mcpAuthMiddleware(req2 as never, res2 as never, vi.fn() as never);
    expect(res2.status).toHaveBeenCalledWith(401);
  });

  it('rejects invalid bearer token and allows valid token', () => {
    process.env.MCP_API_KEY = 'secret-key';

    const badReq = { headers: { authorization: 'Bearer wrong' } };
    const badRes = createRes();
    const badNext = vi.fn();
    mcpAuthMiddleware(badReq as never, badRes as never, badNext as never);
    expect(badRes.status).toHaveBeenCalledWith(401);
    expect(badNext).not.toHaveBeenCalled();

    const goodReq = { headers: { authorization: 'Bearer secret-key' } };
    const goodRes = createRes();
    const goodNext = vi.fn();
    mcpAuthMiddleware(goodReq as never, goodRes as never, goodNext as never);
    expect(goodRes.status).not.toHaveBeenCalled();
    expect(goodNext).toHaveBeenCalledOnce();
  });
});

describe('MCP operator master-key boundary', () => {
  it('accepts only an already-authenticated all-workspace identity', () => {
    const masterReq = { mcpAuth: { scope: 'all' } };
    const masterRes = createRes();
    const masterNext = vi.fn();
    mcpMasterKeyOnlyMiddleware(masterReq as never, masterRes as never, masterNext as never);
    expect(masterNext).toHaveBeenCalledOnce();
    expect(masterRes.status).not.toHaveBeenCalled();

    for (const req of [
      {},
      { mcpAuth: { scope: 'ws-operator-denied', keyId: 'key-1', label: 'Workspace' } },
      { mcpAuth: { scope: 'all', keyId: 'key-all', label: 'Workspace named all' } },
    ]) {
      const res = createRes();
      const next = vi.fn();
      mcpMasterKeyOnlyMiddleware(req as never, res as never, next as never);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    }
  });
});
