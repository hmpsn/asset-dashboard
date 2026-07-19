import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  routerPost: vi.fn(),
  routerGet: vi.fn(),
  routerDelete: vi.fn(),
  postHandler: null as null | ((req: any, res: any) => Promise<void>),
  getHandlers: new Map<string, (req: any, res: any) => void>(),
  deleteHandlers: new Map<string, (req: any, res: any) => void>(),
  mcpAuthMiddleware: vi.fn(),
  mcpMasterKeyOnlyMiddleware: vi.fn(),
  handleMcpRequest: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('express', () => ({
  Router: () => ({
    post: h.routerPost.mockImplementation((...args: unknown[]) => {
      h.postHandler = args.at(-1) as (req: any, res: any) => Promise<void>;
    }),
    get: h.routerGet.mockImplementation((path: string, handler: (req: any, res: any) => void) => {
      h.getHandlers.set(path, handler);
    }),
    delete: h.routerDelete.mockImplementation((path: string, handler: (req: any, res: any) => void) => {
      h.deleteHandlers.set(path, handler);
    }),
  }),
}));

vi.mock('../../server/mcp/auth.js', () => ({
  mcpAuthMiddleware: h.mcpAuthMiddleware,
  mcpMasterKeyOnlyMiddleware: h.mcpMasterKeyOnlyMiddleware,
}));

vi.mock('../../server/mcp/server.js', () => ({
  handleMcpRequest: h.handleMcpRequest,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ error: h.loggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import router from '../../server/mcp/index.js';

describe('mcp router', () => {
  it('registers POST / with auth middleware', () => {
    expect(router).toBeDefined();
    expect(h.routerPost).toHaveBeenCalledWith(
      '/operator',
      h.mcpAuthMiddleware,
      h.mcpMasterKeyOnlyMiddleware,
      expect.any(Function),
    );
    expect(h.routerPost).toHaveBeenCalledWith('/', h.mcpAuthMiddleware, expect.any(Function));
    expect(h.postHandler).toBeTypeOf('function');
  });

  it('handles success and error branches in route handler', async () => {
    const req = { body: {} };
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    h.handleMcpRequest.mockResolvedValueOnce(undefined);
    await h.postHandler!(req, res);
    expect(h.handleMcpRequest).toHaveBeenCalledWith(req, res);
    expect(res.status).not.toHaveBeenCalled();

    h.handleMcpRequest.mockRejectedValueOnce(new Error('mcp failed'));
    await h.postHandler!(req, res);
    expect(h.loggerError).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('registers GET and DELETE 405 handlers for both MCP profiles', () => {
    for (const path of ['/', '/operator']) {
      expect(h.routerGet).toHaveBeenCalledWith(path, expect.any(Function));
      expect(h.routerDelete).toHaveBeenCalledWith(path, expect.any(Function));

      for (const handler of [h.getHandlers.get(path), h.deleteHandlers.get(path)]) {
        const res = {
          set: vi.fn().mockReturnThis(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn().mockReturnThis(),
        };
        handler!({}, res);
        expect(res.set).toHaveBeenCalledWith('Allow', 'POST');
        expect(res.status).toHaveBeenCalledWith(405);
      }
    }
  });

  it('skips response write when headers are already sent', async () => {
    const req = { body: {} };
    const res = {
      headersSent: true,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    h.handleMcpRequest.mockRejectedValueOnce(new Error('mcp failed'));
    await h.postHandler!(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
