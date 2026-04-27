import { useState, useCallback, useRef, useMemo } from 'react';
import {
  Filter, ArrowUpDown, Sparkles, FileText, Send, Download,
  FileDown, CheckSquare, Square, BarChart3, Flag,
} from 'lucide-react';
import { SectionCard, Badge, PageHeader } from '../ui';
import type { ContentMatrix, MatrixCell } from './types';
import { CellDetailPanel } from './CellDetailPanel';

interface MatrixGridProps {
  workspaceId: string;
  matrix: ContentMatrix;
  onCellClick: (cell: MatrixCell) => void;
  onBulkAction: (action: 'optimize' | 'generate_briefs' | 'generate_posts' | 'send_review' | 'export_csv' | 'export_docx', cellIds: string[]) => void;
  onCellUpdate: (cellId: string, updates: Partial<MatrixCell>) => void;
}

const STATUS_CONFIG: Record<MatrixCell['status'], { label: string; bg: string; text: string; border: string; icon: string }> = {
  planned:            { label: 'Planned',           bg: 'bg-[var(--surface-3)]',   text: 'text-[var(--brand-text-muted)]', border: '',                    icon: '○' },
  keyword_validated:   { label: 'Keyword Optimized', bg: 'bg-blue-500/10',    text: 'text-blue-400',   border: 'border-blue-500/20',  icon: '◐' },
  brief_generated:    { label: 'Brief Generated',   bg: 'bg-amber-500/10',   text: 'text-amber-400',  border: 'border-amber-500/20', icon: '◑' },
  review:             { label: 'Client Review',     bg: 'bg-blue-500/10',    text: 'text-blue-400',   border: 'border-blue-500/20', icon: '◑' },
  approved:           { label: 'Approved',           bg: 'bg-teal-500/10',   text: 'text-teal-400',   border: 'border-teal-500/20',  icon: '✓' },
  draft:              { label: 'Draft',              bg: 'bg-orange-500/10',  text: 'text-orange-400', border: 'border-orange-500/20', icon: '◐' },
  published:          { label: 'Published',          bg: 'bg-emerald-500/10',   text: 'text-emerald-400',  border: 'border-emerald-500/20', icon: '●' },
};

const ALL_STATUSES: MatrixCell['status'][] = ['planned', 'keyword_validated', 'brief_generated', 'review', 'approved', 'draft', 'published'];

type SortKey = 'status' | 'volume' | 'difficulty' | 'alphabetical';

export function MatrixGrid({ matrix, onCellClick, onBulkAction, onCellUpdate }: MatrixGridProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailCellId, setDetailCellId] = useState<string | null>(null);
  const detailCell = detailCellId ? matrix.cells.find(c => c.id === detailCellId) ?? null : null;
  const [filterStatus, setFilterStatus] = useState<MatrixCell['status'] | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showBulkMenu, setShowBulkMenu] = useState(false);

  const lastSelectedIndex = useRef<number | null>(null);

  const dim0 = matrix.dimensions[0];
  const dim1 = matrix.dimensions.length > 1 ? matrix.dimensions[1] : null;

  // Filter cells
  const filteredCells = filterStatus === 'all'
    ? matrix.cells
    : matrix.cells.filter(c => c.status === filterStatus);

  // Sort cells for list view
  const sortedCells = [...filteredCells].sort((a, b) => {
    switch (sortKey) {
      case 'volume':
        return (b.keywordValidation?.volume ?? 0) - (a.keywordValidation?.volume ?? 0);
      case 'difficulty':
        return (a.keywordValidation?.difficulty ?? 999) - (b.keywordValidation?.difficulty ?? 999);
      case 'alphabetical':
        return a.targetKeyword.localeCompare(b.targetKeyword);
      case 'status':
      default: {
        const order = ALL_STATUSES;
        return order.indexOf(a.status) - order.indexOf(b.status);
      }
    }
  });

  const completedCount = matrix.cells.filter(c => c.status === 'published' || c.status === 'approved' || c.status === 'draft').length;
  const progressPercent = matrix.cells.length > 0 ? Math.round((completedCount / matrix.cells.length) * 100) : 0;

  // Build ordered cell ID lists for shift-click selection in each view mode.
  // Grid view: include null placeholders for empty slots so indices match flatIndex.
  // List view: use sortedCells order directly.
  const gridOrderedCellIds = useMemo(() => {
    if (!dim0 || !dim1) return sortedCells.map(c => c.id);
    const ids: (string | null)[] = [];
    for (const row of dim0.values) {
      for (const col of dim1.values) {
        const cell = filteredCells.find(c =>
          c.variableValues[dim0.variableName] === row && c.variableValues[dim1.variableName] === col
        );
        ids.push(cell ? cell.id : null);
      }
    }
    return ids;
  }, [dim0, dim1, filteredCells, sortedCells]);

  const handleCellSelect = useCallback((cellId: string, e: React.MouseEvent, flatIndex: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (e.metaKey || e.ctrlKey) {
        if (next.has(cellId)) next.delete(cellId);
        else next.add(cellId);
      } else if (e.shiftKey && lastSelectedIndex.current !== null) {
        const start = Math.min(lastSelectedIndex.current, flatIndex);
        const end = Math.max(lastSelectedIndex.current, flatIndex);
        for (let i = start; i <= end; i++) {
          const id = gridOrderedCellIds[i];
          if (id) next.add(id);
        }
      } else {
        next.clear();
        next.add(cellId);
      }
      return next;
    });
    lastSelectedIndex.current = flatIndex;
  }, [gridOrderedCellIds]);

  const handleCellOpen = useCallback((cell: MatrixCell) => {
    setDetailCellId(cell.id);
    onCellClick(cell);
  }, [onCellClick]);

  const getCellForGrid = (rowVal: string, colVal: string): MatrixCell | undefined => {
    if (!dim0 || !dim1) return undefined;
    return filteredCells.find(c =>
      c.variableValues[dim0.variableName] === rowVal && c.variableValues[dim1.variableName] === colVal
    );
  };

  const renderCell = (cell: MatrixCell | undefined, flatIndex: number) => {
    if (!cell) return <td key={`empty-${flatIndex}`} className="p-2 border border-[var(--brand-border)]"><div className="h-14" /></td>;
    const cfg = STATUS_CONFIG[cell.status];
    const isSelected = selectedIds.has(cell.id);
    return (
      <td
        key={cell.id}
        className={`p-0 border border-[var(--brand-border)] cursor-pointer transition-all ${isSelected ? 'ring-2 ring-teal-400 ring-inset' : ''}`}
        onClick={e => handleCellSelect(cell.id, e, flatIndex)}
        onDoubleClick={() => handleCellOpen(cell)}
      >
        <div className={`px-2.5 py-2 h-full ${cfg.bg}`}>
          <div className="flex items-center gap-1 mb-1">
            <span className={`t-caption ${cfg.text}`}>{cfg.icon}</span>
            <span className="t-caption text-[var(--brand-text-bright)] truncate flex-1">
              {cell.customKeyword ?? cell.targetKeyword}
            </span>
          </div>
          {cell.keywordValidation && (
            <div className="flex items-center gap-1.5">
              <span className="t-caption-sm text-[var(--brand-text)] tabular-nums">{cell.keywordValidation.volume}/mo</span>
              <span className={`t-caption-sm tabular-nums ${cell.keywordValidation.difficulty > 60 ? 'text-red-400' : cell.keywordValidation.difficulty > 35 ? 'text-amber-400' : 'text-emerald-400'}`}>
                KD {cell.keywordValidation.difficulty}
              </span>
            </div>
          )}
          {cell.clientFlag && (
            <Flag className="w-2.5 h-2.5 text-amber-400 mt-0.5" />
          )}
        </div>
      </td>
    );
  };

  let flatIndex = 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title={matrix.name}
        subtitle={`${matrix.stats.total} pages total`}
        icon={<BarChart3 className="w-5 h-5 text-teal-400" />}
      />

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--brand-text)]">{progressPercent}% complete</span>
          <span className="t-caption text-[var(--brand-text-muted)]">{completedCount}/{matrix.cells.length} pages</span>
        </div>
        <div className="w-full h-2 bg-[var(--surface-1)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="relative">
            <button
              onClick={() => { setShowFilter(!showFilter); setShowSort(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] border border-[var(--brand-border)] text-xs text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)] transition-colors"
            >
              <Filter className="w-3 h-3" /> Filter
              {filterStatus !== 'all' && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
            </button>
            {showFilter && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl z-20 py-1">
                <button
                  onClick={() => { setFilterStatus('all'); setShowFilter(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface-3)] transition-colors ${filterStatus === 'all' ? 'text-teal-400' : 'text-[var(--brand-text)]'}`}
                >
                  All statuses
                </button>
                {ALL_STATUSES.map(s => (
                  <button
                    key={s}
                    onClick={() => { setFilterStatus(s); setShowFilter(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface-3)] transition-colors ${filterStatus === s ? 'text-teal-400' : 'text-[var(--brand-text)]'}`}
                  >
                    {STATUS_CONFIG[s].icon} {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort */}
          <div className="relative">
            <button
              onClick={() => { setShowSort(!showSort); setShowFilter(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] border border-[var(--brand-border)] text-xs text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)] transition-colors"
            >
              <ArrowUpDown className="w-3 h-3" /> Sort
            </button>
            {showSort && (
              <div className="absolute top-full left-0 mt-1 w-40 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl z-20 py-1">
                {([['status', 'Status'], ['volume', 'Volume'], ['difficulty', 'Difficulty'], ['alphabetical', 'Alphabetical']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setSortKey(key); setShowSort(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface-3)] transition-colors ${sortKey === key ? 'text-teal-400' : 'text-[var(--brand-text)]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-[var(--brand-text)]">
                <CheckSquare className="w-3 h-3 inline mr-1" />
                {selectedIds.size} selected
              </span>
              <div className="relative">
                <button
                  onClick={() => setShowBulkMenu(!showBulkMenu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 text-xs text-teal-300 hover:bg-teal-600/30 transition-colors font-medium"
                >
                  Actions
                </button>
                {showBulkMenu && (
                  <div className="absolute top-full right-0 mt-1 w-52 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl z-20 py-1">
                    {[
                      { key: 'optimize' as const, label: 'Optimize Keywords', icon: Sparkles },
                      { key: 'generate_briefs' as const, label: 'Generate Briefs', icon: FileText },
                      { key: 'send_review' as const, label: 'Send for Review', icon: Send },
                      { key: 'export_csv' as const, label: 'Export CSV', icon: Download },
                      { key: 'export_docx' as const, label: 'Export Word Doc', icon: FileDown },
                    ].map(action => (
                      <button
                        key={action.key}
                        onClick={() => { onBulkAction(action.key, [...selectedIds]); setShowBulkMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
                      >
                        <action.icon className="w-3.5 h-3.5 text-[var(--brand-text-muted)]" />
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Grid table (2-dimension) or list (1-dimension / fallback) */}
      {dim1 ? (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="px-3 py-2 t-caption font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider border-b border-[var(--brand-border)] bg-[var(--surface-1)] sticky left-0 z-10">
                    {dim0.label ?? dim0.variableName} / {dim1.label ?? dim1.variableName}
                  </th>
                  {dim1.values.map(col => (
                    <th key={col} className="px-3 py-2 t-caption font-semibold text-[var(--brand-text-bright)] border-b border-[var(--brand-border)] bg-[var(--surface-1)] text-center min-w-[120px]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dim0.values.map(row => (
                  <tr key={row}>
                    <td className="px-3 py-2 text-xs font-medium text-[var(--brand-text-bright)] border-b border-[var(--brand-border)] bg-[var(--surface-1)] sticky left-0 z-10 whitespace-nowrap">
                      {row}
                    </td>
                    {dim1.values.map(col => {
                      const cell = getCellForGrid(row, col);
                      const idx = flatIndex++;
                      return renderCell(cell, idx);
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : (
        <SectionCard noPadding>
          <div className="divide-y divide-[var(--brand-border)]">
            {sortedCells.map((cell, i) => {
              const cfg = STATUS_CONFIG[cell.status];
              const isSelected = selectedIds.has(cell.id);
              return (
                <div
                  key={cell.id}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--surface-3)] transition-colors ${isSelected ? 'ring-2 ring-teal-400 ring-inset' : ''}`}
                  onClick={e => handleCellSelect(cell.id, e, i)}
                  onDoubleClick={() => handleCellOpen(cell)}
                >
                  <button
                    onClick={e => { e.stopPropagation(); handleCellSelect(cell.id, { ...e, ctrlKey: true } as React.MouseEvent, i); }}
                    className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
                  >
                    {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-teal-400" /> : <Square className="w-3.5 h-3.5" />}
                  </button>
                  <Badge label={`${cfg.icon} ${cfg.label}`} color={cfg.text.includes('zinc') || cfg.text.includes('brand') ? 'zinc' : cfg.text.includes('blue') ? 'blue' : cfg.text.includes('amber') ? 'amber' : cfg.text.includes('teal') ? 'teal' : cfg.text.includes('orange') ? 'orange' : cfg.text.includes('emerald') ? 'emerald' : cfg.text.includes('red') ? 'red' : 'zinc'} />
                  <span className="text-xs text-[var(--brand-text-bright)] flex-1 truncate">{cell.customKeyword ?? cell.targetKeyword}</span>
                  {cell.keywordValidation && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="t-caption-sm text-[var(--brand-text)] tabular-nums">{cell.keywordValidation.volume}/mo</span>
                      <span className={`t-caption-sm tabular-nums ${cell.keywordValidation.difficulty > 60 ? 'text-red-400' : cell.keywordValidation.difficulty > 35 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        KD {cell.keywordValidation.difficulty}
                      </span>
                    </div>
                  )}
                  {cell.clientFlag && <Flag className="w-3 h-3 text-amber-400" />}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Status legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {ALL_STATUSES.map(s => {
          const cfg = STATUS_CONFIG[s];
          return (
            <span key={s} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
              <span className={cfg.text}>{cfg.icon}</span> {cfg.label}
            </span>
          );
        })}
        <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
          <Flag className="w-2.5 h-2.5 text-amber-400" /> Flagged
        </span>
      </div>

      {/* Slide-out detail panel */}
      {detailCell && (
        <CellDetailPanel
          cell={detailCell}
          onClose={() => setDetailCellId(null)}
          onCellUpdate={onCellUpdate}
          onGenerateBrief={id => onBulkAction('generate_briefs', [id])}
          onSendReview={id => onBulkAction('send_review', [id])}
        />
      )}
    </div>
  );
}
