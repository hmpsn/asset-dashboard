#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ADR_DIR = path.resolve(ROOT, 'docs/adr');

const REQUIRED_HEADERS = ['## Decision', '## Context', '## Alternatives Considered', '## Consequences'];

const REQUIRED_TOPICS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'background-jobs', label: 'Background jobs', pattern: /background job|jobs platform/i },
  { id: 'workspace-intelligence', label: 'Workspace intelligence slices', pattern: /workspace intelligence|slice/i },
  { id: 'feature-flags', label: 'Feature flags', pattern: /feature flag|rollout|sunset/i },
  { id: 'route-splits', label: 'Client/admin route split', pattern: /client.*route|admin.*route|public route/i },
  { id: 'ai-dispatch', label: 'AI dispatch', pattern: /callAI|ai dispatch|provider selection/i },
  { id: 'bounded-contexts', label: 'Bounded contexts/service extraction', pattern: /bounded context|service extraction|route-to-service/i },
];

export interface AdrFileReport {
  path: string;
  title: string;
  missingHeaders: string[];
}

export interface AdrLogReport {
  generatedBy: 'scripts/adr-log.ts';
  generatedAt: string;
  adrCount: number;
  files: AdrFileReport[];
  missingTopics: string[];
}

function listAdrFiles(): string[] {
  if (!fs.existsSync(ADR_DIR)) return [];
  return fs
    .readdirSync(ADR_DIR)
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .map(name => path.resolve(ADR_DIR, name))
    .sort();
}

function readFileReport(filePath: string): AdrFileReport {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstLine = content.split('\n').find(line => line.startsWith('# ')) ?? '# (untitled)';
  const title = firstLine.replace(/^#\s+/, '').trim();
  const missingHeaders = REQUIRED_HEADERS.filter(header => !content.includes(header));
  return { path: path.relative(ROOT, filePath), title, missingHeaders };
}

export function buildAdrLogReport(): AdrLogReport {
  const files = listAdrFiles().map(readFileReport);
  const combined = files.map(file => fs.readFileSync(path.resolve(ROOT, file.path), 'utf8')).join('\n\n');
  const missingTopics = REQUIRED_TOPICS
    .filter(topic => !topic.pattern.test(combined))
    .map(topic => `${topic.id}: ${topic.label}`);

  return {
    generatedBy: 'scripts/adr-log.ts',
    generatedAt: new Date().toISOString(),
    adrCount: files.length,
    files,
    missingTopics,
  };
}

export function findAdrPolicyGaps(report: AdrLogReport): string[] {
  const issues: string[] = [];
  if (report.adrCount === 0) issues.push('No ADR files found in docs/adr.');

  for (const file of report.files) {
    if (file.missingHeaders.length > 0) {
      issues.push(`${file.path}: missing headers -> ${file.missingHeaders.join(', ')}`);
    }
  }
  for (const topic of report.missingTopics) {
    issues.push(`Missing required topic coverage: ${topic}`);
  }
  return issues;
}

export function formatAdrLogReportMarkdown(report: AdrLogReport, issues: string[]): string {
  const lines: string[] = [];
  lines.push('# ADR Log Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- ADR files: ${report.adrCount}`);
  lines.push('');
  lines.push('## ADR Files');
  if (report.files.length === 0) {
    lines.push('- none');
  } else {
    for (const file of report.files) {
      const status = file.missingHeaders.length === 0 ? 'ok' : `missing: ${file.missingHeaders.join(', ')}`;
      lines.push(`- ${file.path} — ${file.title} (${status})`);
    }
  }
  lines.push('');
  lines.push('## Policy Gaps');
  if (issues.length === 0) {
    lines.push('- none');
  } else {
    for (const issue of issues) lines.push(`- ${issue}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function runCli(args: string[]): number {
  const json = args.includes('--json');
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    console.log('Usage: npm run verify:adr-log -- [--json]');
    return 0;
  }
  if (args.some(arg => !['--json', '--help', '-h'].includes(arg))) {
    console.error('Unknown option. Usage: npm run verify:adr-log -- [--json]');
    return 1;
  }

  const report = buildAdrLogReport();
  const issues = findAdrPolicyGaps(report);

  if (json) {
    console.log(JSON.stringify({ ...report, issues }, null, 2));
  } else {
    console.log(formatAdrLogReportMarkdown(report, issues));
  }

  return issues.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  process.exit(runCli(process.argv.slice(2)));
}
