import { Icon } from '../ui';
import {
  ChevronDown, ChevronRight, Loader2, Pencil, Check, X,
  Search, BarChart3, Shield, DollarSign, ArrowUp, ArrowDown,
} from 'lucide-react';
import type { MetricsSource } from '../../../shared/types/keywords.js';
import { SeoCopyPanel } from './SeoCopyPanel';

interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  metricsSource?: MetricsSource;
  validated?: boolean;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

interface SeoCopy {
  seoTitle: string;
  metaDescription: string;
  h1: string;
  introParagraph: string;
  internalLinkSuggestions?: { targetPath: string; anchorText: string; context: string }[];
  changes?: string[];
}

export interface PageKeywordMapProps {
  filteredPages: PageKeywordMap[];
  pageMap: PageKeywordMap[];
  expandedPages: Set<number>;
  editingPage: number | null;
  editDraft: { primary: string; secondary: string };
  saving: boolean;
  pageSearch: string;
  sortBy: 'opportunity' | 'position' | 'volume' | 'impressions';
  sortDir: 'asc' | 'desc';
  seoCopyResults: Map<string, SeoCopy>;
  generatingCopy: string | null;
  copiedField: string | null;
  positionColor: (pos?: number) => string;
  difficultyColor: (kd?: number) => string;
  difficultyLabel: (kd?: number) => string;
  intentColor: (intent?: string) => string;
  onTogglePage: (idx: number) => void;
  onStartEdit: (idx: number) => void;
  onSaveEdit: () => void;
  onSetEditingPage: (idx: number | null) => void;
  onSetEditDraft: (fn: (prev: { primary: string; secondary: string }) => { primary: string; secondary: string }) => void;
  onSetPageSearch: (value: string) => void;
  onSetSortBy: (value: 'opportunity' | 'position' | 'volume' | 'impressions') => void;
  onSetSortDir: (fn: (prev: 'asc' | 'desc') => 'asc' | 'desc') => void;
  onGenerateSeoCopy: (page: PageKeywordMap) => void;
  onCopyText: (text: string, label: string) => void;
}

export function PageKeywordMapPanel({
  filteredPages,
  pageMap,
  expandedPages,
  editingPage,
  editDraft,
  saving,
  pageSearch,
  sortBy,
  sortDir,
  seoCopyResults,
  generatingCopy,
  copiedField,
  positionColor,
  difficultyColor,
  difficultyLabel,
  intentColor,
  onTogglePage,
  onStartEdit,
  onSaveEdit,
  onSetEditingPage,
  onSetEditDraft,
  onSetPageSearch,
  onSetSortBy,
  onSetSortDir,
  onGenerateSeoCopy,
  onCopyText,
}: PageKeywordMapProps) {
  return (
    // pr-check-disable-next-line -- brand asymmetric signature on PageKeywordMap outer; non-SectionCard chrome (sticky table headers)
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
      <div className="px-4 py-3 border-b border-[var(--brand-border)]">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">Page Keyword Map</h4>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{filteredPages.length} pages · Click to expand · Pencil to edit</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Icon as={Search} size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
            <input
              type="text"
              value={pageSearch}
              onChange={e => onSetPageSearch(e.target.value)}
              placeholder="Search pages, keywords..."
              className="w-full pl-8 pr-3 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-bright)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
            />
          </div>
          <div className="flex items-center gap-1">
            {(['opportunity', 'position', 'impressions', 'volume'] as const).map(s => (
              <button
                key={s}
                onClick={() => { if (sortBy === s) onSetSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { onSetSortBy(s); onSetSortDir(() => 'desc'); } }}
                className={`px-2 py-1 rounded t-caption-sm font-medium transition-colors flex items-center gap-0.5 ${
                  sortBy === s ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border-hover)] hover:text-[var(--brand-text-bright)]'
                }`}
              >
                {s === 'opportunity' ? 'Priority' : s.charAt(0).toUpperCase() + s.slice(1)}
                {sortBy === s && (sortDir === 'desc' ? <Icon as={ArrowDown} size="xs" /> : <Icon as={ArrowUp} size="xs" />)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {filteredPages.map((page) => {
        const realIdx = pageMap.indexOf(page);
        const isExpanded = expandedPages.has(realIdx);
        const isEditing = editingPage === realIdx;

        return (
          <div key={realIdx} className="border-b border-[var(--brand-border)]/50 last:border-b-0">
            <button
              onClick={() => onTogglePage(realIdx)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-3)]/20 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Icon as={isExpanded ? ChevronDown : ChevronRight} size="xs" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="t-caption text-[var(--brand-text-bright)] truncate block">{page.pageTitle}</span>
                  <span className="t-mono text-[var(--brand-text-muted)]">{page.pagePath}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {page.searchIntent && (
                  <span className={`t-caption-sm px-1.5 py-0.5 rounded-full border font-medium ${intentColor(page.searchIntent)}`}>
                    {page.searchIntent}
                  </span>
                )}
                <span className="t-caption-sm text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded max-w-[180px] truncate">
                  {page.primaryKeyword}
                </span>
                {page.validated === false && (
                  <span className="t-caption-sm text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20" title="This keyword has no confirmed search volume in SEMRush">
                    Unvalidated
                  </span>
                )}
                {page.volume !== undefined && page.volume > 0 && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1">
                    {page.volume.toLocaleString()}/mo
                    {page.metricsSource === 'partial_match' && (
                      <span className="text-amber-400" title="Metrics from a similar keyword — may not be exact">~</span>
                    )}
                  </span>
                )}
                {page.difficulty !== undefined && page.difficulty > 0 && (
                  <span className={`t-caption-sm ${difficultyColor(page.difficulty)} bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1`}>
                    KD {page.difficulty}%
                    {page.metricsSource === 'partial_match' && (
                      <span className="text-amber-400" title="Metrics from a similar keyword — may not be exact">~</span>
                    )}
                  </span>
                )}
                {page.currentPosition ? (
                  <span className={`t-caption-sm ${positionColor(page.currentPosition)} font-mono font-medium bg-[var(--surface-3)] px-1.5 py-0.5 rounded`}>
                    #{page.currentPosition.toFixed(0)}
                  </span>
                ) : (
                  <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono">—</span>
                )}
                {page.impressions !== undefined && page.impressions > 0 && (
                  <span className="t-mono text-[var(--brand-text-muted)]">{page.impressions.toLocaleString()} imp</span>
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 pl-10 space-y-2">
                {!isEditing ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Primary Keyword</span>
                        <p className="t-caption text-[var(--brand-text-bright)] mt-0.5">{page.primaryKeyword}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onStartEdit(realIdx); }}
                        className="p-1 text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
                        title="Edit keywords"
                      >
                        <Icon as={Pencil} size="sm" />
                      </button>
                    </div>
                    <div>
                      <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">Secondary Keywords</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {page.secondaryKeywords.map((kw, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded t-caption-sm text-[var(--brand-text)]">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Metrics row */}
                    <div className="flex flex-wrap gap-3 mt-1">
                      {page.volume != null && page.volume > 0 && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                          <Icon as={BarChart3} size="sm" className="text-orange-400" />
                          <span className="text-[var(--brand-text-bright)] font-medium">{page.volume.toLocaleString()}</span>/mo
                        </div>
                      )}
                      {page.difficulty != null && page.difficulty > 0 && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                          <Icon as={Shield} size="sm" />
                          KD: <span className={`font-medium ${difficultyColor(page.difficulty)}`}>{page.difficulty}%</span>
                          <span className={`t-caption-sm ${difficultyColor(page.difficulty)}`}>({difficultyLabel(page.difficulty)})</span>
                        </div>
                      )}
                      {page.cpc !== undefined && page.cpc > 0 && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                          <Icon as={DollarSign} size="sm" className="text-emerald-400" />
                          CPC: <span className="text-emerald-400 font-medium">${page.cpc.toFixed(2)}</span>
                        </div>
                      )}
                      {page.impressions !== undefined && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)]">
                          <span className="text-[var(--brand-text)] font-medium">{page.impressions.toLocaleString()}</span> impressions
                        </div>
                      )}
                      {page.clicks !== undefined && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)]">
                          <span className="text-[var(--brand-text)] font-medium">{page.clicks.toLocaleString()}</span> clicks
                        </div>
                      )}
                      {page.currentPosition && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)]">
                          Avg position: <span className={`font-medium ${positionColor(page.currentPosition)}`}>#{page.currentPosition.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    {/* Secondary keyword metrics */}
                    {page.secondaryMetrics && page.secondaryMetrics.length > 0 && (
                      <div className="mt-1">
                        <span className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wider">Secondary keyword data</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {page.secondaryMetrics.filter(sm => sm.volume > 0 || sm.difficulty > 0).map((sm, si) => (
                            <span key={si} className="t-caption-sm px-1.5 py-0.5 bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 rounded text-[var(--brand-text-muted)]">
                              {sm.keyword} {sm.volume > 0 && <span className="text-[var(--brand-text)]">{sm.volume}/mo</span>} {sm.difficulty > 0 && <span className={difficultyColor(sm.difficulty)}>KD {sm.difficulty}%</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generate SEO Copy */}
                    <SeoCopyPanel
                      page={page}
                      seoCopyResults={seoCopyResults}
                      generatingCopy={generatingCopy}
                      copiedField={copiedField}
                      onGenerateSeoCopy={onGenerateSeoCopy}
                      onCopyText={onCopyText}
                    />
                  </>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider block mb-1">Primary Keyword</label>
                      <input
                        type="text"
                        value={editDraft.primary}
                        onChange={e => onSetEditDraft(prev => ({ ...prev, primary: e.target.value }))}
                        className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
                      />
                    </div>
                    <div>
                      <label className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider block mb-1">Secondary Keywords (comma-separated)</label>
                      <input
                        type="text"
                        value={editDraft.secondary}
                        onChange={e => onSetEditDraft(prev => ({ ...prev, secondary: e.target.value }))}
                        className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={onSaveEdit}
                        disabled={saving}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white t-caption-sm font-medium"
                      >
                        {saving ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Check} size="sm" />} Save
                      </button>
                      <button
                        onClick={() => onSetEditingPage(null)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text-bright)] t-caption-sm font-medium"
                      >
                        <Icon as={X} size="xs" /> Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
