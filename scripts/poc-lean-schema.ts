/**
 * POC: Lean schema generator vs. current generator.
 *
 * Reads the existing schema snapshot for a workspace, then calls the
 * production `generateLeanSchema` (server/schema/index.ts) for each page
 * using the snapshot's metadata (no live HTML fetch, no AI calls because
 * descriptions are reused from the snapshot).  Prints a side-by-side
 * comparison of character counts and node types.
 *
 * No AI calls. The lean version uses data already present in the snapshot
 * (pageTitle, slug, url, existing schema's description if any) so the
 * comparison isolates *prompt-design* differences, not AI quality differences.
 *
 * Usage:
 *   npx tsx scripts/poc-lean-schema.ts [workspaceId]
 *
 * Default workspaceId is hmpsn studio (ws_dd68114e-283b-430b-a9c1-05afdbd30e0d).
 *
 * NOTE: Requires staging data to be present locally.
 *   Run `npm run db:sync-staging` first if the workspace is not found.
 */

import db from '../server/db/index.js';
import { generateLeanSchema } from '../server/schema/index.js';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface SnapshotResult {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  suggestedSchemas: Array<{
    type: string;
    reason: string;
    priority: string;
    template: Record<string, unknown>;
  }>;
}

interface Workspace {
  id: string;
  name: string;
  webflowSiteId: string | null;
  liveDomain: string | null;
  businessContext?: string | null;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/**
 * Extract a description and image from the existing AI-generated schema, if available.
 * This avoids an AI call for the POC and keeps the comparison fair (we're testing
 * the structure of the OUTPUT, not the AI's content quality).
 *
 * We bake the description into a fake meta SEO field so the production extractor
 * picks it up without needing to parse HTML.
 */
function reuseAiContent(result: SnapshotResult): { description?: string; image?: string } {
  const tmpl = result.suggestedSchemas?.[0]?.template;
  const graph = (tmpl?.['@graph'] as Array<Record<string, unknown>>) ?? [];
  let description: string | undefined;
  let image: string | undefined;
  for (const node of graph) {
    if (!description && typeof node.description === 'string') description = node.description;
    if (!image) {
      if (typeof node.image === 'string') image = node.image;
      else if (Array.isArray(node.image) && typeof node.image[0] === 'string') image = node.image[0] as string;
    }
  }
  return { description, image };
}

function chars(obj: unknown): number {
  return JSON.stringify(obj).length;
}

function nodeTypes(schema: Record<string, unknown>): string[] {
  const graph = (schema['@graph'] as Array<Record<string, unknown>>) ?? [];
  return graph.map(n => n['@type'] as string);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ──────────────────────────────────────────────────────────────
// DB helpers
// ──────────────────────────────────────────────────────────────

function loadWorkspace(workspaceId: string): Workspace | null {
  // business_context was added in a later migration — query without it so the
  // script works against both local and staging DBs.
  const row = db
    .prepare(`SELECT id, name, webflow_site_id, live_domain FROM workspaces WHERE id = ?`)
    .get(workspaceId) as
    | { id: string; name: string; webflow_site_id: string | null; live_domain: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    webflowSiteId: row.webflow_site_id,
    liveDomain: row.live_domain,
    businessContext: null,
  };
}

function loadSnapshot(siteId: string): { results: SnapshotResult[] } | null {
  const row = db
    .prepare(`SELECT results FROM schema_snapshots WHERE site_id = ?`)
    .get(siteId) as { results: string } | undefined;
  if (!row) return null;
  const results = JSON.parse(row.results) as SnapshotResult[];
  return { results };
}

// ──────────────────────────────────────────────────────────────
// Comparison runner
// ──────────────────────────────────────────────────────────────

async function main() {
  const wsId = process.argv[2] || 'ws_dd68114e-283b-430b-a9c1-05afdbd30e0d';
  const ws = loadWorkspace(wsId);
  if (!ws) {
    console.error(`\nWorkspace ${wsId} not found in local DB.`);
    console.error(`Run \`npm run db:sync-staging\` to pull staging data first.\n`);
    process.exit(1);
  }
  if (!ws.webflowSiteId) {
    console.error(`Workspace ${ws.name} has no webflowSiteId`);
    process.exit(1);
  }
  const snap = loadSnapshot(ws.webflowSiteId);
  if (!snap) {
    console.error(`No schema snapshot found for site ${ws.webflowSiteId}.`);
    console.error(`Run \`npm run db:sync-staging\` to pull staging data first.\n`);
    process.exit(1);
  }

  const baseUrl = ws.liveDomain
    ? ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`
    : `https://${ws.name}.com`;

  console.log(`\nLean Schema POC — ${ws.name} (${snap.results.length} pages)\n`);
  console.log(`baseUrl: ${baseUrl}\n`);

  const header = `${pad('Page', 60)} ${pad('Type', 20)} ${pad('Old', 30)} ${pad('Lean', 24)} Δ chars`;
  console.log(header);
  console.log('─'.repeat(header.length));

  let oldTotalChars = 0;
  let leanTotalChars = 0;
  const samplesToFullDump: Array<{ result: SnapshotResult; lean: Record<string, unknown>; leanType: string }> = [];

  for (const result of snap.results) {
    const oldSchema = result.suggestedSchemas?.[0]?.template ?? {};
    const oldGraph = (oldSchema['@graph'] as Array<Record<string, unknown>>) ?? [];
    const { description } = reuseAiContent(result);

    const publishedPath = result.url.replace(baseUrl, '') || '/';

    // Call the production lean generator.
    // html is empty — we reuse the description from the snapshot via pageMeta.seo.description
    // so the AI path in extractDescription is skipped (description !== undefined short-circuits).
    const leanOutput = await generateLeanSchema({
      pageId: result.pageId,
      pageMeta: {
        title: result.pageTitle,
        slug: result.slug,
        publishedPath,
        seo: description ? { description } : undefined,
      },
      html: '',
      baseUrl,
      workspace: {
        name: ws.name,
        publisherLogoUrl: null,
        businessProfile: null,
      },
    });

    const leanSchema = leanOutput.suggestedSchemas[0]?.template ?? {};
    const leanGraph = (leanSchema['@graph'] as Array<Record<string, unknown>>) ?? [];
    const leanType = leanOutput.suggestedSchemas[0]?.type ?? 'unknown';

    const oldChars = chars(oldSchema);
    const leanChars = chars(leanSchema);
    oldTotalChars += oldChars;
    leanTotalChars += leanChars;

    const delta = leanChars - oldChars;
    const deltaPct = oldChars > 0 ? Math.round((delta / oldChars) * 100) : 0;

    console.log(
      `${pad(result.slug.slice(0, 58) || '/', 60)} ` +
      `${pad(leanType.slice(0, 18), 20)} ` +
      `${pad(`${oldGraph.length}n ${oldChars}c`, 14)}` +
      `${pad('', 16)} ` +
      `${pad(`${leanGraph.length}n ${leanChars}c`, 24)} ` +
      `${delta < 0 ? '−' : '+'}${Math.abs(delta).toString().padStart(4)} (${deltaPct >= 0 ? '+' : ''}${deltaPct}%)`,
    );

    // Collect samples for full JSON dump (one per notable type)
    const isInteresting = leanType.includes('BlogPosting') || leanType.includes('Article') || leanType.includes('Service');
    if (samplesToFullDump.length < 3 && isInteresting) {
      samplesToFullDump.push({ result, lean: leanSchema, leanType });
    }

    // Print any validation errors
    if (leanOutput.validationErrors && leanOutput.validationErrors.length > 0) {
      for (const err of leanOutput.validationErrors) {
        console.log(`  ⚠ validation: ${err}`);
      }
    }
  }

  console.log('─'.repeat(header.length));
  console.log(
    `\nTotals: old ${oldTotalChars} chars across ${snap.results.length} pages`,
  );
  console.log(
    `        lean ${leanTotalChars} chars`,
  );
  const reduction = oldTotalChars > 0 ? Math.round(((oldTotalChars - leanTotalChars) / oldTotalChars) * 100) : 0;
  console.log(`        Δ ${oldTotalChars - leanTotalChars} chars (${reduction}% smaller)\n`);

  if (reduction < 60) {
    console.warn(`⚠  Reduction (${reduction}%) is below the 60% target. Investigate template bloat.\n`);
  } else {
    console.log(`✓  Reduction (${reduction}%) meets the ≥60% target (POC baseline: 72%).\n`);
  }

  // Full JSON dumps for spot-check
  if (samplesToFullDump.length > 0) {
    console.log('═══════ FULL OUTPUTS — SPOT-CHECK SAMPLES ═══════\n');
    for (const { result, lean, leanType } of samplesToFullDump) {
      console.log(`\n──── ${result.slug} (lean type: ${leanType}) ────\n`);
      const oldTmpl = result.suggestedSchemas?.[0]?.template ?? {};
      console.log(`OLD (${chars(oldTmpl)} chars, types: ${nodeTypes(oldTmpl).join(', ')}):`);
      console.log(JSON.stringify(oldTmpl, null, 2));
      console.log(`\nLEAN (${chars(lean)} chars, types: ${nodeTypes(lean).join(', ')}):`);
      console.log(JSON.stringify(lean, null, 2));
      console.log('\n────────\n');
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
