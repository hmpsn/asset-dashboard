#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

import { runTenantBoundaryAuditCli } from './platform-tenant-boundary-audit.js';

function runCli(): void {
  process.exit(runTenantBoundaryAuditCli(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
