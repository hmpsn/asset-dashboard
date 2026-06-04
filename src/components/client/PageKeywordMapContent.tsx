import { useState, useMemo } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, Layers, MessageCircle, ChevronDown, Search, ThumbsUp, ThumbsDown, Ban, Undo2 } from 'lucide-react';
import { Badge, Button, Icon } from '../ui';
import { positionColor, positionTone } from '../ui/constants';
import type { MetricsSource } from '../../../shared/types/keywords.js';
import type { KeywordStrategyExplanation } from '../../../shared/types/keyword-strategy-ux.js';
import { post } from '../../api';
import { normalizeKeyword } from './strategy/strategyKeywordDisplay';
import { capitalize } from '../../utils/strings';
import { KeywordMetricCell } from '../shared/KeywordMetricCell';

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
  explanations?: KeywordStrategyExplanation[];
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
         capitalize(parts[0]);
}


export function PageKeywordMapContent({ pageMap, workspaceId, setToast, onContentRequested, keywordFeedback, onApproveKeyword, onDeclineKeyword, onUndoFeedback, isLoadingFeedback, explanations = [] }: PageKeywordMapContentProps) {
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
  const explanationByKeyword = useMemo(
    () => new Map(explanations.map(explanation => [explanation.normalizedKeyword, explanation])),
    [explanations],
  );

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
          <Button
            key={tab.id}
            variant="ghost"
            size="sm"
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
          </Button>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleFolder(folder)}
                className="w-full !justify-between px-4 py-2 hover:bg-[var(--surface-3)]/30 transition-colors"
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
              </Button>

              {/* Pages in Folder */}
              {expandedFolders.has(folder) && (
                <div className="divide-y divide-[var(--brand-border)]/30">
                  {pages.map(page => {
                    const trend = getTrendIndicator(page.currentPosition, page.previousPosition);
                    const TrendIconComp = trend?.icon;
                    const isOpportunity = !page.currentPosition && (page.impressions || 0) > 0;
                    const isExpanded = expandedPages.has(page.pagePath);
                    const kwCount = page.gscKeywords?.length || 0;
                    const explanation = page.primaryKeyword ? explanationByKeyword.get(normalizeKeyword(page.primaryKeyword)) : undefined;
                    
                    return (
                      <div key={page.pagePath} className={`transition-all ${isExpanded ? 'bg-[var(--surface-3)]/20' : ''}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePage(page.pagePath)}
                          className="w-full !justify-start px-4 py-2.5 hover:bg-[var(--surface-3)]/20 transition-colors text-left h-auto"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="t-caption-sm text-[var(--brand-text-bright)] font-medium truncate">
                                  {page.pageTitle || page.pagePath.split('/').pop() || page.pagePath}
                                </div>
                                {isOpportunity && (
                                  <Badge label="Opportunity" tone="blue" variant="outline" />
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
                                <Badge label={`#${Math.round(page.currentPosition)}`} tone={positionTone(page.currentPosition)} className="font-mono" />
                              ) : (
                                <Badge label="—" tone="zinc" className="font-mono" />
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
                                  <span title="This keyword does not yet have confirmed provider search-volume data. GSC or client evidence may still support it.">
                                    <Badge label="Unvalidated" tone="amber" variant="outline" />
                                  </span>
                                )}
                                {/* Inline feedback badge */}
                                {keywordFeedback?.get(normalizeKeyword(page.primaryKeyword)) === 'approved' && (
                                  <Badge label="Relevant" tone="emerald" variant="outline" icon={ThumbsUp} />
                                )}
                                {keywordFeedback?.get(normalizeKeyword(page.primaryKeyword)) === 'declined' && (
                                  <Badge label="Not relevant" tone="red" variant="outline" icon={Ban} />
                                )}
                              </span>
                            )}
                            {kwCount > 0 && (
                              <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-0.5">
                                <Icon as={Search} size="sm" />
                                {kwCount} keywords
                              </span>
                            )}
                            <KeywordMetricCell
                              volume={page.volume}
                              difficulty={page.difficulty}
                              mode="badge"
                              kdForm="difficulty"
                              partialMatch={page.metricsSource === 'partial_match'}
                            />
                            {explanation?.nextAction && (
                              <Badge label={explanation.nextAction.label} tone="teal" variant="outline" />
                            )}
                          </div>
                        </Button>

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
                                      {page.primaryKeyword && <Badge label={page.primaryKeyword} tone="teal" variant="outline" />}
                                      {page.secondaryKeywords.map((kw, i) => (
                                        <Badge key={i} label={kw} tone="zinc" variant="outline" />
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <span>No keyword data available. Regenerate strategy with GSC connected to see per-keyword metrics.</span>
                                )}
                              </div>
                            )}

                            {explanation && (
                              <div className="mt-2 rounded-[var(--radius-md)] border border-teal-500/20 bg-teal-500/10 px-3 py-2">
                                <div className="t-caption-sm font-medium text-teal-300 mb-1">Why this page matters</div>
                                <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">
                                  {explanation.reasons[0] ?? explanation.nextAction.detail}
                                </p>
                              </div>
                            )}

                            {/* Keyword feedback controls */}
                            {page.primaryKeyword && onApproveKeyword && onDeclineKeyword && (() => {
                              const kw = page.primaryKeyword!;
                              const fbStatus = keywordFeedback?.get(normalizeKeyword(kw));
                              const loading = isLoadingFeedback?.(kw) ?? false;
                              if (fbStatus === 'declined') return (
                                <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-[var(--radius-md)] bg-red-500/5 border border-red-500/20">
                                  <Icon as={Ban} size="sm" className="text-accent-danger flex-shrink-0" />
                                  <div className="t-caption-sm text-accent-danger flex-1">Not relevant - excluded from future strategies</div>
                                  {onUndoFeedback && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => onUndoFeedback(kw)}
                                      disabled={loading}
                                      className="t-caption-sm text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] flex items-center gap-0.5 transition-colors !px-0 !py-0 !h-auto"
                                    >
                                      <Icon as={Undo2} size="sm" /> Restore
                                    </Button>
                                  )}
                                </div>
                              );
                              if (fbStatus === 'approved') return (
                                <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-[var(--radius-md)] bg-emerald-500/5 border border-emerald-500/20">
                                  <Icon as={ThumbsUp} size="sm" className="text-accent-success flex-shrink-0" />
                                  <div className="t-caption-sm text-accent-success">Relevant - can shape future recommendations</div>
                                </div>
                              );
                              return (
                                <div className="flex items-center gap-1.5 mt-2">
                                  <span className="t-caption-sm text-[var(--brand-text-muted)] mr-1">Is this keyword relevant?</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onApproveKeyword(kw, 'page_map')}
                                    disabled={loading}
                                    className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-brand bg-teal-500/10 border border-teal-500/20 hover:bg-teal-500/20 transition-colors disabled:opacity-50"
                                  >
                                    <Icon as={ThumbsUp} size="sm" /> Yes
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onDeclineKeyword(kw, 'page_map')}
                                    disabled={loading}
                                    className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-danger bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                  >
                                    <Icon as={ThumbsDown} size="sm" /> Not relevant
                                  </Button>
                                </div>
                              );
                            })()}

                            {/* Action for Opportunities */}
                            {isOpportunity && workspaceId && (
                              <div className="mt-2 pt-2 border-t border-[var(--brand-border)]/30 flex justify-end">
                                <Button
                                  variant="secondary"
                                  size="sm"
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
                                </Button>
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
