/**
 * One-off backfill: record a workspace's already-PUBLISHED posts as manual outcome
 * actions so historical agency work enters the outcome ledger and can become measured
 * wins. Narrowly scoped (Rinse Dental by default) — the external/manual outcome
 * ingestion P1 (docs/superpowers/plans/2026-07-02-external-ingestion-p1-plan.md).
 *
 * - Attribution is `platform_executed` — the agency genuinely performed this work.
 * - Idempotent: dedups on (sourceType, sourceId) via getActionByWorkspaceAndSource, so
 *   re-running never double-counts.
 * - Honesty (FM-2): a post with no title is skipped-and-reported, never fabricated.
 *
 * OPERATOR-RUN ONLY. Run `--dry-run` first to preview. Not part of CI. Resolve the
 * workspace with `--workspace=<id>` or `--name=<substring>` (defaults to "rinse").
 *
 *   npx tsx scripts/backfill-rinse-outcomes.ts --name=rinse --dry-run
 *   npx tsx scripts/backfill-rinse-outcomes.ts --workspace=<id>
 */
import { listWorkspaces } from '../server/workspaces.js';
import { listPosts } from '../server/content-posts-db.js';
import { recordAction, getActionByWorkspaceAndSource, type RecordActionParams } from '../server/outcome-tracking.js';
import type { GeneratedPost } from '../shared/types/content.js';

const SOURCE_TYPE = 'manual-backfill';

/** Build a best-effort page URL from the workspace domain + the post's published slug. */
export function buildPageUrl(liveDomain: string, slug?: string): string {
  if (!slug) return liveDomain ?? '';
  if (/^https?:\/\//.test(slug)) return slug;
  const base = (liveDomain ?? '').replace(/\/+$/, '');
  const path = slug.replace(/^\/+/, '');
  return base ? `${base}/${path}` : `/${path}`;
}

/**
 * Pure mapper (unit-tested): a published GeneratedPost → the recordAction body (minus
 * workspaceId). Returns null to SKIP — an unpublished post (no `publishedAt`) or one
 * with no title (never fabricate a title, FM-2).
 */
export function toRecordActionBody(
  post: GeneratedPost,
  liveDomain: string,
): Omit<RecordActionParams, 'workspaceId'> | null {
  if (!post.publishedAt) return null; // only actually-published posts
  const title = post.title?.trim();
  if (!title) return null; // skip-and-report: no title to attribute honestly
  const page = buildPageUrl(liveDomain, post.publishedSlug);
  return {
    actionType: 'content_published',
    sourceType: SOURCE_TYPE,
    sourceId: `${SOURCE_TYPE}:${post.id}`,
    pageUrl: page || null,
    targetKeyword: post.targetKeyword || null,
    baselineSnapshot: {}, // historical publish — no captured baseline
    attribution: 'platform_executed', // the agency performed this work
    source: { label: title, snapshot: { title, type: SOURCE_TYPE, page: page || undefined } },
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const wsArg = args.find(a => a.startsWith('--workspace='))?.split('=')[1];
  const nameArg = (args.find(a => a.startsWith('--name='))?.split('=')[1] ?? 'rinse').toLowerCase();

  const workspaces = listWorkspaces();
  const ws = wsArg
    ? workspaces.find(w => w.id === wsArg)
    : workspaces.find(w => (w.name ?? '').toLowerCase().includes(nameArg));
  if (!ws) {
    const hint = wsArg ? `id ${wsArg}` : `name ~ "${nameArg}"`;
    console.error(`Workspace not found (${hint}). Available: ${workspaces.map(w => `${w.id}:${w.name}`).join(', ')}`);
    process.exit(1);
  }

  console.log(`Backfill published posts → outcomes · workspace ${ws.id} (${ws.name})${dryRun ? ' · DRY RUN' : ''}`);
  const posts = listPosts(ws.id);
  let recorded = 0;
  let skippedExisting = 0;
  let skippedNoData = 0;

  for (const post of posts) {
    const body = toRecordActionBody(post, ws.liveDomain ?? '');
    if (!body) {
      skippedNoData++;
      continue;
    }
    const existing = getActionByWorkspaceAndSource(ws.id, SOURCE_TYPE, body.sourceId ?? '');
    if (existing) {
      skippedExisting++;
      continue;
    }
    if (dryRun) {
      console.log(`  would record: "${body.source?.label}" → ${body.pageUrl}`);
      recorded++;
      continue;
    }
    recordAction({ workspaceId: ws.id, ...body });
    recorded++;
  }

  console.log(
    `Done. recorded=${recorded} skippedExisting=${skippedExisting} skippedNoData=${skippedNoData} (of ${posts.length} posts)`,
  );
}

// Guard: only run when executed directly (so tests can import the pure mapper without
// hitting the DB or process.exit).
const isDirectRun = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) main();
