import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SeoAuditResult } from './seo-audit.js';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const REPORTS_DIR = DATA_BASE
  ? path.join(DATA_BASE, 'reports')
  : path.join(process.env.HOME || '', '.asset-dashboard', 'reports');

export interface AuditSnapshot {
  id: string;
  siteId: string;
  siteName: string;
  createdAt: string;
  audit: SeoAuditResult;
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

export function saveSnapshot(siteId: string, siteName: string, audit: SeoAuditResult): AuditSnapshot {
  const id = crypto.randomBytes(8).toString('hex');
  const snapshot: AuditSnapshot = {
    id,
    siteId,
    siteName,
    createdAt: new Date().toISOString(),
    audit,
  };
  const filePath = path.join(siteDir(siteId), `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return snapshot;
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
  const { audit, siteName, createdAt } = snapshot;
  const date = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const scoreColor = audit.siteScore >= 80 ? '#22c55e' : audit.siteScore >= 60 ? '#eab308' : audit.siteScore >= 40 ? '#f97316' : '#ef4444';

  const catColors: Record<string, string> = {
    content: '#34d399', technical: '#a78bfa', social: '#f472b6',
    performance: '#fb923c', accessibility: '#38bdf8',
  };

  // Category summary
  const catCounts: Record<string, number> = {};
  for (const p of audit.pages) {
    for (const i of p.issues) {
      const cat = i.category || 'technical';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }
  }
  for (const i of audit.siteWideIssues) {
    const cat = i.category || 'technical';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  const pageRows = audit.pages.map(p => {
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

  const siteWideRows = audit.siteWideIssues.map(i => {
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
    .header { text-align:center; margin-bottom:40px; }
    .score-ring { width:120px; height:120px; margin:0 auto 20px; position:relative; }
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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
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
      
      <div class="stats">
        <div class="stat">
          <div class="stat-value" style="color:#f1f5f9">${audit.totalPages}</div>
          <div class="stat-label">Pages</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color:#ef4444">${audit.errors}</div>
          <div class="stat-label">Errors</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color:#eab308">${audit.warnings}</div>
          <div class="stat-label">Warnings</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color:#60a5fa">${audit.infos}</div>
          <div class="stat-label">Info</div>
        </div>
      </div>
      ${catSummaryHTML}
    </div>

    ${audit.siteWideIssues.length > 0 ? `<div class="section-title">Site-Wide Issues</div>${siteWideRows}` : ''}
    
    <div class="section-title">Page-by-Page Results</div>
    ${pageRows}
    
    <div class="footer">
      <div style="font-size:12px;color:#64748b">Generated by <a href="#">hmpsn.studio</a></div>
    </div>
  </div>
</body>
</html>`;
}
