import { useState, useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, Info, CheckCircle2, ChevronDown, Shield, FileEdit, Share2, Link2, ExternalLink, FileText, BarChart3, Check, Globe, TrendingUp, Minus, LayoutList, Layers } from 'lucide-react';
import { MetricRing } from '../ui';
import { scoreColorClass } from '../ui/constants';
import { ScoreHistoryChart } from './helpers';
import { toLiveUrl } from './utils';
import { SEV, CAT_LABELS } from './types';
import type { AuditSummary, AuditDetail, CwvStrategyResult } from './types';
import { STUDIO_NAME } from '../../constants';
import { post, getSafe } from '../../api/client';

const ScoreRing = MetricRing;

export interface HealthTabProps {
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  liveDomain?: string;
  initialSeverity?: 'all' | 'error' | 'warning' | 'info';
  workspaceId?: string;
  onContentRequested?: () => void;
  actionPlanSlot?: ReactNode;
}

// Plain-English impact statements for each check type — shown below the raw issue message
// to help clients understand WHY something matters without needing to know SEO terminology.
const CHECK_IMPACT: Record<string, string> = {
  'title': 'The page title is the first thing people see in Google search results. It directly controls whether they click or scroll past.',
  'meta-description': 'Google shows this text below your link in search results. A missing or poor description means fewer people click through to your site.',
  'h1': 'The main heading tells Google what your page is about. Without it, your page is harder to rank for relevant searches.',
  'canonical': 'Without this, Google may split your ranking power across multiple URLs — weakening your position for all of them.',
  'duplicate-title': 'Having two pages with the same title confuses Google about which one to show. It can reduce rankings for both.',
  'duplicate-description': 'Duplicate descriptions make it harder for Google to understand what makes each page unique.',
  'img-alt': 'Missing alt text hides your images from Google Image Search and creates accessibility barriers for screen reader users.',
  'og-tags': 'Without these, links shared to social media show no title, description, or image — significantly reducing click-through.',
  'og-image': 'Without a preview image, social shares look bare and get far fewer clicks than posts with rich previews.',
  'structured-data': 'Schema markup can unlock rich results in Google — stars, FAQs, breadcrumbs — which stand out and get more clicks.',
  'internal-links': 'Internal links spread authority across your site and help Google discover all your pages.',
  'content-length': 'Pages with thin content are less likely to rank. Google prefers pages that fully answer a user\'s question.',
  'redirect-chains': 'Every redirect hop slows your page down and weakens the SEO authority passed through the link.',
  'mixed-content': 'HTTP content on an HTTPS page triggers browser security warnings that erode visitor trust.',
  'ssl': 'Google gives a small ranking boost to secure HTTPS pages. Insecure pages also display warnings in browsers.',
  'viewport': 'Without a viewport tag, your page won\'t scale correctly on mobile — and most searches now happen on phones.',
  'lang': 'The language attribute helps Google serve your content to the right audience in the right language.',
  'robots': 'The robots meta tag controls whether Google can index this page. An incorrect setting can hide it from search entirely.',
  'heading-hierarchy': 'A clear heading structure (H1, H2, H3) helps Google understand your content and helps visitors scan the page.',
  'cwv': 'Google uses page speed and stability as a ranking signal — slow or jumpy pages rank lower and lose visitors.',
  'cwv-lcp': 'Slow loading speed causes visitors to leave before your page even appears. Google penalizes slow-loading pages.',
  'cwv-cls': 'Content that shifts while loading frustrates visitors and can cause accidental clicks. Google flags this as poor experience.',
  'aeo-author': 'AI answer engines (ChatGPT, Google AI Overviews) prefer citing content with named, credentialed authors.',
  'aeo-date': 'Undated content gets deprioritized by AI systems that can\'t verify freshness — a quick fix with lasting benefit.',
  'aeo-answer-first': 'AI systems extract the first substantive paragraph as their citation. Generic intros waste that prime position.',
  'aeo-faq-no-schema': 'FAQ schema makes Q&A pairs directly extractable by AI answer engines and can unlock rich results in Google.',
  'aeo-hidden-content': 'Content hidden in accordions or tabs often isn\'t read by search crawlers or AI systems.',
  'aeo-citations': 'Pages that cite authoritative sources (.gov, .edu, journals) are trusted more by AI systems.',
  'aeo-dark-patterns': 'Aggressive overlays and autoplay reduce content accessibility for AI retrieval systems.',
};

function checkImpact(check: string): string | null {
  const chk = check.toLowerCase();
  return CHECK_IMPACT[chk] || null;
}

const CONTENT_ISSUE_CHECKS = ['content-length', 'heading', 'h1', 'h1-missing', 'h1-multiple', 'word-count'];
function hasContentIssues(issues: { check: string; message: string }[]): boolean {
  return issues.some(i => {
    const chk = i.check?.toLowerCase() || '';
    const msg = i.message?.toLowerCase() || '';
    return CONTENT_ISSUE_CHECKS.some(c => chk.includes(c)) || msg.includes('thin content') || msg.includes('word');
  });
}

export function HealthTab({ audit, auditDetail, liveDomain, initialSeverity, workspaceId, onContentRequested, actionPlanSlot }: HealthTabProps) {
  // State for accordion sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['site-wide-all']));
  
  // Ref for snap-to-section
  const allPagesRef = useRef<HTMLDivElement>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>(initialSeverity || 'warning');
  const [showInfoItems, setShowInfoItems] = useState(false);
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'by-page' | 'by-fix-type'>('by-page');
  const [auditSearch, setAuditSearch] = useState('');
  const [requestedPages, setRequestedPages] = useState<Set<string>>(new Set());
  const [requestingPage, setRequestingPage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

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
    } catch { setRequestError(page.pageId); }
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
    if (severityFilter === 'all') {
      if (!showInfoItems) return p.issues.some(i => i.severity !== 'info');
      return true;
    }
    if (severityFilter === 'info') return p.issues.some(i => i.severity === 'info');
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

  const infoIssueCount = auditDetail
    ? auditDetail.audit.pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'info').length, 0)
    : 0;

  // Share reports state
  const [shareOpen, setShareOpen] = useState(false);
  const [reports, setReports] = useState<Array<{ id: string; type: 'audit' | 'monthly'; title: string; createdAt: string; score?: number; permalink: string }>>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shareOpen && workspaceId && reports.length === 0) {
      getSafe<Array<{ id: string; type: 'audit' | 'monthly'; title: string; createdAt: string; score?: number; permalink: string }>>(`/api/public/reports/${workspaceId}`, []).then(setReports);
    }
  }, [shareOpen, workspaceId, reports.length]);

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

      {/* ── 1b. WHAT CHANGED SINCE LAST AUDIT ── */}
      {auditDetail.auditDiff && auditDetail.previousScore != null && (
        auditDetail.auditDiff.resolved > 0 || auditDetail.auditDiff.newIssues > 0
      ) && (() => {
        const { resolved, newIssues } = auditDetail.auditDiff!;
        const scoreDelta = auditDetail.audit.siteScore - auditDetail.previousScore!;
        const deltaColor = scoreDelta > 0 ? 'text-emerald-400' : scoreDelta < 0 ? 'text-red-400' : 'text-zinc-500';
        const DeltaIcon = scoreDelta > 0 ? TrendingUp : scoreDelta < 0 ? AlertTriangle : Minus;
        return (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[12px]">
            <DeltaIcon className={`w-4 h-4 flex-shrink-0 ${deltaColor}`} />
            <span className="text-zinc-400">Since last audit:</span>
            {resolved > 0 && <span className="text-emerald-400 font-medium">{resolved} resolved</span>}
            {resolved > 0 && newIssues > 0 && <span className="text-zinc-600">·</span>}
            {newIssues > 0 && <span className="text-red-400 font-medium">{newIssues} new</span>}
            <span className="text-zinc-600">·</span>
            <span className={`font-medium ${deltaColor}`}>
              score {auditDetail.previousScore} → {auditDetail.audit.siteScore}
              {scoreDelta !== 0 && <span className="ml-1">({scoreDelta > 0 ? '+' : ''}{scoreDelta})</span>}
            </span>
          </div>
        );
      })()}

      {/* ── 2. PAGE SPEED (Always Expanded) ── */}
      {auditDetail.audit.cwvSummary && (auditDetail.audit.cwvSummary.mobile || auditDetail.audit.cwvSummary.desktop) && (() => {
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
            <div key={label} className="flex-1 min-w-[200px]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${badge.cls}`}>{badge.text}</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { key: 'LCP' as const, label: 'Loading Speed', fmt: (v: number) => `${(v / 1000).toFixed(1)}s`, desc: 'Content appears' },
                  { key: 'INP' as const, label: 'Responsiveness', fmt: (v: number) => `${Math.round(v)}ms`, desc: 'Page reacts' },
                  { key: 'CLS' as const, label: 'Visual Stability', fmt: (v: number) => v.toFixed(2), desc: 'Layout shifts' },
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
                <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-300">These are simulated scores, not real user data. Real metrics appear once Chrome has enough traffic data for your site.</p>
                </div>
              )}
            </div>
          );
        };
        return (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-200">Page Speed &amp; Core Web Vitals</span>
              <span className="text-[11px] text-zinc-500 ml-2">Google uses these to rank your site</span>
            </div>
            <div className="flex gap-4 flex-wrap">
              {auditDetail.audit.cwvSummary!.mobile && renderStrategy('Mobile', auditDetail.audit.cwvSummary!.mobile)}
              {auditDetail.audit.cwvSummary!.desktop && renderStrategy('Desktop', auditDetail.audit.cwvSummary!.desktop)}
            </div>
          </div>
        );
      })()}

      {/* ── 3. FIX THESE FIRST (Top 5) + Pages Grid ── */}
      {(() => {
        // Collect and prioritize issues
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
        const prioritized = allIssues.sort((a, b) => {
          const sevScore = (s: string) => s === 'error' ? 3 : s === 'warning' ? 2 : 1;
          const sevDiff = sevScore(b.issue.severity) - sevScore(a.issue.severity);
          if (sevDiff !== 0) return sevDiff;
          const aContent = hasContentIssues([a.issue]) ? 1 : 0;
          const bContent = hasContentIssues([b.issue]) ? 1 : 0;
          return bContent - aContent;
        }).slice(0, 5);

        // Sort pages by issue count (worst first) for the cards
        // Exclude noindex pages — their issues don't affect search performance
        const sortedPages = [...auditDetail.audit.pages]
          .filter(p => !p.noindex)
          .sort((a, b) => {
            const aErrs = a.issues.filter(i => i.severity === 'error').length;
            const bErrs = b.issues.filter(i => i.severity === 'error').length;
            if (aErrs !== bErrs) return bErrs - aErrs;
            return b.issues.length - a.issues.length;
          }).slice(0, 3);

        return (
          <>
            {/* Two-column layout: Fix List | Page Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Fix These First */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-zinc-200">Fix these first</span>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {prioritized.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
                      <p className="text-xs text-zinc-500">No critical issues found!</p>
                    </div>
                  ) : (
                    prioritized.map((item, i) => {
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
                              {checkImpact(item.issue.check) && (
                                <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{checkImpact(item.issue.check)}</div>
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
                    })
                  )}
                </div>
              </div>

              {/* Page Cards */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm font-medium text-zinc-200">Pages needing attention</span>
                  </div>
                  <span className="text-[11px] text-zinc-500">Top {sortedPages.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {sortedPages.map(page => {
                    const errs = page.issues.filter(i => i.severity === 'error').length;
                    const warns = page.issues.filter(i => i.severity === 'warning').length;
                    const isExpanded = expandedPages.has(page.pageId);
                    return (
                      <div key={page.pageId} className={`rounded-lg border transition-all ${isExpanded ? 'bg-zinc-950/80 border-zinc-700' : 'bg-zinc-950/50 border-zinc-800/50 hover:border-zinc-700'}`}>
                        <button
                          onClick={() => togglePage(page.pageId)}
                          className="w-full flex items-center gap-3 p-3 text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-zinc-300 truncate">{page.page}</div>
                            <div className="text-[11px] text-zinc-500 truncate">{toLiveUrl(page.url, liveDomain)}</div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {errs > 0 && <span className="text-[11px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">{errs}E</span>}
                            {warns > 0 && <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{warns}W</span>}
                            <div className={`text-xs font-bold ${scoreColorClass(page.score)}`}>{page.score}</div>
                            <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                          </div>
                        </button>
                        
                        {/* Expanded issues accordion inside the card */}
                        {isExpanded && (
                          <div className="px-3 pb-3 border-t border-zinc-800/50">
                            <div className="pt-3 space-y-2">
                              {page.issues.map((issue, i) => {
                                const sc = SEV[issue.severity];
                                return (
                                  <div key={i} className={`px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                                    <div className="flex items-start gap-2">
                                      {issue.severity === 'error' && <AlertTriangle className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                      {issue.severity === 'warning' && <Info className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                      <div className="flex-1">
                                        <div className="text-[11px] text-zinc-300">{issue.message}</div>
                                        {checkImpact(issue.check) && (
                                          <div className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{checkImpact(issue.check)}</div>
                                        )}
                                        {issue.recommendation && <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {hasContentIssues(page.issues) && workspaceId && (
                              <>
                                <button
                                  onClick={() => { setRequestError(null); requestContentImprovement(page); }}
                                  disabled={requestedPages.has(page.pageId) || requestingPage === page.pageId}
                                  className={`mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                    requestedPages.has(page.pageId)
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                                      : 'bg-teal-600 hover:bg-teal-500 text-white'
                                  }`}
                                >
                                  <FileEdit className="w-3 h-3" />
                                  {requestedPages.has(page.pageId) ? 'Request created' : requestingPage === page.pageId ? 'Creating...' : 'Request Content Fix'}
                                </button>
                                {requestError === page.pageId && (
                                  <p className="text-[11px] text-red-400 mt-1">Failed to create request. Please try again.</p>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button 
                  onClick={() => {
                    setTimeout(() => allPagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                  }}
                  className="w-full mt-3 text-center py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors border border-dashed border-zinc-800 rounded-lg hover:border-zinc-700"
                >
                  View all {auditDetail.audit.totalPages} pages
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── 4. PRIORITIZED ACTION PLAN (slot from parent) ── */}
      {actionPlanSlot}

      {/* ── 5. SITE-WIDE ISSUES ── */}
      {auditDetail.audit.siteWideIssues.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                <Info className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">Site-Wide Issues</div>
                <div className="text-[11px] text-zinc-500">{auditDetail.audit.siteWideIssues.length} issues affecting your entire site</div>
              </div>
            </div>
          </div>
          
          <div className="p-3">
            <div className="flex flex-wrap gap-3">
              {auditDetail.audit.siteWideIssues.slice(0, 3).map((issue, i) => {
                const sc = SEV[issue.severity];
                return (
                  <div key={i} className={`px-2.5 py-1.5 rounded-lg ${sc.bg} border ${sc.border} text-[11px]`}>
                    <span className={sc.text}>{issue.message}</span>
                  </div>
                );
              })}
              {auditDetail.audit.siteWideIssues.length > 3 && (
                <button 
                  onClick={() => toggleSection('site-wide-all')}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-400 hover:text-zinc-300"
                >
                  +{auditDetail.audit.siteWideIssues.length - 3} more
                </button>
              )}
            </div>
            
            {expandedSections.has('site-wide-all') && (
              <div className="mt-3 pt-3 border-t border-zinc-800/50 space-y-2">
                {auditDetail.audit.siteWideIssues.map((issue, i) => {
                  const sc = SEV[issue.severity];
                  return (
                    <div key={i} className={`px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                      <div className={`text-[11px] font-medium ${sc.text}`}>{issue.message}</div>
                      {issue.recommendation && <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 6. ALL PAGES LIST ── */}
      <div ref={allPagesRef}>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 flex-wrap bg-zinc-950/30">
            {/* View mode toggle */}
            <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5">
              <button onClick={() => setViewMode('by-page')}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${viewMode === 'by-page' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <LayoutList className="w-3 h-3" /> By Page
              </button>
              <button onClick={() => setViewMode('by-fix-type')}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${viewMode === 'by-fix-type' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <Layers className="w-3 h-3" /> By Fix Type
              </button>
            </div>
            {/* Severity filter */}
            <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5">
              {(['all', 'error', 'warning'] as const).map(s => (
                <button key={s} onClick={() => setSeverityFilter(s)}
                  className={`px-3 py-2 min-h-[44px] rounded-md text-[11px] font-medium transition-colors ${
                    severityFilter === s ? (s === 'all' ? 'bg-zinc-700 text-zinc-200' : `${SEV[s].bg} ${SEV[s].text}`) : 'text-zinc-500 hover:text-zinc-300'
                  }`}>{s === 'all' ? 'Issues' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
              ))}
            </div>
            {infoIssueCount > 0 && (
              <button
                onClick={() => setShowInfoItems(!showInfoItems)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors border ${
                  showInfoItems
                    ? 'bg-zinc-700 text-zinc-300 border-zinc-600'
                    : 'bg-transparent text-zinc-500 border-zinc-700 hover:text-zinc-300'
                }`}
              >
                <Info className="w-3 h-3" />
                {showInfoItems ? 'Hide' : 'Show'} {infoIssueCount} informational
              </button>
            )}
            {viewMode === 'by-page' && (
              <input type="text" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Search pages..."
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-40" />
            )}
          </div>

          {/* By-page view */}
          {viewMode === 'by-page' && (
          <div className="divide-y divide-zinc-800/50 max-h-[500px] overflow-y-auto">
            {filteredPages.map(page => {
              const errs = page.issues.filter(i => i.severity === 'error').length;
              const warns = page.issues.filter(i => i.severity === 'warning').length;
              const isExpanded = expandedPages.has(page.pageId);
              return (
                <div key={page.pageId} className={`transition-all ${isExpanded ? 'bg-zinc-950/50' : ''}`}>
                  <button
                    onClick={() => togglePage(page.pageId)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-300 truncate">{page.page}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{toLiveUrl(page.url, liveDomain)}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {errs > 0 && <span className="text-[11px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">{errs} err</span>}
                      {warns > 0 && <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{warns} warn</span>}
                      <div className={`text-xs font-bold ${scoreColorClass(page.score)}`}>{page.score}</div>
                      <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3">
                      <div className="space-y-2">
                        {page.issues.filter(i => showInfoItems || i.severity !== 'info').map((issue, i) => {
                          const sc = SEV[issue.severity];
                          return (
                            <div key={i} className={`px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                              <div className="flex items-start gap-2">
                                {issue.severity === 'error' && <AlertTriangle className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                {issue.severity === 'warning' && <Info className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                <div className="flex-1">
                                  <div className="text-[11px] text-zinc-300">{issue.message}</div>
                                  {issue.recommendation && <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {hasContentIssues(page.issues) && workspaceId && (
                        <>
                          <button
                            onClick={() => { setRequestError(null); requestContentImprovement(page); }}
                            disabled={requestedPages.has(page.pageId) || requestingPage === page.pageId}
                            className={`mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                              requestedPages.has(page.pageId)
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                                : 'bg-teal-600 hover:bg-teal-500 text-white'
                            }`}
                          >
                            <FileEdit className="w-3 h-3" />
                            {requestedPages.has(page.pageId) ? 'Request created' : requestingPage === page.pageId ? 'Creating...' : 'Request Content Fix'}
                          </button>
                          {requestError === page.pageId && (
                            <p className="text-[11px] text-red-400 mt-1">Failed to create request. Please try again.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredPages.length === 0 && <div className="px-4 py-8 text-center text-xs text-zinc-500">No pages match your filters</div>}
          </div>
          )}

          {/* By-fix-type view */}
          {viewMode === 'by-fix-type' && (() => {
            // Group all issues by category, then by check type
            const FIX_TYPE_LABELS: Record<string, string> = {
              'title': 'Page Titles', 'meta-description': 'Meta Descriptions', 'h1': 'Headings (H1)',
              'canonical': 'Canonical Tags', 'img-alt': 'Image Alt Text', 'og-tags': 'Social Media Tags',
              'og-image': 'Social Media Images', 'structured-data': 'Schema / Structured Data',
              'internal-links': 'Internal Links', 'content-length': 'Content Length',
              'redirect-chains': 'Redirect Chains', 'mixed-content': 'Mixed Content',
              'ssl': 'SSL / HTTPS', 'viewport': 'Mobile Viewport', 'robots': 'Robots / Indexing',
              'heading-hierarchy': 'Heading Structure', 'cwv': 'Core Web Vitals',
              'duplicate-title': 'Duplicate Titles', 'duplicate-description': 'Duplicate Descriptions',
            };
            const groups = new Map<string, { check: string; label: string; severity: 'error' | 'warning' | 'info'; pages: { pageId: string; page: string; url: string; message: string; recommendation?: string }[] }>();

            (auditDetail?.audit.pages || []).forEach(p => {
              p.issues.forEach(issue => {
                if (!showInfoItems && issue.severity === 'info') return;
                if (severityFilter !== 'all' && issue.severity !== severityFilter) return;
                const key = issue.check || 'other';
                if (!groups.has(key)) {
                  groups.set(key, {
                    check: key,
                    label: FIX_TYPE_LABELS[key.toLowerCase()] || (issue.category ? (CAT_LABELS[issue.category]?.label || issue.category) + ': ' + key : key),
                    severity: issue.severity,
                    pages: [],
                  });
                }
                const g = groups.get(key)!;
                // Keep highest severity
                if (issue.severity === 'error' && g.severity !== 'error') g.severity = 'error';
                else if (issue.severity === 'warning' && g.severity === 'info') g.severity = 'warning';
                g.pages.push({ pageId: p.pageId, page: p.page, url: p.url, message: issue.message, recommendation: issue.recommendation });
              });
            });

            const sorted = [...groups.values()].sort((a, b) => {
              const sevScore = (s: string) => s === 'error' ? 3 : s === 'warning' ? 2 : 1;
              const d = sevScore(b.severity) - sevScore(a.severity);
              if (d !== 0) return d;
              return b.pages.length - a.pages.length;
            });

            return (
              <div className="divide-y divide-zinc-800/50 max-h-[500px] overflow-y-auto">
                {sorted.length === 0 && <div className="px-4 py-8 text-center text-xs text-zinc-500">No issues match your filters</div>}
                {sorted.map(group => {
                  const sc = SEV[group.severity];
                  const isExpanded = expandedPages.has(`fix-type-${group.check}`);
                  return (
                    <div key={group.check} className={`transition-all ${isExpanded ? 'bg-zinc-950/50' : ''}`}>
                      <button
                        onClick={() => togglePage(`fix-type-${group.check}`)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-zinc-300">{group.label}</div>
                          <div className="text-[11px] text-zinc-500">{group.pages.length} {group.pages.length === 1 ? 'page' : 'pages'} affected</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-[11px] font-medium uppercase ${sc.text}`}>{group.severity}</span>
                          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${sc.bg} border ${sc.border} ${sc.text}`}>{group.pages.length}</span>
                          <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-3">
                          {checkImpact(group.check) && (
                            <div className="text-[11px] text-zinc-400 mb-2 leading-relaxed px-1">{checkImpact(group.check)}</div>
                          )}
                          <div className="space-y-1.5">
                            {group.pages.map((p, i) => (
                              <div key={`${p.pageId}-${i}`} className={`px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                                <div className="text-[11px] font-medium text-zinc-300 truncate">{p.page}</div>
                                <div className="text-[10px] text-zinc-500 truncate">{toLiveUrl(p.url, liveDomain)}</div>
                                {p.recommendation && <div className="text-[10px] text-zinc-500 mt-0.5">{p.recommendation}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── 7. HISTORY (Collapsed by default - at the bottom) ── */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <button onClick={() => toggleSection('history')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">History &amp; Details</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expandedSections.has('history') ? '' : '-rotate-90'}`} />
        </button>
        {expandedSections.has('history') && (
          <div className="px-4 pb-4 border-t border-zinc-800 space-y-4">
            {/* Score History */}
            {auditDetail.scoreHistory.length >= 2 && (
              <div className="pt-4">
                <div className="text-xs font-medium text-zinc-400 mb-2">Score History</div>
                <ScoreHistoryChart history={auditDetail.scoreHistory} />
              </div>
            )}
            {/* Category Breakdown */}
            <div>
              <div className="text-xs font-medium text-zinc-400 mb-2">Issues by Category</div>
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
        )}
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
      <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">Once {STUDIO_NAME} runs a site audit, you'll see a detailed health score, page-by-page issues, and recommendations to improve your site.</p>
    </div>
  );
}
