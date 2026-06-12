import crypto from 'crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT_MIN = 14000;
const PORT_MAX = 14999;
const PORT_RANGE_SIZE = PORT_MAX - PORT_MIN + 1;
const LOCK_DIR = path.join(os.tmpdir(), 'asset-dashboard-test-port-locks');

const reservedPorts = new Map<string, { port: number; lockPath: string }>();

mkdirSync(LOCK_DIR, { recursive: true });

function normalizeTestId(testId: string): string {
  if (testId.startsWith('file://')) return fileURLToPath(testId);
  return path.resolve(testId);
}

function hashToOffset(input: string): number {
  const hash = crypto.createHash('sha256').update(input).digest();
  return hash.readUInt32BE(0) % PORT_RANGE_SIZE;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearStaleLock(lockPath: string): void {
  if (!existsSync(lockPath)) return;

  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number' && !isProcessAlive(lock.pid)) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    rmSync(lockPath, { force: true });
  }
}

function writeLock(lockPath: string, testId: string): void {
  const fd = openSync(lockPath, 'wx');
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, testId }), 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function reserveIntegrationTestPort(testId: string): number {
  const normalizedTestId = normalizeTestId(testId);
  const existing = reservedPorts.get(normalizedTestId);
  if (existing) return existing.port;

  const offset = hashToOffset(normalizedTestId);

  for (let i = 0; i < PORT_RANGE_SIZE; i += 1) {
    const port = PORT_MIN + ((offset + i) % PORT_RANGE_SIZE);
    const lockPath = path.join(LOCK_DIR, `${port}.json`);

    clearStaleLock(lockPath);

    try {
      writeLock(lockPath, normalizedTestId);
      reservedPorts.set(normalizedTestId, { port, lockPath });
      return port;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue;
      throw error;
    }
  }

  throw new Error(`No free integration test ports available in ${PORT_MIN}-${PORT_MAX}`);
}

export function releaseIntegrationTestPort(testId: string): void {
  const normalizedTestId = normalizeTestId(testId);
  const reservation = reservedPorts.get(normalizedTestId);
  if (!reservation) return;

  rmSync(reservation.lockPath, { force: true });
  reservedPorts.delete(normalizedTestId);
}

export function isIntegrationTestPortReserved(testId: string): boolean {
  return reservedPorts.has(normalizeTestId(testId));
}

function releaseReservedPorts(): void {
  for (const { lockPath } of reservedPorts.values()) {
    rmSync(lockPath, { force: true });
  }
  reservedPorts.clear();
}

process.once('exit', releaseReservedPorts);
