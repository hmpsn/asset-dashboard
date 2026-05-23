/**
 * Unit tests for server/db/migrate-json.ts
 *
 * Strategy:
 * - vi.hoisted + vi.mock intercept getDataDir/getUploadRoot to point at a
 *   per-test temp directory, so migrations never touch real data.
 * - vi.mock on db/index.js keeps the REAL db singleton but stubs runMigrations
 *   so the module-level call is a no-op.
 * - vi.isolateModules re-executes the script per test scenario.
 * - Assertions query the real (test) SQLite database.
 * - afterEach DELETEs rows by tmig-* prefix, keeping tests isolated.
 */

import fs from 'fs';
import path from 'path';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// ── Hoisted mock state ────────────────────────────────────────────────────────

const mockPaths = vi.hoisted(() => ({ data: '', uploads: '' }));

vi.mock('../../../server/data-dir.js', () => ({
  getDataDir: (subdir: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const np = require('node:path') as typeof path;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nf = require('node:fs') as typeof fs;
    const dir = subdir
      ? np.join(mockPaths.data, subdir)
      : mockPaths.data;
    nf.mkdirSync(dir, { recursive: true });
    return dir;
  },
  getUploadRoot: () => mockPaths.uploads,
  DATA_BASE: '',
}));

vi.mock('../../../server/db/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../server/db/index.js')>(
    '../../../server/db/index.js',
  );
  return { ...actual, runMigrations: vi.fn(), default: actual.default };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runMigration(): Promise<void> {
  vi.resetModules();
  await import('../../../server/db/migrate-json.js');
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'mig-test-'));
  mockPaths.data = path.join(tmpRoot, 'data');
  mockPaths.uploads = path.join(tmpRoot, 'uploads');
  mkdirSync(mockPaths.data, { recursive: true });
  mkdirSync(mockPaths.uploads, { recursive: true });
});

// Import db AFTER mocks are registered (module is already loaded by the time
// the test body runs, so we import it at module level after vi.mock).
const { default: db } = await import('../../../server/db/index.js');

afterEach(() => {
  db.prepare("DELETE FROM users WHERE id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM client_users WHERE id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM payments WHERE id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM activity_log WHERE id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM requests WHERE id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM workspaces WHERE id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM page_edit_states WHERE workspace_id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM seo_edit_tracking WHERE workspace_id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM roi_snapshots WHERE workspace_id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM rank_tracking_config WHERE workspace_id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM rank_snapshots WHERE workspace_id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM recommendation_sets WHERE workspace_id LIKE 'tmig-%'").run();
  db.prepare("DELETE FROM audit_schedules WHERE workspace_id LIKE 'tmig-%'").run();
  // Clean up temp fixture files so each test starts fresh
  try {
    fs.rmSync(path.join(mockPaths.data, 'auth'), { recursive: true, force: true });
    fs.rmSync(path.join(mockPaths.data, 'payments'), { recursive: true, force: true });
    fs.rmSync(path.join(mockPaths.data, 'recommendations'), { recursive: true, force: true });
    fs.rmSync(path.join(mockPaths.data, 'roi-history'), { recursive: true, force: true });
    fs.rmSync(path.join(mockPaths.uploads, '.activity-log.json'), { force: true });
    fs.rmSync(path.join(mockPaths.uploads, '.requests.json'), { force: true });
    fs.rmSync(path.join(mockPaths.uploads, '.workspaces.json'), { force: true });
    fs.rmSync(path.join(mockPaths.uploads, '.audit-schedules.json'), { force: true });
    // Clean per-workspace dirs from uploadRoot
    for (const entry of fs.readdirSync(mockPaths.uploads)) {
      const p = path.join(mockPaths.uploads, entry);
      try {
        if (fs.statSync(p).isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
});

// ═══════════════════════════════════════════════════════════════════
// migrateUsers
// ═══════════════════════════════════════════════════════════════════

describe('migrateUsers', () => {
  it('tmig-usr-001: inserts a user with correct camelCase → snake_case field mapping', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'users.json'), [
      {
        id: 'tmig-usr-001',
        email: 'alice@example.com',
        name: 'Alice',
        passwordHash: 'hash123',
        role: 'admin',
        workspaceIds: ['ws-a', 'ws-b'],
        avatarUrl: 'https://cdn.example.com/alice.png',
        lastLoginAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-06-01T00:00:00.000Z',
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT * FROM users WHERE id = 'tmig-usr-001'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['email']).toBe('alice@example.com');
    expect(row['name']).toBe('Alice');
    expect(row['password_hash']).toBe('hash123');
    expect(row['role']).toBe('admin');
    expect(row['workspace_ids']).toBe('["ws-a","ws-b"]');
    expect(row['avatar_url']).toBe('https://cdn.example.com/alice.png');
    expect(row['last_login_at']).toBe('2026-01-01T00:00:00.000Z');
    expect(row['created_at']).toBe('2025-01-01T00:00:00.000Z');
  });

  it('tmig-usr-002: returns 0 and does not crash when users.json is absent', async () => {
    // No file written
    await expect(runMigration()).resolves.toBeUndefined();
    const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-usr-003: returns 0 and does not crash when users.json contains invalid JSON', async () => {
    fs.mkdirSync(path.join(mockPaths.data, 'auth'), { recursive: true });
    fs.writeFileSync(path.join(mockPaths.data, 'auth', 'users.json'), '{ NOT VALID JSON }');

    await expect(runMigration()).resolves.toBeUndefined();
    const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-usr-004: returns 0 when users.json is a non-array object', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'users.json'), { id: 'tmig-usr-004', name: 'Not an array' });

    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-usr-005: role defaults to "member" when absent from record', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'users.json'), [
      {
        id: 'tmig-usr-005',
        email: 'bob@example.com',
        name: 'Bob',
        passwordHash: 'hash',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT role FROM users WHERE id = 'tmig-usr-005'").get() as { role: string };
    expect(row.role).toBe('member');
  });

  it('tmig-usr-006: workspaceIds serialized as a JSON array string', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'users.json'), [
      {
        id: 'tmig-usr-006',
        email: 'carol@example.com',
        name: 'Carol',
        passwordHash: 'hash',
        workspaceIds: ['ws-x'],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT workspace_ids FROM users WHERE id = 'tmig-usr-006'").get() as { workspace_ids: string };
    expect(row.workspace_ids).toBe('["ws-x"]');
  });

  it('tmig-usr-007: second run inserts 0 rows (idempotent)', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'users.json'), [
      {
        id: 'tmig-usr-007',
        email: 'dan@example.com',
        name: 'Dan',
        passwordHash: 'hash',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE id = 'tmig-usr-007'").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('tmig-usr-008: optional fields avatarUrl and lastLoginAt stored as null when absent', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'users.json'), [
      {
        id: 'tmig-usr-008',
        email: 'eve@example.com',
        name: 'Eve',
        passwordHash: 'hash',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT avatar_url, last_login_at FROM users WHERE id = 'tmig-usr-008'").get() as Record<string, unknown>;
    expect(row['avatar_url']).toBeNull();
    expect(row['last_login_at']).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateClientUsers
// ═══════════════════════════════════════════════════════════════════

describe('migrateClientUsers', () => {
  it('tmig-cu-001: inserts a client user with correct field mapping', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'client-users.json'), [
      {
        id: 'tmig-cu-001',
        email: 'client@example.com',
        name: 'Client One',
        passwordHash: 'clienthash',
        role: 'client_admin',
        workspaceId: 'ws-client',
        avatarUrl: null,
        invitedBy: 'admin-user',
        lastLoginAt: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT * FROM client_users WHERE id = 'tmig-cu-001'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['email']).toBe('client@example.com');
    expect(row['role']).toBe('client_admin');
    expect(row['workspace_id']).toBe('ws-client');
    expect(row['invited_by']).toBe('admin-user');
  });

  it('tmig-cu-002: role defaults to "client_member" when absent', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'client-users.json'), [
      {
        id: 'tmig-cu-002',
        email: 'client2@example.com',
        name: 'Client Two',
        passwordHash: 'hash',
        workspaceId: 'ws-client',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT role FROM client_users WHERE id = 'tmig-cu-002'").get() as { role: string };
    expect(row.role).toBe('client_member');
  });

  it('tmig-cu-003: returns 0 when client-users.json is absent', async () => {
    // No file
    await expect(runMigration()).resolves.toBeUndefined();
    const count = db.prepare("SELECT COUNT(*) as c FROM client_users WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-cu-004: second run inserts 0 rows (idempotent)', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'client-users.json'), [
      {
        id: 'tmig-cu-004',
        email: 'client4@example.com',
        name: 'Client Four',
        passwordHash: 'hash',
        workspaceId: 'ws-client',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM client_users WHERE id = 'tmig-cu-004'").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('tmig-cu-005: invitedBy stored as null when absent', async () => {
    writeJson(path.join(mockPaths.data, 'auth', 'client-users.json'), [
      {
        id: 'tmig-cu-005',
        email: 'client5@example.com',
        name: 'Client Five',
        passwordHash: 'hash',
        workspaceId: 'ws-client',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT invited_by FROM client_users WHERE id = 'tmig-cu-005'").get() as { invited_by: unknown };
    expect(row.invited_by).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// migratePayments
// ═══════════════════════════════════════════════════════════════════

describe('migratePayments', () => {
  it('tmig-pay-001: inserts a payment with correct field mapping', async () => {
    writeJson(path.join(mockPaths.data, 'payments', 'ws-pay.json'), [
      {
        id: 'tmig-pay-001',
        workspaceId: 'ws-pay',
        stripeSessionId: 'cs_123',
        stripePaymentIntentId: 'pi_123',
        productType: 'seo-audit',
        amount: 4900,
        currency: 'usd',
        status: 'paid',
        contentRequestId: 'cr-001',
        metadata: { plan: 'growth' },
        createdAt: '2025-01-01T00:00:00.000Z',
        paidAt: '2025-01-02T00:00:00.000Z',
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT * FROM payments WHERE id = 'tmig-pay-001'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['stripe_session_id']).toBe('cs_123');
    expect(row['stripe_payment_intent_id']).toBe('pi_123');
    expect(row['product_type']).toBe('seo-audit');
    expect(row['amount']).toBe(4900);
    expect(row['status']).toBe('paid');
    expect(row['content_request_id']).toBe('cr-001');
    expect(row['paid_at']).toBe('2025-01-02T00:00:00.000Z');
  });

  it('tmig-pay-002: workspace_id falls back to filename when r.workspaceId absent', async () => {
    writeJson(path.join(mockPaths.data, 'payments', 'ws-from-filename.json'), [
      {
        id: 'tmig-pay-002',
        stripeSessionId: 'cs_fallback',
        productType: 'seo-audit',
        amount: 100,
        currency: 'usd',
        status: 'pending',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT workspace_id FROM payments WHERE id = 'tmig-pay-002'").get() as { workspace_id: string };
    expect(row.workspace_id).toBe('ws-from-filename');
  });

  it('tmig-pay-003: workspace_id from record overrides filename when present', async () => {
    writeJson(path.join(mockPaths.data, 'payments', 'ws-filename.json'), [
      {
        id: 'tmig-pay-003',
        workspaceId: 'ws-from-record',
        stripeSessionId: 'cs_override',
        productType: 'seo-audit',
        amount: 100,
        currency: 'usd',
        status: 'pending',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT workspace_id FROM payments WHERE id = 'tmig-pay-003'").get() as { workspace_id: string };
    expect(row.workspace_id).toBe('ws-from-record');
  });

  it('tmig-pay-004: metadata serialized to JSON string when present, null when absent', async () => {
    writeJson(path.join(mockPaths.data, 'payments', 'ws-meta.json'), [
      {
        id: 'tmig-pay-004a',
        workspaceId: 'ws-meta',
        stripeSessionId: 'cs_meta_a',
        productType: 'audit',
        amount: 100,
        currency: 'usd',
        status: 'paid',
        metadata: { key: 'val' },
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'tmig-pay-004b',
        workspaceId: 'ws-meta',
        stripeSessionId: 'cs_meta_b',
        productType: 'audit',
        amount: 50,
        currency: 'usd',
        status: 'pending',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const a = db.prepare("SELECT metadata FROM payments WHERE id = 'tmig-pay-004a'").get() as { metadata: string };
    const b = db.prepare("SELECT metadata FROM payments WHERE id = 'tmig-pay-004b'").get() as { metadata: unknown };
    expect(a.metadata).toBe('{"key":"val"}');
    expect(b.metadata).toBeNull();
  });

  it('tmig-pay-005: missing payments directory inserts 0 records', async () => {
    // payments dir is created by getDataDir mock but has no files
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM payments WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-pay-006: invalid JSON file is skipped (continues to next file)', async () => {
    fs.mkdirSync(path.join(mockPaths.data, 'payments'), { recursive: true });
    fs.writeFileSync(path.join(mockPaths.data, 'payments', 'ws-bad.json'), 'NOT JSON');
    writeJson(path.join(mockPaths.data, 'payments', 'ws-good.json'), [
      {
        id: 'tmig-pay-006',
        workspaceId: 'ws-good',
        stripeSessionId: 'cs_good',
        productType: 'audit',
        amount: 100,
        currency: 'usd',
        status: 'paid',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM payments WHERE id = 'tmig-pay-006'").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('tmig-pay-007: second run inserts 0 rows (idempotent)', async () => {
    writeJson(path.join(mockPaths.data, 'payments', 'ws-idem.json'), [
      {
        id: 'tmig-pay-007',
        workspaceId: 'ws-idem',
        stripeSessionId: 'cs_idem',
        productType: 'audit',
        amount: 100,
        currency: 'usd',
        status: 'paid',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM payments WHERE id = 'tmig-pay-007'").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateActivityLog
// ═══════════════════════════════════════════════════════════════════

describe('migrateActivityLog', () => {
  it('tmig-alog-001: inserts activity log entry with correct field mapping', async () => {
    writeJson(path.join(mockPaths.uploads, '.activity-log.json'), [
      {
        id: 'tmig-alog-001',
        workspaceId: 'ws-alog',
        type: 'workspace.updated',
        title: 'Workspace updated',
        description: 'Settings changed',
        metadata: { field: 'name' },
        actorId: 'user-1',
        actorName: 'Alice',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT * FROM activity_log WHERE id = 'tmig-alog-001'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['workspace_id']).toBe('ws-alog');
    expect(row['type']).toBe('workspace.updated');
    expect(row['title']).toBe('Workspace updated');
    expect(row['description']).toBe('Settings changed');
    expect(row['actor_id']).toBe('user-1');
    expect(row['actor_name']).toBe('Alice');
  });

  it('tmig-alog-002: metadata serialized to JSON string', async () => {
    writeJson(path.join(mockPaths.uploads, '.activity-log.json'), [
      {
        id: 'tmig-alog-002',
        workspaceId: 'ws-alog',
        type: 'test',
        title: 'Test',
        metadata: { key: 'value', count: 3 },
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT metadata FROM activity_log WHERE id = 'tmig-alog-002'").get() as { metadata: string };
    expect(JSON.parse(row.metadata)).toEqual({ key: 'value', count: 3 });
  });

  it('tmig-alog-003: missing file returns 0 records', async () => {
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM activity_log WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-alog-004: invalid JSON returns 0 records', async () => {
    fs.writeFileSync(path.join(mockPaths.uploads, '.activity-log.json'), 'NOT JSON');
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM activity_log WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-alog-005: non-array JSON returns 0 records', async () => {
    writeJson(path.join(mockPaths.uploads, '.activity-log.json'), { id: 'not-array' });
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM activity_log WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-alog-006: optional fields actorId, actorName, description stored as null when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.activity-log.json'), [
      {
        id: 'tmig-alog-006',
        workspaceId: 'ws-alog',
        type: 'test',
        title: 'Minimal Entry',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT actor_id, actor_name, description FROM activity_log WHERE id = 'tmig-alog-006'").get() as Record<string, unknown>;
    expect(row['actor_id']).toBeNull();
    expect(row['actor_name']).toBeNull();
    expect(row['description']).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateRequests
// ═══════════════════════════════════════════════════════════════════

describe('migrateRequests', () => {
  it('tmig-req-001: inserts a request with correct field mapping', async () => {
    writeJson(path.join(mockPaths.uploads, '.requests.json'), [
      {
        id: 'tmig-req-001',
        workspaceId: 'ws-req',
        title: 'Fix H1',
        description: 'The H1 is missing',
        category: 'seo',
        priority: 'high',
        status: 'in-progress',
        submittedBy: 'client-user-1',
        pageUrl: 'https://example.com/',
        pageId: 'page-abc',
        attachments: [{ name: 'screenshot.png' }],
        notes: [{ text: 'First note' }],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-02-01T00:00:00.000Z',
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT * FROM requests WHERE id = 'tmig-req-001'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['workspace_id']).toBe('ws-req');
    expect(row['title']).toBe('Fix H1');
    expect(row['category']).toBe('seo');
    expect(row['priority']).toBe('high');
    expect(row['status']).toBe('in-progress');
    expect(row['submitted_by']).toBe('client-user-1');
    expect(row['page_url']).toBe('https://example.com/');
    expect(row['page_id']).toBe('page-abc');
  });

  it('tmig-req-002: priority defaults to "medium" and status defaults to "new" when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.requests.json'), [
      {
        id: 'tmig-req-002',
        workspaceId: 'ws-req',
        title: 'Req Defaults',
        description: 'Testing defaults',
        category: 'content',
        notes: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT priority, status FROM requests WHERE id = 'tmig-req-002'").get() as { priority: string; status: string };
    expect(row.priority).toBe('medium');
    expect(row.status).toBe('new');
  });

  it('tmig-req-003: notes serialized to "[]" when absent from record', async () => {
    writeJson(path.join(mockPaths.uploads, '.requests.json'), [
      {
        id: 'tmig-req-003',
        workspaceId: 'ws-req',
        title: 'No Notes',
        description: 'No notes field',
        category: 'content',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const row = db.prepare("SELECT notes FROM requests WHERE id = 'tmig-req-003'").get() as { notes: string };
    expect(row.notes).toBe('[]');
  });

  it('tmig-req-004: attachments serialized to JSON when present, null when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.requests.json'), [
      {
        id: 'tmig-req-004a',
        workspaceId: 'ws-req',
        title: 'With Attachments',
        description: 'Has attachments',
        category: 'content',
        attachments: [{ name: 'file.pdf' }],
        notes: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'tmig-req-004b',
        workspaceId: 'ws-req',
        title: 'No Attachments',
        description: 'Has no attachments',
        category: 'content',
        notes: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    const a = db.prepare("SELECT attachments FROM requests WHERE id = 'tmig-req-004a'").get() as { attachments: string };
    const b = db.prepare("SELECT attachments FROM requests WHERE id = 'tmig-req-004b'").get() as { attachments: unknown };
    expect(a.attachments).toBe('[{"name":"file.pdf"}]');
    expect(b.attachments).toBeNull();
  });

  it('tmig-req-005: missing .requests.json returns 0 records', async () => {
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM requests WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-req-006: second run inserts 0 rows (idempotent)', async () => {
    writeJson(path.join(mockPaths.uploads, '.requests.json'), [
      {
        id: 'tmig-req-006',
        workspaceId: 'ws-req',
        title: 'Idempotent',
        description: 'Same run',
        category: 'seo',
        notes: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await runMigration();
    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM requests WHERE id = 'tmig-req-006'").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateWorkspaces — highest priority
// ═══════════════════════════════════════════════════════════════════

describe('migrateWorkspaces', () => {
  function baseWorkspace(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id,
      name: 'Test Workspace',
      folder: 'test-folder',
      createdAt: '2025-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('tmig-ws-001: inserts a workspace with correct basic field mapping', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-001', {
        webflowSiteId: 'site-abc',
        clientEmail: 'client@example.com',
        liveDomain: 'https://example.com',
        tier: 'growth',
      }),
    ]);

    await runMigration();

    const row = db.prepare("SELECT * FROM workspaces WHERE id = 'tmig-ws-001'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['name']).toBe('Test Workspace');
    expect(row['webflow_site_id']).toBe('site-abc');
    expect(row['client_email']).toBe('client@example.com');
    expect(row['live_domain']).toBe('https://example.com');
    expect(row['tier']).toBe('growth');
  });

  it('tmig-ws-002: clientPortalEnabled === undefined → null in DB', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-002'),
    ]);

    await runMigration();
    const row = db.prepare("SELECT client_portal_enabled FROM workspaces WHERE id = 'tmig-ws-002'").get() as { client_portal_enabled: unknown };
    expect(row.client_portal_enabled).toBeNull();
  });

  it('tmig-ws-003: clientPortalEnabled === true → 1 in DB', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-003', { clientPortalEnabled: true }),
    ]);

    await runMigration();
    const row = db.prepare("SELECT client_portal_enabled FROM workspaces WHERE id = 'tmig-ws-003'").get() as { client_portal_enabled: unknown };
    expect(row.client_portal_enabled).toBe(1);
  });

  it('tmig-ws-004: clientPortalEnabled === false → 0 in DB', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-004', { clientPortalEnabled: false }),
    ]);

    await runMigration();
    const row = db.prepare("SELECT client_portal_enabled FROM workspaces WHERE id = 'tmig-ws-004'").get() as { client_portal_enabled: unknown };
    expect(row.client_portal_enabled).toBe(0);
  });

  it('tmig-ws-005: seoClientView three-state (undefined→null, true→1, false→0)', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-005a'),
      baseWorkspace('tmig-ws-005b', { seoClientView: true }),
      baseWorkspace('tmig-ws-005c', { seoClientView: false }),
    ]);

    await runMigration();

    const a = db.prepare("SELECT seo_client_view FROM workspaces WHERE id = 'tmig-ws-005a'").get() as { seo_client_view: unknown };
    const b = db.prepare("SELECT seo_client_view FROM workspaces WHERE id = 'tmig-ws-005b'").get() as { seo_client_view: unknown };
    const c = db.prepare("SELECT seo_client_view FROM workspaces WHERE id = 'tmig-ws-005c'").get() as { seo_client_view: unknown };

    expect(a.seo_client_view).toBeNull();
    expect(b.seo_client_view).toBe(1);
    expect(c.seo_client_view).toBe(0);
  });

  it('tmig-ws-006: analyticsClientView three-state', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-006a'),
      baseWorkspace('tmig-ws-006b', { analyticsClientView: true }),
      baseWorkspace('tmig-ws-006c', { analyticsClientView: false }),
    ]);

    await runMigration();

    const a = db.prepare("SELECT analytics_client_view FROM workspaces WHERE id = 'tmig-ws-006a'").get() as { analytics_client_view: unknown };
    const b = db.prepare("SELECT analytics_client_view FROM workspaces WHERE id = 'tmig-ws-006b'").get() as { analytics_client_view: unknown };
    const c = db.prepare("SELECT analytics_client_view FROM workspaces WHERE id = 'tmig-ws-006c'").get() as { analytics_client_view: unknown };

    expect(a.analytics_client_view).toBeNull();
    expect(b.analytics_client_view).toBe(1);
    expect(c.analytics_client_view).toBe(0);
  });

  it('tmig-ws-007: autoReports three-state', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-007a'),
      baseWorkspace('tmig-ws-007b', { autoReports: true }),
      baseWorkspace('tmig-ws-007c', { autoReports: false }),
    ]);

    await runMigration();

    const a = db.prepare("SELECT auto_reports FROM workspaces WHERE id = 'tmig-ws-007a'").get() as { auto_reports: unknown };
    const b = db.prepare("SELECT auto_reports FROM workspaces WHERE id = 'tmig-ws-007b'").get() as { auto_reports: unknown };
    const c = db.prepare("SELECT auto_reports FROM workspaces WHERE id = 'tmig-ws-007c'").get() as { auto_reports: unknown };

    expect(a.auto_reports).toBeNull();
    expect(b.auto_reports).toBe(1);
    expect(c.auto_reports).toBe(0);
  });

  it('tmig-ws-008: onboardingEnabled and onboardingCompleted three-state', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-008a', { onboardingEnabled: true, onboardingCompleted: false }),
      baseWorkspace('tmig-ws-008b'),
    ]);

    await runMigration();

    const a = db.prepare("SELECT onboarding_enabled, onboarding_completed FROM workspaces WHERE id = 'tmig-ws-008a'").get() as Record<string, unknown>;
    const b = db.prepare("SELECT onboarding_enabled, onboarding_completed FROM workspaces WHERE id = 'tmig-ws-008b'").get() as Record<string, unknown>;

    expect(a['onboarding_enabled']).toBe(1);
    expect(a['onboarding_completed']).toBe(0);
    expect(b['onboarding_enabled']).toBeNull();
    expect(b['onboarding_completed']).toBeNull();
  });

  it('tmig-ws-009: tier defaults to "free" when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-009'),
    ]);

    await runMigration();
    const row = db.prepare("SELECT tier FROM workspaces WHERE id = 'tmig-ws-009'").get() as { tier: string };
    expect(row.tier).toBe('free');
  });

  it('tmig-ws-010: optional string fields stored as null when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-010'),
    ]);

    await runMigration();
    const row = db.prepare("SELECT webflow_site_id, live_domain, client_email FROM workspaces WHERE id = 'tmig-ws-010'").get() as Record<string, unknown>;
    expect(row['webflow_site_id']).toBeNull();
    expect(row['live_domain']).toBeNull();
    expect(row['client_email']).toBeNull();
  });

  it('tmig-ws-011: JSON fields serialized when present, null when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-011', {
        eventConfig: [{ name: 'click' }],
        competitorDomains: ['competitor.com'],
        personas: [{ name: 'Buyer' }],
      }),
    ]);

    await runMigration();
    const row = db.prepare("SELECT event_config, competitor_domains, personas FROM workspaces WHERE id = 'tmig-ws-011'").get() as Record<string, unknown>;
    expect(JSON.parse(row['event_config'] as string)).toEqual([{ name: 'click' }]);
    expect(JSON.parse(row['competitor_domains'] as string)).toEqual(['competitor.com']);
    expect(JSON.parse(row['personas'] as string)).toEqual([{ name: 'Buyer' }]);
  });

  it('tmig-ws-012: JSON fields stored as null when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-012'),
    ]);

    await runMigration();
    const row = db.prepare("SELECT event_config, competitor_domains, personas FROM workspaces WHERE id = 'tmig-ws-012'").get() as Record<string, unknown>;
    expect(row['event_config']).toBeNull();
    expect(row['competitor_domains']).toBeNull();
    expect(row['personas']).toBeNull();
  });

  it('tmig-ws-013: pageEditStates entries inserted into page_edit_states table', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-013', {
        pageEditStates: {
          'page-abc': {
            slug: '/about',
            status: 'flagged',
            source: 'audit',
            updatedAt: '2025-06-01T00:00:00.000Z',
          },
        },
      }),
    ]);

    await runMigration();

    const row = db.prepare(
      "SELECT * FROM page_edit_states WHERE workspace_id = 'tmig-ws-013' AND page_id = 'page-abc'",
    ).get() as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row['slug']).toBe('/about');
    expect(row['status']).toBe('flagged');
    expect(row['source']).toBe('audit');
    expect(row['updated_at']).toBe('2025-06-01T00:00:00.000Z');
  });

  it('tmig-ws-014: pageEditStates status defaults to "clean" when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-014', {
        pageEditStates: {
          'page-def': {
            slug: '/home',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        },
      }),
    ]);

    await runMigration();

    const row = db.prepare(
      "SELECT status FROM page_edit_states WHERE workspace_id = 'tmig-ws-014' AND page_id = 'page-def'",
    ).get() as { status: string };
    expect(row.status).toBe('clean');
  });

  it('tmig-ws-015: seoEditTracking entries inserted into seo_edit_tracking table', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-015', {
        seoEditTracking: {
          'page-xyz': {
            status: 'edited',
            updatedAt: '2025-06-01T00:00:00.000Z',
            fields: ['seoTitle'],
          },
        },
      }),
    ]);

    await runMigration();

    const row = db.prepare(
      "SELECT * FROM seo_edit_tracking WHERE workspace_id = 'tmig-ws-015' AND page_id = 'page-xyz'",
    ).get() as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row['status']).toBe('edited');
    expect(row['updated_at']).toBe('2025-06-01T00:00:00.000Z');
    expect(JSON.parse(row['fields'] as string)).toEqual(['seoTitle']);
  });

  it('tmig-ws-016: seoEditTracking status defaults to "flagged" when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-016', {
        seoEditTracking: {
          'page-zzz': {
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        },
      }),
    ]);

    await runMigration();

    const row = db.prepare(
      "SELECT status FROM seo_edit_tracking WHERE workspace_id = 'tmig-ws-016' AND page_id = 'page-zzz'",
    ).get() as { status: string };
    expect(row.status).toBe('flagged');
  });

  it('tmig-ws-017: no pageEditStates → nothing inserted into page_edit_states', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-017'),
    ]);

    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM page_edit_states WHERE workspace_id = 'tmig-ws-017'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-ws-018: no seoEditTracking → nothing inserted into seo_edit_tracking', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-018'),
    ]);

    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM seo_edit_tracking WHERE workspace_id = 'tmig-ws-018'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-ws-019: missing .workspaces.json inserts 0 rows', async () => {
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM workspaces WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-ws-020: non-array JSON inserts 0 rows', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), { id: 'not-array' });
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM workspaces WHERE id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-ws-021: second run inserts 0 rows (idempotent)', async () => {
    writeJson(path.join(mockPaths.uploads, '.workspaces.json'), [
      baseWorkspace('tmig-ws-021'),
    ]);

    await runMigration();
    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM workspaces WHERE id = 'tmig-ws-021'").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateRoiHistory
// ═══════════════════════════════════════════════════════════════════

describe('migrateRoiHistory', () => {
  it('tmig-roi-001: uses r.organicTrafficValue when present', async () => {
    // Need workspace to satisfy FK (workspaces table has FK on roi_snapshots)
    // roi_snapshots does NOT have a FK constraint so we can insert directly
    writeJson(path.join(mockPaths.data, 'roi-history', 'tmig-ws-roi.json'), [
      { organicTrafficValue: 12345.67, computedAt: '2025-01-01T00:00:00.000Z' },
    ]);

    await runMigration();

    const row = db.prepare("SELECT organic_traffic_value FROM roi_snapshots WHERE workspace_id = 'tmig-ws-roi'").get() as { organic_traffic_value: number };
    expect(row.organic_traffic_value).toBe(12345.67);
  });

  it('tmig-roi-002: falls back to r.value when organicTrafficValue absent', async () => {
    writeJson(path.join(mockPaths.data, 'roi-history', 'tmig-ws-roi2.json'), [
      { value: 9876.0, computedAt: '2025-01-01T00:00:00.000Z' },
    ]);

    await runMigration();

    const row = db.prepare("SELECT organic_traffic_value FROM roi_snapshots WHERE workspace_id = 'tmig-ws-roi2'").get() as { organic_traffic_value: number };
    expect(row.organic_traffic_value).toBe(9876.0);
  });

  it('tmig-roi-003: defaults to 0 when both organicTrafficValue and value are absent', async () => {
    writeJson(path.join(mockPaths.data, 'roi-history', 'tmig-ws-roi3.json'), [
      { computedAt: '2025-01-01T00:00:00.000Z' },
    ]);

    await runMigration();

    const row = db.prepare("SELECT organic_traffic_value FROM roi_snapshots WHERE workspace_id = 'tmig-ws-roi3'").get() as { organic_traffic_value: number };
    expect(row.organic_traffic_value).toBe(0);
  });

  it('tmig-roi-004: computedAt fallback chain: computedAt → recordedAt → date', async () => {
    writeJson(path.join(mockPaths.data, 'roi-history', 'tmig-ws-roi4.json'), [
      { organicTrafficValue: 100, recordedAt: '2025-03-01T00:00:00.000Z' },
      { organicTrafficValue: 200, date: '2025-04-01' },
    ]);

    await runMigration();

    const rows = db.prepare(
      "SELECT computed_at FROM roi_snapshots WHERE workspace_id = 'tmig-ws-roi4' ORDER BY organic_traffic_value",
    ).all() as Array<{ computed_at: string }>;
    // 2 rows, sorted by organic_traffic_value ascending
    expect(rows.length).toBe(2); // every-ok: length asserted on this line
    expect(rows[0].computed_at).toBe('2025-03-01T00:00:00.000Z');
    expect(rows[1].computed_at).toBe('2025-04-01');
  });

  it('tmig-roi-005: missing roi-history dir inserts 0 records', async () => {
    // directory not created
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM roi_snapshots WHERE workspace_id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateRankTracking
// ═══════════════════════════════════════════════════════════════════

describe('migrateRankTracking', () => {
  it('tmig-rt-001: config inserted using trackedKeywords', async () => {
    const wsDir = path.join(mockPaths.uploads, 'tmig-ws-rt');
    const rtDir = path.join(wsDir, '.rank-tracking');
    fs.mkdirSync(rtDir, { recursive: true });
    writeJson(path.join(rtDir, 'config.json'), {
      trackedKeywords: ['seo tools', 'keyword research'],
    });

    await runMigration();

    const row = db.prepare("SELECT tracked_keywords FROM rank_tracking_config WHERE workspace_id = 'tmig-ws-rt'").get() as { tracked_keywords: string };
    expect(JSON.parse(row.tracked_keywords)).toEqual(['seo tools', 'keyword research']);
  });

  it('tmig-rt-002: config falls back to config.keywords when trackedKeywords absent', async () => {
    const wsDir = path.join(mockPaths.uploads, 'tmig-ws-rt2');
    const rtDir = path.join(wsDir, '.rank-tracking');
    fs.mkdirSync(rtDir, { recursive: true });
    writeJson(path.join(rtDir, 'config.json'), {
      keywords: ['fallback keyword'],
    });

    await runMigration();

    const row = db.prepare("SELECT tracked_keywords FROM rank_tracking_config WHERE workspace_id = 'tmig-ws-rt2'").get() as { tracked_keywords: string };
    expect(JSON.parse(row.tracked_keywords)).toEqual(['fallback keyword']);
  });

  it('tmig-rt-003: snapshots inserted with correct date field', async () => {
    const wsDir = path.join(mockPaths.uploads, 'tmig-ws-rt3');
    const rtDir = path.join(wsDir, '.rank-tracking');
    fs.mkdirSync(rtDir, { recursive: true });
    writeJson(path.join(rtDir, 'snapshots.json'), [
      { date: '2025-01-15', queries: [{ keyword: 'seo', position: 3 }] },
    ]);

    await runMigration();

    const row = db.prepare("SELECT date, queries FROM rank_snapshots WHERE workspace_id = 'tmig-ws-rt3'").get() as { date: string; queries: string };
    expect(row.date).toBe('2025-01-15');
    expect(JSON.parse(row.queries)).toEqual([{ keyword: 'seo', position: 3 }]);
  });

  it('tmig-rt-004: snapshot date fallback uses capturedAt when date absent', async () => {
    const wsDir = path.join(mockPaths.uploads, 'tmig-ws-rt4');
    const rtDir = path.join(wsDir, '.rank-tracking');
    fs.mkdirSync(rtDir, { recursive: true });
    writeJson(path.join(rtDir, 'snapshots.json'), [
      { capturedAt: '2025-02-20', queries: [] },
    ]);

    await runMigration();

    const row = db.prepare("SELECT date FROM rank_snapshots WHERE workspace_id = 'tmig-ws-rt4'").get() as { date: string };
    expect(row.date).toBe('2025-02-20');
  });

  it('tmig-rt-005: workspace without .rank-tracking dir is skipped cleanly', async () => {
    // Create a workspace dir with no .rank-tracking inside
    const wsDir = path.join(mockPaths.uploads, 'tmig-ws-rt5');
    fs.mkdirSync(wsDir, { recursive: true });
    // Some other file but no .rank-tracking
    fs.writeFileSync(path.join(wsDir, '.some-other.json'), '[]');

    await runMigration();

    const count = db.prepare("SELECT COUNT(*) as c FROM rank_tracking_config WHERE workspace_id = 'tmig-ws-rt5'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-rt-006: uploadRoot scan skips non-directory entries', async () => {
    // Write a plain file at uploadRoot level (not a directory)
    fs.writeFileSync(path.join(mockPaths.uploads, 'notadir.txt'), 'text');

    // Should not throw
    await expect(runMigration()).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateRecommendations
// ═══════════════════════════════════════════════════════════════════

describe('migrateRecommendations', () => {
  it('tmig-rec-001: object record inserted correctly', async () => {
    writeJson(path.join(mockPaths.data, 'recommendations', 'tmig-ws-rec.json'), {
      workspaceId: 'tmig-ws-rec',
      generatedAt: '2025-01-01T00:00:00.000Z',
      recommendations: [{ id: 'r1', title: 'Fix metadata' }],
      summary: { totalCount: 1 },
    });

    await runMigration();

    const row = db.prepare("SELECT * FROM recommendation_sets WHERE workspace_id = 'tmig-ws-rec'").get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['generated_at']).toBe('2025-01-01T00:00:00.000Z');
    expect(JSON.parse(row['recommendations'] as string)).toEqual([{ id: 'r1', title: 'Fix metadata' }]);
  });

  it('tmig-rec-002: array input is rejected — Array.isArray guard prevents silent bad insert', async () => {
    // typeof [] === 'object' is true, so the guard must explicitly check Array.isArray.
    // Without it, an array file would be inserted as a record with recommendations='[]'.
    writeJson(path.join(mockPaths.data, 'recommendations', 'tmig-ws-rec2.json'), [
      { id: 'r1', title: 'Rec one' },
    ]);

    await runMigration();

    const row = db.prepare("SELECT recommendations FROM recommendation_sets WHERE workspace_id = 'tmig-ws-rec2'").get();
    expect(row).toBeUndefined();
  });

  it('tmig-rec-003: missing recommendations dir inserts 0 records', async () => {
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM recommendation_sets WHERE workspace_id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('tmig-rec-004: invalid JSON file is skipped (continue to next file)', async () => {
    fs.mkdirSync(path.join(mockPaths.data, 'recommendations'), { recursive: true });
    fs.writeFileSync(path.join(mockPaths.data, 'recommendations', 'tmig-ws-bad.json'), 'NOT JSON');
    writeJson(path.join(mockPaths.data, 'recommendations', 'tmig-ws-good.json'), {
      workspaceId: 'tmig-ws-good',
      generatedAt: '2025-01-01T00:00:00.000Z',
      recommendations: [],
      summary: {},
    });

    await runMigration();

    const good = db.prepare("SELECT COUNT(*) as c FROM recommendation_sets WHERE workspace_id = 'tmig-ws-good'").get() as { c: number };
    expect(good.c).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// migrateAuditSchedules
// ═══════════════════════════════════════════════════════════════════

describe('migrateAuditSchedules', () => {
  it('tmig-as-001: enabled: true → 1 in DB (NOT three-state, unlike workspaces)', async () => {
    writeJson(path.join(mockPaths.uploads, '.audit-schedules.json'), [
      {
        workspaceId: 'tmig-ws-as1',
        enabled: true,
        intervalDays: 14,
        scoreDropThreshold: 5,
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT enabled FROM audit_schedules WHERE workspace_id = 'tmig-ws-as1'").get() as { enabled: number };
    expect(row.enabled).toBe(1);
  });

  it('tmig-as-002: enabled: false → 0 in DB (no NULL path for false unlike workspaces booleans)', async () => {
    writeJson(path.join(mockPaths.uploads, '.audit-schedules.json'), [
      {
        workspaceId: 'tmig-ws-as2',
        enabled: false,
        intervalDays: 7,
        scoreDropThreshold: 5,
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT enabled FROM audit_schedules WHERE workspace_id = 'tmig-ws-as2'").get() as { enabled: number };
    expect(row.enabled).toBe(0);
  });

  it('tmig-as-003: intervalDays defaults to 7 when absent', async () => {
    writeJson(path.join(mockPaths.uploads, '.audit-schedules.json'), [
      {
        workspaceId: 'tmig-ws-as3',
        enabled: true,
        scoreDropThreshold: 5,
      },
    ]);

    await runMigration();

    const row = db.prepare("SELECT interval_days FROM audit_schedules WHERE workspace_id = 'tmig-ws-as3'").get() as { interval_days: number };
    expect(row.interval_days).toBe(7);
  });

  it('tmig-as-004: missing .audit-schedules.json inserts 0 records', async () => {
    await runMigration();
    const count = db.prepare("SELECT COUNT(*) as c FROM audit_schedules WHERE workspace_id LIKE 'tmig-%'").get() as { c: number };
    expect(count.c).toBe(0);
  });
});
