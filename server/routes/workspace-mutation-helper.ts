import db from '../db/index.js';

export class WorkspaceMutationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WorkspaceMutationError';
    this.status = status;
  }
}

type WorkspaceMutationContext<TRead> = {
  workspaceId: string;
  existing: TRead;
};

type WorkspaceMutationAfterContext<TRead, TResult> = WorkspaceMutationContext<TRead> & {
  result: TResult;
};

export type WorkspaceMutationMappedError = {
  status: number;
  error: string;
  cause?: unknown;
};

type WorkspaceMutationPlan<TRead, TResult> = {
  workspaceId: string;
  defaultErrorMessage: string;
  readBeforeWrite?: (ctx: { workspaceId: string }) => TRead;
  mutate: (ctx: WorkspaceMutationContext<TRead>) => TResult;
  onActivity?: (ctx: WorkspaceMutationAfterContext<TRead, TResult>) => void;
  onBroadcast?: (ctx: WorkspaceMutationAfterContext<TRead, TResult>) => void;
  mapError?: (error: unknown) => WorkspaceMutationMappedError | null;
};

export function mutationError(status: number, error: string): WorkspaceMutationError {
  return new WorkspaceMutationError(status, error);
}

export function normalizeWorkspaceMutationError(
  error: unknown,
  defaultErrorMessage: string,
  mapError?: (error: unknown) => WorkspaceMutationMappedError | null,
): WorkspaceMutationMappedError {
  if (error instanceof WorkspaceMutationError) {
    return { status: error.status, error: error.message };
  }

  if (mapError) {
    const mapped = mapError(error);
    if (mapped) return mapped;
  }

  return { status: 500, error: defaultErrorMessage, cause: error };
}

export function runWorkspaceMutation<TRead, TResult>({
  workspaceId,
  defaultErrorMessage,
  readBeforeWrite,
  mutate,
  onActivity,
  onBroadcast,
  mapError,
}: WorkspaceMutationPlan<TRead, TResult>): TResult {
  try {
    if (!workspaceId) {
      throw mutationError(400, 'workspaceId is required');
    }

    const tx = db.transaction(() => {
      const existing = readBeforeWrite ? readBeforeWrite({ workspaceId }) : (undefined as TRead);
      const result = mutate({ workspaceId, existing });
      return { existing, result };
    });

    const { existing, result } = tx();
    const callbackCtx: WorkspaceMutationAfterContext<TRead, TResult> = { workspaceId, existing, result };
    onActivity?.(callbackCtx);
    onBroadcast?.(callbackCtx);
    return result;
  } catch (error) {
    const normalized = normalizeWorkspaceMutationError(error, defaultErrorMessage, mapError);
    if (normalized.status >= 500 && normalized.cause) {
      throw normalized.cause;
    }
    throw mutationError(normalized.status, normalized.error);
  }
}
