/**
 * Sales Report HTML Template — Client-facing, pitch-deck style SEO report.
 */

import type { SalesAuditResult, SalesPageResult, SalesIssue } from './sales-audit.js';

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Needs Work';
  if (score >= 40) return 'At Risk';
  return 'Critical';
}

function severityIcon(s: string): string {
  if (s === 'error') return '🔴';
  if (s === 'warning') return '🟡';
  return '🔵';
}

function categoryLabel(cat?: string): string {
  const labels: Record<string, string> = {
    content: 'Content', technical: 'Technical', social: 'Social Media',
    performance: 'Performance', accessibility: 'Accessibility',
  };
  return labels[cat || ''] || 'Technical';
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSalesReportHTML(report: SalesAuditResult & { id?: string }): string {
  const sc = scoreColor(report.siteScore);
  const sl = scoreLabel(report.siteScore);
  const date = new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Group issues by category
  const allIssues = [
    ...report.siteWideIssues,
    ...report.pages.flatMap(p => p.issues.map(i => ({ ...i, pageUrl: p.url, pageName: p.page }))),
  ];
  const errorCount = allIssues.filter(i => i.severity === 'error').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;

  // Deduplicate issues for summary
  const issuesByCheck = new Map<string, { issue: SalesIssue; count: number }>();
  for (const issue of allIssues) {
    const key = `${issue.check}-${issue.severity}`;
    if (issuesByCheck.has(key)) {
      issuesByCheck.get(key)!.count++;
    } else {
      issuesByCheck.set(key, { issue, count: 1 });
    }
  }
  const sortedIssues = Array.from(issuesByCheck.values())
    .sort((a, b) => {
      const sev = { error: 0, warning: 1, info: 2 };
      return (sev[a.issue.severity] || 2) - (sev[b.issue.severity] || 2);
    });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SEO Report — ${escHtml(report.siteName)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { margin: 0.5in; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #ffffff; color: #1a1a2e; line-height: 1.6;
    max-width: 900px; margin: 0 auto; padding: 40px 32px;
  }
  .header { text-align: center; margin-bottom: 48px; padding-bottom: 32px; border-bottom: 2px solid #e5e7eb; }
  .header h1 { font-size: 28px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .header .subtitle { font-size: 14px; color: #6b7280; }
  .header .url { font-size: 13px; color: #9ca3af; margin-top: 4px; }
  .score-ring {
    width: 140px; height: 140px; margin: 24px auto; position: relative;
    display: flex; align-items: center; justify-content: center;
  }
  .score-ring svg { position: absolute; top: 0; left: 0; transform: rotate(-90deg); }
  .score-ring .score-num { font-size: 42px; font-weight: 800; line-height: 1; }
  .score-ring .score-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .stats { display: flex; justify-content: center; gap: 32px; margin-top: 24px; }
  .stat { text-align: center; }
  .stat .num { font-size: 24px; font-weight: 700; }
  .stat .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .section { margin-top: 40px; }
  .section h2 { font-size: 20px; font-weight: 700; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
  .section h3 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
  .risk-card {
    background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
    padding: 16px; margin-bottom: 12px;
  }
  .risk-card .risk-title { font-weight: 600; color: #991b1b; font-size: 14px; margin-bottom: 4px; }
  .risk-card .risk-cost { font-size: 13px; color: #dc2626; font-style: italic; }
  .risk-card .risk-fix { font-size: 13px; color: #6b7280; margin-top: 6px; }
  .win-card {
    background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;
    padding: 16px; margin-bottom: 12px;
  }
  .win-card .win-title { font-weight: 600; color: #166534; font-size: 14px; margin-bottom: 4px; }
  .win-card .win-fix { font-size: 13px; color: #6b7280; }
  .issue-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .issue-table th { text-align: left; padding: 8px 12px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  .issue-table td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .issue-table .sev { width: 28px; text-align: center; }
  .issue-table .cat { font-size: 11px; color: #9ca3af; }
  .page-row { background: #f9fafb; }
  .page-row td { font-weight: 600; padding-top: 14px; }
  .page-score { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; color: white; }
  .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>SEO Health Report</h1>
  <div class="subtitle">${escHtml(report.siteName)}</div>
  <div class="url">${escHtml(report.url)}</div>

  <div class="score-ring">
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r="60" fill="none" stroke="#e5e7eb" stroke-width="10" />
      <circle cx="70" cy="70" r="60" fill="none" stroke="${sc}" stroke-width="10"
        stroke-dasharray="${(report.siteScore / 100) * 377} 377" stroke-linecap="round" />
    </svg>
    <div style="text-align: center;">
      <div class="score-num" style="color: ${sc}">${report.siteScore}</div>
      <div class="score-label" style="color: ${sc}">${sl}</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><div class="num">${report.totalPages}</div><div class="label">Pages Scanned</div></div>
    <div class="stat"><div class="num" style="color:#ef4444">${errorCount}</div><div class="label">Errors</div></div>
    <div class="stat"><div class="num" style="color:#eab308">${warningCount}</div><div class="label">Warnings</div></div>
  </div>
</div>

${report.siteScore < 80 ? `
<div class="section">
  <h2>⚠️ Search Visibility Risk</h2>
  <p style="font-size:14px; color:#4b5563; margin-bottom:16px;">
    With a score of <strong>${report.siteScore}/100</strong>, this site is leaving significant search traffic on the table.
    ${report.siteScore < 60 ? 'Competitors with better-optimized sites are likely capturing your potential customers.' : 'Addressing the issues below could meaningfully improve search rankings and organic traffic.'}
  </p>
</div>
` : ''}

${report.topRisks.length > 0 ? `
<div class="section">
  <h2>🔴 Top Risks</h2>
  <p style="font-size:13px; color:#6b7280; margin-bottom:12px;">Critical issues that may be hurting your search rankings right now.</p>
  ${report.topRisks.map(r => `
  <div class="risk-card">
    <div class="risk-title">${severityIcon(r.severity)} ${escHtml(r.message)}</div>
    ${r.opportunityCost ? `<div class="risk-cost">${escHtml(r.opportunityCost)}</div>` : ''}
    <div class="risk-fix">💡 ${escHtml(r.recommendation)}</div>
  </div>
  `).join('')}
</div>
` : ''}

${report.quickWins.length > 0 ? `
<div class="section">
  <h2>⚡ Quick Wins</h2>
  <p style="font-size:13px; color:#6b7280; margin-bottom:12px;">High-impact fixes that can be implemented quickly.</p>
  ${report.quickWins.map(w => `
  <div class="win-card">
    <div class="win-title">✅ ${escHtml(w.message)}</div>
    <div class="win-fix">${escHtml(w.recommendation)}</div>
  </div>
  `).join('')}
</div>
` : ''}

<div class="section">
  <h2>📋 All Issues Found</h2>
  <table class="issue-table">
    <thead><tr><th class="sev"></th><th>Issue</th><th>Category</th><th>Count</th></tr></thead>
    <tbody>
    ${sortedIssues.map(({ issue, count }) => `
      <tr>
        <td class="sev">${severityIcon(issue.severity)}</td>
        <td>${escHtml(issue.message)}<br><span style="font-size:12px;color:#9ca3af">${escHtml(issue.recommendation)}</span></td>
        <td class="cat">${categoryLabel(issue.category)}</td>
        <td style="text-align:center;font-weight:600">${count > 1 ? `×${count}` : ''}</td>
      </tr>
    `).join('')}
    </tbody>
  </table>
</div>

<div class="section" style="page-break-before: always;">
  <h2>📄 Page-by-Page Breakdown</h2>
  ${report.pages.map((p: SalesPageResult) => `
  <div style="margin-bottom:24px;">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
      <span class="page-score" style="background:${scoreColor(p.score)}">${p.score}</span>
      <span style="font-weight:600; font-size:14px;">${escHtml(p.page)}</span>
    </div>
    <div style="font-size:12px; color:#9ca3af; margin-bottom:6px;">${escHtml(p.url)}</div>
    ${p.issues.length === 0 ? '<p style="font-size:13px; color:#22c55e;">✅ No issues found</p>' : `
    <table class="issue-table" style="margin-left:0;">
      <tbody>
      ${p.issues.map(i => `
        <tr><td class="sev">${severityIcon(i.severity)}</td><td>${escHtml(i.message)}</td></tr>
      `).join('')}
      </tbody>
    </table>
    `}
  </div>
  `).join('')}
</div>

${report.siteWideIssues.length > 0 ? `
<div class="section">
  <h2>🌐 Site-Wide Issues</h2>
  <table class="issue-table">
    <tbody>
    ${report.siteWideIssues.map(i => `
      <tr>
        <td class="sev">${severityIcon(i.severity)}</td>
        <td>${escHtml(i.message)}<br><span style="font-size:12px;color:#9ca3af">${escHtml(i.recommendation)}</span></td>
      </tr>
    `).join('')}
    </tbody>
  </table>
</div>
` : ''}

<div class="section">
  <h2>📌 Recommended Next Steps</h2>
  <ol style="font-size:14px; color:#374151; padding-left:20px;">
    <li style="margin-bottom:8px;"><strong>Fix critical errors first</strong> — Address the ${errorCount} errors that are actively hurting your search visibility.</li>
    <li style="margin-bottom:8px;"><strong>Implement quick wins</strong> — The ${report.quickWins.length} quick wins above can be done in a few hours and will have immediate impact.</li>
    <li style="margin-bottom:8px;"><strong>Optimize content</strong> — Ensure every page has a unique title, meta description, and H1 tag.</li>
    <li style="margin-bottom:8px;"><strong>Add structured data</strong> — JSON-LD markup enables rich snippets in search results, increasing click-through rates.</li>
    <li style="margin-bottom:8px;"><strong>Monitor & iterate</strong> — Re-run this audit monthly to track progress and catch new issues.</li>
  </ol>
</div>

<div class="footer">
  <p>Report generated on ${date} · ${report.totalPages} pages scanned</p>
  <p style="margin-top:4px;">Powered by Asset Dashboard</p>
</div>

</body>
</html>`;
}
