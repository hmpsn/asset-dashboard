import crypto from 'crypto';
import type { SeoAuditResult } from './seo-audit.js';
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { fireBridge, withWorkspaceLock } from './bridge-infrastructure.js';
import { listWorkspaces } from './workspaces.js';
import { isFeatureEnabled } from './feature-flags.js';
import { STUDIO_NAME, STUDIO_URL } from './constants.js';
import type * as AnalyticsInsightsStore from './analytics-insights-store.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';


const log = createLogger('reports');
export type ActionStatus = 'planned' | 'in-progress' | 'completed';
export type ActionPriority = 'high' | 'medium' | 'low';

export interface ActionItem {
  id: string;
  snapshotId: string;
  title: string;
  description: string;
  status: ActionStatus;
  priority: ActionPriority;
  category?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditSnapshot {
  id: string;
  siteId: string;
  siteName: string;
  createdAt: string;
  audit: SeoAuditResult;
  logoUrl?: string;
  actionItems?: ActionItem[];
  previousScore?: number;
}

export interface SnapshotSummary {
  id: string;
  createdAt: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
}

// ── Prepared statements (lazy) ──

let _insertSnapshot: ReturnType<typeof db.prepare> | null = null;
function insertSnapshotStmt() {
  if (!_insertSnapshot) {
    _insertSnapshot = db.prepare(`
      INSERT INTO audit_snapshots
        (id, site_id, site_name, created_at, audit, logo_url, action_items, previous_score)
      VALUES (@id, @site_id, @site_name, @created_at, @audit, @logo_url, @action_items, @previous_score)
    `);
  }
  return _insertSnapshot;
}

let _updateSnapshot: ReturnType<typeof db.prepare> | null = null;
function updateSnapshotStmt() {
  if (!_updateSnapshot) {
    _updateSnapshot = db.prepare(`
      UPDATE audit_snapshots SET action_items = @action_items WHERE id = @id
    `);
  }
  return _updateSnapshot;
}

let _getSnapshot: ReturnType<typeof db.prepare> | null = null;
function getSnapshotStmt() {
  if (!_getSnapshot) {
    _getSnapshot = db.prepare(`SELECT * FROM audit_snapshots WHERE id = ?`);
  }
  return _getSnapshot;
}

let _listSnapshots: ReturnType<typeof db.prepare> | null = null;
function listSnapshotsStmt() {
  if (!_listSnapshots) {
    _listSnapshots = db.prepare(`
      SELECT id, site_id, site_name, created_at, audit, logo_url, action_items, previous_score
      FROM audit_snapshots WHERE site_id = ? ORDER BY created_at DESC
    `);
  }
  return _listSnapshots;
}

let _cleanupOldSnapshots: ReturnType<typeof db.prepare> | null = null;
function cleanupOldSnapshotsStmt() {
  if (!_cleanupOldSnapshots) {
    _cleanupOldSnapshots = db.prepare(`
      DELETE FROM audit_snapshots WHERE created_at < datetime('now', ? || ' days')
    `);
  }
  return _cleanupOldSnapshots;
}

interface SnapshotRow {
  id: string;
  site_id: string;
  site_name: string;
  created_at: string;
  audit: string;
  logo_url: string | null;
  action_items: string | null;
  previous_score: number | null;
}

function rowToSnapshot(row: SnapshotRow): AuditSnapshot {
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    createdAt: row.created_at,
    audit: parseJsonFallback<SeoAuditResult>(row.audit, { siteScore: 0, totalPages: 0, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [] } as SeoAuditResult),
    logoUrl: row.logo_url ?? undefined,
    actionItems: row.action_items ? parseJsonFallback(row.action_items, []) : [],
    previousScore: row.previous_score ?? undefined,
  };
}

export function cleanupOldSnapshots(maxAgeDays: number = 365): number {
  const result = cleanupOldSnapshotsStmt().run(`-${maxAgeDays}`);
  return (result as { changes: number }).changes;
}

export function saveSnapshot(siteId: string, siteName: string, audit: SeoAuditResult, logoUrl?: string): AuditSnapshot {
  const id = crypto.randomBytes(8).toString('hex');

  // Get previous score for delta comparison
  const prev = getLatestSnapshot(siteId);
  const previousScore = prev ? prev.audit.siteScore : undefined;

  const snapshot: AuditSnapshot = {
    id,
    siteId,
    siteName,
    createdAt: new Date().toISOString(),
    audit,
    logoUrl,
    actionItems: [],
    previousScore,
  };

  insertSnapshotStmt().run({
    id,
    site_id: siteId,
    site_name: siteName,
    created_at: snapshot.createdAt,
    audit: JSON.stringify(audit),
    logo_url: logoUrl ?? null,
    action_items: JSON.stringify([]),
    previous_score: previousScore ?? null,
  });

  // Bridge #12 (audit → page_health) and Bridge #15 (audit → site_health)
  if (isFeatureEnabled('bridge-audit-page-health') || isFeatureEnabled('bridge-audit-site-health')) {
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
    if (ws) {
      // Bridge #12 — per-page health insights
      // Returns { modified } so executeBridge() auto-broadcasts
      // INSIGHT_BRIDGE_UPDATED via the bridge-infrastructure auto-dispatch
      // path. Inline broadcastToWorkspace() removed to prevent double-fire.
      if (isFeatureEnabled('bridge-audit-page-health')) {
        fireBridge('bridge-audit-page-health', ws.id, async () => {
          let modified = 0;
          await withWorkspaceLock(ws.id, async () => {
            const { upsertInsight }: typeof AnalyticsInsightsStore = await import('./analytics-insights-store.js'); // dynamic-import-ok
            for (const page of audit.pages.slice(0, 50)) {
              const issues = page.issues ?? [];
              const errorCount = issues.filter(i => i.severity === 'error').length;
              const warningCount = issues.filter(i => i.severity === 'warning').length;
              if (errorCount === 0 && warningCount === 0) continue;
              const score = Math.max(0, 100 - (errorCount * 15) - (warningCount * 5));
              const severity = errorCount > 0 ? 'warning' : 'opportunity';
              upsertInsight({
                workspaceId: ws.id,
                pageId: page.url,
                insightType: 'page_health',
                data: {
                  score,
                  trend: 'stable',
                  clicks: 0,
                  impressions: 0,
                  position: 0,
                  ctr: 0,
                  pageviews: 0,
                  bounceRate: 0,
                  avgEngagementTime: 0,
                  // Audit-derived enrichment (not part of the canonical PageHealthData shape)
                  auditSnapshotId: id,
                  errorCount,
                  warningCount,
                  topIssues: issues.slice(0, 5).map(i => i.message),
                } as never,
                severity,
                impactScore: 100 - score,
                domain: 'cross',
                pageTitle: page.page ?? undefined,
                resolutionSource: 'bridge_12_audit_page_health',
                bridgeSource: 'bridge-audit-page-health',
              });
              modified++;
            }
          });
          return { modified };
        });
      }

      // Bridge #15 — site-level health insight
      // Returns { modified: 1 } so executeBridge() auto-broadcasts
      // INSIGHT_BRIDGE_UPDATED. Inline broadcastToWorkspace() removed to
      // prevent double-fire (same pattern as Bridge #12 above).
      if (isFeatureEnabled('bridge-audit-site-health')) {
        fireBridge('bridge-audit-site-health', ws.id, async () => {
          await withWorkspaceLock(ws.id, async () => {
            const { upsertInsight }: typeof AnalyticsInsightsStore = await import('./analytics-insights-store.js'); // dynamic-import-ok
            const delta = previousScore != null ? audit.siteScore - previousScore : null;
            const severity =
              audit.siteScore < 50 ? 'critical' :
              audit.siteScore < 70 ? 'warning' :
              delta != null && delta < -5 ? 'warning' :
              'positive';
            upsertInsight({
              workspaceId: ws.id,
              pageId: null,
              insightType: 'site_health',
              data: {
                auditSnapshotId: id,
                siteScore: audit.siteScore,
                previousScore: previousScore ?? null,
                scoreDelta: delta,
                totalPages: audit.totalPages,
                errors: audit.errors,
                warnings: audit.warnings,
                siteWideIssueCount: audit.siteWideIssues?.length ?? 0,
              },
              severity,
              impactScore: Math.max(0, 100 - audit.siteScore),
              domain: 'cross',
              resolutionSource: 'bridge_15_audit_site_health',
              bridgeSource: 'bridge-audit-site-health',
            });
          });
          return { modified: 1 };
        });
      }
    }
  }

  return snapshot;
}

function updateSnapshotFile(snapshot: AuditSnapshot): void {
  updateSnapshotStmt().run({
    id: snapshot.id,
    action_items: JSON.stringify(snapshot.actionItems || []),
  });
}

// --- Action Items CRUD ---

export function addActionItem(
  snapshotId: string,
  item: { title: string; description: string; priority: ActionPriority; category?: string }
): ActionItem | null {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) return null;

  const actionItem: ActionItem = {
    id: crypto.randomBytes(6).toString('hex'),
    snapshotId,
    title: item.title,
    description: item.description,
    status: 'planned',
    priority: item.priority,
    category: item.category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!snapshot.actionItems) snapshot.actionItems = [];
  snapshot.actionItems.push(actionItem);
  updateSnapshotFile(snapshot);
  return actionItem;
}

export function updateActionItem(
  snapshotId: string,
  itemId: string,
  updates: Partial<Pick<ActionItem, 'title' | 'description' | 'status' | 'priority' | 'category'>>
): ActionItem | null {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot || !snapshot.actionItems) return null;

  const item = snapshot.actionItems.find(a => a.id === itemId);
  if (!item) return null;

  if (updates.title !== undefined) item.title = updates.title;
  if (updates.description !== undefined) item.description = updates.description;
  if (updates.status !== undefined) item.status = updates.status;
  if (updates.priority !== undefined) item.priority = updates.priority;
  if (updates.category !== undefined) item.category = updates.category;
  item.updatedAt = new Date().toISOString();

  updateSnapshotFile(snapshot);
  return item;
}

export function deleteActionItem(snapshotId: string, itemId: string): boolean {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot || !snapshot.actionItems) return false;

  const idx = snapshot.actionItems.findIndex(a => a.id === itemId);
  if (idx === -1) return false;

  snapshot.actionItems.splice(idx, 1);
  updateSnapshotFile(snapshot);
  return true;
}

export function getActionItems(snapshotId: string): ActionItem[] {
  const snapshot = getSnapshot(snapshotId);
  return snapshot?.actionItems || [];
}

// --- Logo Extraction ---

export async function extractSiteLogo(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(baseUrl, { redirect: 'follow' });
    if (!res.ok) return null;
    const html = await res.text();
    let match;

    // Helper: extract src (or data-src for lazy-loaded) from an element string
    const extractSrc = (el: string): string | null => {
      const src = el.match(/src=["']([^"']+)["']/i);
      if (src && src[1] && !src[1].startsWith('data:')) return src[1];
      const dataSrc = el.match(/data-src=["']([^"']+)["']/i);
      if (dataSrc && dataSrc[1]) return dataSrc[1];
      return null;
    };

    // Strategy 1: Webflow navbar brand (w-nav-brand class)
    const navBrandRegex = /<a[^>]*class=["'][^"']*w-nav-brand[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = navBrandRegex.exec(html)) !== null) {
      const inner = match[1];
      const imgMatch = inner.match(/<img[^>]*/i);
      if (imgMatch) {
        const src = extractSrc(inner);
        if (src) return resolveUrl(baseUrl, src);
      }
    }

    // Strategy 2: Find <img> inside <nav> or <header>
    const navHeaderRegex = /<(?:nav|header)[^>]*>([\s\S]*?)<\/(?:nav|header)>/gi;
    while ((match = navHeaderRegex.exec(html)) !== null) {
      const inner = match[1];
      const src = extractSrc(inner);
      if (src) return resolveUrl(baseUrl, src);
      const svgImg = inner.match(/<image[^>]*href=["']([^"']+)["']/i);
      if (svgImg && svgImg[1]) return resolveUrl(baseUrl, svgImg[1]);
    }

    // Strategy 3: Look for elements with class containing "logo", "brand"
    const logoClassRegex = /<(?:img|a|div|span)[^>]*class=["'][^"']*(?:logo|brand|navbar-brand)[^"']*["'][^>]*>(?:[\s\S]*?<\/(?:a|div|span)>)?/gi;
    while ((match = logoClassRegex.exec(html)) !== null) {
      const src = extractSrc(match[0]);
      if (src) return resolveUrl(baseUrl, src);
      const nestedImg = match[0].match(/<img[^>]*/i);
      if (nestedImg) {
        const nestedSrc = extractSrc(nestedImg[0]);
        if (nestedSrc) return resolveUrl(baseUrl, nestedSrc);
      }
    }

    // Strategy 4: Look for img with "logo" in the src, alt, or id
    const logoImgRegex = /<img[^>]*(?:src|alt|id)=["'][^"']*logo[^"']*["'][^>]*>/gi;
    while ((match = logoImgRegex.exec(html)) !== null) {
      const src = extractSrc(match[0]);
      if (src) return resolveUrl(baseUrl, src);
    }

    // Strategy 5: OG image
    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImage && ogImage[1]) return resolveUrl(baseUrl, ogImage[1]);

    // Strategy 6: Favicon as last resort
    const favicon = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i);
    if (favicon && favicon[1] && !favicon[1].includes('favicon.ico')) {
      return resolveUrl(baseUrl, favicon[1]);
    }

    return null;
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'reports/extractSiteLogo: programming error');
    return null;
  }
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http://') || relative.startsWith('https://')) return relative;
  if (relative.startsWith('//')) return 'https:' + relative;
  try {
    return new URL(relative, base).toString();
  } catch (err) {
    return relative;
  }
}

export function getSnapshot(id: string): AuditSnapshot | null {
  const row = getSnapshotStmt().get(id) as SnapshotRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

export function listSnapshots(siteId: string): SnapshotSummary[] {
  const rows = listSnapshotsStmt().all(siteId) as SnapshotRow[];
  return rows.map(row => {
    const audit = parseJsonFallback<SeoAuditResult>(row.audit, { siteScore: 0, totalPages: 0, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [] } as SeoAuditResult);
    return {
      id: row.id,
      createdAt: row.created_at,
      siteScore: audit.siteScore,
      totalPages: audit.totalPages,
      errors: audit.errors,
      warnings: audit.warnings,
      infos: audit.infos,
    };
  });
}

export function getLatestSnapshot(siteId: string): AuditSnapshot | null {
  const summaries = listSnapshots(siteId);
  if (summaries.length === 0) return null;
  return getSnapshot(summaries[0].id);
}

export function getLatestSnapshotBefore(siteId: string, beforeSnapshotId: string): AuditSnapshot | null {
  const summaries = listSnapshots(siteId);
  const idx = summaries.findIndex(s => s.id === beforeSnapshotId);
  if (idx < 0 || idx + 1 >= summaries.length) return null;
  return getSnapshot(summaries[idx + 1].id);
}

export function renderReportHTML(snapshot: AuditSnapshot): string {
  const { audit, siteName, createdAt, logoUrl, actionItems, previousScore } = snapshot;
  const date = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const scoreColor = audit.siteScore >= 80 ? '#22c55e' : audit.siteScore >= 60 ? '#eab308' : audit.siteScore >= 40 ? '#f97316' : '#ef4444';

  // Score delta (if previous score exists)
  const scoreDelta = previousScore !== undefined ? audit.siteScore - previousScore : null;
  const deltaHTML = scoreDelta !== null
    ? `<div style="font-size:14px;margin-top:8px;color:${scoreDelta > 0 ? '#22c55e' : scoreDelta < 0 ? '#ef4444' : '#64748b'}">
        ${scoreDelta > 0 ? '↑' : scoreDelta < 0 ? '↓' : '→'} ${scoreDelta > 0 ? '+' : ''}${scoreDelta} points since last audit
      </div>`
    : '';

  // For client-facing report, filter out performance category issues (PageSpeed-type flags)
  const clientPages = audit.pages.map(p => ({
    ...p,
    issues: p.issues.filter(i => (i.category || 'technical') !== 'performance'),
  }));
  const clientSiteWide = audit.siteWideIssues.filter(i => (i.category || 'technical') !== 'performance');

  // Recalculate counts without performance issues
  const clientErrors = clientPages.reduce((s, p) => s + p.issues.filter(i => i.severity === 'error').length, 0)
    + clientSiteWide.filter(i => i.severity === 'error').length;
  const clientWarnings = clientPages.reduce((s, p) => s + p.issues.filter(i => i.severity === 'warning').length, 0)
    + clientSiteWide.filter(i => i.severity === 'warning').length;
  const clientInfos = clientPages.reduce((s, p) => s + p.issues.filter(i => i.severity === 'info').length, 0)
    + clientSiteWide.filter(i => i.severity === 'info').length;

  // (No category breakdown or executive summary — clean technical audit)

  // Action items section
  const actions = actionItems || [];
  const actionsByStatus = {
    completed: actions.filter(a => a.status === 'completed'),
    'in-progress': actions.filter(a => a.status === 'in-progress'),
    planned: actions.filter(a => a.status === 'planned'),
  };
  const actionStatusColors: Record<string, { bg: string; color: string; label: string }> = {
    completed: { bg: 'rgba(34,197,94,0.08)', color: '#22c55e', label: 'Completed' },
    'in-progress': { bg: 'rgba(59,130,246,0.08)', color: '#3b82f6', label: 'In Progress' },
    planned: { bg: 'rgba(100,116,139,0.08)', color: '#94a3b8', label: 'Planned' },
  };
  const priorityIcons: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' };

  const actionItemsHTML = actions.length > 0
    ? `<div style="margin:32px 0">
        <div class="section-title">Work Progress</div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          ${Object.entries(actionsByStatus).filter(([, items]) => items.length > 0).map(([status, items]) => {
            const cfg = actionStatusColors[status];
            return `<div style="padding:8px 16px;border-radius:6px;background:${cfg.bg};border:1px solid ${cfg.color}22;text-align:center;flex:1">
              <div style="font-size:18px;font-weight:600;color:${cfg.color}">${items.length}</div>
              <div style="font-size:10px;color:${cfg.color};text-transform:uppercase;letter-spacing:0.5px">${cfg.label}</div>
            </div>`;
          }).join('')}
        </div>
        ${(['in-progress', 'planned', 'completed'] as const).map(status => {
          const items = actionsByStatus[status];
          if (items.length === 0) return '';
          const cfg = actionStatusColors[status];
          return `<div style="margin:12px 0">
            <div style="font-size:12px;font-weight:600;color:${cfg.color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">${cfg.label}</div>
            ${items.map(item => `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;margin:4px 0;border-radius:6px;background:${cfg.bg};border:1px solid ${cfg.color}22">
              <span style="font-size:12px">${status === 'completed' ? '✓' : status === 'in-progress' ? '◐' : '○'}</span>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:500;color:#f1f5f9">${item.title}</div>
                ${item.description ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${item.description}</div>` : ''}
              </div>
              <span style="font-size:11px">${priorityIcons[item.priority] || ''}</span>
            </div>`).join('')}
          </div>`;
        }).join('')}
      </div>`
    : '';

  // (No category summary — clean technical audit)

  // Page rows — structured "Problem → Fix" format for technical audit
  const pageRows = clientPages.map(p => {
    const pColor = p.score >= 80 ? '#22c55e' : p.score >= 60 ? '#eab308' : p.score >= 40 ? '#f97316' : '#ef4444';
    const sevIcon = (s: string) => s === 'error' ? '✗' : s === 'warning' ? '⚠' : 'ℹ';
    const sevColor = (s: string) => s === 'error' ? '#ef4444' : s === 'warning' ? '#eab308' : '#60a5fa';
    const sevBg = (s: string) => s === 'error' ? 'rgba(239,68,68,0.08)' : s === 'warning' ? 'rgba(234,179,8,0.06)' : 'rgba(96,165,250,0.06)';
    const sevBorder = (s: string) => s === 'error' ? 'rgba(239,68,68,0.2)' : s === 'warning' ? 'rgba(234,179,8,0.15)' : 'rgba(96,165,250,0.15)';

    const issueList = p.issues.map(i => {
      return `<div style="padding:10px 14px;margin:6px 0;border-radius:6px;background:${sevBg(i.severity)};border:1px solid ${sevBorder(i.severity)}">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <span style="color:${sevColor(i.severity)};font-size:14px;line-height:1;flex-shrink:0;margin-top:1px">${sevIcon(i.severity)}</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:${sevColor(i.severity)};margin-bottom:4px">Problem: ${i.message}</div>
            <div style="font-size:12px;color:#e2e8f0;line-height:1.5"><strong style="color:#2ed9c3">Fix:</strong> ${i.recommendation}</div>
            ${i.value ? `<div style="font-size:11px;color:#64748b;margin-top:4px;font-family:monospace;word-break:break-all">Current: ${i.value}</div>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    return `<div style="margin-bottom:16px;border:1px solid rgba(255,255,255,0.06);border-radius:8px;overflow:hidden">
      <div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.02)">
        <div>
          <div style="font-size:14px;font-weight:500;color:#f1f5f9">${p.page}</div>
          <div style="font-size:12px;color:#64748b">${p.slug || '/'}</div>
        </div>
        <div style="font-size:20px;font-weight:700;color:${pColor}">${p.score}</div>
      </div>
      ${p.issues.length > 0 ? `<div style="padding:8px 12px">${issueList}</div>` : '<div style="padding:12px 16px;font-size:13px;color:#22c55e">✓ No issues found</div>'}
    </div>`;
  }).join('');

  // Site-wide rows — structured "Problem → Fix" format
  const siteWideRows = clientSiteWide.map(i => {
    const iColor = i.severity === 'error' ? '#ef4444' : i.severity === 'warning' ? '#eab308' : '#60a5fa';
    const iIcon = i.severity === 'error' ? '✗' : i.severity === 'warning' ? '⚠' : 'ℹ';
    const iBg = i.severity === 'error' ? 'rgba(239,68,68,0.08)' : i.severity === 'warning' ? 'rgba(234,179,8,0.06)' : 'rgba(96,165,250,0.06)';
    const iBorder = i.severity === 'error' ? 'rgba(239,68,68,0.2)' : i.severity === 'warning' ? 'rgba(234,179,8,0.15)' : 'rgba(96,165,250,0.15)';
    return `<div style="padding:10px 14px;margin:6px 0;border-radius:6px;background:${iBg};border:1px solid ${iBorder}">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="color:${iColor};font-size:14px;line-height:1;flex-shrink:0;margin-top:1px">${iIcon}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:${iColor};margin-bottom:4px">Problem: ${i.message}</div>
          <div style="font-size:12px;color:#e2e8f0;line-height:1.5"><strong style="color:#2ed9c3">Fix:</strong> ${i.recommendation}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  // (Data analyst enhancements removed — this is a clean technical audit)

  // Client logo
  const logoHTML = logoUrl
    ? `<img src="${logoUrl}" alt="${siteName}" style="max-height:40px;max-width:200px;margin-bottom:16px;opacity:0.9" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SEO Audit Report — ${siteName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#0f1219; color:#e2e8f0; min-height:100vh; }
    .container { max-width:800px; margin:0 auto; padding:40px 24px; }
    .header { text-align:center; margin-bottom:32px; }
    .score-ring { width:120px; height:120px; margin:0 auto 16px; position:relative; }
    .score-ring svg { transform:rotate(-90deg); }
    .score-number { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:36px; font-weight:700; }
    .stats { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:20px; }
    .stat { padding:10px 20px; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); text-align:center; }
    .stat-value { font-size:20px; font-weight:600; }
    .stat-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-top:2px; }
    .section-title { font-size:16px; font-weight:600; color:#f1f5f9; margin:32px 0 16px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06); }
    .footer { text-align:center; margin-top:48px; padding-top:24px; border-top:1px solid rgba(255,255,255,0.06); }
    .footer a { color:#2ed9c3; text-decoration:none; }
    .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:500; }
    @media print { body { background:#fff; color:#1e293b; } .container { padding:20px; } }
  </style>
</head>
<body>
  <div class="container">
    <!-- Branded header -->
    <div class="header">
      <div style="margin-bottom:20px">
        <svg xmlns="http://www.w3.org/2000/svg" width="140" height="45" viewBox="0 0 1000 320" style="opacity:0.85">
          <g><path d="M47.235,5.654V89.544c13.786-17.858,30.704-23.185,48.25-23.185,43.865,0,63.29,29.765,63.29,75.196v79.502c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-79.189c0-28.2-14.726-40.104-35.091-40.104-22.56,0-38.224,19.111-38.224,42.297v76.997c0,1.082-.877,1.959-1.959,1.959H10.97c-1.082,0-1.959-.877-1.959-1.959V5.654c0-1.082,.877-1.959,1.959-1.959H45.276c1.082,0,1.959,.877,1.959,1.959Z" fill="#2ed9c3"/><path d="M303.05,223.016c-1.082,0-1.959-.877-1.959-1.959v-80.755c0-20.366-10.653-38.852-31.645-38.852-20.679,0-32.898,18.486-32.898,38.852v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h31.757c.97,0,1.794,.709,1.938,1.669l2.571,17.129c8.146-15.665,26.004-21.305,40.73-21.305,18.486,0,36.971,7.52,45.745,28.825,13.786-21.932,31.645-28.198,51.697-28.198,43.865,0,65.483,26.945,65.483,73.316v81.382c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-81.382c0-20.366-8.46-37.599-29.139-37.599s-33.525,17.86-33.525,38.226v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/><path d="M480.221,310.401V70.51c0-1.082,.877-1.959,1.959-1.959h32.015c.994,0,1.83,.744,1.946,1.73l2.304,19.577c11.906-17.233,32.584-24.754,50.13-24.754,47.623,0,79.268,35.405,79.268,80.836,0,45.117-28.512,80.836-78.015,80.836-16.292,0-40.418-5.013-51.383-21.933v105.558c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959Zm129.398-164.461c0-24.124-16.292-43.865-43.865-43.865s-43.863,19.74-43.863,43.865,17.858,43.865,43.863,43.865,43.865-19.739,43.865-43.865Z" fill="#2ed9c3"/><path d="M781.403,108.059c-.718,.845-1.968,.908-2.802,.177-10.606-9.285-22.666-12.427-36.728-12.427-18.172,0-28.198,5.64-28.198,15.353,0,10.026,9.087,15.666,28.825,16.919,29.139,1.88,66.109,8.46,66.109,49.503,0,27.259-22.244,50.758-66.423,50.758-24.026,0-48.053-3.938-70.293-26.4-.663-.67-.755-1.735-.22-2.51l16.543-23.985c.694-1.007,2.113-1.119,2.994-.27,14.636,14.119,35.008,19.652,51.604,19.954,14.412,.312,27.885-5.64,27.885-16.919,0-10.653-8.773-16.606-30.706-17.858-29.137-2.194-63.915-12.847-63.915-47.938,0-35.717,36.971-48.25,65.17-48.25,23.453,0,41.281,4.442,58.666,19.084,.827,.697,.923,1.95,.223,2.774l-18.732,22.037Z" fill="#2ed9c3"/><path d="M958.735,223.016c-1.082,0-1.959-.877-1.959-1.959v-78.877c0-23.356-12.69-41.14-36.841-41.355-21.958-.196-39.922,18.489-39.922,40.448v79.784c0,1.082-.877,1.959-1.959,1.959h-33.992c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h30.452c.992,0,1.828,.742,1.946,1.727l2.301,19.264c15.665-15.353,31.331-23.185,50.756-23.185,36.346,0,65.483,27.259,65.483,75.823v79.189c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/></g>
          <g><path d="M46.137,267.39c-.706,.619-1.753,.656-2.484,.067-3.444-2.774-8.564-4.008-12.792-4.008-5.949,0-10.777,2.501-10.777,6.64,0,5.518,5.259,6.553,13.019,7.242,11.9,1.035,23.194,5.604,23.194,19.572,0,13.451-12.416,19.314-25.436,19.4-9.88,.082-20.147-3.547-25.527-11.109-.53-.745-.408-1.775,.225-2.435l5.464-5.699c.76-.792,2.03-.812,2.791-.021,4.697,4.877,11.559,7.022,17.133,7.022,7.157,0,12.072-2.845,12.072-7.158,.086-5.086-3.967-7.414-12.158-8.105-12.761-1.205-24.143-4.397-23.97-18.623,.087-11.986,11.468-18.365,23.884-18.365,8.61,0,15.229,1.768,21.085,7.758,.794,.813,.767,2.125-.087,2.875l-5.636,4.947Z" fill="#2ed9c3"/><path d="M100.176,265.95h-16.407c-1.082,0-1.959-.877-1.959-1.959v-8.067c0-1.082,.877-1.959,1.959-1.959h46.178c1.082,0,1.959,.877,1.959,1.959v8.067c0,1.082-.877,1.959-1.959,1.959h-16.407v46.412c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959v-46.412Z" fill="#2ed9c3"/><path d="M213.833,254.051c1.082,0,1.959,.877,1.959,1.959v31.755c0,17.934-10.001,27.505-25.867,28.022-15.779,.517-29.143-8.536-29.143-28.022v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v31.755c0,10.778,6.036,16.383,15.865,15.95,9.139-.603,12.416-6.898,12.416-15.95v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446Z" fill="#2ed9c3"/><path d="M274.673,253.965c20.78,0,30.005,13.968,30.005,29.748s-8.881,30.609-30.005,30.609h-22.787c-1.082,0-1.959-.877-1.959-1.959v-56.438c0-1.082,.877-1.959,1.959-1.959h22.787Zm-11.468,47.941h11.468c13.106,0,16.727-9.657,16.727-18.365s-4.139-17.418-16.727-17.418h-11.468v35.783Z" fill="#2ed9c3"/><path d="M336.398,312.362v-56.438c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v56.438c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959Z" fill="#2ed9c3"/><path d="M413.907,315.787c-19.314,0-32.592-11.986-32.592-31.644s13.278-31.644,32.592-31.644,32.592,11.986,32.592,31.644-13.278,31.644-32.592,31.644Zm0-51.216c-11.468,0-19.4,8.622-19.4,19.572,0,11.295,7.932,19.486,19.4,19.486,11.726,0,19.4-8.277,19.4-19.486,0-11.037-7.674-19.572-19.4-19.572Z" fill="#2ed9c3"/></g>
        </svg>
      </div>
      ${logoHTML}
      <div style="font-size:13px;color:#2ed9c3;font-weight:500;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px">SEO Audit Report</div>
      <h1 style="font-size:24px;font-weight:600;color:#f1f5f9">${siteName}</h1>
      <div style="font-size:13px;color:#64748b;margin-top:4px">${date}</div>
      
      <div class="score-ring">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="${scoreColor}" stroke-width="8" 
            stroke-dasharray="${(audit.siteScore / 100) * 327} 327" stroke-linecap="round"/>
        </svg>
        <div class="score-number" style="color:${scoreColor}">${audit.siteScore}</div>
      </div>
      ${deltaHTML}
      
      <div class="stats">
        <div class="stat">
          <div class="stat-value" style="color:#f1f5f9">${audit.totalPages}</div>
          <div class="stat-label">Pages</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color:#ef4444">${clientErrors}</div>
          <div class="stat-label">Errors</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color:#eab308">${clientWarnings}</div>
          <div class="stat-label">Warnings</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color:#60a5fa">${clientInfos}</div>
          <div class="stat-label">Info</div>
        </div>
      </div>
    </div>

    ${actionItemsHTML}

    ${clientSiteWide.length > 0 ? `<div class="section-title">Site-Wide Issues</div>${siteWideRows}` : ''}
    
    <div class="section-title">Page-by-Page Results</div>
    ${pageRows}

    <div class="footer">
      <div style="margin-bottom:12px">
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="32" viewBox="0 0 1000 320" style="opacity:0.4">
          <g><path d="M47.235,5.654V89.544c13.786-17.858,30.704-23.185,48.25-23.185,43.865,0,63.29,29.765,63.29,75.196v79.502c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-79.189c0-28.2-14.726-40.104-35.091-40.104-22.56,0-38.224,19.111-38.224,42.297v76.997c0,1.082-.877,1.959-1.959,1.959H10.97c-1.082,0-1.959-.877-1.959-1.959V5.654c0-1.082,.877-1.959,1.959-1.959H45.276c1.082,0,1.959,.877,1.959,1.959Z" fill="#2ed9c3"/><path d="M303.05,223.016c-1.082,0-1.959-.877-1.959-1.959v-80.755c0-20.366-10.653-38.852-31.645-38.852-20.679,0-32.898,18.486-32.898,38.852v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h31.757c.97,0,1.794,.709,1.938,1.669l2.571,17.129c8.146-15.665,26.004-21.305,40.73-21.305,18.486,0,36.971,7.52,45.745,28.825,13.786-21.932,31.645-28.198,51.697-28.198,43.865,0,65.483,26.945,65.483,73.316v81.382c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-81.382c0-20.366-8.46-37.599-29.139-37.599s-33.525,17.86-33.525,38.226v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/><path d="M480.221,310.401V70.51c0-1.082,.877-1.959,1.959-1.959h32.015c.994,0,1.83,.744,1.946,1.73l2.304,19.577c11.906-17.233,32.584-24.754,50.13-24.754,47.623,0,79.268,35.405,79.268,80.836,0,45.117-28.512,80.836-78.015,80.836-16.292,0-40.418-5.013-51.383-21.933v105.558c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959Zm129.398-164.461c0-24.124-16.292-43.865-43.865-43.865s-43.863,19.74-43.863,43.865,17.858,43.865,43.863,43.865,43.865-19.739,43.865-43.865Z" fill="#2ed9c3"/><path d="M781.403,108.059c-.718,.845-1.968,.908-2.802,.177-10.606-9.285-22.666-12.427-36.728-12.427-18.172,0-28.198,5.64-28.198,15.353,0,10.026,9.087,15.666,28.825,16.919,29.139,1.88,66.109,8.46,66.109,49.503,0,27.259-22.244,50.758-66.423,50.758-24.026,0-48.053-3.938-70.293-26.4-.663-.67-.755-1.735-.22-2.51l16.543-23.985c.694-1.007,2.113-1.119,2.994-.27,14.636,14.119,35.008,19.652,51.604,19.954,14.412,.312,27.885-5.64,27.885-16.919,0-10.653-8.773-16.606-30.706-17.858-29.137-2.194-63.915-12.847-63.915-47.938,0-35.717,36.971-48.25,65.17-48.25,23.453,0,41.281,4.442,58.666,19.084,.827,.697,.923,1.95,.223,2.774l-18.732,22.037Z" fill="#2ed9c3"/><path d="M958.735,223.016c-1.082,0-1.959-.877-1.959-1.959v-78.877c0-23.356-12.69-41.14-36.841-41.355-21.958-.196-39.922,18.489-39.922,40.448v79.784c0,1.082-.877,1.959-1.959,1.959h-33.992c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h30.452c.992,0,1.828,.742,1.946,1.727l2.301,19.264c15.665-15.353,31.331-23.185,50.756-23.185,36.346,0,65.483,27.259,65.483,75.823v79.189c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/></g>
          <g><path d="M46.137,267.39c-.706,.619-1.753,.656-2.484,.067-3.444-2.774-8.564-4.008-12.792-4.008-5.949,0-10.777,2.501-10.777,6.64,0,5.518,5.259,6.553,13.019,7.242,11.9,1.035,23.194,5.604,23.194,19.572,0,13.451-12.416,19.314-25.436,19.4-9.88,.082-20.147-3.547-25.527-11.109-.53-.745-.408-1.775,.225-2.435l5.464-5.699c.76-.792,2.03-.812,2.791-.021,4.697,4.877,11.559,7.022,17.133,7.022,7.157,0,12.072-2.845,12.072-7.158,.086-5.086-3.967-7.414-12.158-8.105-12.761-1.205-24.143-4.397-23.97-18.623,.087-11.986,11.468-18.365,23.884-18.365,8.61,0,15.229,1.768,21.085,7.758,.794,.813,.767,2.125-.087,2.875l-5.636,4.947Z" fill="#2ed9c3"/><path d="M100.176,265.95h-16.407c-1.082,0-1.959-.877-1.959-1.959v-8.067c0-1.082,.877-1.959,1.959-1.959h46.178c1.082,0,1.959,.877,1.959,1.959v8.067c0,1.082-.877,1.959-1.959,1.959h-16.407v46.412c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959v-46.412Z" fill="#2ed9c3"/><path d="M213.833,254.051c1.082,0,1.959,.877,1.959,1.959v31.755c0,17.934-10.001,27.505-25.867,28.022-15.779,.517-29.143-8.536-29.143-28.022v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v31.755c0,10.778,6.036,16.383,15.865,15.95,9.139-.603,12.416-6.898,12.416-15.95v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446Z" fill="#2ed9c3"/><path d="M274.673,253.965c20.78,0,30.005,13.968,30.005,29.748s-8.881,30.609-30.005,30.609h-22.787c-1.082,0-1.959-.877-1.959-1.959v-56.438c0-1.082,.877-1.959,1.959-1.959h22.787Zm-11.468,47.941h11.468c13.106,0,16.727-9.657,16.727-18.365s-4.139-17.418-16.727-17.418h-11.468v35.783Z" fill="#2ed9c3"/><path d="M336.398,312.362v-56.438c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v56.438c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959Z" fill="#2ed9c3"/><path d="M413.907,315.787c-19.314,0-32.592-11.986-32.592-31.644s13.278-31.644,32.592-31.644,32.592,11.986,32.592,31.644-13.278,31.644-32.592,31.644Zm0-51.216c-11.468,0-19.4,8.622-19.4,19.572,0,11.295,7.932,19.486,19.4,19.486,11.726,0,19.4-8.277,19.4-19.486,0-11.037-7.674-19.572-19.4-19.572Z" fill="#2ed9c3"/></g>
        </svg>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:4px">Prepared by <a href="${STUDIO_URL}">${STUDIO_NAME}</a></div>
      <div style="font-size:11px;color:#475569">Report ID: ${snapshot.id}</div>
    </div>
  </div>
</body>
</html>`;
}
