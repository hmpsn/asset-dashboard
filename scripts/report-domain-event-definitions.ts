#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

import {
  buildDomainEventDefinitionsReport,
  formatDomainEventDefinitionsReportAsMarkdown,
} from './platform-domain-event-definitions.js';

function runCli(): void {
  const report = buildDomainEventDefinitionsReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatDomainEventDefinitionsReportAsMarkdown(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
