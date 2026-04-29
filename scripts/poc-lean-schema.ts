/**
 * POC: Lean schema generator vs. current generator.
 *
 * Reads the existing schema snapshot for a workspace, builds a deterministic
 * lean schema for each page using URL-pattern-driven type selection and compact
 * templates, then prints a side-by-side comparison.
 *
 * No AI calls. The lean version uses data already present in the snapshot
 * (pageTitle, slug, url, existing schema's description if any) so the comparison
 * isolates *prompt-design* differences, not AI quality differences.
 *
 * Usage:
 *   npx tsx scripts/poc-lean-schema.ts <workspaceId>
 *
 * Default workspaceId is hmpsn studio (ws_dd68114e-283b-430b-a9c1-05afdbd30e0d).
 */

import db from '../server/db/index.js';

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
// URL pattern → primary type
// ──────────────────────────────────────────────────────────────

type LeanPageType =
  | 'Homepage'         // Organization + WebSite (sitewide entities)
  | 'AboutPage'
  | 'ContactPage'
  | 'BlogPosting'      // /insights/*, /blog/*, /articles/*
  | 'BlogIndex'        // /insights, /blog, /articles
  | 'Service'          // /services/[name]
  | 'ServiceIndex'     // /services
  | 'CaseStudy'        // /our-work/[name], /case-studies/[name]
  | 'CaseStudyIndex'   // /our-work, /case-studies
  | 'Legal'            // /privacy*, /terms*
  | 'WebPage';         // fallback

function classifyPage(pagePath: string): LeanPageType {
  const p = pagePath.replace(/\/$/, '') || '/';
  if (p === '/' || p === '') return 'Homepage';
  if (/^\/about(-us)?$/i.test(p)) return 'AboutPage';
  if (/^\/contact(-us)?$/i.test(p)) return 'ContactPage';
  if (/^\/(insights?|blog|articles?|news)$/i.test(p)) return 'BlogIndex';
  if (/^\/(insights?|blog|articles?|news)\/.+/i.test(p)) return 'BlogPosting';
  if (/^\/services?$/i.test(p)) return 'ServiceIndex';
  if (/^\/services?\/[^/]+\/?$/i.test(p)) return 'Service';
  if (/^\/(our-work|case-stud(y|ies)|portfolio|projects)$/i.test(p)) return 'CaseStudyIndex';
  if (/^\/(our-work|case-stud(y|ies)|portfolio|projects)\/.+/i.test(p)) return 'CaseStudy';
  if (/^\/(privacy(-policy)?|terms(-of-(service|use))?|legal|cookie(-policy)?)/i.test(p)) return 'Legal';
  return 'WebPage';
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/**
 * Extract a description and image from the existing AI-generated schema, if available.
 * This avoids an AI call for the POC and keeps the comparison fair (we're testing
 * the structure of the OUTPUT, not the AI's content quality).
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

function buildBreadcrumb(pagePath: string, baseUrl: string, pageTitle: string): Record<string, unknown> {
  const segments = pagePath.replace(/^\//, '').split('/').filter(Boolean);
  const items: Record<string, unknown>[] = [
    {
      '@type': 'ListItem',
      'position': 1,
      'name': 'Home',
      'item': baseUrl,
    },
  ];
  let acc = baseUrl;
  segments.forEach((seg, i) => {
    acc = `${acc}/${seg}`;
    items.push({
      '@type': 'ListItem',
      'position': i + 2,
      'name': i === segments.length - 1 ? pageTitle : capitalize(seg.replace(/-/g, ' ')),
      'item': acc,
    });
  });
  return {
    '@type': 'BreadcrumbList',
    'itemListElement': items,
  };
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// ──────────────────────────────────────────────────────────────
// Lean schema templates
// ──────────────────────────────────────────────────────────────

interface BuildContext {
  ws: Workspace;
  baseUrl: string;
  publisherLogoUrl?: string;
}

function buildOrgNode(ctx: BuildContext, asPrimary: boolean): Record<string, unknown> {
  return dropUndefined({
    '@type': 'Organization',
    '@id': `${ctx.baseUrl}/#organization`,
    'name': ctx.ws.name,
    'url': ctx.baseUrl,
    'logo': ctx.publisherLogoUrl
      ? { '@type': 'ImageObject', 'url': ctx.publisherLogoUrl }
      : undefined,
    // Only emit description on Homepage to avoid duplication site-wide
    'description': asPrimary && ctx.ws.businessContext ? ctx.ws.businessContext.slice(0, 250) : undefined,
  });
}

function buildLeanSchema(
  result: SnapshotResult,
  ctx: BuildContext,
): Record<string, unknown> {
  const pagePath = result.url.replace(ctx.baseUrl, '') || '/';
  const type = classifyPage(pagePath);
  const { description, image } = reuseAiContent(result);
  const url = result.url;
  const title = result.pageTitle;

  // Most page types share Article/WebPage shape — build the primary node, then add breadcrumb.
  // Homepage is the only exception (no breadcrumb, sitewide entities only).

  if (type === 'Homepage') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        dropUndefined({
          '@type': 'Organization',
          '@id': `${ctx.baseUrl}/#organization`,
          'name': ctx.ws.name,
          'url': ctx.baseUrl,
          'logo': ctx.publisherLogoUrl
            ? { '@type': 'ImageObject', 'url': ctx.publisherLogoUrl }
            : undefined,
          'description': description || ctx.ws.businessContext || undefined,
          'image': image,
        }),
        {
          '@type': 'WebSite',
          '@id': `${ctx.baseUrl}/#website`,
          'name': ctx.ws.name,
          'url': ctx.baseUrl,
          'publisher': { '@id': `${ctx.baseUrl}/#organization` },
        },
      ],
    };
  }

  // For non-homepage types: ONE primary node + BreadcrumbList. No sitewide bloat.
  const breadcrumb = buildBreadcrumb(pagePath, ctx.baseUrl, title);

  if (type === 'BlogPosting') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        dropUndefined({
          '@type': 'BlogPosting',
          '@id': `${url}#article`,
          'headline': title,
          'description': description,
          'image': image ? [image] : undefined,
          'url': url,
          'mainEntityOfPage': { '@type': 'WebPage', '@id': url },
          'author': { '@type': 'Organization', 'name': ctx.ws.name },
          'publisher': dropUndefined({
            '@type': 'Organization',
            'name': ctx.ws.name,
            'logo': ctx.publisherLogoUrl
              ? { '@type': 'ImageObject', 'url': ctx.publisherLogoUrl }
              : undefined,
          }),
        }),
        breadcrumb,
      ],
    };
  }

  if (type === 'CaseStudy') {
    // Case studies are Articles, not Services — Service describes a thing you sell.
    return {
      '@context': 'https://schema.org',
      '@graph': [
        dropUndefined({
          '@type': 'Article',
          '@id': `${url}#article`,
          'headline': title,
          'description': description,
          'image': image ? [image] : undefined,
          'url': url,
          'mainEntityOfPage': { '@type': 'WebPage', '@id': url },
          'author': { '@type': 'Organization', 'name': ctx.ws.name },
          'publisher': dropUndefined({
            '@type': 'Organization',
            'name': ctx.ws.name,
            'logo': ctx.publisherLogoUrl
              ? { '@type': 'ImageObject', 'url': ctx.publisherLogoUrl }
              : undefined,
          }),
          'about': 'Case study',
        }),
        breadcrumb,
      ],
    };
  }

  if (type === 'Service') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        dropUndefined({
          '@type': 'Service',
          '@id': `${url}#service`,
          'name': title,
          'description': description,
          'image': image,
          'url': url,
          'provider': { '@type': 'Organization', '@id': `${ctx.baseUrl}/#organization`, 'name': ctx.ws.name },
        }),
        breadcrumb,
      ],
    };
  }

  if (type === 'BlogIndex' || type === 'CaseStudyIndex' || type === 'ServiceIndex') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        dropUndefined({
          '@type': 'CollectionPage',
          '@id': `${url}#collection`,
          'name': title,
          'description': description,
          'url': url,
        }),
        breadcrumb,
      ],
    };
  }

  if (type === 'AboutPage') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        dropUndefined({
          '@type': 'AboutPage',
          '@id': `${url}#aboutpage`,
          'name': title,
          'description': description,
          'url': url,
          'mainEntity': { '@id': `${ctx.baseUrl}/#organization` },
        }),
        breadcrumb,
      ],
    };
  }

  if (type === 'ContactPage') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        dropUndefined({
          '@type': 'ContactPage',
          '@id': `${url}#contactpage`,
          'name': title,
          'description': description,
          'url': url,
        }),
        breadcrumb,
      ],
    };
  }

  // Legal pages and fallback WebPage — minimal: just a WebPage + Breadcrumb.
  return {
    '@context': 'https://schema.org',
    '@graph': [
      dropUndefined({
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        'name': title,
        'description': description,
        'url': url,
      }),
      breadcrumb,
    ],
  };
}

// ──────────────────────────────────────────────────────────────
// Validation (same checks as production validator)
// ──────────────────────────────────────────────────────────────

function validateLean(schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (schema['@context'] !== 'https://schema.org') errors.push('Missing or wrong @context');
  const graph = schema['@graph'] as Array<Record<string, unknown>>;
  if (!Array.isArray(graph)) {
    errors.push('Missing @graph array');
    return errors;
  }
  for (const node of graph) {
    if (!node['@type']) errors.push('Node missing @type');
  }
  return errors;
}

// ──────────────────────────────────────────────────────────────
// Comparison runner
// ──────────────────────────────────────────────────────────────

function loadWorkspace(workspaceId: string): Workspace | null {
  const row = db
    .prepare(`SELECT id, name, webflow_site_id, live_domain, business_context FROM workspaces WHERE id = ?`)
    .get(workspaceId) as
    | { id: string; name: string; webflow_site_id: string | null; live_domain: string | null; business_context: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    webflowSiteId: row.webflow_site_id,
    liveDomain: row.live_domain,
    businessContext: row.business_context,
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

async function main() {
  const wsId = process.argv[2] || 'ws_dd68114e-283b-430b-a9c1-05afdbd30e0d';
  const ws = loadWorkspace(wsId);
  if (!ws) {
    console.error(`Workspace ${wsId} not found`);
    process.exit(1);
  }
  if (!ws.webflowSiteId) {
    console.error(`Workspace ${ws.name} has no webflowSiteId`);
    process.exit(1);
  }
  const snap = loadSnapshot(ws.webflowSiteId);
  if (!snap) {
    console.error(`No snapshot for site ${ws.webflowSiteId}`);
    process.exit(1);
  }

  const baseUrl = ws.liveDomain ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`) : `https://${ws.name}.com`;
  const ctx: BuildContext = { ws, baseUrl };

  console.log(`\nLean Schema POC — ${ws.name} (${snap.results.length} pages)\n`);
  console.log(`baseUrl: ${baseUrl}\n`);

  const header = `${pad('Page', 60)} ${pad('Type', 18)} ${pad('Old', 30)} ${pad('Lean', 24)} Δ chars`;
  console.log(header);
  console.log('─'.repeat(header.length));

  let oldTotalChars = 0;
  let leanTotalChars = 0;
  let oldTotalErrors = 0;
  let leanTotalErrors = 0;
  const samplesToFullDump: SnapshotResult[] = [];

  for (const result of snap.results) {
    const oldSchema = result.suggestedSchemas?.[0]?.template ?? {};
    const oldGraph = (oldSchema['@graph'] as Array<Record<string, unknown>>) ?? [];
    const leanSchema = buildLeanSchema(result, ctx);
    const leanGraph = (leanSchema['@graph'] as Array<Record<string, unknown>>) ?? [];

    const pagePath = result.url.replace(ctx.baseUrl, '') || '/';
    const type = classifyPage(pagePath);

    const oldChars = chars(oldSchema);
    const leanChars = chars(leanSchema);
    oldTotalChars += oldChars;
    leanTotalChars += leanChars;

    const oldErrors = result.suggestedSchemas?.[0]?.reason?.match(/auto-fixed (\d+)/)?.[1];
    const leanValidation = validateLean(leanSchema);
    oldTotalErrors += Number(oldErrors ?? 0);
    leanTotalErrors += leanValidation.length;

    const delta = leanChars - oldChars;
    const deltaPct = oldChars > 0 ? Math.round((delta / oldChars) * 100) : 0;

    console.log(
      `${pad(result.slug.slice(0, 58) || '/', 60)} ` +
      `${pad(type, 18)} ` +
      `${pad(`${oldGraph.length}n ${oldChars}c`, 14)}` +
      `${pad(`(fix${oldErrors ?? '?'})`, 16)} ` +
      `${pad(`${leanGraph.length}n ${leanChars}c`, 24)} ` +
      `${delta < 0 ? '−' : '+'}${Math.abs(delta).toString().padStart(4)} (${deltaPct >= 0 ? '+' : ''}${deltaPct}%)`,
    );

    if (samplesToFullDump.length < 3 && (type === 'BlogPosting' || type === 'CaseStudy' || type === 'Service')) {
      samplesToFullDump.push(result);
    }
  }

  console.log('─'.repeat(header.length));
  console.log(
    `\nTotals: old ${oldTotalChars} chars across ${snap.results.length} pages, ${oldTotalErrors} auto-fixes`,
  );
  console.log(
    `        lean ${leanTotalChars} chars, ${leanTotalErrors} validation issues`,
  );
  const reduction = Math.round(((oldTotalChars - leanTotalChars) / oldTotalChars) * 100);
  console.log(`        Δ ${oldTotalChars - leanTotalChars} chars (${reduction}% smaller)\n`);

  // Full JSON dumps for spot-check
  console.log('═══════ FULL OUTPUTS — SPOT-CHECK SAMPLES ═══════\n');
  for (const sample of samplesToFullDump) {
    const pagePath = sample.url.replace(ctx.baseUrl, '') || '/';
    const type = classifyPage(pagePath);
    console.log(`\n──── ${sample.slug} (classified: ${type}) ────\n`);
    console.log(`OLD (${chars(sample.suggestedSchemas?.[0]?.template ?? {})} chars, types: ${nodeTypes(sample.suggestedSchemas?.[0]?.template ?? {}).join(', ')}):`);
    console.log(JSON.stringify(sample.suggestedSchemas?.[0]?.template, null, 2));
    console.log(`\nLEAN (${chars(buildLeanSchema(sample, ctx))} chars, types: ${nodeTypes(buildLeanSchema(sample, ctx)).join(', ')}):`);
    console.log(JSON.stringify(buildLeanSchema(sample, ctx), null, 2));
    console.log('\n────────\n');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
