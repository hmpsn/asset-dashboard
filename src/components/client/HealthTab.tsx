import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Info, CheckCircle2, ChevronDown, Shield, FileEdit, Share2, Link2, ExternalLink, FileText, BarChart3, Check, Globe } from 'lucide-react';
import { MetricRing } from '../ui';
import { scoreColorClass } from '../ui/constants';
import { ScoreHistoryChart } from './helpers';
import { toLiveUrl } from './utils';
import { SEV, CAT_LABELS } from './types';
import type { AuditSummary, AuditDetail, CwvStrategyResult } from './types';
import { FixRecommendations } from './FixRecommendations';
import { OrderStatus } from './OrderStatus';
import { STUDIO_NAME } from '../../constants';
import { post, getSafe } from '../../api/client';

const ScoreRing = MetricRing;

export interface HealthTabProps {
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  liveDomain?: string;
  initialSeverity?: 'all' | 'error' | 'warning' | 'info';
  tier?: 'free' | 'growth' | 'premium';
  workspaceId?: string;
  onContentRequested?: () => void;
}

const CONTENT_ISSUE_CHECKS = ['content-length', 'heading', 'h1', 'h1-missing', 'h1-multiple', 'word-count'];
function hasContentIssues(issues: { check: string; message: string }[]): boolean {
  return issues.some(i => {
    const chk = i.check?.toLowerCase() || '';
    const msg = i.message?.toLowerCase() || '';
    return CONTENT_ISSUE_CHECKS.some(c => chk.includes(c)) || msg.includes('thin content') || msg.includes('word');
  });
}

export function HealthTab({ audit, auditDetail, liveDomain, initialSeverity, tier, workspaceId, onContentRequested }: HealthTabProps) {
  // State for accordion sections (all collapsed by default)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [visiblePages, setVisiblePages] = useState(3);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>(initialSeverity || 'all');
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [auditSearch, setAuditSearch] = useState('');
  const [requestedPages, setRequestedPages] = useState<Set<string>>(new Set());
  const [requestingPage, setRequestingPage] = useState<string | null>(null);

  const requestContentImprovement = async (page: { pageId: string; page: string; slug: string; issues: { check: string; message: string }[] }) => {
    if (!workspaceId || requestedPages.has(page.pageId)) return;
    setRequestingPage(page.pageId);
    try {
      const wordIssue = page.issues.find(i => i.check?.toLowerCase().includes('content-length'));
      const wordMatch = wordIssue?.message?.match(/(\d+)\s*words?/i);
      const wordCount = wordMatch ? parseInt(wordMatch[1], 10) : undefined;
      await post(`/api/public/content-request/${workspaceId}/from-audit`, {
        pageSlug: page.slug,
        pageName: page.page,
        issues: page.issues.filter(i => hasContentIssues([i])).map(i => i.message),
        wordCount,
      });
      setRequestedPages(prev => new Set(prev).add(page.pageId));
      onContentRequested?.();
    } catch { /* silent fail */ }
    finally { setRequestingPage(null); }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

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

  // Share reports state
  const [shareOpen, setShareOpen] = useState(false);
  const [reports, setReports] = useState<Array<{ id: string; type: 'audit' | 'monthly'; title: string; createdAt: string; score?: number; permalink: string }>>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shareOpen && workspaceId && reports.length === 0) {
      getSafe<Array<{ id: string; type: 'audit' | 'monthly'; title: string; createdAt: string; score?: number; permalink: string }>>(`/api/public/reports/${workspaceId}`, []).then(setReports);
    }
  }, [shareOpen, workspaceId]);

  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e: MouseEvent) => { if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [shareOpen]);

  const copyReportLink = (permalink: string, id: string) => {
    const url = `${window.location.origin}${permalink}`;
    navigator.clipboard.writeText(url).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
  };

  if (auditDetail) return (
    <div className="space-y-4">
      {/* ── HEADER ── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Site Health</h2>
          <p className="text-sm text-zinc-500 mt-1">{auditDetail.audit.totalPages} pages · Last scanned {new Date(auditDetail.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        {/* Share dropdown preserved */}
        <div className="relative" ref={shareRef}>
          <button onClick={() => setShareOpen(!shareOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors">
            <Share2 className="w-3.5 h-3.5" />
            Share Report
          </button>
          {shareOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <div className="text-xs font-medium text-zinc-200">Shareable Reports</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Copy a link to share with your team</div>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/50">
                {reports.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-zinc-500">Loading reports...</div>
                )}
                {reports.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/50 transition-colors">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${r.type === 'audit' ? 'bg-emerald-500/10' : 'bg-blue-500/10'}`}>
                      {r.type === 'audit' ? <BarChart3 className="w-3.5 h-3.5 text-emerald-400" /> : <FileText className="w-3.5 h-3.5 text-blue-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-zinc-300 truncate">{r.title}</div>
                      <div className="text-[10px] text-zinc-500">{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => copyReportLink(r.permalink, r.id)}
                        className={`p-1.5 rounded-md transition-colors ${copiedId === r.id ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
                        title="Copy link">
                        {copiedId === r.id ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                      </button>
                      <a href={r.permalink} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors" title="Open report">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 1. HEALTH SCORE SUMMARY ── */}
      {(() => {
        const score = auditDetail.audit.siteScore;
        const summary = score >= 90 
          ? 'Your site is in excellent shape with only minor improvements needed.'
          : score >= 70
          ? 'Good foundation with some actionable fixes to boost your rankings.'
          : score >= 50
          ? 'Several issues are holding back your search performance — prioritize the fixes below.'
          : 'Critical issues need immediate attention to establish search visibility.';
        return (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center gap-4">
              <div className={`text-4xl font-bold ${scoreColorClass(score)}`}>{score}</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-200">Your site's health</div>
                <div className="text-xs text-zinc-500 mt-0.5">{summary}</div>
              </div>
              {auditDetail.previousScore != null && (
                <div className={`text-xs ${auditDetail.audit.siteScore > auditDetail.previousScore ? 'text-green-400' : auditDetail.audit.siteScore < auditDetail.previousScore ? 'text-red-400' : 'text-zinc-500'}`}>
                  {auditDetail.audit.siteScore > auditDetail.previousScore ? '↑' : '↓'} {Math.abs(auditDetail.audit.siteScore - auditDetail.previousScore)} from previous
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-zinc-800/50 text-xs">
              <span className="text-zinc-500">{auditDetail.audit.totalPages} pages scanned</span>
              <span className="text-red-400">{auditDetail.audit.errors} errors</span>
              <span className="text-amber-400">{auditDetail.audit.warnings} warnings</span>
            </div>
          </div>
        );
      })()}

      {/* ── 2. FIX THESE FIRST (Top 5 prioritized) ── */}
      {(() => {
        // Collect all issues prioritized: errors > warnings > content issues
        const allIssues: Array<{
          pageId: string;
          page: string;
          slug: string;
          url: string;
          issue: { check: string; message: string; severity: 'error' | 'warning' | 'info'; recommendation?: string; category?: string };
        }> = [];
        auditDetail.audit.pages.forEach(p => {
          p.issues.forEach(i => {
            allIssues.push({ pageId: p.pageId, page: p.page, slug: p.slug, url: p.url, issue: i });
          });
        });
        // Sort: errors first, then warnings, then by content-related
        const prioritized = allIssues.sort((a, b) => {
          const sevScore = (s: string) => s === 'error' ? 3 : s === 'warning' ? 2 : 1;
          const sevDiff = sevScore(b.issue.severity) - sevScore(a.issue.severity);
          if (sevDiff !== 0) return sevDiff;
          const aContent = hasContentIssues([a.issue]) ? 1 : 0;
          const bContent = hasContentIssues([b.issue]) ? 1 : 0;
          return bContent - aContent;
        }).slice(0, 5);
        if (prioritized.length === 0) return null;
        return (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-zinc-200">Fix these first</span>
              <span className="text-[11px] text-zinc-500 ml-auto">Top {prioritized.length} priorities</span>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {prioritized.map((item, i) => {
                const sc = SEV[item.issue.severity];
                return (
                  <div key={`${item.pageId}-${i}`} className="px-4 py-3 hover:bg-zinc-800/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 text-[11px] text-zinc-400 font-medium">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-medium uppercase ${sc.text}`}>{item.issue.severity}</span>
                          <span className="text-[11px] text-zinc-500 truncate">{item.page}</span>
                        </div>
                        <div className="text-[11px] text-zinc-300 mt-0.5">{item.issue.message}</div>
                        {item.issue.recommendation && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">{item.issue.recommendation}</div>
                        )}
                      </div>
                      {hasContentIssues([item.issue]) && workspaceId && !requestedPages.has(item.pageId) && (
                        <button
                          onClick={() => requestContentImprovement({ pageId: item.pageId, page: item.page, slug: item.slug, issues: [item.issue] })}
                          disabled={requestingPage === item.pageId}
                          className="flex-shrink-0 px-2 py-1 rounded bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-medium transition-colors"
                        >
                          {requestingPage === item.pageId ? '...' : 'Fix'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── 3. DEEP DIVE (accordion sections, all collapsed by default) ── */}
      <div className="space-y-3">
        {/* Score History */}
        {auditDetail.scoreHistory.length >= 2 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <button onClick={() => toggleSection('score-history')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
              <span className="text-sm font-medium text-zinc-300">Score History</span>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('score-history') ? '' : '-rotate-90'}`} />
            </button>
            {expandedSections.has('score-history') && (
              <div className="px-4 pb-4">
                <ScoreHistoryChart history={auditDetail.scoreHistory} />
              </div>
            )}
          </div>
        )}

        {/* Category Breakdown */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <button onClick={() => toggleSection('categories')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
            <span className="text-sm font-medium text-zinc-300">Issues by Category</span>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('categories') ? '' : '-rotate-90'}`} />
          </button>
          {expandedSections.has('categories') && (
            <div className="px-4 pb-4">
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
          )}
        </div>

        {/* Core Web Vitals */}
        {auditDetail.audit.cwvSummary && (auditDetail.audit.cwvSummary.mobile || auditDetail.audit.cwvSummary.desktop) && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <button onClick={() => toggleSection('cwv')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-medium text-zinc-300">Page Speed &amp; Core Web Vitals</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('cwv') ? '' : '-rotate-90'}`} />
            </button>
            {expandedSections.has('cwv') && (() => {
              const ratingColor = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
                r === 'good' ? 'text-emerald-400' : r === 'needs-improvement' ? 'text-amber-400' : r === 'poor' ? 'text-red-400' : 'text-zinc-500';
              const ratingBg = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
                r === 'good' ? 'bg-emerald-500/10 border-emerald-500/20' : r === 'needs-improvement' ? 'bg-amber-500/10 border-amber-500/20' : r === 'poor' ? 'bg-red-500/10 border-red-500/20' : 'bg-zinc-800/50 border-zinc-700/30';
              const assessBadge = (a: CwvStrategyResult['assessment']) =>
                a === 'good' ? { text: 'Passed', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
                : a === 'needs-improvement' ? { text: 'Needs Work', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
                : a === 'poor' ? { text: 'Failed', cls: 'bg-red-500/15 text-red-400 border-red-500/30' }
                : { text: 'No Data', cls: 'bg-zinc-800/50 text-zinc-500 border-zinc-700/30' };
              const renderStrategy = (label: string, s: CwvStrategyResult) => {
                const badge = assessBadge(s.assessment);
                return (
                  <div key={label} className="flex-1 min-w-[240px]">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${badge.cls}`}>{badge.text}</span>
                    </div>
                    <div className="space-y-1.5">
                      {[
                        { key: 'LCP' as const, label: 'Loading Speed', fmt: (v: number) => `${(v / 1000).toFixed(1)}s`, desc: 'How fast content appears' },
                        { key: 'INP' as const, label: 'Responsiveness', fmt: (v: number) => `${Math.round(v)}ms`, desc: 'How fast the page reacts' },
                        { key: 'CLS' as const, label: 'Visual Stability', fmt: (v: number) => v.toFixed(2), desc: 'How much the layout shifts' },
                      ].map(m => {
                        const metric = s.metrics[m.key];
                        return (
                          <div key={m.key} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${ratingBg(metric.rating)}`}>
                            <div>
                              <span className="text-xs font-medium text-zinc-300">{m.label}</span>
                              <span className="text-[10px] text-zinc-500 ml-1.5">{m.desc}</span>
                            </div>
                            <span className={`text-sm font-mono font-medium ${ratingColor(metric.rating)}`}>
                              {metric.value !== null ? m.fmt(metric.value) : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {!s.fieldDataAvailable && (
                      <div className="mt-1.5 text-[10px] text-zinc-500 italic px-1">Based on lab simulation — real visitor data not yet available</div>
                    )}
                  </div>
                );
              };
              return (
                <div className="px-4 pb-4 flex gap-4 flex-wrap">
                  {auditDetail.audit.cwvSummary!.mobile && renderStrategy('Mobile', auditDetail.audit.cwvSummary!.mobile)}
                  {auditDetail.audit.cwvSummary!.desktop && renderStrategy('Desktop', auditDetail.audit.cwvSummary!.desktop)}
                </div>
              );
            })()}
          </div>
        )}

        {/* Site-Wide Issues */}
        {auditDetail.audit.siteWideIssues.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <button onClick={() => toggleSection('site-wide')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
              <span className="text-sm font-medium text-zinc-300">Site-Wide Issues</span>
              <span className="text-[11px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{auditDetail.audit.siteWideIssues.length}</span>
            </button>
            {expandedSections.has('site-wide') && (
              <div className="px-4 pb-4 space-y-2">
                {auditDetail.audit.siteWideIssues.map((issue, i) => {
                  const sc = SEV[issue.severity] || SEV.info;
                  return (
                    <div key={i} className={`px-3 py-2.5 rounded-lg ${sc.bg} border ${sc.border}`}>
                      <div className={`flex items-center gap-1.5 text-xs font-medium ${sc.text}`}>
                        {issue.severity === 'error' && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                        {issue.severity === 'warning' && <Info className="w-3.5 h-3.5 flex-shrink-0" />}
                        {issue.severity === 'info' && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
                        {issue.message}
                      </div>
                      {issue.recommendation && <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Page Breakdown (top 3 only initially) */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <button onClick={() => toggleSection('page-breakdown')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-300">Page Breakdown</span>
              <span className="text-[11px] text-zinc-500">{filteredPages.length} pages</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('page-breakdown') ? '' : '-rotate-90'}`} />
          </button>
          {expandedSections.has('page-breakdown') && (
            <div className="border-t border-zinc-800">
              <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2 flex-wrap bg-zinc-950/30">
                <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5">
                  {(['all', 'error', 'warning', 'info'] as const).map(s => (
                    <button key={s} onClick={() => setSeverityFilter(s)}
                      className={`px-3 py-2 min-h-[44px] rounded-md text-[11px] font-medium transition-colors ${
                        severityFilter === s ? (s === 'all' ? 'bg-zinc-700 text-zinc-200' : `${SEV[s].bg} ${SEV[s].text}`) : 'text-zinc-500 hover:text-zinc-300'
                      }`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
                  ))}
                </div>
                <input type="text" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Search pages..."
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-40" />
              </div>
              <div className="divide-y divide-zinc-800/50 max-h-[400px] overflow-y-auto">
                {filteredPages.slice(0, visiblePages).map(page => {
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
                          <div className={`text-xs font-bold ${scoreColorClass(page.score)}`}>{page.score}</div>
                        </div>
                      </button>
                      {isExp && pageIssues.length > 0 && (
                        <div className="px-4 pb-3 pl-11 space-y-1.5">
                          {pageIssues.map((issue, i) => {
                            const sc = SEV[issue.severity] || SEV.info;
                            return (
                              <div key={i} className={`px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                                <div className="flex items-start gap-2">
                                  {issue.severity === 'error' && <AlertTriangle className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                  {issue.severity === 'warning' && <Info className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                  {issue.severity === 'info' && <CheckCircle2 className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                  <span className={`text-[11px] font-medium uppercase ${sc.text} flex-shrink-0 mt-0.5`}>{issue.severity}</span>
                                  <div>
                                    <div className="text-[11px] text-zinc-300">{issue.message}</div>
                                    {issue.recommendation && <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>}
                                    {issue.value && <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">Current: {issue.value}</div>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {hasContentIssues(page.issues) && workspaceId && (
                            <button
                              onClick={(e) => { e.stopPropagation(); requestContentImprovement(page); }}
                              disabled={requestedPages.has(page.pageId) || requestingPage === page.pageId}
                              className={`mt-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                requestedPages.has(page.pageId)
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                                  : 'bg-teal-600 hover:bg-teal-500 text-white'
                              }`}
                            >
                              <FileEdit className="w-3 h-3" />
                              {requestedPages.has(page.pageId) ? 'Content request created' : requestingPage === page.pageId ? 'Creating request...' : 'Request Content Improvement'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredPages.length === 0 && <div className="px-4 py-8 text-center text-xs text-zinc-500">No pages match your filters</div>}
                {filteredPages.length > visiblePages && (
                  <button 
                    onClick={() => setVisiblePages(filteredPages.length)}
                    className="w-full text-center py-3 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors border-t border-zinc-800"
                  >
                    View all {filteredPages.length} pages
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fix recommendations with cart CTAs */}
      <FixRecommendations auditDetail={auditDetail} tier={tier} workspaceId={workspaceId} />

      {/* Order status — recent fix purchases */}
      {workspaceId && <OrderStatus workspaceId={workspaceId} />}
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
      <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">Once {STUDIO_NAME} runs a site audit, you'll see a detailed health score, page-by-page issues, and recommendations to improve your site.</p>
    </div>
  );
}
