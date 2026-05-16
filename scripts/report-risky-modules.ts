#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

import { runRiskyModuleDashboardCli } from './platform-risky-module-dashboard.js';

function runCli(): void {
  process.exit(runRiskyModuleDashboardCli(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
