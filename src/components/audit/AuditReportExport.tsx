/**
 * AuditReportExport — report generation (HTML + CSV) and export modal / viewer.
 * Extracted from SeoAudit.tsx to keep the orchestrator lean.
 */
import { FileText, Download, X } from 'lucide-react';
import type { SeoAuditResult } from './types';

// ── Pure helpers ────────────────────────────────────────────────────

export function getCSV(data: SeoAuditResult): string {
  const rows = [['Page', 'Slug', 'Score', 'Severity', 'Check', 'Message', 'Recommendation', 'Value', 'AI Suggestion']];
  // CWV summary rows
  if (data.cwvSummary) {
    for (const [label, s] of [['Mobile', data.cwvSummary.mobile], ['Desktop', data.cwvSummary.desktop]] as const) {
      if (!s) continue;
      const assessText = s.assessment === 'good' ? 'Passed' : s.assessment === 'needs-improvement' ? 'Needs Work' : s.assessment === 'poor' ? 'Failed' : 'No Data';
      const lcpVal = s.metrics.LCP.value !== null ? `${(s.metrics.LCP.value / 1000).toFixed(1)}s` : '—';
      const inpVal = s.metrics.INP.value !== null ? `${Math.round(s.metrics.INP.value)}ms` : '—';
      const clsVal = s.metrics.CLS.value !== null ? s.metrics.CLS.value.toFixed(2) : '—';
      rows.push([`[CWV ${label}]`, '', '', s.assessment === 'good' ? 'info' : s.assessment === 'poor' ? 'error' : 'warning', 'cwv', `${label} CWV: ${assessText} (LCP ${lcpVal}, INP ${inpVal}, CLS ${clsVal})`, `Lighthouse lab score: ${s.lighthouseScore}/100. ${s.fieldDataAvailable ? 'Real-user data (CrUX).' : 'Lab simulation only.'}`, assessText, '']);
    }
  }
  for (const issue of data.siteWideIssues) {
    rows.push(['[Site-Wide]', '', '', issue.severity, issue.check, issue.message, issue.recommendation, issue.value || '', issue.suggestedFix || '']);
  }
  for (const page of data.pages) {
    for (const issue of page.issues) {
      rows.push([page.page, page.slug, String(page.score), issue.severity, issue.check, issue.message, issue.recommendation, issue.value || '', issue.suggestedFix || '']);
    }
  }
  return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function generateHtmlReport(data: SeoAuditResult): string {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const errorPages = data.pages.filter(p => p.score < 60);
  const goodPages = data.pages.filter(p => p.score >= 80);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SEO Audit Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #fff; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
  .score-card { display: flex; align-items: center; gap: 24px; padding: 24px; background: #f8f9fa; border-radius: 12px; margin-bottom: 32px; }
  .score-circle { width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; color: white; }
  .score-green { background: #22c55e; } .score-amber { background: #f59e0b; } .score-orange { background: #f97316; } .score-red { background: #ef4444; }
  .stats { display: flex; gap: 24px; }
  .stat { text-align: center; } .stat-num { font-size: 24px; font-weight: 700; } .stat-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  h2 { font-size: 20px; font-weight: 600; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #eee; }
  .issue-row { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .badge-error { background: #fef2f2; color: #dc2626; } .badge-warning { background: #fffbeb; color: #d97706; } .badge-info { background: #eff6ff; color: #2563eb; }
  .issue-content { flex: 1; }
  .issue-msg { font-weight: 500; font-size: 14px; } .issue-rec { font-size: 13px; color: #666; margin-top: 2px; } .issue-val { font-size: 12px; color: #999; font-style: italic; margin-top: 2px; }
  .page-block { background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .page-name { font-weight: 600; font-size: 15px; } .page-score { font-weight: 700; font-size: 14px; }
  .summary-box { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
  .summary-item { padding: 16px; background: #f8f9fa; border-radius: 8px; }
  .summary-item h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .summary-item p { font-size: 13px; color: #666; }
  @media print { body { font-size: 12px; } .container { padding: 20px; } }
</style>
</head>
<body>
<div class="container">
  <h1>SEO Audit Report</h1>
  <p class="subtitle">Generated ${now} &middot; ${data.totalPages} pages analyzed</p>

  <div class="score-card">
    <div class="score-circle ${data.siteScore >= 80 ? 'score-green' : data.siteScore >= 60 ? 'score-amber' : data.siteScore >= 40 ? 'score-orange' : 'score-red'}">${data.siteScore}</div>
    <div>
      <div style="font-size:18px;font-weight:600">Overall Site Score</div>
      <div class="stats" style="margin-top:8px">
        <div class="stat"><div class="stat-num" style="color:#dc2626">${data.errors}</div><div class="stat-label">Errors</div></div>
        <div class="stat"><div class="stat-num" style="color:#d97706">${data.warnings}</div><div class="stat-label">Warnings</div></div>
        <div class="stat"><div class="stat-num" style="color:#2563eb">${data.infos}</div><div class="stat-label">Info</div></div>
      </div>
    </div>
  </div>

  <div class="summary-box">
    <div class="summary-item">
      <h3>Executive Summary</h3>
      <p>${data.errors > 0 ? `Found <strong>${data.errors} critical error${data.errors > 1 ? 's' : ''}</strong> that need immediate attention. ` : 'No critical errors found. '}${data.warnings > 0 ? `There are <strong>${data.warnings} warning${data.warnings > 1 ? 's' : ''}</strong> that should be addressed for better rankings.` : 'All warnings have been addressed.'}</p>
    </div>
    <div class="summary-item">
      <h3>Key Metrics</h3>
      <p><strong>${goodPages.length}</strong> of ${data.totalPages} pages score 80+<br>
      <strong>${errorPages.length}</strong> pages need significant improvement<br>
      Average page score: <strong>${data.siteScore}</strong>/100</p>
    </div>
  </div>

  ${data.cwvSummary ? (() => {
    const renderStrat = (label: string, s: NonNullable<typeof data.cwvSummary>['mobile']) => {
      if (!s) return '';
      const assess = s.assessment === 'good' ? 'Passed' : s.assessment === 'needs-improvement' ? 'Needs Work' : s.assessment === 'poor' ? 'Failed' : 'No Data';
      const color = s.assessment === 'good' ? '#22c55e' : s.assessment === 'needs-improvement' ? '#f59e0b' : s.assessment === 'poor' ? '#ef4444' : '#999';
      const lcpVal = s.metrics.LCP.value !== null ? (s.metrics.LCP.value / 1000).toFixed(1) + 's' : '—';
      const inpVal = s.metrics.INP.value !== null ? Math.round(s.metrics.INP.value) + 'ms' : '—';
      const clsVal = s.metrics.CLS.value !== null ? s.metrics.CLS.value.toFixed(2) : '—';
      return '<div class="summary-item"><h3>' + label + ' <span style="color:' + color + ';font-weight:700">' + assess + '</span></h3><p>LCP: <strong>' + lcpVal + '</strong> · INP: <strong>' + inpVal + '</strong> · CLS: <strong>' + clsVal + '</strong><br>Lighthouse: ' + s.lighthouseScore + '/100' + (s.fieldDataAvailable ? ' · <em>Real-user data (CrUX)</em>' : ' · <em>Lab simulation only</em>') + '</p></div>';
    };
    return '<h2>Core Web Vitals <span style="font-size:13px;color:#666;font-weight:400">— Google ranking signal</span></h2><div class="summary-box">' + renderStrat('Mobile', data.cwvSummary.mobile) + renderStrat('Desktop', data.cwvSummary.desktop) + '</div>';
  })() : ''}

  ${data.siteWideIssues.length > 0 ? `<h2>Site-Wide Issues</h2>${data.siteWideIssues.map(i => `
  <div class="issue-row">
    <span class="badge badge-${i.severity}">${i.severity}</span>
    <div class="issue-content">
      <div class="issue-msg">${i.message}</div>
      <div class="issue-rec">${i.recommendation}</div>
      ${i.value ? `<div class="issue-val">${i.value}</div>` : ''}
      ${i.suggestedFix ? `<div style="margin-top:6px;padding:6px 10px;background:#064e3b20;border:1px solid #06533830;border-radius:6px"><div style="font-size:9px;color:#10b981;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">AI Suggestion</div><div style="font-size:12px;color:#34d399">${i.suggestedFix}</div></div>` : ''}
    </div>
  </div>`).join('')}` : ''}

  <h2>Page-by-Page Results</h2>
  ${data.pages.map(p => `
  <div class="page-block">
    <div class="page-header">
      <span class="page-name">${p.page} <span style="color:#999;font-weight:400">/${p.slug}</span></span>
      <span class="page-score" style="color:${p.score >= 80 ? '#22c55e' : p.score >= 60 ? '#f59e0b' : '#ef4444'}">${p.score}/100</span>
    </div>
    ${p.issues.length === 0 ? '<div style="color:#22c55e;font-size:13px">No issues found</div>' : p.issues.map(i => `
    <div class="issue-row">
      <span class="badge badge-${i.severity}">${i.severity}</span>
      <div class="issue-content">
        <div class="issue-msg">${i.message}</div>
        <div class="issue-rec">${i.recommendation}</div>
        ${i.value ? `<div class="issue-val">${i.value}</div>` : ''}
        ${i.suggestedFix ? `<div style="margin-top:6px;padding:6px 10px;background:#064e3b20;border:1px solid #06533830;border-radius:6px"><div style="font-size:9px;color:#10b981;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">AI Suggestion</div><div style="font-size:12px;color:#34d399">${i.suggestedFix}</div></div>` : ''}
      </div>
    </div>`).join('')}
  </div>`).join('')}

  <div style="margin-top:40px;padding-top:16px;border-top:2px solid #eee;text-align:center;color:#999;font-size:12px">
    Generated by Asset Dashboard SEO Auditor &middot; ${now}
  </div>
</div>
</body>
</html>`;
}

// ── Report format chooser modal ─────────────────────────────────

interface ReportModalProps {
  onExportHtml: () => void;
  onExportCsv: () => void;
  onClose: () => void;
}

export function ReportModal({ onExportHtml, onExportCsv, onClose }: ReportModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      {/* pr-check-disable-next-line -- modal dialog */}
      <div className="relative max-w-md w-full mx-4 bg-zinc-900 rounded-xl border border-zinc-700 p-6" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
        <h3 className="text-lg font-semibold mb-1">Export SEO Report</h3>
        <p className="text-xs text-zinc-500 mb-5">Choose a format to view the audit results</p>
        <div className="space-y-3">
          <button
            onClick={onExportHtml}
            className="w-full flex items-center gap-3 px-4 py-3 bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors text-left"
          >
            <FileText className="w-5 h-5" />
            <div>
              <div className="text-sm font-medium">HTML Report</div>
              <div className="text-xs text-teal-200">Beautifully formatted, client-ready report. Print to PDF.</div>
            </div>
          </button>
          <button
            onClick={onExportCsv}
            className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-left"
          >
            <Download className="w-5 h-5" />
            <div>
              <div className="text-sm font-medium">CSV Spreadsheet</div>
              <div className="text-xs text-zinc-400">Raw data for analysis in Excel or Google Sheets.</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline report viewer (fullscreen overlay) ────────────────────

interface ReportViewerProps {
  reportView: 'html' | 'csv';
  data: SeoAuditResult;
  onClose: () => void;
}

export function ReportViewer({ reportView, data, onClose }: ReportViewerProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
        <div className="text-sm font-medium text-zinc-200">
          {reportView === 'html' ? 'SEO Audit Report' : 'CSV Export'}
        </div>
        <div className="flex items-center gap-2">
          {reportView === 'csv' && (
            <button
              onClick={() => { navigator.clipboard.writeText(getCSV(data)); }}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors"
            >
              Copy to Clipboard
            </button>
          )}
          {reportView === 'html' && (
            <button
              onClick={() => {
                const iframe = document.getElementById('report-iframe') as HTMLIFrameElement;
                if (iframe?.contentWindow) iframe.contentWindow.print();
              }}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors"
            >
              Print / Save as PDF
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {reportView === 'html' ? (
          <iframe
            id="report-iframe"
            srcDoc={generateHtmlReport(data)}
            className="w-full h-full border-0 bg-white"
            title="SEO Report"
          />
        ) : (
          <textarea
            readOnly
            value={getCSV(data)}
            className="w-full h-full p-4 bg-zinc-950 text-zinc-300 text-xs font-mono resize-none focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
