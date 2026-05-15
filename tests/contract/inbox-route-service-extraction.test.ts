import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), 'utf8');
}

describe('inbox route-to-service extraction contract', () => {
  it('keeps client action route handlers delegated to inbox domain mutations', () => {
    const route = readSource('server/routes/client-actions.ts'); // readFile-ok - contract guard for route-to-service extraction.
    expect(route).toContain("from '../domains/inbox/client-actions-mutations.js'");
    expect(route).toContain('createAdminClientAction(');
    expect(route).toContain('updateAdminClientAction(');
    expect(route).toContain('respondToPublicClientAction(');
  });
});
