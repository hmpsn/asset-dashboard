import fs from 'fs';
import path from 'path';

import { getDataDir } from './data-dir.js';

export type OperationTraceStatus = 'success' | 'error' | 'warning';

export interface OperationTraceEntry {
  source: 'job' | 'ai' | 'integration' | 'http';
  operation: string;
  status: OperationTraceStatus;
  timestamp: string;
  workspaceId?: string;
  durationMs?: number;
  message?: string;
}

export interface ExternalApiTelemetryEntry {
  provider: 'semrush' | 'dataforseo' | 'google' | 'webflow' | 'other';
  endpoint: string;
  status: 'success' | 'error';
  timestamp: string;
  workspaceId?: string;
  durationMs?: number;
  errorKind?: string;
}

export interface SlowRouteTelemetryEntry {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
  workspaceId?: string;
}

type ObservabilityStream = 'operations' | 'external-api' | 'slow-routes';

type ObservabilityEntryByStream = {
  operations: OperationTraceEntry;
  'external-api': ExternalApiTelemetryEntry;
  'slow-routes': SlowRouteTelemetryEntry;
};

type ReadOptions = {
  workspaceId?: string;
  since?: string;
  days?: number;
};

const OBSERVABILITY_DIR = getDataDir('platform-observability');

const pending: {
  operations: OperationTraceEntry[];
  'external-api': ExternalApiTelemetryEntry[];
  'slow-routes': SlowRouteTelemetryEntry[];
} = {
  operations: [],
  'external-api': [],
  'slow-routes': [],
};

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getStreamFilePath(stream: ObservabilityStream, date = todayStr()): string {
  return path.join(OBSERVABILITY_DIR, `${stream}-${date}.json`);
}

function withTimestamp<T extends { timestamp: string }>(
  input: Omit<T, 'timestamp'> & { timestamp?: string },
): T {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  } as T;
}

function flushStream<K extends ObservabilityStream>(stream: K): void {
  const queue = pending[stream] as ObservabilityEntryByStream[K][];
  if (queue.length === 0) return;

  const filePath = getStreamFilePath(stream);
  let existing: ObservabilityEntryByStream[K][] = [];
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ObservabilityEntryByStream[K][];
  } catch {
    existing = [];
  }

  existing.push(...queue);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  pending[stream] = [] as typeof pending[K];
}

export function flushPlatformObservabilityToDisk(): void {
  flushStream('operations');
  flushStream('external-api');
  flushStream('slow-routes');
}

function enqueue<K extends ObservabilityStream>(stream: K, entry: ObservabilityEntryByStream[K]): void {
  pending[stream].push(entry as never);
  const queueLength = pending.operations.length + pending['external-api'].length + pending['slow-routes'].length;
  if (queueLength >= 30) {
    flushPlatformObservabilityToDisk();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPlatformObservabilityToDisk();
    }, 5_000);
  }
}

export function recordOperationTrace(entry: Omit<OperationTraceEntry, 'timestamp'> & { timestamp?: string }): void {
  enqueue('operations', withTimestamp<OperationTraceEntry>(entry));
}

export function recordExternalApiTelemetry(
  entry: Omit<ExternalApiTelemetryEntry, 'timestamp'> & { timestamp?: string },
): void {
  enqueue('external-api', withTimestamp<ExternalApiTelemetryEntry>(entry));
}

export function recordSlowRouteTelemetry(
  entry: Omit<SlowRouteTelemetryEntry, 'timestamp'> & { timestamp?: string },
): void {
  enqueue('slow-routes', withTimestamp<SlowRouteTelemetryEntry>(entry));
}

function loadStreamFromDisk<K extends ObservabilityStream>(
  stream: K,
  options?: ReadOptions,
): ObservabilityEntryByStream[K][] {
  flushPlatformObservabilityToDisk();

  const cutoffDate = options?.since
    ? options.since.slice(0, 10)
    : options?.days
      ? (() => {
        const date = new Date();
        date.setDate(date.getDate() - options.days!);
        return date.toISOString().slice(0, 10);
      })()
      : '0000';

  try {
    const files = fs.readdirSync(OBSERVABILITY_DIR)
      .filter(file => file.startsWith(`${stream}-`) && file.endsWith('.json'))
      .filter(file => file.slice(stream.length + 1, stream.length + 11) >= cutoffDate)
      .sort();

    const entries: ObservabilityEntryByStream[K][] = [];
    for (const file of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(OBSERVABILITY_DIR, file), 'utf8'));
        if (Array.isArray(parsed)) {
          entries.push(...parsed as ObservabilityEntryByStream[K][]);
        }
      } catch {
        // Ignore malformed files.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function filterByWorkspace<T extends { workspaceId?: string; timestamp: string }>(
  entries: T[],
  options?: ReadOptions,
): T[] {
  const since = options?.since;
  const workspaceId = options?.workspaceId;
  return entries.filter((entry) => {
    if (workspaceId && entry.workspaceId !== workspaceId) return false;
    if (since && entry.timestamp < since) return false;
    return true;
  });
}

export function getOperationTraces(options?: ReadOptions): OperationTraceEntry[] {
  return filterByWorkspace(loadStreamFromDisk('operations', options), options);
}

export function getExternalApiTelemetry(options?: ReadOptions): ExternalApiTelemetryEntry[] {
  return filterByWorkspace(loadStreamFromDisk('external-api', options), options);
}

export function getSlowRouteTelemetry(options?: ReadOptions): SlowRouteTelemetryEntry[] {
  return filterByWorkspace(loadStreamFromDisk('slow-routes', options), options);
}

process.on('beforeExit', flushPlatformObservabilityToDisk);
