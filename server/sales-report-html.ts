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
  <div style="margin-bottom:20px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="51" viewBox="0 0 1000 320" style="opacity:0.85">
      <g><path d="M47.235,5.654V89.544c13.786-17.858,30.704-23.185,48.25-23.185,43.865,0,63.29,29.765,63.29,75.196v79.502c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-79.189c0-28.2-14.726-40.104-35.091-40.104-22.56,0-38.224,19.111-38.224,42.297v76.997c0,1.082-.877,1.959-1.959,1.959H10.97c-1.082,0-1.959-.877-1.959-1.959V5.654c0-1.082,.877-1.959,1.959-1.959H45.276c1.082,0,1.959,.877,1.959,1.959Z" fill="#2ed9c3"/><path d="M303.05,223.016c-1.082,0-1.959-.877-1.959-1.959v-80.755c0-20.366-10.653-38.852-31.645-38.852-20.679,0-32.898,18.486-32.898,38.852v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h31.757c.97,0,1.794,.709,1.938,1.669l2.571,17.129c8.146-15.665,26.004-21.305,40.73-21.305,18.486,0,36.971,7.52,45.745,28.825,13.786-21.932,31.645-28.198,51.697-28.198,43.865,0,65.483,26.945,65.483,73.316v81.382c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-81.382c0-20.366-8.46-37.599-29.139-37.599s-33.525,17.86-33.525,38.226v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/><path d="M480.221,310.401V70.51c0-1.082,.877-1.959,1.959-1.959h32.015c.994,0,1.83,.744,1.946,1.73l2.304,19.577c11.906-17.233,32.584-24.754,50.13-24.754,47.623,0,79.268,35.405,79.268,80.836,0,45.117-28.512,80.836-78.015,80.836-16.292,0-40.418-5.013-51.383-21.933v105.558c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959Zm129.398-164.461c0-24.124-16.292-43.865-43.865-43.865s-43.863,19.74-43.863,43.865,17.858,43.865,43.863,43.865,43.865-19.739,43.865-43.865Z" fill="#2ed9c3"/><path d="M781.403,108.059c-.718,.845-1.968,.908-2.802,.177-10.606-9.285-22.666-12.427-36.728-12.427-18.172,0-28.198,5.64-28.198,15.353,0,10.026,9.087,15.666,28.825,16.919,29.139,1.88,66.109,8.46,66.109,49.503,0,27.259-22.244,50.758-66.423,50.758-24.026,0-48.053-3.938-70.293-26.4-.663-.67-.755-1.735-.22-2.51l16.543-23.985c.694-1.007,2.113-1.119,2.994-.27,14.636,14.119,35.008,19.652,51.604,19.954,14.412,.312,27.885-5.64,27.885-16.919,0-10.653-8.773-16.606-30.706-17.858-29.137-2.194-63.915-12.847-63.915-47.938,0-35.717,36.971-48.25,65.17-48.25,23.453,0,41.281,4.442,58.666,19.084,.827,.697,.923,1.95,.223,2.774l-18.732,22.037Z" fill="#2ed9c3"/><path d="M958.735,223.016c-1.082,0-1.959-.877-1.959-1.959v-78.877c0-23.356-12.69-41.14-36.841-41.355-21.958-.196-39.922,18.489-39.922,40.448v79.784c0,1.082-.877,1.959-1.959,1.959h-33.992c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h30.452c.992,0,1.828,.742,1.946,1.727l2.301,19.264c15.665-15.353,31.331-23.185,50.756-23.185,36.346,0,65.483,27.259,65.483,75.823v79.189c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/></g>
      <g><path d="M46.137,267.39c-.706,.619-1.753,.656-2.484,.067-3.444-2.774-8.564-4.008-12.792-4.008-5.949,0-10.777,2.501-10.777,6.64,0,5.518,5.259,6.553,13.019,7.242,11.9,1.035,23.194,5.604,23.194,19.572,0,13.451-12.416,19.314-25.436,19.4-9.88,.082-20.147-3.547-25.527-11.109-.53-.745-.408-1.775,.225-2.435l5.464-5.699c.76-.792,2.03-.812,2.791-.021,4.697,4.877,11.559,7.022,17.133,7.022,7.157,0,12.072-2.845,12.072-7.158,.086-5.086-3.967-7.414-12.158-8.105-12.761-1.205-24.143-4.397-23.97-18.623,.087-11.986,11.468-18.365,23.884-18.365,8.61,0,15.229,1.768,21.085,7.758,.794,.813,.767,2.125-.087,2.875l-5.636,4.947Z" fill="#2ed9c3"/><path d="M100.176,265.95h-16.407c-1.082,0-1.959-.877-1.959-1.959v-8.067c0-1.082,.877-1.959,1.959-1.959h46.178c1.082,0,1.959,.877,1.959,1.959v8.067c0,1.082-.877,1.959-1.959,1.959h-16.407v46.412c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959v-46.412Z" fill="#2ed9c3"/><path d="M213.833,254.051c1.082,0,1.959,.877,1.959,1.959v31.755c0,17.934-10.001,27.505-25.867,28.022-15.779,.517-29.143-8.536-29.143-28.022v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v31.755c0,10.778,6.036,16.383,15.865,15.95,9.139-.603,12.416-6.898,12.416-15.95v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446Z" fill="#2ed9c3"/><path d="M274.673,253.965c20.78,0,30.005,13.968,30.005,29.748s-8.881,30.609-30.005,30.609h-22.787c-1.082,0-1.959-.877-1.959-1.959v-56.438c0-1.082,.877-1.959,1.959-1.959h22.787Zm-11.468,47.941h11.468c13.106,0,16.727-9.657,16.727-18.365s-4.139-17.418-16.727-17.418h-11.468v35.783Z" fill="#2ed9c3"/><path d="M336.398,312.362v-56.438c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v56.438c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959Z" fill="#2ed9c3"/><path d="M413.907,315.787c-19.314,0-32.592-11.986-32.592-31.644s13.278-31.644,32.592-31.644,32.592,11.986,32.592,31.644-13.278,31.644-32.592,31.644Zm0-51.216c-11.468,0-19.4,8.622-19.4,19.572,0,11.295,7.932,19.486,19.4,19.486,11.726,0,19.4-8.277,19.4-19.486,0-11.037-7.674-19.572-19.4-19.572Z" fill="#2ed9c3"/></g>
    </svg>
  </div>
  <div style="font-size:11px; color:#9ca3af; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:16px;">Prepared by hmpsn.studio</div>
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
  <div style="margin-bottom:12px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="32" viewBox="0 0 1000 320" style="opacity:0.4">
      <g><path d="M47.235,5.654V89.544c13.786-17.858,30.704-23.185,48.25-23.185,43.865,0,63.29,29.765,63.29,75.196v79.502c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-79.189c0-28.2-14.726-40.104-35.091-40.104-22.56,0-38.224,19.111-38.224,42.297v76.997c0,1.082-.877,1.959-1.959,1.959H10.97c-1.082,0-1.959-.877-1.959-1.959V5.654c0-1.082,.877-1.959,1.959-1.959H45.276c1.082,0,1.959,.877,1.959,1.959Z" fill="#2ed9c3"/><path d="M303.05,223.016c-1.082,0-1.959-.877-1.959-1.959v-80.755c0-20.366-10.653-38.852-31.645-38.852-20.679,0-32.898,18.486-32.898,38.852v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h31.757c.97,0,1.794,.709,1.938,1.669l2.571,17.129c8.146-15.665,26.004-21.305,40.73-21.305,18.486,0,36.971,7.52,45.745,28.825,13.786-21.932,31.645-28.198,51.697-28.198,43.865,0,65.483,26.945,65.483,73.316v81.382c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-81.382c0-20.366-8.46-37.599-29.139-37.599s-33.525,17.86-33.525,38.226v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/><path d="M480.221,310.401V70.51c0-1.082,.877-1.959,1.959-1.959h32.015c.994,0,1.83,.744,1.946,1.73l2.304,19.577c11.906-17.233,32.584-24.754,50.13-24.754,47.623,0,79.268,35.405,79.268,80.836,0,45.117-28.512,80.836-78.015,80.836-16.292,0-40.418-5.013-51.383-21.933v105.558c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959Zm129.398-164.461c0-24.124-16.292-43.865-43.865-43.865s-43.863,19.74-43.863,43.865,17.858,43.865,43.863,43.865,43.865-19.739,43.865-43.865Z" fill="#2ed9c3"/><path d="M781.403,108.059c-.718,.845-1.968,.908-2.802,.177-10.606-9.285-22.666-12.427-36.728-12.427-18.172,0-28.198,5.64-28.198,15.353,0,10.026,9.087,15.666,28.825,16.919,29.139,1.88,66.109,8.46,66.109,49.503,0,27.259-22.244,50.758-66.423,50.758-24.026,0-48.053-3.938-70.293-26.4-.663-.67-.755-1.735-.22-2.51l16.543-23.985c.694-1.007,2.113-1.119,2.994-.27,14.636,14.119,35.008,19.652,51.604,19.954,14.412,.312,27.885-5.64,27.885-16.919,0-10.653-8.773-16.606-30.706-17.858-29.137-2.194-63.915-12.847-63.915-47.938,0-35.717,36.971-48.25,65.17-48.25,23.453,0,41.281,4.442,58.666,19.084,.827,.697,.923,1.95,.223,2.774l-18.732,22.037Z" fill="#2ed9c3"/><path d="M958.735,223.016c-1.082,0-1.959-.877-1.959-1.959v-78.877c0-23.356-12.69-41.14-36.841-41.355-21.958-.196-39.922,18.489-39.922,40.448v79.784c0,1.082-.877,1.959-1.959,1.959h-33.992c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h30.452c.992,0,1.828,.742,1.946,1.727l2.301,19.264c15.665-15.353,31.331-23.185,50.756-23.185,36.346,0,65.483,27.259,65.483,75.823v79.189c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/></g>
      <g><path d="M46.137,267.39c-.706,.619-1.753,.656-2.484,.067-3.444-2.774-8.564-4.008-12.792-4.008-5.949,0-10.777,2.501-10.777,6.64,0,5.518,5.259,6.553,13.019,7.242,11.9,1.035,23.194,5.604,23.194,19.572,0,13.451-12.416,19.314-25.436,19.4-9.88,.082-20.147-3.547-25.527-11.109-.53-.745-.408-1.775,.225-2.435l5.464-5.699c.76-.792,2.03-.812,2.791-.021,4.697,4.877,11.559,7.022,17.133,7.022,7.157,0,12.072-2.845,12.072-7.158,.086-5.086-3.967-7.414-12.158-8.105-12.761-1.205-24.143-4.397-23.97-18.623,.087-11.986,11.468-18.365,23.884-18.365,8.61,0,15.229,1.768,21.085,7.758,.794,.813,.767,2.125-.087,2.875l-5.636,4.947Z" fill="#2ed9c3"/><path d="M100.176,265.95h-16.407c-1.082,0-1.959-.877-1.959-1.959v-8.067c0-1.082,.877-1.959,1.959-1.959h46.178c1.082,0,1.959,.877,1.959,1.959v8.067c0,1.082-.877,1.959-1.959,1.959h-16.407v46.412c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959v-46.412Z" fill="#2ed9c3"/><path d="M213.833,254.051c1.082,0,1.959,.877,1.959,1.959v31.755c0,17.934-10.001,27.505-25.867,28.022-15.779,.517-29.143-8.536-29.143-28.022v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v31.755c0,10.778,6.036,16.383,15.865,15.95,9.139-.603,12.416-6.898,12.416-15.95v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446Z" fill="#2ed9c3"/><path d="M274.673,253.965c20.78,0,30.005,13.968,30.005,29.748s-8.881,30.609-30.005,30.609h-22.787c-1.082,0-1.959-.877-1.959-1.959v-56.438c0-1.082,.877-1.959,1.959-1.959h22.787Zm-11.468,47.941h11.468c13.106,0,16.727-9.657,16.727-18.365s-4.139-17.418-16.727-17.418h-11.468v35.783Z" fill="#2ed9c3"/><path d="M336.398,312.362v-56.438c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v56.438c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959Z" fill="#2ed9c3"/><path d="M413.907,315.787c-19.314,0-32.592-11.986-32.592-31.644s13.278-31.644,32.592-31.644,32.592,11.986,32.592,31.644-13.278,31.644-32.592,31.644Zm0-51.216c-11.468,0-19.4,8.622-19.4,19.572,0,11.295,7.932,19.486,19.4,19.486,11.726,0,19.4-8.277,19.4-19.486,0-11.037-7.674-19.572-19.4-19.572Z" fill="#2ed9c3"/></g>
    </svg>
  </div>
  <p>Report generated on ${date} · ${report.totalPages} pages scanned</p>
  <p style="margin-top:4px;">Prepared by <a href="https://hmpsn.studio" style="color:#2ed9c3; text-decoration:none;">hmpsn.studio</a></p>
</div>

</body>
</html>`;
}
