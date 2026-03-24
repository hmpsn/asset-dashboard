import { useState, useMemo } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, Layers, MessageCircle, ChevronDown, Search, ThumbsUp, ThumbsDown, Ban, Undo2 } from 'lucide-react';
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
  metricsSource?: 'exact' | 'partial_match' | 'ai_estimate';
  validated?: boolean;
  searchIntent?: string;
  gscKeywords?: GscKeyword[];
}

interface PageKeywordMapContentProps {
  pageMap: PageMapItem[];
  workspaceId?: string;
  setToast?: (msg: string) => void;
  onContentRequested?: () => void;
  keywordFeedback?: Map<string, 'approved' | 'declined'>;
  onApproveKeyword?: (keyword: string, source: string) => void;
  onDeclineKeyword?: (keyword: string, source: string) => void;
  onUndoFeedback?: (keyword: string) => void;
  isLoadingFeedback?: (keyword: string) => boolean;
}

type FilterTab = 'all' | 'ranking' | 'opportunities' | 'stagnant' | 'falling';

function getTrendIndicator(current?: number, previous?: number) {
  if (!current || !previous) return null;
  const diff = previous - current; // Lower position number is better (e.g., 5 -> 3 is +2 improvement)
  if (diff > 0) return { icon: ArrowUpRight, color: 'text-emerald-400', label: `↑ ${diff}` };
  if (diff < 0) return { icon: ArrowDownRight, color: 'text-red-400', label: `↓ ${Math.abs(diff)}` };
  return { icon: Minus, color: 'text-zinc-500', label: '→' };
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
  if (pos <= 3) return 'text-emerald-400';
  if (pos <= 10) return 'text-emerald-400/70';
  if (pos <= 20) return 'text-amber-400';
  if (pos <= 50) return 'text-amber-400/70';
  return 'text-zinc-500';
}

export function PageKeywordMapContent({ pageMap, workspaceId, setToast, onContentRequested, keywordFeedback, onApproveKeyword, onDeclineKeyword, onUndoFeedback, isLoadingFeedback }: PageKeywordMapContentProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['Blog', 'Services']));
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());

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
      case 'stagnant':
        return pageMap.filter(p => {
          if (!p.currentPosition || !p.previousPosition) return false;
          return Math.abs(p.currentPosition - p.previousPosition) < 2;
        });
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
    { id: 'ranking', label: 'Top 20', count: pageMap.filter(p => p.currentPosition && p.currentPosition <= 20).length },
    { id: 'opportunities', label: 'Opportunities', count: pageMap.filter(p => !p.currentPosition && (p.impressions || 0) > 0).length },
    { id: 'falling', label: 'Falling', count: pageMap.filter(p => p.currentPosition && p.previousPosition && p.currentPosition > p.previousPosition).length },
  ];

  return (
    <div className="border-t border-zinc-800">
      {/* Filter Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800/50 overflow-x-auto">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
              activeFilter === tab.id 
                ? 'bg-zinc-700 text-zinc-200' 
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-zinc-600">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Grouped Page List */}
      <div className="max-h-[400px] overflow-y-auto">
        {Object.entries(groupedPages).length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-zinc-500">No pages match this filter</p>
          </div>
        ) : (
          Object.entries(groupedPages).map(([folder, pages]) => (
            <div key={folder} className="border-b border-zinc-800/50 last:border-b-0">
              {/* Folder Header */}
              <button
                onClick={() => toggleFolder(folder)}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-[11px] font-medium text-zinc-400">{folder}</span>
                  <span className="text-[10px] text-zinc-600">{pages.length} pages</span>
                </div>
                <svg 
                  className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${expandedFolders.has(folder) ? '' : '-rotate-90'}`} 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Pages in Folder */}
              {expandedFolders.has(folder) && (
                <div className="divide-y divide-zinc-800/30">
                  {pages.map(page => {
                    const trend = getTrendIndicator(page.currentPosition, page.previousPosition);
                    const TrendIcon = trend?.icon;
                    const isOpportunity = !page.currentPosition && (page.impressions || 0) > 0;
                    const isExpanded = expandedPages.has(page.pagePath);
                    const kwCount = page.gscKeywords?.length || 0;
                    
                    return (
                      <div key={page.pagePath} className={`transition-all ${isExpanded ? 'bg-zinc-800/20' : ''}`}>
                        <button
                          onClick={() => togglePage(page.pagePath)}
                          className="w-full px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-left"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-zinc-300 font-medium truncate">
                                  {page.pageTitle || page.pagePath.split('/').pop() || page.pagePath}
                                </div>
                                {isOpportunity && (
                                  <span className="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20">
                                    Opportunity
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-zinc-500 font-mono truncate">{page.pagePath}</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              {page.impressions != null && page.impressions > 0 && (
                                <span className="text-[10px] text-zinc-500">{page.impressions.toLocaleString()} imp</span>
                              )}
                              {page.clicks != null && page.clicks > 0 && (
                                <span className="text-[10px] text-zinc-400">{page.clicks.toLocaleString()} clicks</span>
                              )}
                              {trend && TrendIcon && (
                                <span className={`flex items-center gap-0.5 text-[10px] ${trend.color}`}>
                                  <TrendIcon className="w-3 h-3" />
                                  {trend.label}
                                </span>
                              )}
                              {page.currentPosition ? (
                                <span className={`text-[11px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-800 ${positionColor(page.currentPosition)}`}>
                                  #{Math.round(page.currentPosition)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">&mdash;</span>
                              )}
                              <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                            </div>
                          </div>
                          
                          {/* Summary row: primary keyword + keyword count */}
                          <div className="flex items-center gap-2 mt-1">
                            {page.primaryKeyword && (
                              <span className="text-[10px] text-teal-400/80 truncate inline-flex items-center gap-1">
                                {page.primaryKeyword}
                                {page.validated === false && (
                                  <span className="text-amber-400 bg-amber-500/10 px-1 py-px rounded border border-amber-500/20 text-[9px]" title="This keyword has no confirmed search volume in SEMRush">
                                    Unvalidated
                                  </span>
                                )}
                                {/* Inline feedback badge */}
                                {keywordFeedback?.get(page.primaryKeyword.toLowerCase().trim()) === 'approved' && (
                                  <span className="text-emerald-400 bg-emerald-500/10 px-1 py-px rounded border border-emerald-500/20 text-[9px] flex items-center gap-0.5"><ThumbsUp className="w-2.5 h-2.5" />Approved</span>
                                )}
                                {keywordFeedback?.get(page.primaryKeyword.toLowerCase().trim()) === 'declined' && (
                                  <span className="text-red-400 bg-red-500/10 px-1 py-px rounded border border-red-500/20 text-[9px] flex items-center gap-0.5"><Ban className="w-2.5 h-2.5" />Declined</span>
                                )}
                              </span>
                            )}
                            {kwCount > 0 && (
                              <span className="text-[10px] text-zinc-600 flex items-center gap-0.5">
                                <Search className="w-2.5 h-2.5" />
                                {kwCount} keywords
                              </span>
                            )}
                            {page.volume != null && page.volume > 0 && (
                              <span className="text-[10px] text-zinc-500 inline-flex items-center gap-0.5">
                                {page.volume.toLocaleString()}/mo
                                {page.metricsSource === 'partial_match' && (
                                  <span className="text-amber-400" title="Metrics from a similar keyword — may not be exact">~</span>
                                )}
                              </span>
                            )}
                            {page.difficulty != null && page.difficulty > 0 && (
                              <span className={`text-[10px] inline-flex items-center gap-0.5 ${page.difficulty <= 30 ? 'text-green-400' : page.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                                KD {page.difficulty}
                                {page.metricsSource === 'partial_match' && (
                                  <span className="text-amber-400" title="Metrics from a similar keyword — may not be exact">~</span>
                                )}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Expanded: per-keyword GSC data */}
                        {isExpanded && (
                          <div className="px-4 pb-3">
                            {page.gscKeywords && page.gscKeywords.length > 0 ? (
                              <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
                                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-zinc-950/50 border-b border-zinc-800/50 text-[9px] font-medium text-zinc-500 uppercase tracking-wider">
                                  <span>Keyword</span>
                                  <span className="text-right">Position</span>
                                  <span className="text-right">Impressions</span>
                                  <span className="text-right">Clicks</span>
                                </div>
                                {page.gscKeywords.map((kw, i) => (
                                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 border-b border-zinc-800/30 last:border-b-0 hover:bg-zinc-800/20">
                                    <span className="text-[11px] text-zinc-300 truncate">{kw.query}</span>
                                    <span className={`text-[11px] font-mono text-right ${positionColor(kw.position)}`}>
                                      {kw.position.toFixed(1)}
                                    </span>
                                    <span className="text-[11px] text-zinc-500 font-mono text-right">
                                      {kw.impressions.toLocaleString()}
                                    </span>
                                    <span className="text-[11px] text-zinc-400 font-mono text-right">
                                      {kw.clicks.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[11px] text-zinc-500 py-2">
                                {page.secondaryKeywords && page.secondaryKeywords.length > 0 ? (
                                  <div>
                                    <div className="text-[10px] text-zinc-400 mb-1.5">Target keywords (no GSC data yet):</div>
                                    <div className="flex flex-wrap gap-1.5">
                                      <span className="text-[10px] text-teal-400/80 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded">{page.primaryKeyword}</span>
                                      {page.secondaryKeywords.map((kw, i) => (
                                        <span key={i} className="text-[10px] text-zinc-400 bg-zinc-800 border border-zinc-700/50 px-2 py-0.5 rounded">{kw}</span>
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
                                <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/20">
                                  <Ban className="w-3 h-3 text-red-400 flex-shrink-0" />
                                  <span className="text-[10px] text-red-400 flex-1">Declined — excluded from future strategies</span>
                                  {onUndoFeedback && (
                                    <button onClick={() => onUndoFeedback(kw)} disabled={loading} className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-0.5 transition-colors disabled:opacity-50">
                                      <Undo2 className="w-3 h-3" /> Restore
                                    </button>
                                  )}
                                </div>
                              );
                              if (fbStatus === 'approved') return (
                                <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                                  <ThumbsUp className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                                  <span className="text-[10px] text-emerald-400">Approved — prioritized in strategy</span>
                                </div>
                              );
                              return (
                                <div className="flex items-center gap-1.5 mt-2">
                                  <span className="text-[10px] text-zinc-500 mr-1">Is this keyword relevant?</span>
                                  <button
                                    onClick={() => onApproveKeyword(kw, 'page_map')}
                                    disabled={loading}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                  >
                                    <ThumbsUp className="w-3 h-3" /> Yes
                                  </button>
                                  <button
                                    onClick={() => onDeclineKeyword(kw, 'page_map')}
                                    disabled={loading}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                  >
                                    <ThumbsDown className="w-3 h-3" /> Not relevant
                                  </button>
                                </div>
                              );
                            })()}

                            {/* Action for Opportunities */}
                            {isOpportunity && workspaceId && (
                              <div className="mt-2 pt-2 border-t border-zinc-800/30 flex justify-end">
                                <button
                                  onClick={() => {
                                    post(`/api/public/content-request/${workspaceId}`, {
                                      type: 'meeting_discussion',
                                      targetPage: page.pagePath,
                                      targetKeyword: page.primaryKeyword,
                                      notes: 'Page getting impressions but not ranking - discuss optimization strategy',
                                      priority: 'high'
                                    }).then(() => {
                                      setToast?.('Added to meeting agenda');
                                      onContentRequested?.();
                                    }).catch(() => setToast?.('Failed to add to agenda'));
                                  }}
                                  className="px-2 py-1 rounded text-[10px] font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors flex items-center gap-1"
                                >
                                  <MessageCircle className="w-3 h-3" />
                                  Discuss
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
