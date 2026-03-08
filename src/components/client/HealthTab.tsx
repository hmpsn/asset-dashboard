import { useState } from 'react';
import { AlertTriangle, Info, CheckCircle2, ChevronDown, Shield } from 'lucide-react';
import { MetricRing } from '../ui';
import { ScoreHistoryChart } from './helpers';
import { toLiveUrl } from './utils';
import { SEV, CAT_LABELS } from './types';
import type { AuditSummary, AuditDetail } from './types';
import { FixRecommendations } from './FixRecommendations';
import { OrderStatus } from './OrderStatus';

const ScoreRing = MetricRing;

export interface HealthTabProps {
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  liveDomain?: string;
  initialSeverity?: 'all' | 'error' | 'warning' | 'info';
  tier?: 'free' | 'growth' | 'premium';
  workspaceId?: string;
}

export function HealthTab({ audit, auditDetail, liveDomain, initialSeverity = 'all', tier, workspaceId }: HealthTabProps) {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>(initialSeverity);
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [auditSearch, setAuditSearch] = useState('');

  const togglePage = (id: string) => setExpandedPages(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const filteredPages = auditDetail?.audit.pages.filter(p => {
    if (auditSearch && !p.page.toLowerCase().includes(auditSearch.toLowerCase()) && !toLiveUrl(p.url, liveDomain).toLowerCase().includes(auditSearch.toLowerCase())) return false;
    if (severityFilter === 'all') return true;
    return p.issues.some(i => i.severity === severityFilter);
  }) || [];

  const categoryStats = auditDetail ? (() => {
    const cats: Record<string, { errors: number; warnings: number; infos: number }> = {};
    auditDetail.audit.pages.forEach(p => p.issues.forEach(i => {
      const cat = i.category || 'other';
      if (!cats[cat]) cats[cat] = { errors: 0, warnings: 0, infos: 0 };
      if (i.severity === 'error') cats[cat].errors++; else if (i.severity === 'warning') cats[cat].warnings++; else cats[cat].infos++;
    }));
    return cats;
  })() : {};

  if (auditDetail) return (
    <div className="space-y-5">
      <div className="mb-2">
        <h2 className="text-xl font-semibold text-zinc-100">Site Health</h2>
        <p className="text-sm text-zinc-500 mt-1">{auditDetail.audit.totalPages} pages · Last scanned {new Date(auditDetail.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>
      <div className="grid grid-cols-3 gap-5">
        {/* Score ring */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 flex flex-col items-center justify-center">
          <ScoreRing score={auditDetail.audit.siteScore} size={140} />
          <div className="text-xs text-zinc-500 mt-3">{auditDetail.audit.totalPages} pages scanned</div>
          <div className="text-[11px] text-zinc-500">{new Date(auditDetail.createdAt).toLocaleDateString()}</div>
          {auditDetail.previousScore != null && (
            <div className={`text-xs mt-1 ${auditDetail.audit.siteScore > auditDetail.previousScore ? 'text-green-400' : auditDetail.audit.siteScore < auditDetail.previousScore ? 'text-red-400' : 'text-zinc-500'}`}>
              {auditDetail.audit.siteScore > auditDetail.previousScore ? '↑' : '↓'} {Math.abs(auditDetail.audit.siteScore - auditDetail.previousScore)} from previous
            </div>
          )}
        </div>
        {/* Severity buttons */}
        <div className="space-y-3">
          {([
            { sev: 'error' as const, count: auditDetail.audit.errors, label: 'Errors', Icon: AlertTriangle },
            { sev: 'warning' as const, count: auditDetail.audit.warnings, label: 'Warnings', Icon: Info },
            { sev: 'info' as const, count: auditDetail.audit.infos, label: 'Info', Icon: CheckCircle2 },
          ]).map(s => {
            const sc = SEV[s.sev];
            return (
              <button key={s.sev} onClick={() => setSeverityFilter(severityFilter === s.sev ? 'all' : s.sev)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${severityFilter === s.sev ? `${sc.bg} ${sc.border}` : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}>
                <s.Icon className={`w-4 h-4 ${sc.text}`} />
                <span className="text-sm font-medium text-zinc-300">{s.label}</span>
                <span className={`text-xl font-bold ml-auto ${sc.text}`}>{s.count}</span>
              </button>
            );
          })}
        </div>
        {/* Score history + category breakdown */}
        <div className="space-y-3">
          {auditDetail.scoreHistory.length >= 2 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="text-xs font-medium text-zinc-400 mb-2">Score History</div>
              <ScoreHistoryChart history={auditDetail.scoreHistory} />
            </div>
          )}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="text-xs font-medium text-zinc-400 mb-3">Issues by Category</div>
            <div className="space-y-2">
              {Object.entries(categoryStats).map(([cat, counts]) => {
                const info = CAT_LABELS[cat] || { label: cat, color: '#71717a' };
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: info.color }} />
                    <span className="text-[11px] text-zinc-400 flex-1">{info.label}</span>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      {counts.errors > 0 && <span className="text-red-400">{counts.errors}E</span>}
                      {counts.warnings > 0 && <span className="text-amber-400">{counts.warnings}W</span>}
                      {counts.infos > 0 && <span className="text-blue-400">{counts.infos}I</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Fix recommendations with cart CTAs */}
      <FixRecommendations auditDetail={auditDetail} tier={tier} />

      {/* Order status — recent fix purchases */}
      {workspaceId && <OrderStatus workspaceId={workspaceId} />}

      {/* Site-wide issues */}
      {auditDetail.audit.siteWideIssues.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="text-xs font-medium text-zinc-400 mb-3">Site-Wide Issues</div>
          <div className="space-y-2">
            {auditDetail.audit.siteWideIssues.map((issue, i) => {
              const sc = SEV[issue.severity] || SEV.info;
              return (
                <div key={i} className={`px-3 py-2.5 rounded-lg ${sc.bg} border ${sc.border}`}>
                  <div className={`text-xs font-medium ${sc.text}`}>{issue.message}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Page-by-page breakdown */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
          <span className="text-xs font-medium text-zinc-300">Page Breakdown</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5">
            {(['all', 'error', 'warning', 'info'] as const).map(s => (
              <button key={s} onClick={() => setSeverityFilter(s)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  severityFilter === s ? (s === 'all' ? 'bg-zinc-700 text-zinc-200' : `${SEV[s].bg} ${SEV[s].text}`) : 'text-zinc-500 hover:text-zinc-300'
                }`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <input type="text" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Search pages..."
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-40" />
        </div>
        <div className="divide-y divide-zinc-800/50 max-h-[600px] overflow-y-auto">
          {filteredPages.map(page => {
            const isExp = expandedPages.has(page.pageId);
            const pageIssues = severityFilter === 'all' ? page.issues : page.issues.filter(i => i.severity === severityFilter);
            const errs = page.issues.filter(i => i.severity === 'error').length;
            const warns = page.issues.filter(i => i.severity === 'warning').length;
            return (
              <div key={page.pageId}>
                <button onClick={() => togglePage(page.pageId)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left">
                  <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isExp ? '' : '-rotate-90'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-zinc-300 truncate">{page.page}</div>
                    <div className="text-[11px] text-zinc-500 truncate">{toLiveUrl(page.url, liveDomain)}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {errs > 0 && <span className="text-[11px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">{errs} err</span>}
                    {warns > 0 && <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{warns} warn</span>}
                    <div className={`text-xs font-bold ${page.score >= 80 ? 'text-green-400' : page.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{page.score}</div>
                  </div>
                </button>
                {isExp && pageIssues.length > 0 && (
                  <div className="px-4 pb-3 pl-11 space-y-1.5">
                    {pageIssues.map((issue, i) => {
                      const sc = SEV[issue.severity] || SEV.info;
                      return (
                        <div key={i} className={`px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                          <div className="flex items-start gap-2">
                            <span className={`text-[11px] font-medium uppercase ${sc.text} flex-shrink-0 mt-0.5`}>{issue.severity}</span>
                            <div>
                              <div className="text-[11px] text-zinc-300">{issue.message}</div>
                              <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>
                              {issue.value && <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">Current: {issue.value}</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filteredPages.length === 0 && <div className="px-4 py-8 text-center text-xs text-zinc-500">No pages match your filters</div>}
        </div>
      </div>
    </div>
  );

  if (audit) return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center gap-4">
        <ScoreRing score={audit.siteScore} size={100} />
        <div>
          <div className="text-sm font-medium text-zinc-200">Site Health Score</div>
          <div className="text-xs text-zinc-500">{audit.totalPages} pages • {new Date(audit.createdAt).toLocaleDateString()}</div>
          <div className="flex gap-3 mt-2"><span className="text-xs text-red-400">{audit.errors} errors</span><span className="text-xs text-amber-400">{audit.warnings} warnings</span></div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
        <Shield className="w-8 h-8 text-zinc-700" />
      </div>
      <p className="text-sm font-medium text-zinc-400">Site Health Check Coming Soon</p>
      <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">Once your team runs a site audit, you'll see a detailed health score, page-by-page issues, and recommendations to improve your site.</p>
    </div>
  );
}
