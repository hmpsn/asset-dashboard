import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SeoAuditResult } from './seo-audit.js';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const REPORTS_DIR = DATA_BASE
  ? path.join(DATA_BASE, 'reports')
  : path.join(process.env.HOME || '', '.asset-dashboard', 'reports');

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

function siteDir(siteId: string): string {
  const dir = path.join(REPORTS_DIR, siteId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
  const filePath = path.join(siteDir(siteId), `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function updateSnapshotFile(snapshot: AuditSnapshot): void {
  // Find the snapshot file across all site dirs
  if (!fs.existsSync(REPORTS_DIR)) return;
  const sites = fs.readdirSync(REPORTS_DIR);
  for (const site of sites) {
    const filePath = path.join(REPORTS_DIR, site, `${snapshot.id}.json`);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
      return;
    }
  }
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

    // Strategy 1: Webflow navbar brand (w-nav-brand class) — most Webflow sites use this
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
      // Also check for SVG with an image/src
      const svgImg = inner.match(/<image[^>]*href=["']([^"']+)["']/i);
      if (svgImg && svgImg[1]) return resolveUrl(baseUrl, svgImg[1]);
    }

    // Strategy 3: Look for elements with class containing "logo", "brand"
    const logoClassRegex = /<(?:img|a|div|span)[^>]*class=["'][^"']*(?:logo|brand|navbar-brand)[^"']*["'][^>]*>(?:[\s\S]*?<\/(?:a|div|span)>)?/gi;
    while ((match = logoClassRegex.exec(html)) !== null) {
      const src = extractSrc(match[0]);
      if (src) return resolveUrl(baseUrl, src);
      // Check for nested img
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

    // Strategy 5: OG image — many sites use their logo or branded image
    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImage && ogImage[1]) return resolveUrl(baseUrl, ogImage[1]);

    // Strategy 6: Favicon as last resort
    const favicon = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i);
    if (favicon && favicon[1] && !favicon[1].includes('favicon.ico')) {
      return resolveUrl(baseUrl, favicon[1]);
    }

    return null;
  } catch {
    return null;
  }
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http://') || relative.startsWith('https://')) return relative;
  if (relative.startsWith('//')) return 'https:' + relative;
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

export function getSnapshot(id: string): AuditSnapshot | null {
  // Search all site directories for this snapshot
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const sites = fs.readdirSync(REPORTS_DIR);
  for (const site of sites) {
    const filePath = path.join(REPORTS_DIR, site, `${id}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  }
  return null;
}

export function listSnapshots(siteId: string): SnapshotSummary[] {
  const dir = path.join(REPORTS_DIR, siteId);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const summaries: SnapshotSummary[] = [];

  for (const file of files) {
    try {
      const data: AuditSnapshot = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      summaries.push({
        id: data.id,
        createdAt: data.createdAt,
        siteScore: data.audit.siteScore,
        totalPages: data.audit.totalPages,
        errors: data.audit.errors,
        warnings: data.audit.warnings,
        infos: data.audit.infos,
      });
    } catch { /* skip corrupt files */ }
  }

  return summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getLatestSnapshot(siteId: string): AuditSnapshot | null {
  const summaries = listSnapshots(siteId);
  if (summaries.length === 0) return null;
  return getSnapshot(summaries[0].id);
}

export function renderReportHTML(snapshot: AuditSnapshot): string {
  const { audit, siteName, createdAt, logoUrl, actionItems, previousScore } = snapshot;
  const date = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const scoreColor = audit.siteScore >= 80 ? '#22c55e' : audit.siteScore >= 60 ? '#eab308' : audit.siteScore >= 40 ? '#f97316' : '#ef4444';

  const catColors: Record<string, string> = {
    content: '#34d399', technical: '#a78bfa', social: '#f472b6',
    performance: '#fb923c', accessibility: '#38bdf8',
  };

  // Score delta
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

  // Category breakdown (excluding performance)
  const catCounts: Record<string, number> = {};
  for (const p of clientPages) {
    for (const i of p.issues) {
      catCounts[i.category || 'technical'] = (catCounts[i.category || 'technical'] || 0) + 1;
    }
  }
  for (const i of clientSiteWide) {
    catCounts[i.category || 'technical'] = (catCounts[i.category || 'technical'] || 0) + 1;
  }

  // Executive summary: top 3 most impactful issues (using client-filtered data)
  const allErrors = [
    ...clientSiteWide.filter(i => i.severity === 'error'),
    ...clientPages.flatMap(p => p.issues.filter(i => i.severity === 'error')),
  ];
  const allWarnings = [
    ...clientSiteWide.filter(i => i.severity === 'warning'),
    ...clientPages.flatMap(p => p.issues.filter(i => i.severity === 'warning')),
  ];
  // Deduplicate by check name and count occurrences
  const issueCounts = new Map<string, { check: string; message: string; recommendation: string; count: number; severity: string }>();
  for (const issue of [...allErrors, ...allWarnings]) {
    const existing = issueCounts.get(issue.check);
    if (existing) {
      existing.count++;
    } else {
      issueCounts.set(issue.check, { check: issue.check, message: issue.message, recommendation: issue.recommendation, count: 1, severity: issue.severity });
    }
  }
  const topIssues = [...issueCounts.values()]
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, 3);

  const executiveSummaryHTML = topIssues.length > 0
    ? `<div style="margin:32px 0">
        <div class="section-title">Top Priorities</div>
        ${topIssues.map((issue, idx) => {
          const color = issue.severity === 'error' ? '#ef4444' : '#eab308';
          return `<div style="display:flex;gap:12px;padding:14px 16px;margin:8px 0;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
            <div style="width:28px;height:28px;border-radius:50%;background:${color}15;color:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">${idx + 1}</div>
            <div>
              <div style="font-size:14px;font-weight:500;color:#f1f5f9">${issue.message}${issue.count > 1 ? ` <span style="color:#64748b;font-weight:400">(${issue.count} pages)</span>` : ''}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px">${issue.recommendation}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`
    : '';

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

  // Category breakdown
  const catSummaryHTML = Object.entries(catCounts).length > 0
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;justify-content:center">${
        Object.entries(catCounts).map(([cat, count]) => {
          const color = catColors[cat] || '#94a3b8';
          const label = cat.charAt(0).toUpperCase() + cat.slice(1);
          return `<div style="padding:6px 14px;border-radius:6px;background:${color}11;border:1px solid ${color}22;text-align:center">
            <div style="font-size:16px;font-weight:600;color:${color}">${count}</div>
            <div style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:0.5px">${label}</div>
          </div>`;
        }).join('')
      }</div>`
    : '';

  // Page rows (using client-filtered data — no performance issues)
  const pageRows = clientPages.map(p => {
    const pColor = p.score >= 80 ? '#22c55e' : p.score >= 60 ? '#eab308' : p.score >= 40 ? '#f97316' : '#ef4444';
    const issueList = p.issues.map(i => {
      const iColor = i.severity === 'error' ? '#ef4444' : i.severity === 'warning' ? '#eab308' : '#60a5fa';
      const cColor = catColors[i.category || 'technical'] || '#94a3b8';
      const cLabel = (i.category || 'technical').charAt(0).toUpperCase() + (i.category || 'technical').slice(1);
      return `<div style="padding:8px 12px;margin:4px 0;border-radius:6px;background:${i.severity === 'error' ? 'rgba(239,68,68,0.08)' : i.severity === 'warning' ? 'rgba(234,179,8,0.08)' : 'rgba(96,165,250,0.08)'};border:1px solid ${i.severity === 'error' ? 'rgba(239,68,68,0.2)' : i.severity === 'warning' ? 'rgba(234,179,8,0.2)' : 'rgba(96,165,250,0.2)'}">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="font-size:13px;color:${iColor};font-weight:500;flex:1">${i.severity.toUpperCase()}: ${i.message}</div>
          <span class="badge" style="color:${cColor};border:1px solid ${cColor}33;background:${cColor}11">${cLabel}</span>
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px">${i.recommendation}</div>
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

  // Site-wide rows (using client-filtered data — no performance issues)
  const siteWideRows = clientSiteWide.map(i => {
    const iColor = i.severity === 'error' ? '#ef4444' : i.severity === 'warning' ? '#eab308' : '#60a5fa';
    const cColor = catColors[i.category || 'technical'] || '#94a3b8';
    const cLabel = (i.category || 'technical').charAt(0).toUpperCase() + (i.category || 'technical').slice(1);
    return `<div style="padding:10px 14px;margin:6px 0;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06)">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-size:13px;color:${iColor};font-weight:500;flex:1">${i.severity.toUpperCase()}: ${i.message}</div>
        <span class="badge" style="color:${cColor};border:1px solid ${cColor}33;background:${cColor}11">${cLabel}</span>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px">${i.recommendation}</div>
    </div>`;
  }).join('');

  // --- DATA ANALYST ENHANCEMENTS ---

  // Score context: plain-English interpretation
  const scoreGrade = audit.siteScore >= 90 ? 'Excellent' : audit.siteScore >= 80 ? 'Good' : audit.siteScore >= 60 ? 'Needs Improvement' : audit.siteScore >= 40 ? 'Poor' : 'Critical';
  const scoreContext = audit.siteScore >= 90
    ? 'Your site is well-optimized for search engines. Focus on maintaining this standard and addressing any remaining minor issues.'
    : audit.siteScore >= 80
    ? 'Your site has a solid SEO foundation with room for targeted improvements that could further boost your visibility.'
    : audit.siteScore >= 60
    ? 'Your site has several SEO gaps that are likely costing you search visibility. Addressing the issues below could significantly increase your organic traffic.'
    : audit.siteScore >= 40
    ? 'Your site has critical SEO deficiencies that are severely limiting your search engine visibility. Immediate action is recommended.'
    : 'Your site has fundamental SEO issues that are preventing search engines from properly indexing and ranking your content.';

  // Search visibility risk: pages missing critical elements
  const missingTitles = clientPages.filter(p => p.issues.some(i => i.check === 'title' && i.severity === 'error')).length;
  const missingDescriptions = clientPages.filter(p => p.issues.some(i => i.check === 'meta-description' && (i.severity === 'error' || i.severity === 'warning'))).length;
  const missingOG = clientPages.filter(p => p.issues.some(i => i.check === 'og-tags')).length;
  const missingH1 = clientPages.filter(p => p.issues.some(i => i.check === 'h1' && i.severity === 'error')).length;
  const missingAlt = clientPages.filter(p => p.issues.some(i => i.check === 'img-alt')).length;
  const totalPages = clientPages.length;
  const pctWithIssues = totalPages > 0 ? Math.round((clientPages.filter(p => p.issues.length > 0).length / totalPages) * 100) : 0;

  const visibilityRiskHTML = `<div style="margin:32px 0">
    <div class="section-title">Search Visibility Risk Assessment</div>
    <div style="font-size:13px;color:#94a3b8;margin-bottom:16px">${pctWithIssues}% of your pages have at least one SEO issue that could impact their search performance.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      ${missingTitles > 0 ? `<div style="padding:12px 16px;border-radius:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15)">
        <div style="font-size:24px;font-weight:700;color:#ef4444">${missingTitles}</div>
        <div style="font-size:11px;color:#ef4444;margin-top:2px">Pages without title tags</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px">Invisible to search engines</div>
      </div>` : ''}
      ${missingDescriptions > 0 ? `<div style="padding:12px 16px;border-radius:8px;background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.15)">
        <div style="font-size:24px;font-weight:700;color:#eab308">${missingDescriptions}</div>
        <div style="font-size:11px;color:#eab308;margin-top:2px">Missing meta descriptions</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px">Lower click-through rates</div>
      </div>` : ''}
      ${missingOG > 0 ? `<div style="padding:12px 16px;border-radius:8px;background:rgba(244,114,182,0.06);border:1px solid rgba(244,114,182,0.15)">
        <div style="font-size:24px;font-weight:700;color:#f472b6">${missingOG}</div>
        <div style="font-size:11px;color:#f472b6;margin-top:2px">Missing Open Graph tags</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px">Poor social sharing appearance</div>
      </div>` : ''}
      ${missingH1 > 0 ? `<div style="padding:12px 16px;border-radius:8px;background:rgba(251,146,60,0.06);border:1px solid rgba(251,146,60,0.15)">
        <div style="font-size:24px;font-weight:700;color:#fb923c">${missingH1}</div>
        <div style="font-size:11px;color:#fb923c;margin-top:2px">Missing H1 headings</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px">Weakened content relevance</div>
      </div>` : ''}
      ${missingAlt > 0 ? `<div style="padding:12px 16px;border-radius:8px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15)">
        <div style="font-size:24px;font-weight:700;color:#38bdf8">${missingAlt}</div>
        <div style="font-size:11px;color:#38bdf8;margin-top:2px">Pages with missing alt text</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px">Accessibility &amp; image SEO gap</div>
      </div>` : ''}
    </div>
  </div>`;

  // Quick Wins: single-fix issues that affect many pages
  const quickWinChecks = [...issueCounts.values()]
    .filter(i => i.count >= 2 && ['meta-description', 'og-tags', 'og-image', 'twitter-card', 'img-alt', 'canonical'].includes(i.check))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const quickWinsHTML = quickWinChecks.length > 0
    ? `<div style="margin:32px 0">
        <div class="section-title">Quick Wins</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:12px">These fixes can be applied in bulk and will improve your SEO across multiple pages at once.</div>
        ${quickWinChecks.map(qw => {
          const impactPct = totalPages > 0 ? Math.round((qw.count / totalPages) * 100) : 0;
          return `<div style="display:flex;gap:12px;padding:14px 16px;margin:8px 0;border-radius:8px;background:rgba(46,217,195,0.04);border:1px solid rgba(46,217,195,0.12)">
            <div style="width:48px;height:48px;border-radius:8px;background:rgba(46,217,195,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <span style="font-size:18px;font-weight:700;color:#2ed9c3">${qw.count}</span>
            </div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:500;color:#f1f5f9">${qw.message}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px">${qw.recommendation}</div>
              <div style="font-size:11px;color:#2ed9c3;margin-top:4px">Affects ${impactPct}% of your site (${qw.count} pages)</div>
            </div>
          </div>`;
        }).join('')}
      </div>`
    : '';

  // What's Working Well: pages with high scores + positive signals
  const perfectPages = clientPages.filter(p => p.score >= 95);
  const goodPages = clientPages.filter(p => p.score >= 80 && p.score < 95);
  const hasStructuredData = clientPages.filter(p => !p.issues.some(i => i.check === 'structured-data')).length;

  const positiveSignals: string[] = [];
  if (perfectPages.length > 0) positiveSignals.push(`${perfectPages.length} page${perfectPages.length > 1 ? 's' : ''} with near-perfect SEO scores`);
  if (goodPages.length > 0) positiveSignals.push(`${goodPages.length} additional page${goodPages.length > 1 ? 's' : ''} scoring 80+`);
  if (hasStructuredData > 0) positiveSignals.push(`${hasStructuredData} page${hasStructuredData > 1 ? 's' : ''} with structured data (JSON-LD)`);
  if (!clientSiteWide.some(i => i.check === 'ssl')) positiveSignals.push('SSL certificate is properly configured');
  if (!clientSiteWide.some(i => i.check === 'robots-txt' && i.severity === 'error')) positiveSignals.push('robots.txt is properly configured');
  if (!clientSiteWide.some(i => i.check === 'sitemap' && i.severity === 'error')) positiveSignals.push('XML sitemap is present and accessible');

  const workingWellHTML = positiveSignals.length > 0
    ? `<div style="margin:32px 0">
        <div class="section-title">What's Working Well</div>
        ${positiveSignals.map(signal => `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin:4px 0;border-radius:6px;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.12)">
          <span style="color:#22c55e;font-size:14px">✓</span>
          <span style="font-size:13px;color:#94a3b8">${signal}</span>
        </div>`).join('')}
      </div>`
    : '';

  // Recommended Next Steps (CTA section)
  const nextSteps: string[] = [];
  if (missingTitles > 0) nextSteps.push('Add unique, keyword-rich title tags to all pages — this is the #1 ranking factor you can control');
  if (missingDescriptions > 0) nextSteps.push('Write compelling meta descriptions for all pages to improve click-through rates from search results');
  if (missingOG > 0) nextSteps.push('Add Open Graph tags so your pages look professional when shared on social media');
  if (quickWinChecks.length > 0) nextSteps.push('Implement the Quick Wins above — they provide the highest ROI for the least effort');
  if (audit.siteScore < 80) nextSteps.push('Schedule a follow-up audit in 30 days to track improvement and identify new opportunities');
  if (nextSteps.length === 0) nextSteps.push('Continue monitoring your SEO health with regular audits to maintain your strong position');

  const nextStepsHTML = `<div style="margin:40px 0;padding:24px;border-radius:12px;background:linear-gradient(135deg,rgba(46,217,195,0.06),rgba(99,102,241,0.06));border:1px solid rgba(46,217,195,0.15)">
    <div style="font-size:16px;font-weight:600;color:#f1f5f9;margin-bottom:4px">Recommended Next Steps</div>
    <div style="font-size:12px;color:#64748b;margin-bottom:16px">Prioritized actions to improve your search visibility</div>
    ${nextSteps.map((step, idx) => `<div style="display:flex;gap:12px;padding:10px 0;${idx < nextSteps.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.04)' : ''}">
      <div style="width:24px;height:24px;border-radius:50%;background:rgba(46,217,195,0.12);color:#2ed9c3;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0">${idx + 1}</div>
      <div style="font-size:13px;color:#cbd5e1;padding-top:2px">${step}</div>
    </div>`).join('')}
  </div>`;

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
      <div style="margin-top:8px;font-size:14px;font-weight:600;color:${scoreColor}">${scoreGrade}</div>
      <div style="margin-top:6px;font-size:12px;color:#94a3b8;max-width:500px;margin-left:auto;margin-right:auto;line-height:1.5">${scoreContext}</div>
      
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
      ${catSummaryHTML}
    </div>

    ${executiveSummaryHTML}
    ${visibilityRiskHTML}
    ${quickWinsHTML}
    ${actionItemsHTML}
    ${workingWellHTML}

    ${clientSiteWide.length > 0 ? `<div class="section-title">Site-Wide Issues</div>${siteWideRows}` : ''}
    
    <div class="section-title">Page-by-Page Results</div>
    ${pageRows}

    ${nextStepsHTML}
    
    <div class="footer">
      <div style="font-size:12px;color:#64748b;margin-bottom:4px">Prepared by <a href="#">hmpsn.studio</a></div>
      <div style="font-size:11px;color:#475569">Report ID: ${snapshot.id}</div>
    </div>
  </div>
</body>
</html>`;
}
