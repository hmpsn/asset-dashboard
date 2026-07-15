import { randomUUID } from 'node:crypto';

import type {
  MatrixGenerationRetryCommand,
  RetryMatrixGenerationCommandRequest,
} from '../../../../shared/types/matrix-generation.js';
import db from '../../../db/index.js';
import { parseJsonSafe } from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { z } from '../../../middleware/validate.js';
import { MatrixGenerationPersistenceContractError } from './repository.js';

interface RetryCommandRow {
  id: string;
  run_id: string;
  workspace_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  request_payload: string;
  job_id: string;
  created_at: string;
}

const sourceRevisionSchema = z.object({
  matrixRevision: z.number().int().nonnegative(),
  templateRevision: z.number().int().nonnegative(),
  cellRevision: z.number().int().nonnegative(),
}).strict();

const artifactRevisionsSchema = z.object({
  brief: z.object({
    artifactType: z.literal('content_brief'),
    artifactId: z.string().nullable(),
    generationRevision: z.number().int().nonnegative(),
  }).strict(),
  post: z.object({
    artifactType: z.literal('generated_post'),
    artifactId: z.string().nullable(),
    generationRevision: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const resolverSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp', 'system']),
  actorId: z.string().min(1),
  actorLabel: z.string().optional(),
}).strict();

const mcpContextSchema = z.object({
  requestId: z.string().min(1),
  toolName: z.string().min(1),
  targetWorkspaceId: z.string().nullable(),
  caller: z.union([
    z.object({
      kind: z.literal('master_key'),
      scope: z.literal('all'),
      keyId: z.null(),
      keyLabel: z.null(),
    }).strict(),
    z.object({
      kind: z.literal('workspace_key'),
      scope: z.string().min(1),
      workspaceId: z.string().min(1),
      keyId: z.string().min(1),
      keyLabel: z.string().min(1),
    }).strict(),
  ]),
}).strict();

const retryItemSchema = z.object({
  itemId: z.string().min(1),
  expectedItemRevision: z.number().int().nonnegative(),
  sourceRevision: sourceRevisionSchema,
  expectedArtifactRevisions: artifactRevisionsSchema,
  reusableCheckpointFingerprint: z.string().nullable(),
}).strict();

const retryBaseShape = {
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  expectedRunRevision: z.number().int().nonnegative(),
  items: z.array(retryItemSchema).min(1).max(25),
  idempotencyKey: z.string().min(1).max(200),
  requestedBy: resolverSchema,
  mcpExecutionContext: mcpContextSchema.nullable(),
};

const retryRequestSchema = z.discriminatedUnion('mode', [
  z.object({ ...retryBaseShape, mode: z.literal('resume') }).strict(),
  z.object({
    ...retryBaseShape,
    mode: z.literal('replace'),
    replacementAuthorization: z.object({
      authorizedBy: resolverSchema.extend({ actorType: z.literal('operator') }).strict(),
      reason: z.string().min(1),
      authorizedAt: z.string().min(1),
    }).strict(),
  }).strict(),
]);

const stmts = createStmtCache(() => ({
  getByIdempotency: db.prepare(`
    SELECT * FROM content_matrix_generation_retry_commands
    WHERE workspace_id = ? AND run_id = ? AND idempotency_key = ?
  `),
  getByJob: db.prepare(`
    SELECT * FROM content_matrix_generation_retry_commands
    WHERE workspace_id = ? AND job_id = ?
  `),
  insert: db.prepare(`
    INSERT INTO content_matrix_generation_retry_commands (
      id, run_id, workspace_id, idempotency_key, request_fingerprint,
      request_payload, job_id, created_at
    ) VALUES (
      @id, @run_id, @workspace_id, @idempotency_key, @request_fingerprint,
      @request_payload, @job_id, @created_at
    )
  `),
}));

function rowToCommand(row: RetryCommandRow): MatrixGenerationRetryCommand {
  const request = parseJsonSafe(row.request_payload, retryRequestSchema, null, {
    workspaceId: row.workspace_id,
    table: 'content_matrix_generation_retry_commands',
    field: 'request_payload',
  });
  if (!request) {
    throw new MatrixGenerationPersistenceContractError(
      'Stored matrix generation retry command is invalid',
    );
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    request: request as RetryMatrixGenerationCommandRequest,
    jobId: row.job_id,
    createdAt: row.created_at,
  };
}

export function getMatrixGenerationRetryCommandByIdempotency(
  workspaceId: string,
  runId: string,
  idempotencyKey: string,
): MatrixGenerationRetryCommand | null {
  const row = stmts().getByIdempotency.get(
    workspaceId,
    runId,
    idempotencyKey,
  ) as RetryCommandRow | undefined;
  return row ? rowToCommand(row) : null;
}

export function getMatrixGenerationRetryCommandByJob(
  workspaceId: string,
  jobId: string,
): MatrixGenerationRetryCommand | null {
  const row = stmts().getByJob.get(workspaceId, jobId) as RetryCommandRow | undefined;
  return row ? rowToCommand(row) : null;
}

export function insertMatrixGenerationRetryCommand(input: {
  request: RetryMatrixGenerationCommandRequest;
  requestFingerprint: string;
  jobId: string;
}): MatrixGenerationRetryCommand {
  const parsed = retryRequestSchema.safeParse(input.request);
  if (!parsed.success) {
    throw new MatrixGenerationPersistenceContractError('Matrix generation retry request is invalid');
  }
  const insert = (): MatrixGenerationRetryCommand => {
    const command: MatrixGenerationRetryCommand = {
      id: `mgrc_${randomUUID()}`,
      workspaceId: input.request.workspaceId,
      runId: input.request.runId,
      idempotencyKey: input.request.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      request: input.request,
      jobId: input.jobId,
      createdAt: new Date().toISOString(),
    };
    stmts().insert.run({
      id: command.id,
      run_id: command.runId,
      workspace_id: command.workspaceId,
      idempotency_key: command.idempotencyKey,
      request_fingerprint: command.requestFingerprint,
      request_payload: JSON.stringify(parsed.data),
      job_id: command.jobId,
      created_at: command.createdAt,
    });
    return command;
  };
  return db.inTransaction ? insert() : db.transaction(insert).immediate();
}
