import { useState, useEffect, useRef } from 'react';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { Globe, Search, ExternalLink, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Info, Zap, FileText } from 'lucide-react';
import { scoreColorClass, MetricRing, MetricRingSvg } from './ui';
import { salesReport as salesReportApi } from '../api/misc';

interface SalesIssue {
  check: string;
  severity: 'error' | 'warning' | 'info';
  category?: string;
  message: string;
  recommendation: string;
  value?: string;
  opportunityCost?: string;
}

interface SalesPageResult {
  page: string;
  url: string;
  score: number;
  issues: SalesIssue[];
}

interface SalesAuditResult {
  id?: string;
  url: string;
  siteName: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  infos: number;
  pages: SalesPageResult[];
  siteWideIssues: SalesIssue[];
  quickWins: SalesIssue[];
  topRisks: SalesIssue[];
  generatedAt: string;
}

interface ReportSummary {
  id: string;
  url: string;
  siteName: string;
  siteScore: number;
  totalPages: number;
  errors: number;
  warnings: number;
  generatedAt: string;
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'error') return <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  if (severity === 'warning') return <Info className="w-3.5 h-3.5 text-yellow-400 shrink-0" />;
  return <CheckCircle className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
}

export function SalesReport() {
  const { startJob, jobs } = useBackgroundTasks();
  const salesJobId = useRef<string | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SalesAuditResult | null>(null);
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [view, setView] = useState<'input' | 'report'>('input');
  const [progress, setProgress] = useState('');

  const loadHistory = async () => {
    try {
      const data = await salesReportApi.list();
      setHistory(data as ReportSummary[]);
    } catch (err) { console.error('SalesReport operation failed:', err); }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const runReport = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setProgress('Discovering pages...');
    const jobId = await startJob('sales-report', { url: url.trim(), maxPages: 50 });
    if (jobId) {
      salesJobId.current = jobId;
    } else {
      setError('Failed to start report job');
      setLoading(false);
      setProgress('');
    }
  };

  // Watch for sales report job completion
  useEffect(() => {
    if (!salesJobId.current) return;
    const job = jobs.find(j => j.id === salesJobId.current);
    if (!job) return;
    if (job.status === 'running') {
      setProgress(job.message || 'Running...');
    } else if (job.status === 'done' && job.result) {
      const data = job.result as SalesAuditResult;
      if (data.pages && Array.isArray(data.pages)) {
        setReport(data);
        setView('report');
        loadHistory();
      } else {
        setError('Invalid response');
      }
      setLoading(false);
      setProgress('');
      salesJobId.current = null;
    } else if (job.status === 'error') {
      setError(job.error || 'Report failed');
      setLoading(false);
      setProgress('');
      salesJobId.current = null;
    }
  }, [jobs]);

  const loadReport = async (id: string) => {
    try {
      const data = await salesReportApi.getById(id);
      if (data) {
        setReport(data as SalesAuditResult);
        setView('report');
      }
    } catch (err) { console.error('SalesReport operation failed:', err); }
  };

  const openHtmlReport = (id: string) => {
    window.open(`/api/sales-report/${id}/html`, '_blank');
  };

  // Input / history view
  if (view === 'input' || !report) {
    return (
      <div className="space-y-6 p-6">
        {/* URL Input */}
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #2dd4bf, #14b8a6)' }}>
              <Globe className="w-7 h-7 text-black" />
            </div>
            <h2 className="text-xl font-bold text-zinc-200">Sales SEO Report</h2>
            <p className="text-sm mt-1 text-zinc-500">
              Audit any website — no API key needed. Generate a client-ready SEO report.
            </p>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && runReport()}
                placeholder="Enter website URL (e.g. swishsmiles.com)"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 bg-zinc-900 border border-zinc-800 text-zinc-200"
                disabled={loading}
              />
            </div>
            <button
              onClick={runReport}
              disabled={loading || !url.trim()}
              className="px-6 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 bg-teal-400 text-[#0f1219]"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Scanning...
                </div>
              ) : 'Run Report'}
            </button>
          </div>

          {loading && progress && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-zinc-500">
              <div className="w-3 h-3 border border-zinc-600 border-t-teal-400 rounded-full animate-spin" />
              {progress}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg px-4 py-3 bg-red-500/10 border border-red-500/30">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Report History */}
        {history.length > 0 && (
          <div className="max-w-2xl mx-auto mt-8">
            <h3 className="text-sm font-semibold mb-3 text-zinc-200">Previous Reports</h3>
            <div className="space-y-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition-colors hover:bg-zinc-800/50 bg-zinc-900 border border-zinc-800"
                  onClick={() => loadReport(h.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MetricRingSvg score={h.siteScore} size={36} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate text-zinc-200">{h.siteName}</div>
                      <div className="text-xs truncate text-zinc-500">{h.url}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-xs text-zinc-500">
                      {new Date(h.generatedAt).toLocaleDateString()}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); openHtmlReport(h.id); }}
                      className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                      title="View printable report"
                    >
                      <FileText className="w-4 h-4 text-zinc-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Report view
  const r = report;

  return (
    <div className="space-y-6 p-6">
      {/* Back + Actions bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => { setView('input'); setReport(null); }}
          className="text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-zinc-500"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          {r.id && (
            <button
              onClick={() => openHtmlReport(r.id!)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors bg-teal-400 text-[#0f1219]"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Client Report
            </button>
          )}
          <button
            onClick={() => {
              const domain = r.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
              window.location.hash = `#new-workspace?url=${encodeURIComponent(r.url)}&name=${encodeURIComponent(domain)}`;
            }}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
          >
            <Zap className="w-3.5 h-3.5" />
            Onboard as Client
          </button>
        </div>
      </div>

      {/* Score Header */}
      <div className="text-center">
        <h2 className="text-lg font-bold text-zinc-200">{r.siteName}</h2>
        <p className="text-xs mt-0.5 text-zinc-500">{r.url}</p>

        <div className="flex justify-center mt-4">
          <MetricRing score={r.siteScore} size={112} />
        </div>

        <div className="flex justify-center gap-6 mt-4">
          <div className="text-center">
            <div className="text-lg font-bold text-zinc-200">{r.totalPages}</div>
            <div className="text-xs text-zinc-500">Pages</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-red-400">{r.errors}</div>
            <div className="text-xs text-zinc-500">Errors</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-yellow-400">{r.warnings}</div>
            <div className="text-xs text-zinc-500">Warnings</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-blue-400">{r.infos}</div>
            <div className="text-xs text-zinc-500">Info</div>
          </div>
        </div>
      </div>

      {/* Top Risks */}
      {r.topRisks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-zinc-200">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            Top Risks
          </h3>
          <div className="space-y-2">
            {r.topRisks.map((risk, idx) => (
              <div key={idx} className="rounded-xl px-4 py-3 bg-red-500/5 border border-red-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-300">{risk.message}</p>
                    {risk.opportunityCost && (
                      <p className="text-xs text-red-400/70 mt-1 italic">{risk.opportunityCost}</p>
                    )}
                    <p className="text-xs mt-1 text-zinc-500">{risk.recommendation}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Wins */}
      {r.quickWins.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-zinc-200">
            <Zap className="w-4 h-4 text-yellow-400" />
            Quick Wins
          </h3>
          <div className="space-y-2">
            {r.quickWins.map((win, idx) => (
              <div key={idx} className="rounded-xl px-4 py-3 bg-emerald-500/5 border border-emerald-500/20">
                <div className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-300">{win.message}</p>
                    <p className="text-xs mt-1 text-zinc-500">{win.recommendation}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Site-Wide Issues */}
      {r.siteWideIssues.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-zinc-200">
            <Globe className="w-4 h-4 text-zinc-500" />
            Site-Wide Issues
          </h3>
          <div className="space-y-1">
            {r.siteWideIssues.map((issue, idx) => (
              <div key={idx} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-zinc-900">
                <SeverityBadge severity={issue.severity} />
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{issue.message}</p>
                  <p className="text-xs mt-0.5 text-zinc-500">{issue.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Page-by-Page */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-zinc-200">
          Page-by-Page Breakdown
        </h3>
        <div className="space-y-2">
          {r.pages.map((page) => (
            <div key={page.url}>
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-zinc-800/50 bg-zinc-900 border border-zinc-800"
                onClick={() => setExpandedPage(expandedPage === page.url ? null : page.url)}
              >
                {expandedPage === page.url
                  ? <ChevronDown className="w-4 h-4 shrink-0 text-zinc-500" />
                  : <ChevronRight className="w-4 h-4 shrink-0 text-zinc-500" />
                }
                <MetricRingSvg score={page.score} size={32} />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-zinc-200">{page.page}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {page.issues.filter(i => i.severity === 'error').length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                      {page.issues.filter(i => i.severity === 'error').length}
                    </span>
                  )}
                  {page.issues.filter(i => i.severity === 'warning').length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                      {page.issues.filter(i => i.severity === 'warning').length}
                    </span>
                  )}
                </div>
              </div>

              {expandedPage === page.url && (
                <div className="ml-7 mt-1 mb-2 space-y-1">
                  <div className="text-xs truncate px-3 py-1 text-zinc-500">{page.url}</div>
                  {page.issues.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-emerald-400">✓ No issues found</div>
                  ) : (
                    page.issues.map((issue, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-zinc-900">
                        <SeverityBadge severity={issue.severity} />
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-200">{issue.message}</p>
                          <p className="text-xs mt-0.5 text-zinc-500">{issue.recommendation}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
