/**
 * Unit tests: server/workspace-mutation-helper.ts
 *
 * Tests runWorkspaceMutation, WorkspaceMutationError, mutationError,
 * and normalizeWorkspaceMutationError.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runWorkspaceMutation,
  mutationError,
  normalizeWorkspaceMutationError,
  WorkspaceMutationError,
} from '../../server/workspace-mutation-helper.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ws = createWorkspace('workspace-mutation-helper-unit-test');
const WS_ID = ws.id;

// Cleanup after all tests
import { afterAll } from 'vitest';
afterAll(() => deleteWorkspace(WS_ID));

// ── mutationError ─────────────────────────────────────────────────────────

describe('mutationError', () => {
  it('returns a WorkspaceMutationError with the given status and message', () => {
    const err = mutationError(400, 'Bad input');
    expect(err).toBeInstanceOf(WorkspaceMutationError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Bad input');
  });

  it('returns a WorkspaceMutationError with status 404', () => {
    const err = mutationError(404, 'Not found');
    expect(err.status).toBe(404);
  });
});

// ── normalizeWorkspaceMutationError ───────────────────────────────────────

describe('normalizeWorkspaceMutationError', () => {
  it('returns status and error message from WorkspaceMutationError directly', () => {
    const err = mutationError(403, 'Forbidden');
    const result = normalizeWorkspaceMutationError(err, 'Default error');
    expect(result.status).toBe(403);
    expect(result.error).toBe('Forbidden');
  });

  it('uses default error message for unknown errors', () => {
    const result = normalizeWorkspaceMutationError(new Error('something'), 'Default error');
    expect(result.status).toBe(500);
    expect(result.error).toBe('Default error');
  });

  it('uses mapError when provided and it returns a value', () => {
    const mapError = (err: unknown) => {
      if (err instanceof TypeError) return { status: 422, error: 'Type mismatch' };
      return null;
    };
    const result = normalizeWorkspaceMutationError(new TypeError('bad type'), 'Default', mapError);
    expect(result.status).toBe(422);
    expect(result.error).toBe('Type mismatch');
  });

  it('falls back to default when mapError returns null', () => {
    const mapError = () => null;
    const result = normalizeWorkspaceMutationError(new Error('x'), 'Fallback', mapError);
    expect(result.status).toBe(500);
    expect(result.error).toBe('Fallback');
  });
});

// ── runWorkspaceMutation ──────────────────────────────────────────────────

describe('runWorkspaceMutation', () => {
  it('throws a 400 error when workspaceId is empty string', () => {
    expect(() =>
      runWorkspaceMutation({
        workspaceId: '',
        defaultErrorMessage: 'Failed',
        mutate: () => 'result',
      }),
    ).toThrow();
  });

  it('calls mutate and returns the result', () => {
    const result = runWorkspaceMutation({
      workspaceId: WS_ID,
      defaultErrorMessage: 'Failed',
      mutate: () => ({ value: 42 }),
    });
    expect(result).toEqual({ value: 42 });
  });

  it('calls readBeforeWrite and passes existing to mutate', () => {
    const readFn = vi.fn(() => ({ previousData: 'read' }));
    const mutateFn = vi.fn(({ existing }) => existing.previousData);

    const result = runWorkspaceMutation({
      workspaceId: WS_ID,
      defaultErrorMessage: 'Failed',
      readBeforeWrite: readFn,
      mutate: mutateFn,
    });

    expect(readFn).toHaveBeenCalledWith({ workspaceId: WS_ID });
    expect(mutateFn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS_ID, existing: { previousData: 'read' } }),
    );
    expect(result).toBe('read');
  });

  it('calls onActivity with result after successful mutation', () => {
    const onActivity = vi.fn();
    runWorkspaceMutation({
      workspaceId: WS_ID,
      defaultErrorMessage: 'Failed',
      mutate: () => 'done',
      onActivity,
    });
    expect(onActivity).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS_ID, result: 'done' }),
    );
  });

  it('calls onBroadcast with result after successful mutation', () => {
    const onBroadcast = vi.fn();
    runWorkspaceMutation({
      workspaceId: WS_ID,
      defaultErrorMessage: 'Failed',
      mutate: () => 'broadcast-result',
      onBroadcast,
    });
    expect(onBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'broadcast-result' }),
    );
  });

  it('rethrows the original error when status >= 500 and cause exists', () => {
    const originalError = new TypeError('DB failure');
    expect(() =>
      runWorkspaceMutation({
        workspaceId: WS_ID,
        defaultErrorMessage: 'DB error',
        mutate: () => { throw originalError; },
      }),
    ).toThrow(TypeError);
  });

  it('throws WorkspaceMutationError when mutate throws a 4xx mutation error', () => {
    expect(() =>
      runWorkspaceMutation({
        workspaceId: WS_ID,
        defaultErrorMessage: 'Failed',
        mutate: () => { throw mutationError(404, 'Not found'); },
      }),
    ).toThrowError('Not found');
  });

  it('does not call onActivity or onBroadcast when mutate throws', () => {
    const onActivity = vi.fn();
    const onBroadcast = vi.fn();
    expect(() =>
      runWorkspaceMutation({
        workspaceId: WS_ID,
        defaultErrorMessage: 'Failed',
        mutate: () => { throw mutationError(400, 'Bad'); },
        onActivity,
        onBroadcast,
      }),
    ).toThrow();
    expect(onActivity).not.toHaveBeenCalled();
    expect(onBroadcast).not.toHaveBeenCalled();
  });
});
