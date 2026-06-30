import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import { z } from './middleware/validate.js';

const STATE_INTENT = 'gbp-auth';
const STATE_TTL_MS = 10 * 60 * 1000;

const payloadSchema = z.object({
  intent: z.literal(STATE_INTENT),
  nonce: z.string().min(16),
  workspaceId: z.string().optional(),
  returnTo: z.string().optional(),
  expiresAt: z.number().int().positive(),
});

export type GbpOAuthStatePayload = z.infer<typeof payloadSchema>;

const stmts = createStmtCache(() => ({
  insertState: db.prepare(`
    INSERT INTO google_business_profile_oauth_states (
      nonce, intent, workspace_id, return_to, expires_at, created_at
    )
    VALUES (@nonce, @intent, @workspaceId, @returnTo, @expiresAt, @createdAt)
  `),
  getState: db.prepare(`
    SELECT nonce, intent, workspace_id, return_to, expires_at, consumed_at
    FROM google_business_profile_oauth_states
    WHERE nonce = ?
  `),
  // ws-scope-ok: OAuth states are nonce-scoped, single-use verifier rows with optional workspace return metadata.
  consumeState: db.prepare(`
    UPDATE google_business_profile_oauth_states
    SET consumed_at = ?
    WHERE nonce = ? AND consumed_at IS NULL
  `),
}));

interface OAuthStateRow {
  nonce: string;
  intent: string;
  workspace_id: string | null;
  return_to: string | null;
  expires_at: number;
  consumed_at: string | null;
}

function stateSecret(): string {
  return process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.APP_PASSWORD || process.env.JWT_SECRET || 'asset-dashboard-local-oauth-state-secret';
}

function sign(unsigned: string): string {
  return createHmac('sha256', stateSecret()).update(unsigned).digest('base64url');
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createGbpOAuthState(input: { workspaceId?: string; returnTo?: string } = {}): string {
  const now = Date.now();
  const payload: GbpOAuthStatePayload = {
    intent: STATE_INTENT,
    nonce: randomBytes(24).toString('base64url'),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.returnTo ? { returnTo: input.returnTo } : {}),
    expiresAt: now + STATE_TTL_MS,
  };
  stmts().insertState.run({
    nonce: payload.nonce,
    intent: payload.intent,
    workspaceId: payload.workspaceId ?? null,
    returnTo: payload.returnTo ?? null,
    expiresAt: payload.expiresAt,
    createdAt: new Date(now).toISOString(),
  });
  const unsigned = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${unsigned}.${sign(unsigned)}`;
}

export function consumeGbpOAuthState(state: string): GbpOAuthStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid Google Business Profile OAuth state');
  }
  const [unsigned, signature] = parts;
  if (!unsigned || !signature || !safeCompare(signature, sign(unsigned))) {
    throw new Error('Invalid Google Business Profile OAuth state');
  }
  const payload = parseJsonSafe(
    Buffer.from(unsigned, 'base64url').toString('utf8'),
    payloadSchema,
    null,
    { table: 'google_business_profile_oauth_states', field: 'state' },
  );
  if (!payload || payload.intent !== STATE_INTENT) {
    throw new Error('Invalid Google Business Profile OAuth state intent');
  }
  if (payload.expiresAt < Date.now()) {
    throw new Error('Expired Google Business Profile OAuth state');
  }
  const row = stmts().getState.get(payload.nonce) as OAuthStateRow | undefined;
  if (!row || row.intent !== STATE_INTENT || row.consumed_at || row.expires_at < Date.now()) {
    throw new Error('Replayed or expired Google Business Profile OAuth state');
  }
  const result = stmts().consumeState.run(new Date().toISOString(), payload.nonce);
  if (result.changes !== 1) {
    throw new Error('Replayed Google Business Profile OAuth state');
  }
  return payload;
}
