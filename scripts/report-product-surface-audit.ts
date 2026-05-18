#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildProductSurfaceReport,
  type ProductSurfaceEntry,
} from './product-surface-map.js';

interface ProductSurfaceAuditReport {
  generatedAt: string;
  featureAuditHeadlineCount: number;
  productSurfaceEntryCount: number;
  humanVerificationCount: number;
  recommendations: Record<string, number>;
  placement: Record<string, number>;
  lifecycle: Record<string, number>;
  byOwner: Record<string, number>;
  humanVerificationQueue: Array<{
    id: string;
    capability: string;
    owner: string;
    recommendation: string;
    notes: string;
  }>;
  prioritizedMoves: {
    promote: ProductSurfaceEntry[];
    keep: ProductSurfaceEntry[];
    hideBehindProgressiveDisclosure: ProductSurfaceEntry[];
    deprecateAfterRedirectWindow: ProductSurfaceEntry[];
  };
}

export function countFeatureAuditHeadlines(source: string): number {
  const explicitHeadline = source.match(/^###\s+(\d+)\./m);
  if (explicitHeadline) {
    return Number(explicitHeadline[1]);
  }

  const numberedEntries = source.match(/^###\s+\d+\./gm);
  return numberedEntries?.length ?? 0;
}

function countFeatureAuditHeadlinesFromFile(featureAuditPath: string): number {
  const source = fs.readFileSync(featureAuditPath, 'utf-8');
  return countFeatureAuditHeadlines(source);
}

export function buildProductSurfaceAuditReport(): ProductSurfaceAuditReport {
  const report = buildProductSurfaceReport();
  const featureAuditPath = path.resolve('FEATURE_AUDIT.md');
  const featureAuditHeadlineCount = countFeatureAuditHeadlinesFromFile(featureAuditPath);

  const byOwner: Record<string, number> = {};
  for (const entry of report.entries) {
    byOwner[entry.owner] = (byOwner[entry.owner] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    featureAuditHeadlineCount,
    productSurfaceEntryCount: report.totalCapabilities,
    humanVerificationCount: report.humanReviewRequired,
    recommendations: report.counts.recommendations,
    placement: report.counts.placements,
    lifecycle: report.counts.lifecycle,
    byOwner,
    humanVerificationQueue: report.entries
      .filter(entry => entry.requiresHumanVerification)
      .map(entry => ({
        id: entry.id,
        capability: entry.capability,
        owner: entry.owner,
        recommendation: entry.recommendation,
        notes: entry.notes,
      })),
    prioritizedMoves: {
      promote: report.entries.filter(entry => entry.recommendation === 'promote'),
      keep: report.entries.filter(entry => entry.recommendation === 'keep'),
      hideBehindProgressiveDisclosure: report.entries.filter(entry => entry.recommendation === 'hide-behind-progressive-disclosure'),
      deprecateAfterRedirectWindow: report.entries.filter(entry => entry.recommendation === 'deprecate-after-redirect-window'),
    },
  };
}

function runCli(): void {
  const outputFlag = process.argv.indexOf('--output');
  const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : 'data/product-surface-audit.json';
  const report = buildProductSurfaceAuditReport();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  console.log(`[product-surface-audit] wrote ${outputPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  runCli();
}
