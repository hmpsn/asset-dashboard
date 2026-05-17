import { useState } from 'react';
import {
  X, ExternalLink, FileText, PenTool, Flag, Check,
  Search, ArrowRight, ChevronRight, Clock,
} from 'lucide-react';
import { Badge, Button, FormTextarea, IconButton } from '../ui';
import { TrendBadge } from '../ui/TrendBadge';
import type { MatrixCell } from './types';
import { timeAgo } from '../../lib/timeAgo';

interface CellDetailPanelProps {
  cell: MatrixCell;
  onClose: () => void;
  onCellUpdate: (cellId: string, updates: Partial<MatrixCell>) => void;
  onGenerateBrief?: (cellId: string) => void;
  onSendReview?: (cellId: string) => void;
  onFlag?: (cellId: string, comment: string) => void;
}

const STATUS_CONFIG: Record<MatrixCell['status'], { label: string; color: 'zinc' | 'blue' | 'amber' | 'teal' | 'orange' | 'emerald'; icon: string }> = {
  planned: { label: 'Planned', color: 'zinc', icon: '○' },
  keyword_validated: { label: 'Keyword Optimized', color: 'blue', icon: '◐' },
  brief_generated: { label: 'Brief Generated', color: 'amber', icon: '◑' },
  review: { label: 'Client Review', color: 'blue', icon: '◑' },
  flagged: { label: 'Client Flagged', color: 'amber', icon: '!' },
  approved: { label: 'Approved', color: 'teal', icon: '✓' },
  draft: { label: 'Draft', color: 'orange', icon: '◐' },
  published: { label: 'Published', color: 'emerald', icon: '●' },
};

// Map status color name to actual hex for the timeline dot
const STATUS_DOT_COLOR: Record<string, string> = {
  emerald: '#34d399',
  teal: '#2dd4bf',
  amber: '#fbbf24',
  blue: '#60a5fa',
  orange: '#fb923c',
  zinc: '#71717a',
};

export function CellDetailPanel({
  cell,
  onClose,
  onCellUpdate,
  onGenerateBrief,
  onSendReview,
  onFlag,
}: CellDetailPanelProps) {
  const [flagComment, setFlagComment] = useState('');
  const [showFlagForm, setShowFlagForm] = useState(false);

  const statusCfg = STATUS_CONFIG[cell.status];
  const varEntries = Object.entries(cell.variableValues);
  const cellTitle = varEntries.map(([, v]) => v).join(' in ');
  const keyword = cell.customKeyword ?? cell.targetKeyword;

  const handleAcceptRecommendation = () => {
    if (cell.recommendedKeyword) {
      onCellUpdate(cell.id, { customKeyword: cell.recommendedKeyword });
    }
  };

  const handleFlag = () => {
    if (flagComment.trim() && onFlag) {
      onFlag(cell.id, flagComment.trim());
      setFlagComment('');
      setShowFlagForm(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-[var(--surface-2)] border-l border-[var(--brand-border)] shadow-2xl z-[var(--z-modal)] flex flex-col animate-[slideInRight_0.2s_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <IconButton
            onClick={onClose}
            icon={X}
            label="Close details panel"
            size="sm"
            className="rounded-[var(--radius-lg)] hover:bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]"
          />
          <span className="text-sm font-semibold text-[var(--brand-text-bright)] truncate">{cellTitle}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--brand-text-muted)]">Status:</span>
          <Badge label={`${statusCfg.icon} ${statusCfg.label}`} tone={statusCfg.color} />
        </div>

        {/* URL */}
        <div>
          <span className="t-caption text-[var(--brand-text-muted)] font-medium">URL</span>
          <p className="text-xs text-[var(--brand-text-bright)] font-mono mt-0.5">{cell.plannedUrl}</p>
        </div>

        {/* Variables */}
        <div>
          <span className="t-caption text-[var(--brand-text-muted)] font-medium">Variables</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {varEntries.map(([key, value]) => (
              <span key={key} className="t-caption px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text-bright)]">
                <span className="text-[var(--brand-text-muted)]">{key}:</span> {value}
              </span>
            ))}
          </div>
        </div>

        {/* Keyword section */}
        <div className="pt-2 border-t border-[var(--brand-border)] space-y-2">
          <div className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-[var(--brand-text-muted)]" />
            <span className="t-caption text-[var(--brand-text-muted)] font-semibold uppercase tracking-wider">Keyword</span>
          </div>
          <div>
            <span className="t-caption text-[var(--brand-text-muted)]">Target</span>
            <p className="text-xs font-medium text-[var(--brand-text-bright)]">&ldquo;{keyword}&rdquo;</p>
          </div>

          {cell.keywordValidation && (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-2.5 py-2 text-center">
                <p className="text-sm font-bold text-[var(--brand-text-bright)] tabular-nums">{cell.keywordValidation.volume}<span className="t-caption-sm text-[var(--brand-text-muted)] font-normal">/mo</span></p>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">Volume</p>
              </div>
              <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-2.5 py-2 text-center">
                <p className={`text-sm font-bold tabular-nums ${cell.keywordValidation.difficulty > 60 ? 'text-red-400' : cell.keywordValidation.difficulty > 35 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {cell.keywordValidation.difficulty}<span className="t-caption-sm text-[var(--brand-text-muted)] font-normal">/100</span>
                </p>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">Difficulty</p>
              </div>
              <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-2.5 py-2 text-center">
                <p className="text-sm font-bold text-[var(--brand-text-bright)] tabular-nums">${cell.keywordValidation.cpc}</p>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">CPC</p>
              </div>
            </div>
          )}

          {cell.recommendedKeyword && cell.recommendedKeyword !== keyword && (
            <div className="bg-teal-500/5 border border-teal-500/20 rounded-[var(--radius-lg)] p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <TrendBadge value={1} iconOnly hideOnZero={false} size="sm" className="text-teal-400" />
                <span className="t-caption text-teal-400 font-medium">Recommended</span>
              </div>
              <p className="text-xs text-[var(--brand-text-bright)]">&ldquo;{cell.recommendedKeyword}&rdquo;</p>
              {cell.keywordCandidates && (() => {
                const rec = cell.keywordCandidates.find(c => c.isRecommended);
                return rec ? (
                  <p className="t-caption-sm text-[var(--brand-text)]">{rec.volume}/mo &middot; KD {rec.difficulty} &middot; ${rec.cpc}</p>
                ) : null;
              })()}
              <Button
                onClick={handleAcceptRecommendation}
                icon={Check}
                size="sm"
                variant="secondary"
                className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption text-teal-300 hover:bg-teal-600/30 font-medium"
              >
                Accept Recommendation
              </Button>
            </div>
          )}

          {/* All candidates */}
          {cell.keywordCandidates && cell.keywordCandidates.length > 0 && (
            <div className="space-y-1">
              <span className="t-caption text-[var(--brand-text-muted)] font-medium">All Candidates</span>
              {cell.keywordCandidates.map((c, i) => (
                <div key={i} className={`flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-lg)] text-xs ${c.isRecommended ? 'bg-teal-500/5 border border-teal-500/15' : 'bg-[var(--surface-1)]'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    {c.isRecommended && <TrendBadge value={1} suffix="" hideOnZero={false} size="sm" className="text-teal-400 flex-shrink-0" />}
                    <span className={`truncate ${c.isRecommended ? 'text-teal-300' : 'text-[var(--brand-text-bright)]'}`}>{c.keyword}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 t-caption-sm text-[var(--brand-text-muted)]">
                    <span>{c.volume}/mo</span>
                    <span>KD {c.difficulty}</span>
                    <Badge label={c.source === 'pattern' ? 'Pattern' : c.source === 'semrush_related' ? 'SEMRush' : 'AI'} tone={c.source === 'pattern' ? 'zinc' : c.source === 'semrush_related' ? 'blue' : 'teal'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expected Schema Types */}
        {cell.expectedSchemaTypes && cell.expectedSchemaTypes.length > 0 && (
          <div className="pt-2 border-t border-[var(--brand-border)] space-y-2">
            <span className="t-caption text-[var(--brand-text-muted)] font-medium">Expected Schema</span>
            <div className="flex items-center gap-1 flex-wrap">
              {cell.expectedSchemaTypes.map(t => (
                <Badge key={t} label={t} tone="blue" />
              ))}
            </div>
          </div>
        )}

        {/* Content section */}
        <div className="pt-2 border-t border-[var(--brand-border)] space-y-2">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-[var(--brand-text-muted)]" />
            <span className="t-caption text-[var(--brand-text-muted)] font-semibold uppercase tracking-wider">Content</span>
          </div>

          {cell.briefId ? (
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-between px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-1)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] text-xs text-[var(--brand-text-bright)]"
            >
              <span className="flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-amber-400" /> View Brief
              </span>
              <ChevronRight className="w-3 h-3 text-[var(--brand-text-muted)]" />
            </Button>
          ) : (
            <p className="t-caption text-[var(--brand-text-muted)]">No brief generated yet</p>
          )}

          {cell.postId ? (
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-between px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-1)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] text-xs text-[var(--brand-text-bright)]"
            >
              <span className="flex items-center gap-1.5">
                <PenTool className="w-3 h-3 text-emerald-400" /> View Post
              </span>
              <ChevronRight className="w-3 h-3 text-[var(--brand-text-muted)]" />
            </Button>
          ) : (
            <p className="t-caption text-[var(--brand-text-muted)]">No post created yet</p>
          )}
        </div>

        {/* Status Timeline */}
        {cell.statusHistory && cell.statusHistory.length > 0 && (
          <div className="pt-2 border-t border-[var(--brand-border)] space-y-2">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[var(--brand-text-muted)]" />
              <span className="t-caption text-[var(--brand-text-muted)] font-semibold uppercase tracking-wider">Timeline</span>
            </div>
            <div className="relative pl-3">
              <div className="absolute left-[5px] top-1 bottom-1 w-px bg-[var(--brand-border)]" />
              {[...cell.statusHistory].reverse().map((entry, i) => {
                const toCfg = STATUS_CONFIG[entry.to];
                const dotColor = toCfg ? STATUS_DOT_COLOR[toCfg.color] ?? '#71717a' : '#71717a';
                return (
                  <div key={i} className="relative flex items-start gap-2.5 pb-2.5 last:pb-0">
                    <div className="w-2 h-2 rounded-[var(--radius-pill)] mt-1 flex-shrink-0 -ml-[3.5px] ring-2 ring-[var(--surface-2)]" style={{ backgroundColor: dotColor }} />
                    <div className="min-w-0">
                      <span className="t-caption text-[var(--brand-text-bright)] font-medium">{toCfg?.label || entry.to}</span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">{timeAgo(entry.at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 border-t border-[var(--brand-border)] space-y-2">
          <div className="flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5 text-[var(--brand-text-muted)]" />
            <span className="t-caption text-[var(--brand-text-muted)] font-semibold uppercase tracking-wider">Actions</span>
          </div>

          {onGenerateBrief && !cell.briefId && (
            <Button
              variant="primary"
              size="sm"
              icon={FileText}
              onClick={() => onGenerateBrief(cell.id)}
              className="w-full"
            >
              Generate Brief
            </Button>
          )}

          {onSendReview && cell.briefId && cell.status !== 'review' && cell.status !== 'published' && (
            <Button
              onClick={() => onSendReview(cell.id)}
              icon={ExternalLink}
              size="sm"
              variant="secondary"
              className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 text-xs text-teal-300 hover:bg-teal-600/30 font-medium"
            >
              Send to client
            </Button>
          )}

          {onFlag && (showFlagForm ? (
            <div className="space-y-2">
              <FormTextarea
                value={flagComment}
                onChange={setFlagComment}
                placeholder="Describe what needs to change..."
                rows={2}
                className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] resize-none focus:border-teal-500/40 focus:outline-none transition-colors"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleFlag}
                  disabled={!flagComment.trim()}
                  size="sm"
                  variant="secondary"
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-amber-600/20 border border-amber-500/30 t-caption text-amber-300 hover:bg-amber-600/30 font-medium disabled:opacity-50"
                >
                  Submit Flag
                </Button>
                <Button
                  onClick={() => { setShowFlagForm(false); setFlagComment(''); }}
                  size="sm"
                  variant="ghost"
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-transparent"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={() => setShowFlagForm(true)}
              icon={Flag}
              size="sm"
              variant="secondary"
              className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-[var(--brand-border-hover)] text-xs text-[var(--brand-text)] hover:text-amber-400 hover:border-amber-500/30"
            >
              Flag for Changes
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
