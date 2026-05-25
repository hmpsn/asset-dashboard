import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FsNode =
  | { kind: 'dir'; mtimeMs: number }
  | { kind: 'file'; mtimeMs: number; content: Buffer };

const mocks = vi.hoisted(() => {
  const nodes = new Map<string, FsNode>();

  const dbExec = vi.fn((sql: string) => {
    const match = sql.match(/VACUUM INTO '(.+)'$/);
    if (!match) return;
    const backupPath = normalizePath(match[1].replace(/''/g, "'"));
    ensureDir(parentDir(backupPath));
    writeFile(backupPath, Buffer.alloc(100));
  });

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const createLogger = vi.fn(() => logger);

  const getUploadRoot = vi.fn(() => '/uploads-root');

  const dbVerify = {
    pragma: vi.fn(() => [{ integrity_check: 'ok' }]),
    prepare: vi.fn((sql: string) => {
      if (sql.includes("sqlite_master")) {
        return {
          all: vi.fn(() => [{ name: 'workspaces' }, { name: 'activities' }]),
        };
      }
      if (sql.includes('"workspaces"')) {
        return { get: vi.fn(() => ({ c: 5 })) };
      }
      if (sql.includes('"activities"')) {
        return { get: vi.fn(() => ({ c: 13 })) };
      }
      return { get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => []) };
    }),
    close: vi.fn(),
  };

  const databaseCtor = vi.fn(function DatabaseMock() {
    return dbVerify;
  });

  const s3Send = vi.fn(async (command: { input?: unknown; constructor: { name: string } }) => {
    if (command.constructor.name === 'ListObjectsV2Command') {
      return {
        Contents: [
          { Key: 'backups/backup-old.tar.gz', LastModified: new Date('2026-05-01T00:00:00.000Z') },
          { Key: 'backups/backup-new.tar.gz', LastModified: new Date('2026-05-25T11:59:00.000Z') },
        ],
      };
    }
    return {};
  });

  const S3Client = vi.fn(class S3ClientMock {
    send = s3Send;

    constructor(_config: unknown) {
      // no-op: constructor args are asserted via vi.fn call tracking
    }
  });

  class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }

  class ListObjectsV2Command {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }

  class DeleteObjectsCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }

  const execSync = vi.fn((command: string) => {
    const match = command.match(/tar -czf "([^"]+)"/);
    if (match) {
      const archivePath = normalizePath(match[1]);
      ensureDir(parentDir(archivePath));
      writeFile(archivePath, Buffer.from('archive-bytes'));
    }
  });

  function normalizePath(inputPath: string): string {
    const normalized = inputPath.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalized.length > 1 && normalized.endsWith('/')) {
      return normalized.slice(0, -1);
    }
    return normalized || '/';
  }

  function parentDir(inputPath: string): string {
    const normalized = normalizePath(inputPath);
    if (normalized === '/') return '/';
    const idx = normalized.lastIndexOf('/');
    if (idx <= 0) return '/';
    return normalized.slice(0, idx);
  }

  function ensureDir(inputDir: string): void {
    const dir = normalizePath(inputDir);
    if (nodes.has(dir) && nodes.get(dir)?.kind === 'dir') return;
    if (dir !== '/') ensureDir(parentDir(dir));
    nodes.set(dir, { kind: 'dir', mtimeMs: Date.now() });
  }

  function writeFile(filePath: string, content: Buffer): void {
    const normalized = normalizePath(filePath);
    ensureDir(parentDir(normalized));
    nodes.set(normalized, { kind: 'file', content: Buffer.from(content), mtimeMs: Date.now() });
  }

  function getNode(path: string): FsNode | undefined {
    return nodes.get(normalizePath(path));
  }

  function resetFs(): void {
    nodes.clear();
    nodes.set('/', { kind: 'dir', mtimeMs: Date.now() });
  }

  function seedDir(dirPath: string): void {
    ensureDir(dirPath);
  }

  function seedFile(filePath: string, content: string | Buffer, mtimeMs = Date.now()): void {
    const data = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    writeFile(filePath, data);
    const node = nodes.get(normalizePath(filePath));
    if (node && node.kind === 'file') {
      node.mtimeMs = mtimeMs;
    }
  }

  const fsApi = {
    existsSync: vi.fn((inputPath: string) => !!getNode(inputPath)),
    mkdirSync: vi.fn((inputPath: string) => {
      ensureDir(inputPath);
      return undefined;
    }),
    readdirSync: vi.fn((inputPath: string, options?: { withFileTypes?: boolean }) => {
      const dir = normalizePath(inputPath);
      if (!getNode(dir) || getNode(dir)?.kind !== 'dir') {
        throw new Error(`ENOENT: no such directory: ${dir}`);
      }

      const prefix = dir === '/' ? '/' : `${dir}/`;
      const children = new Map<string, 'dir' | 'file'>();

      for (const [fullPath, node] of nodes.entries()) {
        if (!fullPath.startsWith(prefix) || fullPath === dir) continue;
        const rest = fullPath.slice(prefix.length);
        if (!rest || rest.includes('/')) {
          const childName = rest.split('/')[0];
          if (childName) {
            children.set(childName, node.kind === 'dir' || rest.includes('/') ? 'dir' : 'file');
          }
          continue;
        }
        children.set(rest, node.kind);
      }

      const names = Array.from(children.keys()).sort();
      if (options?.withFileTypes) {
        return names.map((name) => {
          const kind = children.get(name) === 'dir' ? 'dir' : 'file';
          return {
            name,
            isDirectory: () => kind === 'dir',
            isFile: () => kind === 'file',
          };
        });
      }
      return names;
    }),
    copyFileSync: vi.fn((src: string, dest: string) => {
      const srcNode = getNode(src);
      if (!srcNode || srcNode.kind !== 'file') {
        throw new Error(`ENOENT: no such file: ${src}`);
      }
      writeFile(dest, srcNode.content);
    }),
    statSync: vi.fn((inputPath: string) => {
      const node = getNode(inputPath);
      if (!node) throw new Error(`ENOENT: no such file or directory: ${inputPath}`);
      if (node.kind === 'file') {
        return { size: node.content.length, mtimeMs: node.mtimeMs };
      }
      return { size: 0, mtimeMs: node.mtimeMs };
    }),
    writeFileSync: vi.fn((filePath: string, data: string | Buffer) => {
      const content = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
      writeFile(filePath, content);
    }),
    readFileSync: vi.fn((filePath: string) => {
      const node = getNode(filePath);
      if (!node || node.kind !== 'file') throw new Error(`ENOENT: no such file: ${filePath}`);
      return Buffer.from(node.content);
    }),
    unlinkSync: vi.fn((filePath: string) => {
      const normalized = normalizePath(filePath);
      if (!nodes.has(normalized)) throw new Error(`ENOENT: ${filePath}`);
      nodes.delete(normalized);
    }),
    rmSync: vi.fn((targetPath: string) => {
      const normalized = normalizePath(targetPath);
      nodes.delete(normalized);
      for (const fullPath of Array.from(nodes.keys())) {
        if (fullPath.startsWith(`${normalized}/`)) {
          nodes.delete(fullPath);
        }
      }
    }),
  };

  return {
    fsApi,
    resetFs,
    seedDir,
    seedFile,
    getNode,
    dbExec,
    createLogger,
    logger,
    getUploadRoot,
    databaseCtor,
    dbVerify,
    s3Send,
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
    execSync,
  };
});

vi.mock('fs', () => ({
  default: mocks.fsApi,
  ...mocks.fsApi,
}));

vi.mock('child_process', () => ({
  execSync: mocks.execSync,
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    exec: mocks.dbExec,
  },
}));

vi.mock('better-sqlite3', () => ({
  default: mocks.databaseCtor,
}));

vi.mock('../../server/data-dir.js', () => ({
  DATA_BASE: '/data-base',
  getUploadRoot: mocks.getUploadRoot,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: mocks.createLogger,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: mocks.S3Client,
  PutObjectCommand: mocks.PutObjectCommand,
  ListObjectsV2Command: mocks.ListObjectsV2Command,
  DeleteObjectsCommand: mocks.DeleteObjectsCommand,
}));

describe('server/backup behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

    vi.clearAllMocks();
    vi.resetModules();

    mocks.resetFs();
    mocks.seedDir('/uploads-root');
    mocks.seedDir('/backups-root');

    process.env.BACKUP_DIR = '/backups-root';
    process.env.BACKUP_RETENTION_DAYS = '3';
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.BACKUP_S3_REGION;
    delete process.env.BACKUP_S3_PREFIX;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_RETENTION_DAYS;
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.BACKUP_S3_REGION;
    delete process.env.BACKUP_S3_PREFIX;
  });

  it('runBackup (local) creates backup dir, copies uploads (excluding optimized), vacuums DB, writes manifest, and returns stats', async () => {
    mocks.seedDir('/uploads-root/workspace-a');
    mocks.seedDir('/uploads-root/workspace-a/optimized');
    mocks.seedDir('/uploads-root/workspace-a/docs');

    mocks.seedFile('/uploads-root/workspace-a/logo.png', Buffer.alloc(12));
    mocks.seedFile('/uploads-root/workspace-a/optimized/logo.webp', Buffer.alloc(7));
    mocks.seedFile('/uploads-root/workspace-a/docs/brief.pdf', Buffer.alloc(20));

    const backup = await import('../../server/backup.js');
    const result = await backup.runBackup();

    expect(result.backupDir).toBe('/backups-root/backup-2026-05-25T12-00-00');
    expect(result.files).toBe(3);
    expect(result.bytes).toBe(132);

    expect(mocks.dbExec).toHaveBeenCalledWith("VACUUM INTO '/backups-root/backup-2026-05-25T12-00-00/dashboard.db'");
    expect(mocks.databaseCtor).toHaveBeenCalledWith('/backups-root/backup-2026-05-25T12-00-00/dashboard.db', { readonly: true });

    const copiedSources = mocks.fsApi.copyFileSync.mock.calls.map(([src]) => String(src));
    expect(copiedSources).toContain('/uploads-root/workspace-a/logo.png');
    expect(copiedSources).toContain('/uploads-root/workspace-a/docs/brief.pdf');
    expect(copiedSources.some((src) => src.includes('/optimized/'))).toBe(false);

    const manifestCall = mocks.fsApi.writeFileSync.mock.calls.find(([filePath]) => String(filePath).endsWith('/_manifest.json'));
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(String(manifestCall?.[1]));
    expect(manifest).toMatchObject({
      files: 3,
      bytes: 132,
      verified: true,
      tableCounts: {
        workspaces: 5,
        activities: 13,
      },
    });
  });

  it('startBackupScheduler runs after startup delay and again on 24h interval', async () => {
    const backup = await import('../../server/backup.js');

    backup.startBackupScheduler();

    expect(mocks.dbExec).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(mocks.dbExec).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.dbExec).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(mocks.dbExec).toHaveBeenCalledTimes(2);
  });

  it('startBackupScheduler is idempotent across duplicate startup calls', async () => {
    const backup = await import('../../server/backup.js');

    backup.startBackupScheduler();
    backup.startBackupScheduler();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.dbExec).toHaveBeenCalledTimes(1);
  });

  it('runBackup with S3 bucket uploads archive and attempts prune via S3 client commands', async () => {
    process.env.BACKUP_S3_BUCKET = 'bucket-test';
    process.env.BACKUP_S3_REGION = 'us-west-2';
    process.env.BACKUP_S3_PREFIX = 'backups';

    mocks.seedDir('/uploads-root/workspace-b');
    mocks.seedFile('/uploads-root/workspace-b/image.png', Buffer.alloc(9));

    const backup = await import('../../server/backup.js');
    await backup.runBackup();

    expect(mocks.execSync).toHaveBeenCalledTimes(1);
    expect(mocks.execSync.mock.calls[0][0]).toContain('tar -czf');

    expect(mocks.S3Client).toHaveBeenCalledWith({ region: 'us-west-2' });
    expect(mocks.s3Send).toHaveBeenCalled();

    const sentCommandNames = mocks.s3Send.mock.calls.map(([cmd]) => cmd.constructor.name);
    expect(sentCommandNames).toContain('PutObjectCommand');
    expect(sentCommandNames).toContain('ListObjectsV2Command');
    expect(sentCommandNames).toContain('DeleteObjectsCommand');

    const putCall = mocks.s3Send.mock.calls.find(([cmd]) => cmd.constructor.name === 'PutObjectCommand');
    expect(putCall?.[0].input).toMatchObject({
      Bucket: 'bucket-test',
      Key: expect.stringMatching(/^backups\/backup-2026-05-25T12-00-00\.tar\.gz$/),
      ContentType: 'application/gzip',
    });

    expect(mocks.fsApi.unlinkSync).toHaveBeenCalledWith('/backups-root/backup-2026-05-25T12-00-00.tar.gz');
  });

  it('runBackup degrades gracefully when SQLite VACUUM fails', async () => {
    mocks.seedDir('/uploads-root/workspace-c');
    mocks.seedFile('/uploads-root/workspace-c/logo.png', Buffer.alloc(12));

    mocks.dbExec.mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });

    const backup = await import('../../server/backup.js');
    const result = await backup.runBackup();

    // Upload file still copied; DB file not counted.
    expect(result.files).toBe(1);
    expect(result.bytes).toBe(12);

    const manifestCall = mocks.fsApi.writeFileSync.mock.calls.find(([filePath]) => String(filePath).endsWith('/_manifest.json'));
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(String(manifestCall?.[1]));
    expect(manifest.verified).toBe(false);
    expect(manifest.tableCounts).toEqual({});
  });

  it('runBackup marks manifest unverified when integrity check is not ok', async () => {
    mocks.seedDir('/uploads-root/workspace-d');
    mocks.seedFile('/uploads-root/workspace-d/logo.png', Buffer.alloc(10));

    mocks.dbVerify.pragma.mockReturnValueOnce([{ integrity_check: 'not ok' }]);

    const backup = await import('../../server/backup.js');
    const result = await backup.runBackup();

    expect(result.files).toBe(2);
    expect(result.bytes).toBe(110);

    const manifestCall = mocks.fsApi.writeFileSync.mock.calls.find(([filePath]) => String(filePath).endsWith('/_manifest.json'));
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(String(manifestCall?.[1]));
    expect(manifest.verified).toBe(false);
    expect(manifest.tableCounts).toEqual({});
  });

  it('runBackup continues successfully when S3 upload fails', async () => {
    process.env.BACKUP_S3_BUCKET = 'bucket-test';
    process.env.BACKUP_S3_REGION = 'us-west-2';
    process.env.BACKUP_S3_PREFIX = 'backups';

    mocks.seedDir('/uploads-root/workspace-e');
    mocks.seedFile('/uploads-root/workspace-e/image.png', Buffer.alloc(9));

    mocks.s3Send.mockImplementationOnce(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'PutObjectCommand') {
        throw new Error('S3 unavailable');
      }
      return {};
    });

    const backup = await import('../../server/backup.js');
    const result = await backup.runBackup();

    expect(result.backupDir).toBe('/backups-root/backup-2026-05-25T12-00-00');
    // upload file + dashboard.db are still counted before S3 stage
    expect(result.files).toBe(2);
    expect(result.bytes).toBe(109);
    expect(mocks.fsApi.unlinkSync).toHaveBeenCalledWith('/backups-root/backup-2026-05-25T12-00-00.tar.gz');
  });
});
