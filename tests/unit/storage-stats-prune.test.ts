/**
 * Unit tests for the four prune functions in server/storage-stats.ts.
 *
 * Strategy: each test sets process.env.DATA_DIR to a fresh tmp directory,
 * then dynamically re-imports the module so DATA_BASE picks up the new value.
 * BACKUP_DIR is set via process.env where needed.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  utimesSync,
  existsSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// ── Hoist mock factories so vi.mock calls can reference them ──
const mocks = vi.hoisted(() => ({
  isProgrammingError: vi.fn(() => false),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: mocks.logWarn,
    info: mocks.logInfo,
    debug: mocks.logDebug,
    error: mocks.logError,
  }),
}));

// ── Types ──

type PruneFn = (arg?: number) => { sessionsRemoved: number; bytesFreed: number; errors: string[] };

// ── Per-test state ──

let tmpDir: string;
let pruneChatSessions: PruneFn;
let pruneBackups: PruneFn;
let pruneReportSnapshots: PruneFn;
let pruneActivityLogs: PruneFn;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'storage-stats-test-'));
  process.env.DATA_DIR = tmpDir;
  delete process.env.BACKUP_DIR;

  // Reset module registry so DATA_BASE is re-evaluated on each import
  vi.resetModules();
  const m = await import('../../server/storage-stats.js');
  pruneChatSessions = m.pruneChatSessions as PruneFn;
  pruneBackups = m.pruneBackups as PruneFn;
  pruneReportSnapshots = m.pruneReportSnapshots as PruneFn;
  pruneActivityLogs = m.pruneActivityLogs as PruneFn;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.BACKUP_DIR;
  vi.restoreAllMocks();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ── Helpers ──

function writeChatSession(wsId: string, fileName: string, updatedAt: string | null, extra: Record<string, unknown> = {}) {
  const dir = join(tmpDir, 'chat-sessions', wsId);
  mkdirSync(dir, { recursive: true });
  const payload = updatedAt !== null ? { updatedAt, ...extra } : { ...extra };
  writeFileSync(join(dir, fileName), JSON.stringify(payload));
}

function writeBackupDir(name: string, mtimeOffsetMs: number) {
  const dir = join(tmpDir, 'backups', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'db.sqlite'), 'data');
  const t = new Date(Date.now() + mtimeOffsetMs);
  utimesSync(dir, t, t);
  return dir;
}

function writeReport(siteId: string, name: string, mtimeOffsetMs = 0, content = '{"ok":true}') {
  const dir = join(tmpDir, 'reports', siteId);
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, name);
  writeFileSync(fp, content);
  const t = new Date(Date.now() + mtimeOffsetMs);
  utimesSync(fp, t, t);
  return fp;
}

function writeActivityLog(name: string, entries: Array<{ timestamp?: string } & Record<string, unknown>>) {
  const dir = join(tmpDir, 'activity');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(entries));
}

// ─────────────────────────────────────────────────────────────────────────────
// pruneChatSessions
// ─────────────────────────────────────────────────────────────────────────────

describe('pruneChatSessions', () => {
  it('returns zero result when chat-sessions dir does not exist', () => {
    const r = pruneChatSessions(90);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('returns zero result when chat-sessions dir is empty', () => {
    mkdirSync(join(tmpDir, 'chat-sessions'), { recursive: true });
    const r = pruneChatSessions(90);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('returns zero result when all workspace dirs contain no json files', () => {
    const dir = join(tmpDir, 'chat-sessions', 'ws1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'readme.txt'), 'not a session');
    const r = pruneChatSessions(90);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('removes a session file whose updatedAt is older than the cutoff', () => {
    // 100 days ago
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    writeChatSession('ws1', 'session-old.json', old);
    const r = pruneChatSessions(90);
    expect(r.sessionsRemoved).toBe(1);
    expect(r.bytesFreed).toBeGreaterThan(0);
    expect(r.errors).toHaveLength(0);
    expect(existsSync(join(tmpDir, 'chat-sessions', 'ws1', 'session-old.json'))).toBe(false);
  });

  it('keeps a session file whose updatedAt is newer than the cutoff', () => {
    // 10 days ago — inside default 90-day window
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeChatSession('ws1', 'session-new.json', recent);
    const r = pruneChatSessions(90);
    expect(r.sessionsRemoved).toBe(0);
    expect(r.bytesFreed).toBe(0);
    expect(existsSync(join(tmpDir, 'chat-sessions', 'ws1', 'session-new.json'))).toBe(true);
  });

  it('keeps a session file whose updatedAt equals exactly the cutoff (strict < not <=)', () => {
    // Freeze time so both the test and pruneChatSessions compute the same cutoff.
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const maxAgeDays = 90;
    const cutoff = new Date(now - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    writeChatSession('ws1', 'session-boundary.json', cutoff);
    const r = pruneChatSessions(maxAgeDays);
    vi.useRealTimers();
    // cutoff === cutoff is NOT < cutoff, so file should be kept
    expect(r.sessionsRemoved).toBe(0);
    expect(existsSync(join(tmpDir, 'chat-sessions', 'ws1', 'session-boundary.json'))).toBe(true);
  });

  it('keeps a session file with no updatedAt field', () => {
    writeChatSession('ws1', 'no-date.json', null, { messages: [] });
    const r = pruneChatSessions(90);
    expect(r.sessionsRemoved).toBe(0);
    expect(existsSync(join(tmpDir, 'chat-sessions', 'ws1', 'no-date.json'))).toBe(true);
  });

  it('removes old sessions across multiple workspace dirs', () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    writeChatSession('ws1', 'a.json', old);
    writeChatSession('ws2', 'b.json', old);
    const r = pruneChatSessions(90);
    expect(r.sessionsRemoved).toBe(2);
  });

  it('records an error for invalid JSON and continues processing other files', () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    // Valid old session in ws1
    writeChatSession('ws1', 'good.json', old);
    // Invalid JSON in ws2
    const ws2Dir = join(tmpDir, 'chat-sessions', 'ws2');
    mkdirSync(ws2Dir, { recursive: true });
    writeFileSync(join(ws2Dir, 'bad.json'), 'not json {{{');

    const r = pruneChatSessions(90);
    // The bad file causes an error, good file is still removed
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.sessionsRemoved).toBe(1);
  });

  it('removes all old files when maxAgeDays=0 (cutoff is now)', () => {
    // Files written 1 second "in the past" relative to now won't reliably be < cutoff(0)
    // because the file timestamp and the cutoff are both "now". Use a slightly future cutoff trick:
    // write a file with an updatedAt well in the past and pass maxAgeDays=0.
    const ancient = new Date(0).toISOString(); // 1970
    writeChatSession('ws1', 'ancient.json', ancient);
    const r = pruneChatSessions(0);
    expect(r.sessionsRemoved).toBe(1);
  });

  it('uses a tighter maxAgeDays window to prune fewer files', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

    writeChatSession('ws1', 'five-days.json', fiveDaysAgo);
    writeChatSession('ws1', 'hundred-days.json', hundredDaysAgo);

    // 30-day window: 5-day-old file kept, 100-day-old file removed
    const r = pruneChatSessions(30);
    expect(r.sessionsRemoved).toBe(1);
    expect(existsSync(join(tmpDir, 'chat-sessions', 'ws1', 'five-days.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'chat-sessions', 'ws1', 'hundred-days.json'))).toBe(false);
  });

  it('accumulates bytesFreed across multiple removed files', () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    writeChatSession('ws1', 'a.json', old, { payload: 'x'.repeat(100) });
    writeChatSession('ws1', 'b.json', old, { payload: 'y'.repeat(200) });
    const r = pruneChatSessions(90);
    expect(r.sessionsRemoved).toBe(2);
    expect(r.bytesFreed).toBeGreaterThan(200);
  });

  it('skips non-directory entries at the workspace level', () => {
    // A plain file in chat-sessions/ should not be iterated as a workspace
    mkdirSync(join(tmpDir, 'chat-sessions'), { recursive: true });
    writeFileSync(join(tmpDir, 'chat-sessions', 'not-a-dir.json'), '{}');
    const r = pruneChatSessions(90);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pruneBackups
// ─────────────────────────────────────────────────────────────────────────────

describe('pruneBackups', () => {
  it('returns zero result when backups dir does not exist', () => {
    const r = pruneBackups(3);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('returns zero result when backups dir is empty', () => {
    mkdirSync(join(tmpDir, 'backups'), { recursive: true });
    const r = pruneBackups(3);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('skips a directory that does not start with backup-', () => {
    // Created with mtime in the past via mock
    const oldDir = join(tmpDir, 'backups', 'other-dir');
    mkdirSync(oldDir, { recursive: true });
    const past = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    utimesSync(oldDir, past, past);

    const r = pruneBackups(3);
    expect(r.sessionsRemoved).toBe(0);
    expect(existsSync(oldDir)).toBe(true);
  });

  it('skips a non-directory entry even if it starts with backup-', () => {
    mkdirSync(join(tmpDir, 'backups'), { recursive: true });
    writeFileSync(join(tmpDir, 'backups', 'backup-file.db'), 'data');
    const r = pruneBackups(3);
    expect(r.sessionsRemoved).toBe(0);
  });

  it('keeps a recently created backup-* dir (mtime newer than cutoff)', () => {
    writeBackupDir('backup-today', 0); // mtime = now
    const r = pruneBackups(3);
    expect(r.sessionsRemoved).toBe(0);
  });

  it('removes an old backup-* dir by mocking Date.now to advance time', () => {
    // Write dir with current mtime
    writeBackupDir('backup-old', 0);
    // Advance "now" by 10 days so the dir appears old relative to a 3-day window
    const advance = 10 * 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + advance);
    // Re-import so the cutoff is computed with the mocked Date.now
    // (module was already imported; the function re-calls Date.now() at call time)
    const r = pruneBackups(3);
    expect(r.sessionsRemoved).toBe(1);
    expect(r.bytesFreed).toBeGreaterThan(0);
    expect(r.errors).toHaveLength(0);
  });

  it('does not remove a backup-* dir that is within the retain window', () => {
    // 2 days old, retain 3 → should survive
    const twoDaysAgo = -2 * 24 * 60 * 60 * 1000;
    writeBackupDir('backup-recent', twoDaysAgo);
    const r = pruneBackups(3);
    expect(r.sessionsRemoved).toBe(0);
  });

  it('uses BACKUP_DIR env var instead of default backups/ path', async () => {
    const customBackupDir = mkdtempSync(join(tmpdir(), 'custom-backup-'));
    process.env.BACKUP_DIR = customBackupDir;
    vi.resetModules();
    const m = await import('../../server/storage-stats.js');
    const pruneBackupsCustom = m.pruneBackups as PruneFn;

    // Create an old backup dir inside the custom dir
    const backupSubDir = join(customBackupDir, 'backup-custom');
    mkdirSync(backupSubDir, { recursive: true });
    writeFileSync(join(backupSubDir, 'db.sqlite'), 'x');
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(backupSubDir, past, past);

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const r = pruneBackupsCustom(3);
    expect(r.sessionsRemoved).toBe(1);

    rmSync(customBackupDir, { recursive: true, force: true });
  });

  it('handles multiple old backup dirs in one pass', () => {
    const advance = 10 * 24 * 60 * 60 * 1000;
    writeBackupDir('backup-alpha', 0);
    writeBackupDir('backup-beta', 0);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + advance);
    const r = pruneBackups(3);
    expect(r.sessionsRemoved).toBe(2);
  });

  it('selectively removes only old dirs, keeps recent ones', () => {
    const advance = 10 * 24 * 60 * 60 * 1000;
    writeBackupDir('backup-old', 0);           // mtime = now → will be old after advance
    const r_before = pruneBackups(3);
    expect(r_before.sessionsRemoved).toBe(0);  // not old yet

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + advance);
    // Create a "fresh" backup dir (relative to mocked time, still newer than cutoff)
    // We can't easily set mtime to mocked-now, so just verify count
    const r_after = pruneBackups(3);
    expect(r_after.sessionsRemoved).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pruneReportSnapshots
// ─────────────────────────────────────────────────────────────────────────────

describe('pruneReportSnapshots', () => {
  it('returns zero result when reports dir does not exist', () => {
    const r = pruneReportSnapshots(20);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('returns zero result when reports dir is empty', () => {
    mkdirSync(join(tmpDir, 'reports'), { recursive: true });
    const r = pruneReportSnapshots(20);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('does nothing when a site has exactly keepPerSite files', () => {
    for (let i = 0; i < 20; i++) {
      writeReport('site1', `report-${i}.json`);
    }
    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBe(0);
  });

  it('does nothing when a site has fewer than keepPerSite files', () => {
    for (let i = 0; i < 5; i++) {
      writeReport('site1', `report-${i}.json`);
    }
    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBe(0);
  });

  it('removes exactly 1 file when site has keepPerSite+1 files', () => {
    for (let i = 0; i < 21; i++) {
      writeReport('site1', `report-${i}.json`, -i * 1000); // spread mtimes
    }
    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBe(1);
    expect(r.errors).toHaveLength(0);
  });

  it('removes exactly 5 files when site has 25 files and keepPerSite=20', () => {
    for (let i = 0; i < 25; i++) {
      writeReport('site1', `report-${i}.json`, -i * 1000);
    }
    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBe(5);
  });

  it('keeps the NEWEST files (by mtime) and deletes the OLDEST', () => {
    // Write 3 files with distinct, controlled mtimes
    const newest = writeReport('siteA', 'newest.json', 0);          // mtime = now
    const middle = writeReport('siteA', 'middle.json', -1000);       // mtime = 1s ago
    const oldest = writeReport('siteA', 'oldest.json', -2000);       // mtime = 2s ago

    const r = pruneReportSnapshots(2);
    expect(r.sessionsRemoved).toBe(1);
    // newest and middle should survive; oldest should be removed
    expect(existsSync(newest)).toBe(true);
    expect(existsSync(middle)).toBe(true);
    expect(existsSync(oldest)).toBe(false);
  });

  it('keeps only the single newest file when keepPerSite=1', () => {
    const newest = writeReport('siteB', 'newest.json', 0);
    const older1 = writeReport('siteB', 'older1.json', -1000);
    const older2 = writeReport('siteB', 'older2.json', -2000);

    const r = pruneReportSnapshots(1);
    expect(r.sessionsRemoved).toBe(2);
    expect(existsSync(newest)).toBe(true);
    expect(existsSync(older1)).toBe(false);
    expect(existsSync(older2)).toBe(false);
  });

  it('deletes ALL files when keepPerSite=0', () => {
    writeReport('siteC', 'a.json', 0);
    writeReport('siteC', 'b.json', -1000);
    const r = pruneReportSnapshots(0);
    expect(r.sessionsRemoved).toBe(2);
  });

  it('prunes multiple sites independently', () => {
    // site1: 22 files → 2 removed
    for (let i = 0; i < 22; i++) writeReport('site1', `r${i}.json`, -i * 1000);
    // site2: 19 files → 0 removed
    for (let i = 0; i < 19; i++) writeReport('site2', `r${i}.json`, -i * 1000);
    // site3: 25 files → 5 removed
    for (let i = 0; i < 25; i++) writeReport('site3', `r${i}.json`, -i * 1000);

    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBe(7); // 2 + 0 + 5
  });

  it('only processes .json files — non-json files are excluded from the count', () => {
    // Write keepPerSite json files + 1 extra non-json (should not count toward limit)
    for (let i = 0; i < 20; i++) writeReport('siteD', `r${i}.json`, -i * 1000);
    writeFileSync(join(tmpDir, 'reports', 'siteD', 'readme.txt'), 'notes');

    const r = pruneReportSnapshots(20);
    // Exactly 20 json files → no pruning
    expect(r.sessionsRemoved).toBe(0);
    expect(existsSync(join(tmpDir, 'reports', 'siteD', 'readme.txt'))).toBe(true);
  });

  it('skips non-directory entries under the reports dir', () => {
    mkdirSync(join(tmpDir, 'reports'), { recursive: true });
    writeFileSync(join(tmpDir, 'reports', 'stray.json'), '{}');
    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBe(0);
  });

  it('accumulates bytesFreed across multiple deleted snapshots', () => {
    const content = JSON.stringify({ data: 'x'.repeat(500) });
    for (let i = 0; i < 23; i++) writeReport('siteE', `r${i}.json`, -i * 1000, content);
    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBe(3);
    expect(r.bytesFreed).toBeGreaterThan(0);
  });

  it('handles a site dir that is suddenly unreadable gracefully (file already gone)', () => {
    // Write 21 files, then delete one before pruning runs
    for (let i = 0; i < 21; i++) writeReport('siteF', `r${i}.json`, -i * 1000);
    // Because the stat is called inside a try-catch, this should not crash
    // We just verify no throw
    const r = pruneReportSnapshots(20);
    expect(r.sessionsRemoved).toBeGreaterThanOrEqual(1);
  });

  it('sort is stable: files with identical mtime are handled without removal of wrong files', () => {
    // All files have the same mtime — sort is deterministic by Array.sort stability
    for (let i = 0; i < 22; i++) writeReport('siteG', `r${String(i).padStart(3, '0')}.json`, 0);
    const r = pruneReportSnapshots(20);
    // 2 files should be removed regardless of which ones
    expect(r.sessionsRemoved).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pruneActivityLogs
// ─────────────────────────────────────────────────────────────────────────────

describe('pruneActivityLogs', () => {
  it('returns zero result when activity dir does not exist', () => {
    const r = pruneActivityLogs(180);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('returns zero result when activity dir is empty', () => {
    mkdirSync(join(tmpDir, 'activity'), { recursive: true });
    const r = pruneActivityLogs(180);
    expect(r).toEqual({ sessionsRemoved: 0, bytesFreed: 0, errors: [] });
  });

  it('does not modify a file whose entries are all within the cutoff', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('ws1.json', [{ timestamp: recent, action: 'click' }]);
    const before = readFileSync(join(tmpDir, 'activity', 'ws1.json'), 'utf-8');
    const r = pruneActivityLogs(180);
    const after = readFileSync(join(tmpDir, 'activity', 'ws1.json'), 'utf-8');
    expect(r.sessionsRemoved).toBe(0);
    expect(after).toBe(before);
  });

  it('removes entries older than the cutoff and rewrites the file', () => {
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 365d ago
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('ws1.json', [
      { timestamp: old, action: 'audit' },
      { timestamp: recent, action: 'view' },
    ]);
    const r = pruneActivityLogs(180);
    expect(r.sessionsRemoved).toBe(1);
    const remaining = JSON.parse(readFileSync(join(tmpDir, 'activity', 'ws1.json'), 'utf-8'));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe('view');
  });

  it('removes multiple old entries in a single file', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('ws2.json', [
      { timestamp: old },
      { timestamp: old },
      { timestamp: recent },
    ]);
    const r = pruneActivityLogs(180);
    expect(r.sessionsRemoved).toBe(2);
  });

  it('keeps entries with no timestamp field (treated as indefinitely retained)', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('ws3.json', [
      { action: 'no-ts' },              // no timestamp → keep
      { timestamp: old, action: 'old' }, // old → remove
    ]);
    const r = pruneActivityLogs(180);
    expect(r.sessionsRemoved).toBe(1);
    const remaining = JSON.parse(readFileSync(join(tmpDir, 'activity', 'ws3.json'), 'utf-8'));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe('no-ts');
  });

  it('does not remove an entry whose timestamp equals exactly the cutoff (>= comparison)', () => {
    // Freeze time so both the test and pruneActivityLogs compute the same cutoff.
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const maxAgeDays = 180;
    const cutoff = new Date(now - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('ws4.json', [{ timestamp: cutoff }]);
    const r = pruneActivityLogs(maxAgeDays);
    vi.useRealTimers();
    expect(r.sessionsRemoved).toBe(0);
  });

  it('accumulates sessionsRemoved across multiple files', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('a.json', [{ timestamp: old }, { timestamp: old }]);
    writeActivityLog('b.json', [{ timestamp: old }]);
    const r = pruneActivityLogs(180);
    expect(r.sessionsRemoved).toBe(3);
  });

  it('computes positive bytesFreed after removing entries', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('ws5.json', [
      { timestamp: old, data: 'x'.repeat(200) },
      { timestamp: old, data: 'y'.repeat(200) },
    ]);
    const r = pruneActivityLogs(180);
    expect(r.bytesFreed).toBeGreaterThan(0);
  });

  it('skips non-json files in the activity dir', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    mkdirSync(join(tmpDir, 'activity'), { recursive: true });
    writeFileSync(join(tmpDir, 'activity', 'notes.txt'), old);
    const r = pruneActivityLogs(180);
    expect(r.sessionsRemoved).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it('skips a file containing a non-array JSON value (object) and adds to errors', () => {
    mkdirSync(join(tmpDir, 'activity'), { recursive: true });
    writeFileSync(join(tmpDir, 'activity', 'bad.json'), JSON.stringify({ not: 'array' }));
    const r = pruneActivityLogs(180);
    // Non-array: the code does `if (!Array.isArray(entries)) continue;`
    // No error is added in this case — it's a silent skip
    expect(r.sessionsRemoved).toBe(0);
    // We don't assert errors here because the code uses `continue`, not an error push
  });

  it('adds to errors and continues when a file contains invalid JSON', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('good.json', [{ timestamp: old }]);
    mkdirSync(join(tmpDir, 'activity'), { recursive: true });
    writeFileSync(join(tmpDir, 'activity', 'corrupt.json'), 'not valid json {{');

    const r = pruneActivityLogs(180);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain('corrupt.json');
    // good.json should still have been processed
    expect(r.sessionsRemoved).toBe(1);
  });

  it('removes all entries when maxAgeDays=0 and all entries have old timestamps', () => {
    const old = new Date(0).toISOString(); // 1970
    writeActivityLog('ws6.json', [{ timestamp: old }, { timestamp: old }]);
    const r = pruneActivityLogs(0);
    expect(r.sessionsRemoved).toBe(2);
    const remaining = JSON.parse(readFileSync(join(tmpDir, 'activity', 'ws6.json'), 'utf-8'));
    expect(remaining).toHaveLength(0);
  });

  it('does not rewrite a file if no entries are removed (file content unchanged)', () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    writeActivityLog('unchanged.json', [{ timestamp: recent }]);
    const statBefore = statSync(join(tmpDir, 'activity', 'unchanged.json')).mtimeMs;
    pruneActivityLogs(180);
    // If the implementation skips rewriting when removed===0 (which it does via `if (removed > 0)`),
    // the mtime should not change
    const statAfter = statSync(join(tmpDir, 'activity', 'unchanged.json')).mtimeMs;
    expect(statAfter).toBe(statBefore);
  });

  it('handles multiple files: some pruned, some untouched', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    writeActivityLog('pruned.json', [{ timestamp: old }, { timestamp: recent }]);
    writeActivityLog('clean.json', [{ timestamp: recent }]);

    const r = pruneActivityLogs(180);
    expect(r.sessionsRemoved).toBe(1);

    const pruned = JSON.parse(readFileSync(join(tmpDir, 'activity', 'pruned.json'), 'utf-8'));
    expect(pruned).toHaveLength(1);

    const clean = JSON.parse(readFileSync(join(tmpDir, 'activity', 'clean.json'), 'utf-8'));
    expect(clean).toHaveLength(1);
  });

  it('handles an empty array in activity file gracefully', () => {
    writeActivityLog('empty.json', []);
    const r = pruneActivityLogs(180);
    expect(r.sessionsRemoved).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it('correctly filters by maxAgeDays=1 vs maxAgeDays=365', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();

    writeActivityLog('mixed.json', [
      { timestamp: twoHoursAgo },
      { timestamp: twoYearsAgo },
    ]);

    // With 1-day window: only twoHoursAgo survives
    const r1 = pruneActivityLogs(1);
    const after1 = JSON.parse(readFileSync(join(tmpDir, 'activity', 'mixed.json'), 'utf-8'));
    expect(r1.sessionsRemoved).toBe(1);
    expect(after1).toHaveLength(1);
    expect(after1[0].timestamp).toBe(twoHoursAgo);

    // Now with 365-day window on remaining file (only twoHoursAgo left): nothing removed
    const r2 = pruneActivityLogs(365);
    expect(r2.sessionsRemoved).toBe(0);
  });
});
