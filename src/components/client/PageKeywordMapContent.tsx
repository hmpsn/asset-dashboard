import { useState, useMemo } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, Layers, MessageCircle, ChevronDown, Search, ThumbsUp, ThumbsDown, Ban, Undo2 } from 'lucide-react';
import { Icon } from '../ui/Icon.js';
import type { MetricsSource } from '../../../shared/types/keywords.js';
import { post } from '../../api';

interface GscKeyword {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface PageMapItem {
  pagePath: string;
  pageTitle?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  currentPosition?: number;
  previousPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  metricsSource?: MetricsSource;
  validated?: boolean;
  searchIntent?: string;
  gscKeywords?: GscKeyword[];
}

interface PageKeywordMapContentProps {
  pageMap: PageMapItem[];
  workspaceId?: string;
  setToast?: (msg: string) => void;
  onContentRequested?: () => void;
  keywordFeedback?: Map<string, 'approved' | 'declined' | 'requested'>;
  onApproveKeyword?: (keyword: string, source: string) => void;
  onDeclineKeyword?: (keyword: string, source: string) => void;
  onUndoFeedback?: (keyword: string) => void;
  isLoadingFeedback?: (keyword: string) => boolean;
}

type FilterTab = 'all' | 'ranking' | 'opportunities' | 'falling';

function getTrendIndicator(current?: number, previous?: number) {
  if (!current || !previous) return null;
  const diff = previous - current; // Lower position number is better (e.g., 5 -> 3 is +2 improvement)
  if (diff > 0) return { icon: ArrowUpRight, color: 'text-accent-success', label: `↑ ${diff}` };
  if (diff < 0) return { icon: ArrowDownRight, color: 'text-accent-danger', label: `↓ ${Math.abs(diff)}` };
  return { icon: Minus, color: 'text-[var(--brand-text-muted)]', label: '→' };
}

function getPageFolder(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return 'Home';
  if (parts.length === 1) return 'Root';
  return parts[0] === 'blog' ? 'Blog' : 
         parts[0] === 'services' ? 'Services' :
         parts[0] === 'products' ? 'Products' :
         parts[0] === 'about' ? 'About' :
         parts[0] === 'contact' ? 'Contact' :
         parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

function positionColor(pos: number): string {
  if (pos <= 3) return 'text-accent-success font-semibold';
  if (pos <= 10) return 'text-accent-success';
  if (pos <= 20) return 'text-accent-warning font-semibold';
  if (pos <= 50) return 'text-accent-warning';
  return 'text-[var(--brand-text-muted)]';
}

export function PageKeywordMapContent({ pageMap, workspaceId, setToast, onContentRequested, keywordFeedback, onApproveKeyword, onDeclineKeyword, onUndoFeedback, isLoadingFeedback }: PageKeywordMapContentProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [discussingPage, setDiscussingPage] = useState<string | null>(null);

  const togglePage = (path: string) => {
    setExpandedPages(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const filteredPages = useMemo(() => {
    switch (activeFilter) {
      case 'ranking':
        return pageMap.filter(p => p.currentPosition && p.currentPosition <= 20);
      case 'opportunities':
        return pageMap.filter(p => !p.currentPosition && (p.impressions || 0) > 0);
      case 'falling':
        return pageMap.filter(p => {
          if (!p.currentPosition || !p.previousPosition) return false;
          return p.currentPosition > p.previousPosition;
        });
      default:
        return pageMap;
    }
  }, [pageMap, activeFilter]);

  const groupedPages = useMemo(() => {
    const groups: Record<string, PageMapItem[]> = {};
    filteredPages.forEach(page => {
      const folder = getPageFolder(page.pagePath);
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(page);
    });
    return groups;
  }, [filteredPages]);

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: 'All Pages', count: pageMap.length },
    { id: 'ranking', label: 'Ranking', count: pageMap.filter(p => p.currentPosition && p.currentPosition <= 20).length },
    { id: 'opportunities', label: 'Needs Review', count: pageMap.filter(p => !p.currentPosition && (p.impressions || 0) > 0).length },
    { id: 'falling', label: 'Falling', count: pageMap.filter(p => p.currentPosition && p.previousPosition && p.currentPosition > p.previousPosition).length },
  ];
  const emptyMessage: Record<FilterTab, string> = {
    all: 'No mapped pages are available yet.',
    ranking: 'No mapped pages are currently ranking in the top 20.',
    opportunities: 'No pages need ranking review right now.',
    falling: 'No pages are losing ranking positions right now.',
  };

  return (
    <div className="border-t border-[var(--brand-border)]">
      {/* Filter Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--brand-border)]/50 overflow-x-auto" role="tablist" aria-label="Page keyword map filters">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            id={`page-keyword-map-tab-${tab.id}`}
            role="tab"
            aria-selected={activeFilter === tab.id}
            aria-controls="page-keyword-map-panel"
            onClick={() => setActiveFilter(tab.id)}
            className={`px-3 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors whitespace-nowrap ${
              activeFilter === tab.id
                ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]'
                : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]/50'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-[var(--brand-text-muted)]">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Grouped Page List */}
      <div
        id="page-keyword-map-panel"
        role="tabpanel"
        aria-labelledby={`page-keyword-map-tab-${activeFilter}`}
        className="max-h-[400px] overflow-y-auto"
        key={activeFilter}
      >
        {Object.entries(groupedPages).length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="t-caption-sm text-[var(--brand-text-muted)]">{emptyMessage[activeFilter]}</p>
          </div>
        ) : (
          Object.entries(groupedPages).map(([folder, pages]) => (
            <div key={folder} className="border-b border-[var(--brand-border)]/50 last:border-b-0">
              {/* Folder Header */}
              <button
                onClick={() => toggleFolder(folder)}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-[var(--surface-3)]/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Icon as={Layers} size="md" className="text-[var(--brand-text-muted)]" />
                  <span className="t-caption-sm font-medium text-[var(--brand-text)]">{folder}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{pages.length} pages</span>
                </div>
                <svg
                  className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${expandedFolders.has(folder) ? '' : '-rotate-90'}`}
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Pages in Folder */}
              {expandedFolders.has(folder) && (
                <div className="divide-y divide-[var(--brand-border)]/30">
                  {pages.map(page => {
                    const trend = getTrendIndicator(page.currentPosition, page.previousPosition);
                    const TrendIconComp = trend?.icon;
                    const isOpportunity = !page.currentPosition && (page.impressions || 0) > 0;
                    const isExpanded = expandedPages.has(page.pagePath);
                    const kwCount = page.gscKeywords?.length || 0;
                    
                    return (
                      <div key={page.pagePath} className={`transition-all ${isExpanded ? 'bg-[var(--surface-3)]/20' : ''}`}>
                        <button
                          onClick={() => togglePage(page.pagePath)}
                          className="w-full px-4 py-2.5 hover:bg-[var(--surface-3)]/20 transition-colors text-left"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="t-caption-sm text-[var(--brand-text-bright)] font-medium truncate">
                                  {page.pageTitle || page.pagePath.split('/').pop() || page.pagePath}
                                </div>
                                {isOpportunity && (
                                  <span className="t-caption-sm bg-blue-500/10 text-accent-info px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-blue-500/20">
                                    Opportunity
                                  </span>
                                )}
                              </div>
                              <div className="t-caption-sm text-[var(--brand-text-muted)] font-mono truncate">{page.pagePath}</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              {page.impressions != null && page.impressions > 0 && (
                                <span className="t-caption-sm text-[var(--brand-text-muted)]">{page.impressions.toLocaleString()} impressions</span>
                              )}
                              {page.clicks != null && page.clicks > 0 && (
                                <span className="t-caption-sm text-[var(--brand-text)]">{page.clicks.toLocaleString()} clicks</span>
                              )}
                              {trend && TrendIconComp && (
                                <span className={`flex items-center gap-0.5 t-caption-sm ${trend.color}`}>
                                  <Icon as={TrendIconComp} size="sm" />
                                  {trend.label}
                                </span>
                              )}
                              {page.currentPosition ? (
                                <span className={`t-caption-sm font-mono font-medium px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)] ${positionColor(page.currentPosition)}`}>
                                  #{Math.round(page.currentPosition)}
                                </span>
                              ) : (
                                <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded-[var(--radius-sm)] font-mono">&mdash;</span>
                              )}
                              <Icon as={ChevronDown} size="md" className={`text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                            </div>
                          </div>

                          {/* Summary row: primary keyword + keyword count */}
                          <div className="flex items-center gap-2 mt-1">
                            {page.primaryKeyword && (
                              <span className="t-caption-sm text-accent-brand truncate inline-flex items-center gap-1">
                                {page.primaryKeyword}
                                {page.validated === false && (
                                  <span className="text-accent-warning bg-amber-500/10 px-1 py-px rounded-[var(--radius-sm)] border border-amber-500/20 t-caption-sm" title="This keyword has no confirmed search volume in SEMRush">
                                    Unvalidated
                                  </span>
                                )}
                                {/* Inline feedback badge */}
                                {keywordFeedback?.get(page.primaryKeyword.toLowerCase().trim()) === 'approved' && (
                                  <span className="text-accent-success bg-emerald-500/10 px-1 py-px rounded-[var(--radius-sm)] border border-emerald-500/20 t-caption-sm flex items-center gap-0.5"><Icon as={ThumbsUp} size="sm" />Relevant</span>
                                )}
                                {keywordFeedback?.get(page.primaryKeyword.toLowerCase().trim()) === 'declined' && (
                                  <span className="text-accent-danger bg-red-500/10 px-1 py-px rounded-[var(--radius-sm)] border border-red-500/20 t-caption-sm flex items-center gap-0.5"><Icon as={Ban} size="sm" />Not relevant</span>
                                )}
                              </span>
                            )}
                            {kwCount > 0 && (
                              <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-0.5">
                                <Icon as={Search} size="sm" />
                                {kwCount} keywords
                              </span>
                            )}
                            {page.volume != null && page.volume > 0 && (
                              <span className="t-caption-sm text-[var(--brand-text-muted)] inline-flex items-center gap-0.5">
                                {page.volume.toLocaleString()}/mo
                                {page.metricsSource === 'partial_match' && (
                                  <span className="text-accent-warning" title="Metrics from a similar keyword - may not be exact">~</span>
                                )}
                              </span>
                            )}
                            {page.difficulty != null && page.difficulty > 0 && (
                              <span className={`t-caption-sm inline-flex items-center gap-0.5 ${page.difficulty <= 30 ? 'text-accent-success' : page.difficulty <= 60 ? 'text-accent-warning' : 'text-accent-danger'}`}>
                                Difficulty {page.difficulty}
                                {page.metricsSource === 'partial_match' && (
                                  <span className="text-accent-warning" title="Metrics from a similar keyword - may not be exact">~</span>
                                )}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Expanded: per-keyword GSC data */}
                        {isExpanded && (
                          <div className="px-4 pb-3">
                            {page.gscKeywords && page.gscKeywords.length > 0 ? (
                              <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)]/50 overflow-hidden">
                                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-[var(--surface-1)]/50 border-b border-[var(--brand-border)]/50 t-micro text-[var(--brand-text-muted)]">
                                  <span>Keyword</span>
                                  <span className="text-right">Position</span>
                                  <span className="text-right">Impressions</span>
                                  <span className="text-right">Clicks</span>
                                </div>
                                {page.gscKeywords.map((kw, i) => (
                                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 border-b border-[var(--brand-border)]/30 last:border-b-0 hover:bg-[var(--surface-3)]/20">
                                    <span className="t-caption-sm text-[var(--brand-text-bright)] truncate">{kw.query}</span>
                                    <span className={`t-caption-sm font-mono text-right ${positionColor(kw.position)}`}>
                                      {kw.position.toFixed(1)}
                                    </span>
                                    <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono text-right">
                                      {kw.impressions.toLocaleString()}
                                    </span>
                                    <span className="t-caption-sm text-[var(--brand-text)] font-mono text-right">
                                      {kw.clicks.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="t-caption-sm text-[var(--brand-text-muted)] py-2">
                                {page.secondaryKeywords && page.secondaryKeywords.length > 0 ? (
                                  <div>
                                    <div className="t-caption-sm text-[var(--brand-text)] mb-1.5">Strategy keywords (no GSC data yet):</div>
                                    <div className="flex flex-wrap gap-1.5">
                                      <span className="t-caption-sm text-accent-brand bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-[var(--radius-sm)]">{page.primaryKeyword}</span>
                                      {page.secondaryKeywords.map((kw, i) => (
                                        <span key={i} className="t-caption-sm text-[var(--brand-text)] bg-[var(--surface-3)] border border-[var(--brand-border)]/50 px-2 py-0.5 rounded-[var(--radius-sm)]">{kw}</span>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <span>No keyword data available. Regenerate strategy with GSC connected to see per-keyword metrics.</span>
                                )}
                              </div>
                            )}

                            {/* Keyword feedback controls */}
                            {page.primaryKeyword && onApproveKeyword && onDeclineKeyword && (() => {
                              const kw = page.primaryKeyword!;
                              const fbStatus = keywordFeedback?.get(kw.toLowerCase().trim());
                              const loading = isLoadingFeedback?.(kw) ?? false;
                              if (fbStatus === 'declined') return (
                                <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-[var(--radius-md)] bg-red-500/5 border border-red-500/20">
                                  <Icon as={Ban} size="sm" className="text-accent-danger flex-shrink-0" />
                                  <span className="t-caption-sm text-accent-danger flex-1">Not relevant - excluded from future strategies</span>
                                  {onUndoFeedback && (
                                    <button onClick={() => onUndoFeedback(kw)} disabled={loading} className="t-caption-sm text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] flex items-center gap-0.5 transition-colors disabled:opacity-50">
                                      <Icon as={Undo2} size="sm" /> Restore
                                    </button>
                                  )}
                                </div>
                              );
                              if (fbStatus === 'approved') return (
                                <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-[var(--radius-md)] bg-emerald-500/5 border border-emerald-500/20">
                                  <Icon as={ThumbsUp} size="sm" className="text-accent-success flex-shrink-0" />
                                  <span className="t-caption-sm text-accent-success">Relevant - can shape future recommendations</span>
                                </div>
                              );
                              return (
                                <div className="flex items-center gap-1.5 mt-2">
                                  <span className="t-caption-sm text-[var(--brand-text-muted)] mr-1">Is this keyword relevant?</span>
                                  <button
                                    onClick={() => onApproveKeyword(kw, 'page_map')}
                                    disabled={loading}
                                    className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-success bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                  >
                                    <Icon as={ThumbsUp} size="sm" /> Yes
                                  </button>
                                  <button
                                    onClick={() => onDeclineKeyword(kw, 'page_map')}
                                    disabled={loading}
                                    className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-danger bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                  >
                                    <Icon as={ThumbsDown} size="sm" /> Not relevant
                                  </button>
                                </div>
                              );
                            })()}

                            {/* Action for Opportunities */}
                            {isOpportunity && workspaceId && (
                              <div className="mt-2 pt-2 border-t border-[var(--brand-border)]/30 flex justify-end">
                                <button
                                  onClick={async () => {
                                    if (discussingPage === page.pagePath) return;
                                    const topic = `Discuss optimization for ${page.pageTitle || page.pagePath}`;
                                    const targetKeyword = page.primaryKeyword || page.pageTitle || page.pagePath;
                                    setDiscussingPage(page.pagePath);
                                    try {
                                      await post(`/api/public/content-request/${workspaceId}`, {
                                        topic,
                                        targetKeyword,
                                        rationale: `Page ${page.pagePath} is getting impressions but not ranking. Review optimization strategy.`,
                                        priority: 'high'
                                      });
                                      setToast?.('Optimization request created');
                                      onContentRequested?.();
                                    } catch {
                                      setToast?.('Failed to create optimization request');
                                    } finally {
                                      setDiscussingPage(null);
                                    }
                                  }}
                                  disabled={discussingPage === page.pagePath}
                                  className="px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm font-medium text-[var(--brand-text-bright)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border)] transition-colors flex items-center gap-1 disabled:opacity-50"
                                >
                                  <Icon as={MessageCircle} size="sm" />
                                  {discussingPage === page.pagePath ? 'Requesting...' : 'Request Review'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

    </div>
  );
}
