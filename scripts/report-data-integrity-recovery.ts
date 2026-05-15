#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

import { runDataIntegrityRecoveryReport } from './platform-data-integrity-recovery.js';

function runCli(): void {
  const exitCode = runDataIntegrityRecoveryReport(process.argv.slice(2));
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

