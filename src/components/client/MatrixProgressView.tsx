import { useState } from 'react';
import {
  Download, FileDown, Flag, Eye, X, CheckCircle2,
  Clock, FileText, PenTool,
} from 'lucide-react';
import { SectionCard, Badge, PageHeader } from '../ui';
import { Icon } from '../ui/Icon';
import type { ContentMatrix, MatrixCell } from '../matrix/types';

interface MatrixProgressViewProps {
  workspaceId: string;
  matrix: ContentMatrix;
  onCellPreview: (cell: MatrixCell) => void;
  onFlagCell: (cellId: string, comment: string) => void;
  onDownload: (format: 'docx' | 'pdf') => void;
}

const STATUS_DISPLAY: Record<MatrixCell['status'], { label: string; icon: typeof CheckCircle2; color: string; badgeColor: 'zinc' | 'blue' | 'amber' | 'teal' | 'orange' | 'emerald' }> = {
  planned:           { label: 'Planned',       icon: Clock,        color: 'text-[var(--brand-text-muted)]',   badgeColor: 'zinc' },
  keyword_validated:  { label: 'In Progress',   icon: Clock,        color: 'text-blue-400',   badgeColor: 'blue' },
  brief_generated:   { label: 'Brief Ready',   icon: FileText,     color: 'text-amber-400',  badgeColor: 'amber' },
  review:            { label: 'Your Review',   icon: Eye,          color: 'text-blue-400',   badgeColor: 'blue' },
  approved:          { label: 'Approved',       icon: CheckCircle2, color: 'text-teal-400',   badgeColor: 'teal' },
  draft:             { label: 'In Production',  icon: PenTool,      color: 'text-orange-400', badgeColor: 'orange' },
  published:         { label: 'Published',      icon: CheckCircle2, color: 'text-emerald-400',  badgeColor: 'emerald' },
};

function CellPreviewModal({ cell, onClose, onFlag }: { cell: MatrixCell; onClose: () => void; onFlag: (comment: string) => void }) {
  const [flagComment, setFlagComment] = useState('');
  const [showFlagForm, setShowFlagForm] = useState(false);
  const cfg = STATUS_DISPLAY[cell.status];
  const StatusIcon = cfg.icon;
  const title = Object.values(cell.variableValues).join(' — ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-2xl shadow-2xl max-w-md w-full mx-4 animate-[scaleIn_0.2s_ease-out]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--brand-border)]">
          <span className="text-sm font-semibold text-[var(--brand-text-bright)]">{title}</span>
          <button onClick={onClose} className="p-1 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
            <Icon as={X} size="md" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-4 h-4 ${cfg.color}`} />
            <Badge label={cfg.label} color={cfg.badgeColor} />
          </div>

          <div>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">URL</span>
            <p className="t-caption text-[var(--brand-text-bright)] font-mono mt-0.5">{cell.plannedUrl}</p>
          </div>

          <div>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Target Keyword</span>
            <p className="t-caption text-[var(--brand-text-bright)] mt-0.5">{cell.customKeyword ?? cell.targetKeyword}</p>
          </div>

          {cell.clientFlag && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-[var(--radius-md)] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon as={Flag} size="sm" className="text-amber-400" />
                <span className="t-caption text-amber-400 font-medium">Flagged</span>
              </div>
              <p className="t-caption text-[var(--brand-text-bright)]">{cell.clientFlag}</p>
            </div>
          )}

          {showFlagForm ? (
            <div className="space-y-2">
              <textarea
                value={flagComment}
                onChange={e => setFlagComment(e.target.value)}
                placeholder="Describe what needs to change..."
                rows={2}
                className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-md)] t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-dim)] resize-none focus:border-amber-500/40 focus:outline-none transition-colors"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { if (flagComment.trim()) { onFlag(flagComment.trim()); setFlagComment(''); setShowFlagForm(false); } }}
                  disabled={!flagComment.trim()}
                  className="px-3 py-1.5 rounded-[var(--radius-md)] bg-amber-600/20 border border-amber-500/30 t-caption text-amber-300 hover:bg-amber-600/30 transition-colors font-medium disabled:opacity-50"
                >
                  Submit Flag
                </button>
                <button
                  onClick={() => { setShowFlagForm(false); setFlagComment(''); }}
                  className="px-3 py-1.5 rounded-[var(--radius-md)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowFlagForm(true)}
              className="flex items-center gap-1.5 t-caption text-[var(--brand-text)] hover:text-amber-400 transition-colors"
            >
              <Icon as={Flag} size="sm" /> Flag for changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MatrixProgressView({ matrix, onCellPreview, onFlagCell, onDownload }: MatrixProgressViewProps) {
  const [previewCell, setPreviewCell] = useState<MatrixCell | null>(null);

  const completedCount = matrix.cells.filter(c => ['approved', 'draft', 'published'].includes(c.status)).length;
  const publishedCount = matrix.cells.filter(c => c.status === 'published').length;
  const reviewCount = matrix.cells.filter(c => c.status === 'review').length;
  const progressPercent = matrix.cells.length > 0 ? Math.round((completedCount / matrix.cells.length) * 100) : 0;

  const dim0 = matrix.dimensions[0];
  const dim1 = matrix.dimensions.length > 1 ? matrix.dimensions[1] : null;

  const getCellForGrid = (rowVal: string, colVal: string): MatrixCell | undefined => {
    if (!dim0 || !dim1) return undefined;
    return matrix.cells.find(c =>
      c.variableValues[dim0.variableName] === rowVal && c.variableValues[dim1.variableName] === colVal
    );
  };

  const handleCellClick = (cell: MatrixCell) => {
    setPreviewCell(cell);
    onCellPreview(cell);
  };

  const handleFlag = (comment: string) => {
    if (previewCell) {
      onFlagCell(previewCell.id, comment);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader
          title={matrix.name}
          subtitle={`${matrix.stats.total} pages · ${publishedCount} published`}
          icon={<Icon as={FileText} size="lg" className="text-teal-400" />}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDownload('docx')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--brand-border)] t-caption text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)] transition-colors"
          >
            <Icon as={FileDown} size="sm" /> Word Doc
          </button>
          <button
            onClick={() => onDownload('pdf')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--brand-border)] t-caption text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)] transition-colors"
          >
            <Icon as={Download} size="sm" /> PDF
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4" style={{ borderRadius: 'var(--radius-signature)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="t-caption font-medium text-[var(--brand-text-bright)]">Overall Progress</span>
          <span className="t-caption text-[var(--brand-text)]">{progressPercent}%</span>
        </div>
        <div className="w-full h-3 bg-[var(--surface-3)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          <span className="t-caption-sm text-[var(--brand-text-muted)]">{matrix.stats.planned} planned</span>
          <span className="t-caption-sm text-amber-400">{matrix.stats.briefGenerated} briefs</span>
          {reviewCount > 0 && <span className="t-caption-sm text-blue-400">{reviewCount} awaiting review</span>}
          <span className="t-caption-sm text-orange-400">{matrix.stats.drafted} drafts</span>
          <span className="t-caption-sm text-emerald-400">{publishedCount} published</span>
        </div>
      </div>

      {/* Review alert */}
      {reviewCount > 0 && (
        <div className="bg-gradient-to-r from-teal-600/15 to-teal-600/5 border border-teal-500/30 px-5 py-3 flex items-center gap-3" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="w-8 h-8 rounded-[var(--radius-md)] bg-teal-500/20 flex items-center justify-center flex-shrink-0">
            <Icon as={Eye} size="md" className="text-teal-400" />
          </div>
          <div>
            <p className="t-caption font-semibold text-teal-200">{reviewCount} page{reviewCount !== 1 ? 's' : ''} ready for your review</p>
            <p className="t-caption-sm text-teal-400/60 mt-0.5">Click on a cell below to preview and approve</p>
          </div>
        </div>
      )}

      {/* Grid */}
      {dim1 ? (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="px-3 py-2 t-caption font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider border-b border-[var(--brand-border)] bg-[var(--surface-1)] sticky left-0 z-10">
                    {dim0.label ?? dim0.variableName}
                  </th>
                  {dim1.values.map(col => (
                    <th key={col} className="px-3 py-2 t-caption font-semibold text-[var(--brand-text-bright)] border-b border-[var(--brand-border)] bg-[var(--surface-1)] text-center min-w-[100px]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dim0.values.map(row => (
                  <tr key={row}>
                    <td className="px-3 py-2 t-caption font-medium text-[var(--brand-text-bright)] border-b border-[var(--brand-border)] bg-[var(--surface-1)] sticky left-0 z-10 whitespace-nowrap">
                      {row}
                    </td>
                    {dim1.values.map(col => {
                      const cell = getCellForGrid(row, col);
                      if (!cell) return <td key={col} className="p-2 border border-[var(--brand-border)]"><div className="h-10" /></td>;
                      const cfg = STATUS_DISPLAY[cell.status];
                      const CellIcon = cfg.icon;
                      const pageName = Object.values(cell.variableValues).join(' — ');
                      return (
                        <td
                          key={cell.id}
                          className={`p-0 border border-[var(--brand-border)] cursor-pointer hover:bg-[var(--surface-3)]/40 transition-colors ${cell.clientFlag ? 'border-amber-500/30' : ''}`}
                          onClick={() => handleCellClick(cell)}
                        >
                          <div className="px-2.5 py-2 flex items-center gap-1.5">
                            <CellIcon className={`w-3 h-3 flex-shrink-0 ${cfg.color}`} />
                            <span className="t-caption text-[var(--brand-text-bright)] truncate">{pageName}</span>
                            {cell.clientFlag && <Icon as={Flag} size="xs" className="text-amber-400 flex-shrink-0" />}
                          </div>
                        </td>
                      );
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
            {matrix.cells.map(cell => {
              const cfg = STATUS_DISPLAY[cell.status];
              const RowIcon = cfg.icon;
              const pageName = Object.values(cell.variableValues).join(' — ');
              return (
                <div
                  key={cell.id}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--surface-3)]/40 transition-colors ${cell.clientFlag ? 'border-l-2 border-l-amber-500/50' : ''}`}
                  onClick={() => handleCellClick(cell)}
                >
                  <RowIcon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.color}`} />
                  <span className="t-caption text-[var(--brand-text-bright)] flex-1 truncate">{pageName}</span>
                  <Badge label={cfg.label} color={cfg.badgeColor} />
                  {cell.clientFlag && <Icon as={Flag} size="sm" className="text-amber-400 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Status legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {Object.entries(STATUS_DISPLAY).map(([status, cfg]) => {
          const LegendIcon = cfg.icon;
          return (
            <span key={status} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
              <LegendIcon className={`w-2.5 h-2.5 ${cfg.color}`} /> {cfg.label}
            </span>
          );
        })}
        <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
          <Icon as={Flag} size="xs" className="text-amber-400" /> Flagged
        </span>
      </div>

      {/* Preview modal */}
      {previewCell && (
        <CellPreviewModal
          cell={previewCell}
          onClose={() => setPreviewCell(null)}
          onFlag={handleFlag}
        />
      )}
    </div>
  );
}
