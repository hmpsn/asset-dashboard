import { randomUUID } from 'node:crypto';

export type HandleKind =
  | 'keyword-research'
  | 'keyword-research-bulk'
  | 'brief-request'
  | 'brief'
  | 'post-request'
  | 'post';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface HandleRecord {
  kind: HandleKind;
  workspaceId: string;
  payload: unknown;
  expiresAt: number;
}

const handles = new Map<string, HandleRecord>();

export class HandleNotFoundError extends Error {
  constructor(id: string) {
    super(`Handle not found or already consumed: ${id}`);
    this.name = 'HandleNotFoundError';
  }
}

export class HandleExpiredError extends Error {
  constructor(id: string) {
    super(`Handle expired (TTL exceeded): ${id}. Re-run the producing tool.`);
    this.name = 'HandleExpiredError';
  }
}

export class HandleKindMismatchError extends Error {
  constructor(id: string, expected: HandleKind, actual: HandleKind) {
    super(`Handle ${id} is kind '${actual}', expected '${expected}'`);
    this.name = 'HandleKindMismatchError';
  }
}

export class HandleWorkspaceMismatchError extends Error {
  constructor(id: string, expected: string, actual: string) {
    super(`Handle ${id} belongs to workspace '${actual}', not '${expected}'`);
    this.name = 'HandleWorkspaceMismatchError';
  }
}

export function issueHandle(
  kind: HandleKind,
  workspaceId: string,
  payload: unknown,
  opts?: { ttlMs?: number },
): string {
  const id = `${kind}_${randomUUID()}`;
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  handles.set(id, {
    kind,
    workspaceId,
    payload,
    expiresAt: Date.now() + ttlMs,
  });
  return id;
}

export function consumeHandle<T = unknown>(
  id: string,
  expectedKind: HandleKind,
  expectedWorkspaceId: string,
): T {
  const record = handles.get(id);
  if (!record) {
    throw new HandleNotFoundError(id);
  }
  if (Date.now() > record.expiresAt) {
    handles.delete(id);
    throw new HandleExpiredError(id);
  }
  if (record.kind !== expectedKind) {
    throw new HandleKindMismatchError(id, expectedKind, record.kind);
  }
  if (record.workspaceId !== expectedWorkspaceId) {
    throw new HandleWorkspaceMismatchError(id, expectedWorkspaceId, record.workspaceId);
  }
  handles.delete(id);
  return record.payload as T;
}

/** Test-only: clear the handle store between tests. Do not call in production code. */
export function __resetHandleStoreForTests(): void {
  handles.clear();
}
