import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type HandlerHook =
  | 'useWorkspaceEvents'
  | 'useGlobalAdminEvents'
  | 'useWsInvalidation'
  | 'unknown';

export interface HandlerRegistration {
  eventName: string;
  file: string;
  hook: HandlerHook;
}

export interface FrontendHandlerCollection {
  handlers: Map<string, string[]>;
  registrations: HandlerRegistration[];
}

export function collectFiles(dir: string, exts: readonly string[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) {
    return results;
  }

  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

export function parseConstObjectEntries(source: string, constName: string): Map<string, string> {
  const entries = new Map<string, string>();
  const blockMatch = source.match(new RegExp(`export\\s+const\\s+${constName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as\\s+const`));
  if (!blockMatch) {
    return entries;
  }

  const entryRe = /^\s+([A-Z][A-Z0-9_]+)\s*:\s*['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(blockMatch[1])) !== null) {
    entries.set(match[1], match[2]);
  }

  return entries;
}

export function parseWsEvents(source: string): Map<string, string> {
  return parseConstObjectEntries(source, 'WS_EVENTS');
}

export function parseWsEventKeys(source: string): Set<string> {
  return new Set(parseWsEvents(source).keys());
}

export function parseWsEventValues(source: string, opts: { subtractAdminEvents?: boolean } = {}): Set<string> {
  const values = new Set(parseWsEvents(source).values());
  if (opts.subtractAdminEvents) {
    for (const value of parseConstObjectEntries(source, 'ADMIN_EVENTS').values()) {
      values.delete(value);
    }
  }
  return values;
}

export function parseCoveredWsEventKeys(source: string): Set<string> {
  const covered = new Set<string>();
  const handlerRe = /\[WS_EVENTS\.([A-Z][A-Z0-9_]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = handlerRe.exec(source)) !== null) {
    covered.add(match[1]);
  }
  return covered;
}

export function collectServerBroadcasts(root: string, wsEventsMap: Map<string, string>): Map<string, string[]> {
  const serverDir = path.join(root, 'server');
  const files = collectFiles(serverDir, ['.ts']);
  const broadcasts = new Map<string, string[]>();

  const record = (eventName: string, file: string): void => {
    const rel = path.relative(root, file);
    const existing = broadcasts.get(eventName) ?? [];
    existing.push(rel);
    broadcasts.set(eventName, existing);
  };

  const callRe = /broadcastToWorkspace\s*\([^,]+,\s*([^,)]+)/g;
  const aliasCallRe = /(?:_broadcastFn\?\.\s*\(|_broadcastFn\s*\(|_broadcast\s*\()\s*[a-zA-Z_$][a-zA-Z0-9_$.]*\s*,\s*([^,)]+)/g;

  function processMatch(raw: string, file: string): void {
    if (raw.startsWith('WS_EVENTS.')) {
      const key = raw.slice('WS_EVENTS.'.length);
      const value = wsEventsMap.get(key);
      record(value ?? `UNRESOLVED:${raw}`, file);
      return;
    }

    if (raw.startsWith("'") || raw.startsWith('"') || raw.startsWith('`')) {
      const literal = raw.replace(/^['"`]|['"`]$/g, '');
      if (literal.length > 0) {
        record(literal, file);
      }
    }
  }

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    let match: RegExpExecArray | null;

    callRe.lastIndex = 0;
    while ((match = callRe.exec(content)) !== null) {
      processMatch(match[1].trim(), file);
    }

    aliasCallRe.lastIndex = 0;
    while ((match = aliasCallRe.exec(content)) !== null) {
      processMatch(match[1].trim(), file);
    }
  }

  return broadcasts;
}

export function collectFrontendHandlers(root: string, frontendWsEventsMap: Map<string, string>): FrontendHandlerCollection {
  const srcDir = path.join(root, 'src');
  const files = collectFiles(srcDir, ['.ts', '.tsx']);
  const handlers = new Map<string, string[]>();
  const registrations: HandlerRegistration[] = [];

  const record = (eventName: string, file: string, hook: HandlerHook): void => {
    const rel = path.relative(root, file);
    const existing = handlers.get(eventName) ?? [];
    existing.push(rel);
    handlers.set(eventName, existing);
    registrations.push({ eventName, file: rel, hook });
  };

  const computedKeyRe = /\[WS_EVENTS\.([A-Z_]+)\]/g;
  const literalKeyRe = /['"]([a-z][a-z0-9_:-]+)['"]\s*:/g;

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const usesWorkspaceEvents = content.includes('useWorkspaceEvents');
    const usesGlobalAdminEvents = content.includes('useGlobalAdminEvents');
    const usesWsInvalidation = content.includes('useWsInvalidation');
    const usesWsHook = usesWorkspaceEvents || usesGlobalAdminEvents || usesWsInvalidation;
    if (!usesWsHook) {
      continue;
    }

    const hook: HandlerHook = usesWorkspaceEvents
      ? 'useWorkspaceEvents'
      : usesGlobalAdminEvents
        ? 'useGlobalAdminEvents'
        : usesWsInvalidation
          ? 'useWsInvalidation'
          : 'unknown';

    let match: RegExpExecArray | null;

    computedKeyRe.lastIndex = 0;
    while ((match = computedKeyRe.exec(content)) !== null) {
      const key = match[1];
      const value = frontendWsEventsMap.get(key);
      record(value ?? `UNRESOLVED:WS_EVENTS.${key}`, file, hook);
    }

    literalKeyRe.lastIndex = 0;
    while ((match = literalKeyRe.exec(content)) !== null) {
      const literal = match[1];
      if (literal.includes(':') && !literal.endsWith(':') && !literal.startsWith('/')) {
        record(literal, file, hook);
      }
    }
  }

  return { handlers, registrations };
}
