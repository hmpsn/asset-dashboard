#!/usr/bin/env tsx

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type StyleMetricKey =
  | 'raw_button_unallowlisted_count'
  | 'raw_typography_bypass_count'
  | 'raw_radius_literal_count'
  | 'disallowed_hue_count'
  | 'non_primitive_action_count'
  | 'exception_count';

type StyleMetrics = Record<StyleMetricKey, number>;

type StyleExceptionEntry = {
  id: string;
  rule: string;
  file: string;
  reason: string;
  owner: string;
  expiresOn: string;
  createdAt: string;
};

type StyleExceptionsFile = {
  version: number;
  updatedAt: string;
  exceptions: StyleExceptionEntry[];
};

type StyleBaselineFile = {
  generatedAt: string;
  metrics: StyleMetrics;
};

type StyleDriftReport = {
  generatedBy: 'scripts/report-style-drift.ts';
  generatedAt: string;
  baselinePath: string;
  exceptionsPath: string;
  metrics: StyleMetrics;
  baseline: StyleMetrics | null;
  regressions: Array<{ metric: StyleMetricKey; current: number; baseline: number; delta: number }>;
  advisory: boolean;
  pass: boolean;
  detail: {
    rawButtonAdminCount: number;
    rawButtonClientCount: number;
    rawButtonTotalCount: number;
    rawFormControlAdminCount: number;
    rawFormControlClientCount: number;
    rawFormControlTotalCount: number;
    rawFormControlFiles: Array<{ file: string; count: number; domain: 'admin' | 'client' }>;
    clientPurpleCount: number;
    staticStyleguideInlineNoteCount: number;
    staticStyleguideRadiusLiteralCount: number;
    badgeLikeSpanTotalCount: number;
    badgeLikeSpanFiles: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'badge-like-span' }>;
    duplicateHeadingSignalCount: number;
    duplicateHeadingFiles: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'duplicate-heading-signal' }>;
    nestedCardDensitySignalCount: number;
    nestedCardDensityFiles: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'nested-card-density-signal' }>;
    blueActionSemanticDriftCount: number;
    blueActionSemanticDriftFiles: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'blue-action-semantic-drift' }>;
    allowlistedRawButtonFiles: string[];
  };
};

type CliArgs = {
  json: boolean;
  advisory: boolean;
  writeBaseline: boolean;
  baselinePath: string;
  exceptionsPath: string;
  outputPath: string | null;
};

const ROOT = path.join(import.meta.dirname, '..');
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'data/style-drift-baseline.json');
const DEFAULT_EXCEPTIONS_PATH = path.join(ROOT, 'data/style-exceptions.json');
const RAW_BUTTON_RULE_KEY = 'raw-button-outside-primitives';

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    json: false,
    advisory: false,
    writeBaseline: false,
    baselinePath: DEFAULT_BASELINE_PATH,
    exceptionsPath: DEFAULT_EXCEPTIONS_PATH,
    outputPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--advisory') {
      args.advisory = true;
      continue;
    }
    if (arg === '--write-baseline') {
      args.writeBaseline = true;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --baseline');
      args.baselinePath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--exceptions') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --exceptions');
      args.exceptionsPath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --output');
      args.outputPath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function walkFiles(dir: string, exts: Set<string>, out: string[] = []): string[] {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (exts.has(path.extname(entry.name))) out.push(abs);
    }
  }
  return out;
}

function toRepoRel(absPath: string): string {
  return path.relative(ROOT, absPath).replaceAll('\\', '/');
}

function readStyleExceptions(exceptionsPath: string): StyleExceptionsFile {
  if (!existsSync(exceptionsPath)) {
    return {
      version: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      exceptions: [],
    };
  }
  const parsed = JSON.parse(readFileSync(exceptionsPath, 'utf8')) as Partial<StyleExceptionsFile>;
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString().slice(0, 10),
    exceptions: Array.isArray(parsed.exceptions) ? parsed.exceptions : [],
  };
}

function loadBaseline(baselinePath: string): StyleBaselineFile | null {
  if (!existsSync(baselinePath)) return null;
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<StyleBaselineFile>;
  if (!parsed.metrics) return null;
  return {
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    metrics: parsed.metrics as StyleMetrics,
  };
}

function countRegexMatches(content: string, regex: RegExp): number {
  return [...content.matchAll(regex)].length;
}

function hasLocalHatch(lines: string[], lineIndex: number, hatch: string): boolean {
  if (lines[lineIndex]?.includes(hatch)) return true;
  if (lineIndex > 0 && lines[lineIndex - 1]?.includes(hatch)) return true;
  return false;
}

function extractDuplicateHeadingSignals(
  componentFiles: string[],
): {
  total: number;
  files: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'duplicate-heading-signal' }>;
} {
  let total = 0;
  const fileCounts = new Map<string, { count: number; domain: 'admin' | 'client'; category: 'duplicate-heading-signal' }>();
  const headingRe = /<h([1-6])\b[^>]*>([^<]{4,})<\/h\1>/g;

  for (const file of componentFiles) {
    if (!file.endsWith('.tsx')) continue;
    if (file.includes('/src/components/ui/')) continue;

    const rel = toRepoRel(file);
    const domain: 'admin' | 'client' = rel.startsWith('src/components/client/') ? 'client' : 'admin';
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const buckets = new Map<string, Array<{ line: number; text: string }>>();
    let match: RegExpExecArray | null;

    while ((match = headingRe.exec(src)) !== null) {
      const raw = match[2]
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (raw.length < 6) continue;
      const line = (src.slice(0, match.index).match(/\n/g) ?? []).length + 1;
      if (hasLocalHatch(lines, line - 1, 'duplicate-heading-ok')) continue;
      const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalized) continue;
      if (!buckets.has(normalized)) buckets.set(normalized, []);
      buckets.get(normalized)!.push({ line, text: raw });
    }

    let fileCount = 0;
    for (const values of buckets.values()) {
      if (values.length < 2) continue;
      fileCount += values.length - 1;
    }

    if (fileCount > 0) {
      total += fileCount;
      fileCounts.set(rel, { count: fileCount, domain, category: 'duplicate-heading-signal' });
    }
  }

  return {
    total,
    files: [...fileCounts.entries()]
      .map(([file, info]) => ({ file, ...info }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  };
}

function extractNestedCardDensitySignals(
  componentFiles: string[],
): {
  total: number;
  files: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'nested-card-density-signal' }>;
} {
  let total = 0;
  const fileCounts = new Map<string, { count: number; domain: 'admin' | 'client'; category: 'nested-card-density-signal' }>();
  const cardTagRe = /<\/?SectionCard\b[^>]*>/g;

  for (const file of componentFiles) {
    if (!file.endsWith('.tsx')) continue;
    if (file.includes('/src/components/ui/')) continue;

    const rel = toRepoRel(file);
    const domain: 'admin' | 'client' = rel.startsWith('src/components/client/') ? 'client' : 'admin';
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const stack: number[] = [];
    let fileCount = 0;
    let match: RegExpExecArray | null;

    while ((match = cardTagRe.exec(src)) !== null) {
      const token = match[0];
      const line = (src.slice(0, match.index).match(/\n/g) ?? []).length + 1;
      if (token.startsWith('</SectionCard')) {
        if (stack.length > 0) stack.pop();
        continue;
      }
      const selfClosing = /\/>$/.test(token);
      if (stack.length > 0 && !hasLocalHatch(lines, line - 1, 'nested-card-ok')) {
        fileCount += 1;
      }
      if (!selfClosing) stack.push(line);
    }

    if (fileCount > 0) {
      total += fileCount;
      fileCounts.set(rel, { count: fileCount, domain, category: 'nested-card-density-signal' });
    }
  }

  return {
    total,
    files: [...fileCounts.entries()]
      .map(([file, info]) => ({ file, ...info }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  };
}

function extractBlueActionSemanticSignals(
  componentFiles: string[],
): {
  total: number;
  files: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'blue-action-semantic-drift' }>;
} {
  let total = 0;
  const fileCounts = new Map<string, { count: number; domain: 'admin' | 'client'; category: 'blue-action-semantic-drift' }>();
  const actionableStartRe = /<(Button|IconButton|button|a)\b/;
  const blueStyleRe = /\b(?:bg|text|border)-blue-[0-9]+|\b(?:bg|text|border)-blue-[0-9]+\/[0-9]+|\btext-accent-info\b/;

  for (const file of componentFiles) {
    if (!file.endsWith('.tsx')) continue;
    if (file.includes('/src/components/ui/')) continue;

    const rel = toRepoRel(file);
    const domain: 'admin' | 'client' = rel.startsWith('src/components/client/') ? 'client' : 'admin';
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let fileCount = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const startMatch = lines[index].match(actionableStartRe);
      if (!startMatch) continue;

      const tagLines: string[] = [];
      for (let offset = index; offset < Math.min(lines.length, index + 12); offset += 1) {
        tagLines.push(lines[offset]);
        if (/\/?>/.test(lines[offset])) break;
      }
      const tagText = tagLines.join(' ');
      if (!/\bclassName\s*=/.test(tagText)) continue;
      if (!blueStyleRe.test(tagText)) continue;
      if (hasLocalHatch(lines, index, 'blue-action-ok')) continue;
      if (startMatch[1] === 'a' && !/\bhref\s*=|\bonClick\s*=/.test(tagText)) continue;
      fileCount += 1;
    }

    if (fileCount > 0) {
      total += fileCount;
      fileCounts.set(rel, { count: fileCount, domain, category: 'blue-action-semantic-drift' });
    }
  }

  return {
    total,
    files: [...fileCounts.entries()]
      .map(([file, info]) => ({ file, ...info }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  };
}

function extractRawButtonMetrics(
  componentFiles: string[],
  allowlistedRawButtonFiles: Set<string>,
): { total: number; admin: number; client: number; nonPrimitiveActionCount: number } {
  let total = 0;
  let admin = 0;
  let client = 0;
  let nonPrimitiveActionCount = 0;

  for (const file of componentFiles) {
    if (!file.endsWith('.tsx')) continue;
    if (file.includes('/src/components/ui/')) continue;

    const rel = toRepoRel(file);
    if (allowlistedRawButtonFiles.has(rel)) continue;

    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      if (!/<button\b/.test(lines[i])) continue;
      total += 1;
      if (rel.startsWith('src/components/client/')) client += 1;
      else admin += 1;

      const tagWindow = lines.slice(i, Math.min(lines.length, i + 12)).join(' ');
      if (/\bonClick\s*=/.test(tagWindow) || /type\s*=\s*['"]submit['"]/.test(tagWindow)) {
        nonPrimitiveActionCount += 1;
      }
    }
  }

  return { total, admin, client, nonPrimitiveActionCount };
}

function extractRawFormControlMetrics(
  componentFiles: string[],
): {
  total: number;
  admin: number;
  client: number;
  files: Array<{ file: string; count: number; domain: 'admin' | 'client' }>;
} {
  let total = 0;
  let admin = 0;
  let client = 0;
  const fileCounts = new Map<string, { count: number; domain: 'admin' | 'client' }>();

  for (const file of componentFiles) {
    if (!file.endsWith('.tsx')) continue;
    if (file.includes('/src/components/ui/forms/')) continue;

    const rel = toRepoRel(file);
    const domain: 'admin' | 'client' = rel.startsWith('src/components/client/') ? 'client' : 'admin';
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    let fileCount = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const rawControlMatch = line.match(/<(input|select|textarea)\b/);
      if (!rawControlMatch) continue;
      const tagWindow = lines.slice(index, Math.min(lines.length, index + 8)).join(' ');
      if (/<input\b[^>]*type\s*=\s*["'](?:hidden|file|color)["']/.test(tagWindow)) continue;
      total += 1;
      fileCount += 1;
      if (domain === 'client') client += 1;
      else admin += 1;
    }
    if (fileCount > 0) {
      fileCounts.set(rel, { count: fileCount, domain });
    }
  }

  return {
    total,
    admin,
    client,
    files: [...fileCounts.entries()]
      .map(([file, info]) => ({ file, ...info }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  };
}

function countClientPurple(componentFiles: string[]): number {
  let count = 0;
  const purpleRe = /\b(?:purple|violet)-[0-9]|var\(--purple\)|#(?:a78bfa|7c3aed|8b5cf6)\b|rgba?\(\s*(?:124\s*,\s*58\s*,\s*237|167\s*,\s*139\s*,\s*250)/gi;
  for (const file of componentFiles) {
    if (!file.endsWith('.tsx')) continue;
    const rel = toRepoRel(file);
    if (!rel.startsWith('src/components/client/')) continue;
    count += countRegexMatches(readFileSync(file, 'utf8'), purpleRe);
  }
  return count;
}

function extractBadgeLikeSpanMetrics(
  componentFiles: string[],
): {
  total: number;
  files: Array<{ file: string; count: number; domain: 'admin' | 'client'; category: 'badge-like-span' }>;
} {
  let total = 0;
  const fileCounts = new Map<string, { count: number; domain: 'admin' | 'client'; category: 'badge-like-span' }>();

  for (const file of componentFiles) {
    if (!file.endsWith('.tsx')) continue;
    if (file.includes('/src/components/ui/')) continue;

    const rel = toRepoRel(file);
    const domain: 'admin' | 'client' = rel.startsWith('src/components/client/') ? 'client' : 'admin';
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let fileCount = 0;

    for (let index = 0; index < lines.length; index += 1) {
      if (!/<span\b/.test(lines[index])) continue;

      const tagLines = [];
      for (let offset = index; offset < Math.min(lines.length, index + 8); offset += 1) {
        tagLines.push(lines[offset]);
        if (/>/.test(lines[offset])) break;
      }

      const tagText = tagLines.join(' ');
      if (!/^\s*<span\b/.test(tagText)) continue;
      if (!/rounded-\[var\(--radius-(?:sm|pill|md)\)\]/.test(tagText)) continue;
      if (!/\bpx-/.test(tagText)) continue;
      if (!/\b(?:bg|text|border)-(?:teal|blue|emerald|amber|red|orange|zinc)-/.test(tagText)) continue;
      if (/badge-span-ok/.test(tagText)) continue;
      total += 1;
      fileCount += 1;
    }

    if (fileCount > 0) {
      fileCounts.set(rel, { count: fileCount, domain, category: 'badge-like-span' });
    }
  }

  return {
    total,
    files: [...fileCounts.entries()]
      .map(([file, info]) => ({ file, ...info }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  };
}

function extractStaticStyleguideDetail(): {
  inlineNoteCount: number;
  radiusLiteralCount: number;
} {
  const htmlPath = path.join(ROOT, 'public/styleguide.html');
  if (!existsSync(htmlPath)) return { inlineNoteCount: 0, radiusLiteralCount: 0 };
  const src = readFileSync(htmlPath, 'utf8');
  const inlineNoteCount = src
    .split('\n')
    .filter(line => /class="[^"]*(?:muted|dv-caption|dd-note|ar-note)[^"]*"/.test(line))
    .filter(line => /style="[^"]*(?:font-size|margin-top|line-height|padding)/.test(line))
    .length;
  const radiusLiteralCount = countRegexMatches(src, /\b(?:[0-9]+px\s+){1,3}[0-9]+px\b|rounded-(?:sm|md|lg|xl|2xl|3xl|full)\b/g);
  return { inlineNoteCount, radiusLiteralCount };
}

function buildMetrics(exceptionsPath: string): {
  metrics: StyleMetrics;
  detail: StyleDriftReport['detail'];
} {
  const srcRoot = path.join(ROOT, 'src');
  const componentRoot = path.join(ROOT, 'src/components');
  const sourceFiles = walkFiles(srcRoot, new Set(['.ts', '.tsx', '.css']));
  const componentFiles = walkFiles(componentRoot, new Set(['.tsx']));

  const exceptions = readStyleExceptions(exceptionsPath).exceptions;
  const allowlistedRawButtonFiles = new Set(
    exceptions
      .filter(entry => entry.rule === RAW_BUTTON_RULE_KEY)
      .map(entry => entry.file),
  );

  const buttonMetrics = extractRawButtonMetrics(componentFiles, allowlistedRawButtonFiles);
  const formControlMetrics = extractRawFormControlMetrics(componentFiles);
  const badgeLikeSpanMetrics = extractBadgeLikeSpanMetrics(componentFiles);
  const duplicateHeadingSignals = extractDuplicateHeadingSignals(componentFiles);
  const nestedCardSignals = extractNestedCardDensitySignals(componentFiles);
  const blueActionSignals = extractBlueActionSemanticSignals(componentFiles);
  const staticStyleguideDetail = extractStaticStyleguideDetail();

  let rawTypographyBypass = 0;
  let rawRadiusLiteral = 0;
  let disallowedHue = 0;

  for (const file of sourceFiles) {
    const rel = toRepoRel(file);
    const src = readFileSync(file, 'utf8');

    rawTypographyBypass += countRegexMatches(src, /text-\[[0-9]+px\]/g);

    if (!rel.startsWith('src/components/ui/')) {
      rawRadiusLiteral += countRegexMatches(src, /\brounded-(sm|md|lg|xl|2xl|3xl|full)\b/g);
    }

    disallowedHue += countRegexMatches(src, /\b(violet|indigo|rose|pink)-[0-9]/g);
  }

  const metrics: StyleMetrics = {
    raw_button_unallowlisted_count: buttonMetrics.total,
    raw_typography_bypass_count: rawTypographyBypass,
    raw_radius_literal_count: rawRadiusLiteral,
    disallowed_hue_count: disallowedHue,
    non_primitive_action_count: buttonMetrics.nonPrimitiveActionCount,
    exception_count: exceptions.length,
  };

  return {
    metrics,
    detail: {
      rawButtonAdminCount: buttonMetrics.admin,
      rawButtonClientCount: buttonMetrics.client,
      rawButtonTotalCount: buttonMetrics.total,
      rawFormControlAdminCount: formControlMetrics.admin,
      rawFormControlClientCount: formControlMetrics.client,
      rawFormControlTotalCount: formControlMetrics.total,
      rawFormControlFiles: formControlMetrics.files,
      clientPurpleCount: countClientPurple(componentFiles),
      staticStyleguideInlineNoteCount: staticStyleguideDetail.inlineNoteCount,
      staticStyleguideRadiusLiteralCount: staticStyleguideDetail.radiusLiteralCount,
      badgeLikeSpanTotalCount: badgeLikeSpanMetrics.total,
      badgeLikeSpanFiles: badgeLikeSpanMetrics.files,
      duplicateHeadingSignalCount: duplicateHeadingSignals.total,
      duplicateHeadingFiles: duplicateHeadingSignals.files,
      nestedCardDensitySignalCount: nestedCardSignals.total,
      nestedCardDensityFiles: nestedCardSignals.files,
      blueActionSemanticDriftCount: blueActionSignals.total,
      blueActionSemanticDriftFiles: blueActionSignals.files,
      allowlistedRawButtonFiles: [...allowlistedRawButtonFiles].sort(),
    },
  };
}

function buildReport(args: CliArgs): StyleDriftReport {
  const baseline = loadBaseline(args.baselinePath);
  const { metrics, detail } = buildMetrics(args.exceptionsPath);

  const regressions: StyleDriftReport['regressions'] = [];
  if (baseline) {
    (Object.keys(metrics) as StyleMetricKey[]).forEach(metric => {
      const current = metrics[metric];
      const base = baseline.metrics[metric];
      if (current > base) {
        regressions.push({ metric, current, baseline: base, delta: current - base });
      }
    });
  }

  return {
    generatedBy: 'scripts/report-style-drift.ts',
    generatedAt: new Date().toISOString(),
    baselinePath: args.baselinePath,
    exceptionsPath: args.exceptionsPath,
    metrics,
    baseline: baseline?.metrics ?? null,
    regressions,
    advisory: args.advisory,
    pass: regressions.length === 0,
    detail,
  };
}

function formatMarkdown(report: StyleDriftReport): string {
  const lines = [
    '# Style Drift Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Baseline: \`${report.baselinePath}\`${report.baseline ? '' : ' (missing)'}`,
    `Result: ${report.pass ? 'PASS' : 'FAIL'}`,
    '',
    '| Metric | Current | Baseline | Delta |',
    '| --- | ---: | ---: | ---: |',
  ];

  (Object.keys(report.metrics) as StyleMetricKey[]).forEach(metric => {
    const current = report.metrics[metric];
    const baseline = report.baseline ? report.baseline[metric] : 0;
    const delta = current - baseline;
    lines.push(`| ${metric} | ${current} | ${report.baseline ? baseline : 'n/a'} | ${report.baseline ? delta : 'n/a'} |`);
  });

  lines.push(
    '',
    `Raw button breakdown: admin=${report.detail.rawButtonAdminCount}, client=${report.detail.rawButtonClientCount}, total=${report.detail.rawButtonTotalCount}`,
    `Raw form control advisory: admin=${report.detail.rawFormControlAdminCount}, client=${report.detail.rawFormControlClientCount}, total=${report.detail.rawFormControlTotalCount}`,
  );

  if (report.detail.rawFormControlFiles.length > 0) {
    lines.push('', 'Top raw form control files:');
    report.detail.rawFormControlFiles.slice(0, 20).forEach(item => {
      lines.push(`- ${item.file}: ${item.count} (${item.domain})`);
    });
  }

  lines.push(
    `Client purple advisory count: ${report.detail.clientPurpleCount}`,
    `Static styleguide advisory: inlineNote=${report.detail.staticStyleguideInlineNoteCount}, radiusLiteral=${report.detail.staticStyleguideRadiusLiteralCount}`,
    `Badge-like span advisory count: ${report.detail.badgeLikeSpanTotalCount}`,
    `Duplicate heading advisory count: ${report.detail.duplicateHeadingSignalCount}`,
    `Nested SectionCard advisory count: ${report.detail.nestedCardDensitySignalCount}`,
    `Blue action semantic advisory count: ${report.detail.blueActionSemanticDriftCount}`,
    `Exception count: ${report.metrics.exception_count}`,
    '',
    `Regressions: ${report.regressions.length}`,
  );

  if (report.detail.badgeLikeSpanFiles.length > 0) {
    lines.push('', 'Top badge-like span files:');
    report.detail.badgeLikeSpanFiles.slice(0, 20).forEach(item => {
      lines.push(`- ${item.file}: ${item.count} (${item.domain})`);
    });
  }

  if (report.detail.duplicateHeadingFiles.length > 0) {
    lines.push('', 'Top duplicate-heading files:');
    report.detail.duplicateHeadingFiles.slice(0, 20).forEach(item => {
      lines.push(`- ${item.file}: ${item.count} (${item.domain})`);
    });
  }

  if (report.detail.nestedCardDensityFiles.length > 0) {
    lines.push('', 'Top nested-card files:');
    report.detail.nestedCardDensityFiles.slice(0, 20).forEach(item => {
      lines.push(`- ${item.file}: ${item.count} (${item.domain})`);
    });
  }

  if (report.detail.blueActionSemanticDriftFiles.length > 0) {
    lines.push('', 'Top blue-action files:');
    report.detail.blueActionSemanticDriftFiles.slice(0, 20).forEach(item => {
      lines.push(`- ${item.file}: ${item.count} (${item.domain})`);
    });
  }

  report.regressions.forEach(regression => {
    lines.push(`- ${regression.metric}: ${regression.baseline} -> ${regression.current} (+${regression.delta})`);
  });

  return `${lines.join('\n')}\n`;
}

function writeBaseline(baselinePath: string, metrics: StyleMetrics): void {
  const dir = path.dirname(baselinePath);
  mkdirSync(dir, { recursive: true });
  const payload: StyleBaselineFile = {
    generatedAt: new Date().toISOString(),
    metrics,
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeReportOutput(outputPath: string, report: StyleDriftReport): void {
  const dir = path.dirname(outputPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);

  if (args.writeBaseline) {
    writeBaseline(args.baselinePath, report.metrics);
  }

  if (args.outputPath) {
    writeReportOutput(args.outputPath, report);
  }

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatMarkdown(report));

  if (!args.advisory && !report.pass) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
