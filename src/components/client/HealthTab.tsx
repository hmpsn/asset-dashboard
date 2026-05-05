import { useState, useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, Info, CheckCircle2, ChevronDown, Shield, FileEdit, Share2, Link2, ExternalLink, FileText, BarChart3, Check, Globe, ArrowUp, Minus, LayoutList, Layers } from 'lucide-react';
import { MetricRing, Icon, Button, IconButton, ClickableRow, SectionCard } from '../ui';
import { scoreColorClass, themeColor } from '../ui/constants';
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
    <div className="space-y-8">
      {/* ── HEADER ── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="t-h2 text-[var(--brand-text-bright)]">Site Health</h2>
          <p className="t-body text-[var(--brand-text-muted)] mt-1">{auditDetail.audit.totalPages} pages · Last scanned {new Date(auditDetail.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="relative" ref={shareRef}>
          <Button variant="secondary" size="sm" icon={Share2} onClick={() => setShareOpen(!shareOpen)}>
            Share Report
          </Button>
          {shareOpen && (
            // pr-check-disable-next-line -- Shareable Reports popover dropdown; positioned absolute, not a content card
            <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--surface-2)] border border-[var(--brand-border-strong)] rounded-[var(--radius-xl)] shadow-xl z-[var(--z-modal)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--brand-border)]">
                <div className="t-caption font-medium text-[var(--brand-text)]">Shareable Reports</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">Copy a link to share with your team</div>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-[var(--brand-border)]/50">
                {reports.length === 0 && (
                  <div className="px-4 py-6 text-center t-caption text-[var(--brand-text-muted)]">Loading reports...</div>
                )}
                {reports.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-3)]/50 transition-colors">
                    <div className={`w-7 h-7 rounded-[var(--radius-lg)] flex items-center justify-center flex-shrink-0 ${r.type === 'audit' ? 'bg-emerald-500/10' : 'bg-blue-500/10'}`}>
                      {r.type === 'audit' ? <Icon as={BarChart3} size="md" className="text-accent-success" /> : <Icon as={FileText} size="md" className="text-accent-info" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{r.title}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <IconButton
                        icon={copiedId === r.id ? Check : Link2}
                        label="Copy report link"
                        size="sm"
                        variant={copiedId === r.id ? 'accent' : 'ghost'}
                        onClick={() => copyReportLink(r.permalink, r.id)}
                      />
                      <a href={r.permalink} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors" title="Open report">
                        <Icon as={ExternalLink} size="md" />
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
          <SectionCard>
            <div className="flex items-center gap-4">
              <div className={`t-stat-lg ${scoreColorClass(score)}`}>{score}</div>
              <div className="flex-1">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">Your site's health</div>
                <div className="t-body text-[var(--brand-text-muted)] mt-0.5">{summary}</div>
              </div>
              {auditDetail.previousScore != null && (
                <div className={`t-caption ${auditDetail.audit.siteScore > auditDetail.previousScore ? 'text-accent-success' : auditDetail.audit.siteScore < auditDetail.previousScore ? 'text-accent-danger' : 'text-[var(--brand-text-muted)]'}`}>
                  {auditDetail.audit.siteScore > auditDetail.previousScore ? '↑' : '↓'} {Math.abs(auditDetail.audit.siteScore - auditDetail.previousScore)} from previous
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[var(--brand-border)]/50 t-caption">
              <span className="text-[var(--brand-text-muted)]">{auditDetail.audit.totalPages} pages scanned</span>
              <button
                type="button"
                onClick={() => { setSeverityFilter(severityFilter === 'error' ? 'all' : 'error'); setTimeout(() => allPagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}
                className={`transition-colors ${severityFilter === 'error' ? 'text-accent-danger font-medium' : 'text-accent-danger hover:text-accent-danger'}`}
              >{auditDetail.audit.errors} errors</button>
              <button
                type="button"
                onClick={() => { setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning'); setTimeout(() => allPagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}
                className={`transition-colors ${severityFilter === 'warning' ? 'text-accent-warning font-medium' : 'text-accent-warning hover:text-accent-warning'}`}
              >{auditDetail.audit.warnings} warnings</button>
            </div>
          </SectionCard>
        );
      })()}

      {/* ── 1b. WHAT CHANGED SINCE LAST AUDIT ── */}
      {auditDetail.auditDiff && auditDetail.previousScore != null && (
        auditDetail.auditDiff.resolved > 0 || auditDetail.auditDiff.newIssues > 0
      ) && (() => {
        const { resolved, newIssues } = auditDetail.auditDiff!;
        const scoreDelta = auditDetail.audit.siteScore - auditDetail.previousScore!;
        const deltaColor = scoreDelta > 0 ? 'text-accent-success' : scoreDelta < 0 ? 'text-accent-danger' : 'text-[var(--brand-text-muted)]';
        const DeltaIcon = scoreDelta > 0 ? ArrowUp : scoreDelta < 0 ? AlertTriangle : Minus;
        return (
          // pr-check-disable-next-line -- Compact audit-delta status bar; inline row element, not a content card
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-xl)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption">
            <DeltaIcon className={`w-4 h-4 flex-shrink-0 ${deltaColor}`} />
            <span className="text-[var(--brand-text-muted)]">Since last audit:</span>
            {resolved > 0 && <span className="text-accent-success font-medium">{resolved} resolved</span>}
            {resolved > 0 && newIssues > 0 && <span className="text-[var(--brand-text-faint)]">·</span>}
            {newIssues > 0 && <span className="text-accent-danger font-medium">{newIssues} new</span>}
            <span className="text-[var(--brand-text-faint)]">·</span>
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
          r === 'good' ? 'text-accent-success' : r === 'needs-improvement' ? 'text-accent-warning' : r === 'poor' ? 'text-accent-danger' : 'text-[var(--brand-text-muted)]';
        const ratingBg = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
          r === 'good' ? 'bg-emerald-500/10 border-emerald-500/20' : r === 'needs-improvement' ? 'bg-amber-500/10 border-amber-500/20' : r === 'poor' ? 'bg-red-500/10 border-red-500/20' : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)]/30';
        const assessBadge = (a: CwvStrategyResult['assessment']) =>
          a === 'good' ? { text: 'Passed', cls: 'bg-emerald-500/15 text-accent-success border-emerald-500/30' }
          : a === 'needs-improvement' ? { text: 'Needs Work', cls: 'bg-amber-500/15 text-accent-warning border-amber-500/30' }
          : a === 'poor' ? { text: 'Failed', cls: 'bg-red-500/15 text-accent-danger border-red-500/30' }
          : { text: 'No Data', cls: 'bg-[var(--surface-3)]/50 text-[var(--brand-text-muted)] border-[var(--brand-border)]/30' };
        const renderStrategy = (label: string, s: CwvStrategyResult) => {
          const badge = assessBadge(s.assessment);
          return (
            <div key={label} className="flex-1 min-w-[200px]">
              <div className="flex items-center justify-between mb-2">
                <span className="t-caption font-medium text-[var(--brand-text-muted)] tracking-wider">{label}</span>
                <span className={`t-caption-sm px-2 py-0.5 rounded-[var(--radius-sm)] border font-medium ${badge.cls}`}>{badge.text}</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { key: 'LCP' as const, label: 'Loading Speed', fmt: (v: number) => `${(v / 1000).toFixed(1)}s`, desc: 'Content appears' },
                  { key: 'INP' as const, label: 'Responsiveness', fmt: (v: number) => `${Math.round(v)}ms`, desc: 'Page reacts' },
                  { key: 'CLS' as const, label: 'Visual Stability', fmt: (v: number) => v.toFixed(2), desc: 'Layout shifts' },
                ].map(m => {
                  const metric = s.metrics[m.key];
                  return (
                    <div key={m.key} className={`flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] border ${ratingBg(metric.rating)}`}>
                      <div>
                        <span className="t-caption font-medium text-[var(--brand-text)]">{m.label}</span>
                        <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">{m.desc}</span>
                      </div>
                      <span className={`t-body font-mono font-medium ${ratingColor(metric.rating)}`}>
                        {metric.value !== null ? m.fmt(metric.value) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
              {!s.fieldDataAvailable && (
                <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-amber-500/10 border border-amber-500/20">
                  <Icon as={AlertTriangle} size="md" className="text-accent-warning flex-shrink-0 mt-0.5" />
                  <p className="t-caption-sm text-accent-warning">These are simulated scores, not real user data. Real metrics appear once Chrome has enough traffic data for your site.</p>
                </div>
              )}
            </div>
          );
        };
        return (
          <SectionCard
            title="Page Speed & Core Web Vitals"
            titleIcon={<Icon as={Globe} size="md" className="text-accent-brand" />}
            titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)]">Google uses these to rank your site</span>}
          >
            <div className="flex gap-4 flex-wrap">
              {auditDetail.audit.cwvSummary!.mobile && renderStrategy('Mobile', auditDetail.audit.cwvSummary!.mobile)}
              {auditDetail.audit.cwvSummary!.desktop && renderStrategy('Desktop', auditDetail.audit.cwvSummary!.desktop)}
            </div>
          </SectionCard>
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

              <SectionCard
                title="Fix these first"
                titleIcon={<Icon as={AlertTriangle} size="md" className="text-accent-danger" />}
                noPadding
              >
                <div className="divide-y divide-[var(--brand-border)]/50">
                  {prioritized.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <Icon as={CheckCircle2} size="2xl" className="text-accent-success mx-auto mb-2" />
                      <p className="t-caption text-[var(--brand-text-muted)]">No critical issues found!</p>
                    </div>
                  ) : (
                    prioritized.map((item, i) => {
                      const sc = SEV[item.issue.severity];
                      return (
                        <div key={`${item.pageId}-${i}`} className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <span className="w-5 h-5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] flex items-center justify-center flex-shrink-0 t-caption-sm text-[var(--brand-text-muted)] font-medium">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`t-caption-sm font-medium uppercase ${sc.text}`}>{item.issue.severity}</span>
                                <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">{item.page}</span>
                              </div>
                              <div className="t-caption-sm text-[var(--brand-text)] mt-0.5">{item.issue.message}</div>
                              {checkImpact(item.issue.check) && (
                                <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 leading-relaxed">{checkImpact(item.issue.check)}</div>
                              )}
                            </div>
                            {hasContentIssues([item.issue]) && workspaceId && !requestedPages.has(item.pageId) && (
                              <Button
                                size="sm"
                                onClick={() => requestContentImprovement({ pageId: item.pageId, page: item.page, slug: item.slug, issues: [item.issue] })}
                                disabled={requestingPage === item.pageId}
                                className="flex-shrink-0"
                              >
                                {requestingPage === item.pageId ? '...' : 'Fix'}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title="Pages needing attention"
                titleIcon={<Icon as={FileText} size="md" className="text-[var(--brand-text-muted)]" />}
                action={<span className="t-caption-sm text-[var(--brand-text-muted)]">Top {sortedPages.length}</span>}
              >
                <div className="grid grid-cols-1 gap-3">
                  {sortedPages.map(page => {
                    const errs = page.issues.filter(i => i.severity === 'error').length;
                    const warns = page.issues.filter(i => i.severity === 'warning').length;
                    const isExpanded = expandedPages.has(page.pageId);
                    return (
                      <div key={page.pageId} className={`rounded-[var(--radius-lg)] border transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50 border-[var(--brand-border-strong)]' : 'bg-[var(--surface-1)]/50 border-[var(--brand-border)]/50 hover:border-[var(--brand-border-strong)]'}`}>
                        <ClickableRow
                          onClick={() => togglePage(page.pageId)}
                          className="flex items-center gap-3 p-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="t-caption font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                            <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{toLiveUrl(page.url, liveDomain)}</div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {errs > 0 && <span className="t-caption-sm text-accent-danger bg-red-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)]">{errs}E</span>}
                            {warns > 0 && <span className="t-caption-sm text-accent-warning bg-amber-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)]">{warns}W</span>}
                            <div className={`t-stat-sm ${scoreColorClass(page.score)}`}>{page.score}</div>
                            <ChevronDown className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                          </div>
                        </ClickableRow>
                        
                        {/* Expanded issues accordion inside the card */}
                        {isExpanded && (
                          <div className="px-3 pb-3 border-t border-[var(--brand-border)]/50">
                            <div className="pt-3 space-y-2">
                              {page.issues.map((issue, i) => {
                                const sc = SEV[issue.severity];
                                return (
                                  <div key={i} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                                    <div className="flex items-start gap-2">
                                      {issue.severity === 'error' && <AlertTriangle className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                      {issue.severity === 'warning' && <Info className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                      <div className="flex-1">
                                        <div className="t-caption-sm text-[var(--brand-text)]">{issue.message}</div>
                                        {checkImpact(issue.check) && (
                                          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 leading-relaxed">{checkImpact(issue.check)}</div>
                                        )}
                                        {issue.recommendation && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{issue.recommendation}</div>}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {hasContentIssues(page.issues) && workspaceId && (
                              <>
                                <Button
                                  icon={FileEdit}
                                  onClick={() => { setRequestError(null); requestContentImprovement(page); }}
                                  disabled={requestedPages.has(page.pageId) || requestingPage === page.pageId}
                                  className={`mt-3 ${
                                    requestedPages.has(page.pageId)
                                      ? 'bg-emerald-500/10 text-accent-success border border-emerald-500/20'
                                      : ''
                                  }`}
                                >
                                  {requestedPages.has(page.pageId) ? 'Request created' : requestingPage === page.pageId ? 'Creating...' : 'Request Content Fix'}
                                </Button>
                                {requestError === page.pageId && (
                                  <p className="t-caption-sm text-accent-danger mt-1">Failed to create request. Please try again.</p>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTimeout(() => allPagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                  }}
                  className="w-full mt-3 border-dashed"
                >
                  View all {auditDetail.audit.totalPages} pages
                </Button>
              </SectionCard>
            </div>
          </>
        );
      })()}

      {/* ── 4. PRIORITIZED ACTION PLAN (slot from parent) ── */}
      {actionPlanSlot}

      {/* ── 5. SITE-WIDE ISSUES ── */}
      {auditDetail.audit.siteWideIssues.length > 0 && (
        <SectionCard
          title="Site-Wide Issues"
          titleIcon={
            <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-[var(--surface-3)] flex items-center justify-center">
              <Icon as={Info} size="md" className="text-accent-warning" />
            </div>
          }
          titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)]">{auditDetail.audit.siteWideIssues.length} issues affecting your entire site</span>}
          noPadding
        >
          <div className="p-3">
            <div className="flex flex-wrap gap-3">
              {auditDetail.audit.siteWideIssues.slice(0, 3).map((issue, i) => {
                const sc = SEV[issue.severity];
                return (
                  <div key={i} className={`px-2.5 py-1.5 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border} t-caption-sm`}>
                    <span className={sc.text}>{issue.message}</span>
                  </div>
                );
              })}
              {auditDetail.audit.siteWideIssues.length > 3 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => toggleSection('site-wide-all')}
                >
                  +{auditDetail.audit.siteWideIssues.length - 3} more
                </Button>
              )}
            </div>
            
            {expandedSections.has('site-wide-all') && (
              <div className="mt-3 pt-3 border-t border-[var(--brand-border)]/50 space-y-2">
                {auditDetail.audit.siteWideIssues.map((issue, i) => {
                  const sc = SEV[issue.severity];
                  return (
                    <div key={i} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                      <div className={`t-caption-sm font-medium ${sc.text}`}>{issue.message}</div>
                      {issue.recommendation && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{issue.recommendation}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SectionCard>
      )}
      {/* ── 6. ALL PAGES LIST ── */}
      <div ref={allPagesRef}>
        <SectionCard noPadding>
          <div className="px-4 py-3 border-b border-[var(--brand-border)] flex items-center gap-2 flex-wrap bg-[var(--surface-1)]/50">
            {/* View mode toggle */}
            <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-0.5">
              <button type="button" onClick={() => setViewMode('by-page')}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${viewMode === 'by-page' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}>
                <Icon as={LayoutList} size="sm" /> By Page
              </button>
              <button type="button" onClick={() => setViewMode('by-fix-type')}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${viewMode === 'by-fix-type' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}>
                <Icon as={Layers} size="sm" /> By Fix Type
              </button>
            </div>
            {/* Severity filter */}
            <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-0.5">
              {(['all', 'error', 'warning'] as const).map(s => (
                <button key={s} type="button" onClick={() => setSeverityFilter(s)}
                  className={`px-3 py-2 min-h-[44px] rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${
                    severityFilter === s ? (s === 'all' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)]' : `${SEV[s].bg} ${SEV[s].text}`) : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
                  }`}>{s === 'all' ? 'Issues' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
              ))}
            </div>
            {infoIssueCount > 0 && (
              <button
                type="button"
                onClick={() => setShowInfoItems(!showInfoItems)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm transition-colors border ${
                  showInfoItems
                    ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)] border-[var(--brand-border-strong)]'
                    : 'bg-transparent text-[var(--brand-text-muted)] border-[var(--brand-border-strong)] hover:text-[var(--brand-text)]'
                }`}
              >
                <Icon as={Info} size="sm" />
                {showInfoItems ? 'Hide' : 'Show'} {infoIssueCount} informational
              </button>
            )}
            {viewMode === 'by-page' && (
              <input type="text" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Search pages..."
                className="bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-2.5 py-1.5 t-caption-sm text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-[var(--brand-border-strong)] w-40" />
            )}
          </div>

          {/* By-page view */}
          {viewMode === 'by-page' && (
          <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
            {filteredPages.map(page => {
              const errs = page.issues.filter(i => i.severity === 'error').length;
              const warns = page.issues.filter(i => i.severity === 'warning').length;
              const isExpanded = expandedPages.has(page.pageId);
              return (
                <div key={page.pageId} className={`transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50' : ''}`}>
                  <ClickableRow
                    onClick={() => togglePage(page.pageId)}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="t-caption font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{toLiveUrl(page.url, liveDomain)}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {errs > 0 && <span className="t-caption-sm text-accent-danger bg-red-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)]">{errs} err</span>}
                      {warns > 0 && <span className="t-caption-sm text-accent-warning bg-amber-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)]">{warns} warn</span>}
                      <div className={`t-stat-sm ${scoreColorClass(page.score)}`}>{page.score}</div>
                      <ChevronDown className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    </div>
                  </ClickableRow>

                  {isExpanded && (
                    <div className="px-4 pb-3">
                      <div className="space-y-2">
                        {page.issues.filter(i => showInfoItems || i.severity !== 'info').map((issue, i) => {
                          const sc = SEV[issue.severity];
                          return (
                            <div key={i} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                              <div className="flex items-start gap-2">
                                {issue.severity === 'error' && <AlertTriangle className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                {issue.severity === 'warning' && <Info className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                <div className="flex-1">
                                  <div className="t-caption-sm text-[var(--brand-text)]">{issue.message}</div>
                                  {issue.recommendation && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{issue.recommendation}</div>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {hasContentIssues(page.issues) && workspaceId && (
                        <>
                          <Button
                            icon={FileEdit}
                            onClick={() => { setRequestError(null); requestContentImprovement(page); }}
                            disabled={requestedPages.has(page.pageId) || requestingPage === page.pageId}
                            className={`mt-3 ${
                              requestedPages.has(page.pageId)
                                ? 'bg-emerald-500/10 text-accent-success border border-emerald-500/20'
                                : ''
                            }`}
                          >
                            {requestedPages.has(page.pageId) ? 'Request created' : requestingPage === page.pageId ? 'Creating...' : 'Request Content Fix'}
                          </Button>
                          {requestError === page.pageId && (
                            <p className="t-caption-sm text-accent-danger mt-1">Failed to create request. Please try again.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredPages.length === 0 && <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">No pages match your filters</div>}
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
              <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
                {sorted.length === 0 && <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">No issues match your filters</div>}
                {sorted.map(group => {
                  const sc = SEV[group.severity];
                  const isExpanded = expandedPages.has(`fix-type-${group.check}`);
                  return (
                    <div key={group.check} className={`transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50' : ''}`}>
                      <ClickableRow
                        onClick={() => togglePage(`fix-type-${group.check}`)}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="t-caption font-medium text-[var(--brand-text)]">{group.label}</div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)]">{group.pages.length} {group.pages.length === 1 ? 'page' : 'pages'} affected</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`t-caption-sm font-medium uppercase ${sc.text}`}>{group.severity}</span>
                          <span className={`t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-sm)] ${sc.bg} border ${sc.border} ${sc.text}`}>{group.pages.length}</span>
                          <ChevronDown className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                        </div>
                      </ClickableRow>

                      {isExpanded && (
                        <div className="px-4 pb-3">
                          {checkImpact(group.check) && (
                            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2 leading-relaxed px-1">{checkImpact(group.check)}</div>
                          )}
                          <div className="space-y-1.5">
                            {group.pages.map((p, i) => (
                              <div key={`${p.pageId}-${i}`} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                                <div className="t-caption-sm font-medium text-[var(--brand-text)] truncate">{p.page}</div>
                                <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{toLiveUrl(p.url, liveDomain)}</div>
                                {p.recommendation && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{p.recommendation}</div>}
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
        </SectionCard>
      </div>

      {/* ── 7. HISTORY (Collapsed by default - at the bottom) ── */}
      <SectionCard noPadding>
        <ClickableRow onClick={() => toggleSection('history')} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon as={BarChart3} size="md" className="text-[var(--brand-text-muted)]" />
            <span className="t-ui font-medium text-[var(--brand-text-bright)]">History &amp; Details</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('history') ? '' : '-rotate-90'}`} />
        </ClickableRow>
        {expandedSections.has('history') && (
          <div className="px-4 pb-4 border-t border-[var(--brand-border)] space-y-4">
            {/* Score History */}
            {auditDetail.scoreHistory.length >= 2 && (
              <div className="pt-4">
                <div className="t-ui font-medium text-[var(--brand-text-bright)] mb-2">Score History</div>
                <ScoreHistoryChart history={auditDetail.scoreHistory} />
              </div>
            )}
            {/* Category Breakdown */}
            <div>
              <div className="t-ui font-medium text-[var(--brand-text-bright)] mb-2">Issues by Category</div>
              <div className="space-y-2">
                {Object.entries(categoryStats).map(([cat, counts]) => {
                  const info = CAT_LABELS[cat] || { label: cat, color: themeColor('#71717a', '#94a3b8') };
                  return (
                    <div key={cat} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-[var(--radius-pill)] flex-shrink-0" style={{ backgroundColor: info.color }} />
                      <span className="t-caption-sm text-[var(--brand-text-muted)] flex-1">{info.label}</span>
                      <div className="flex items-center gap-1.5 t-caption-sm">
                        {counts.errors > 0 && <span className="text-accent-danger">{counts.errors}E</span>}
                        {counts.warnings > 0 && <span className="text-accent-warning">{counts.warnings}W</span>}
                        {counts.infos > 0 && <span className="text-accent-info">{counts.infos}I</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );

  if (audit) return (
    <SectionCard noPadding>
      <div className="p-6">
      <div className="flex items-center gap-4">
        <ScoreRing score={audit.siteScore} size={100} />
        <div>
          <div className="t-ui font-medium text-[var(--brand-text-bright)]">Site Health Score</div>
          <div className="t-caption text-[var(--brand-text-muted)]">{audit.totalPages} pages • {new Date(audit.createdAt).toLocaleDateString()}</div>
          <div className="flex gap-3 mt-2"><span className="t-caption text-accent-danger">{audit.errors} errors</span><span className="t-caption text-accent-warning">{audit.warnings} warnings</span></div>
        </div>
      </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-[var(--radius-xl)] bg-[var(--surface-2)] border border-[var(--brand-border)] flex items-center justify-center mx-auto mb-4">
        <Icon as={Shield} size="2xl" className="text-[var(--brand-text-faint)]" />
      </div>
      <p className="t-body font-medium text-[var(--brand-text-muted)]">Site Health Check Coming Soon</p>
      <p className="t-caption text-[var(--brand-text-muted)] mt-1 max-w-sm mx-auto">Once {STUDIO_NAME} runs a site audit, you'll see a detailed health score, page-by-page issues, and recommendations to improve your site.</p>
    </div>
  );
}
