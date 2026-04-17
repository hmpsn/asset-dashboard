import { useState } from 'react';
import {
  X, ExternalLink, FileText, PenTool, Flag, Check,
  TrendingUp, Search, ArrowRight, ChevronRight, Clock,
} from 'lucide-react';
import { Badge } from '../ui';
import { themeColor } from '../ui/constants';
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

const STATUS_CONFIG: Record<MatrixCell['status'], { label: string; color: 'zinc' | 'blue' | 'amber' | 'purple' | 'teal' | 'orange' | 'green'; icon: string }> = {
  planned: { label: 'Planned', color: 'zinc', icon: '\u25CB' },
  keyword_validated: { label: 'Keyword Optimized', color: 'blue', icon: '\u25D0' },
  brief_generated: { label: 'Brief Generated', color: 'amber', icon: '\u25D1' },
  review: { label: 'Client Review', color: 'blue', icon: '\u25D1' },
  approved: { label: 'Approved', color: 'teal', icon: '\u2713' },
  draft: { label: 'Draft', color: 'orange', icon: '\u25D0' },
  published: { label: 'Published', color: 'green', icon: '\u25CF' },
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
    <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-zinc-900 border-l border-zinc-800 shadow-2xl z-50 flex flex-col animate-[slideInRight_0.2s_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-zinc-200 truncate">{cellTitle}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Status:</span>
          <Badge label={`${statusCfg.icon} ${statusCfg.label}`} color={statusCfg.color} />
        </div>

        {/* URL */}
        <div>
          <span className="text-[11px] text-zinc-500 font-medium">URL</span>
          <p className="text-xs text-zinc-300 font-mono mt-0.5">{cell.plannedUrl}</p>
        </div>

        {/* Variables */}
        <div>
          <span className="text-[11px] text-zinc-500 font-medium">Variables</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {varEntries.map(([key, value]) => (
              <span key={key} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                <span className="text-zinc-500">{key}:</span> {value}
              </span>
            ))}
          </div>
        </div>

        {/* Keyword section */}
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          <div className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">Keyword</span>
          </div>
          <div>
            <span className="text-[11px] text-zinc-500">Target</span>
            <p className="text-xs font-medium text-zinc-200">&ldquo;{keyword}&rdquo;</p>
          </div>

          {cell.keywordValidation && (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-zinc-950 rounded-lg px-2.5 py-2 text-center">
                <p className="text-sm font-bold text-zinc-200 tabular-nums">{cell.keywordValidation.volume}<span className="text-[10px] text-zinc-500 font-normal">/mo</span></p>
                <p className="text-[10px] text-zinc-500">Volume</p>
              </div>
              <div className="bg-zinc-950 rounded-lg px-2.5 py-2 text-center">
                <p className={`text-sm font-bold tabular-nums ${cell.keywordValidation.difficulty > 60 ? 'text-red-400' : cell.keywordValidation.difficulty > 35 ? 'text-amber-400' : 'text-green-400'}`}>
                  {cell.keywordValidation.difficulty}<span className="text-[10px] text-zinc-500 font-normal">/100</span>
                </p>
                <p className="text-[10px] text-zinc-500">Difficulty</p>
              </div>
              <div className="bg-zinc-950 rounded-lg px-2.5 py-2 text-center">
                <p className="text-sm font-bold text-zinc-200 tabular-nums">${cell.keywordValidation.cpc}</p>
                <p className="text-[10px] text-zinc-500">CPC</p>
              </div>
            </div>
          )}

          {cell.recommendedKeyword && cell.recommendedKeyword !== keyword && (
            <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3 text-teal-400" />
                <span className="text-[11px] text-teal-400 font-medium">Recommended</span>
              </div>
              <p className="text-xs text-zinc-200">&ldquo;{cell.recommendedKeyword}&rdquo;</p>
              {cell.keywordCandidates && (() => {
                const rec = cell.keywordCandidates.find(c => c.isRecommended);
                return rec ? (
                  <p className="text-[10px] text-zinc-400">{rec.volume}/mo &middot; KD {rec.difficulty} &middot; ${rec.cpc}</p>
                ) : null;
              })()}
              <button
                onClick={handleAcceptRecommendation}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors font-medium"
              >
                <Check className="w-3 h-3" /> Accept Recommendation
              </button>
            </div>
          )}

          {/* All candidates */}
          {cell.keywordCandidates && cell.keywordCandidates.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] text-zinc-500 font-medium">All Candidates</span>
              {cell.keywordCandidates.map((c, i) => (
                <div key={i} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs ${c.isRecommended ? 'bg-teal-500/5 border border-teal-500/15' : 'bg-zinc-950'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    {c.isRecommended && <TrendingUp className="w-3 h-3 text-teal-400 flex-shrink-0" />}
                    <span className={`truncate ${c.isRecommended ? 'text-teal-300' : 'text-zinc-300'}`}>{c.keyword}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-zinc-500">
                    <span>{c.volume}/mo</span>
                    <span>KD {c.difficulty}</span>
                    <Badge label={c.source === 'pattern' ? 'Pattern' : c.source === 'semrush_related' ? 'SEMRush' : 'AI'} color={c.source === 'pattern' ? 'zinc' : c.source === 'semrush_related' ? 'blue' : 'teal'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expected Schema Types */}
        {cell.expectedSchemaTypes && cell.expectedSchemaTypes.length > 0 && (
          <div className="pt-2 border-t border-zinc-800 space-y-2">
            <span className="text-[11px] text-zinc-500 font-medium">Expected Schema</span>
            <div className="flex items-center gap-1 flex-wrap">
              {cell.expectedSchemaTypes.map(t => (
                <Badge key={t} label={t} color="purple" />
              ))}
            </div>
          </div>
        )}

        {/* Content section */}
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">Content</span>
          </div>

          {cell.briefId ? (
            <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-colors text-xs text-zinc-300">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-amber-400" /> View Brief
              </span>
              <ChevronRight className="w-3 h-3 text-zinc-500" />
            </button>
          ) : (
            <p className="text-[11px] text-zinc-500">No brief generated yet</p>
          )}

          {cell.postId ? (
            <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-colors text-xs text-zinc-300">
              <span className="flex items-center gap-1.5">
                <PenTool className="w-3 h-3 text-green-400" /> View Post
              </span>
              <ChevronRight className="w-3 h-3 text-zinc-500" />
            </button>
          ) : (
            <p className="text-[11px] text-zinc-500">No post created yet</p>
          )}
        </div>

        {/* Status Timeline */}
        {cell.statusHistory && cell.statusHistory.length > 0 && (
          <div className="pt-2 border-t border-zinc-800 space-y-2">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">Timeline</span>
            </div>
            <div className="relative pl-3">
              <div className="absolute left-[5px] top-1 bottom-1 w-px bg-zinc-800" />
              {[...cell.statusHistory].reverse().map((entry, i) => {
                const toCfg = STATUS_CONFIG[entry.to];
                return (
                  <div key={i} className="relative flex items-start gap-2.5 pb-2.5 last:pb-0">
                    <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 -ml-[3.5px] ring-2 ring-zinc-900 ${toCfg ? `bg-${toCfg.color}-400` : 'bg-zinc-500'}`} style={{ backgroundColor: toCfg?.color === 'green' ? '#4ade80' : toCfg?.color === 'teal' ? '#2dd4bf' : toCfg?.color === 'amber' ? '#fbbf24' : toCfg?.color === 'blue' ? '#60a5fa' : toCfg?.color === 'orange' ? '#fb923c' : toCfg?.color === 'purple' ? '#a78bfa' : themeColor('#71717a', '#94a3b8') }} />
                    <div className="min-w-0">
                      <span className="text-[11px] text-zinc-300 font-medium">{toCfg?.label || entry.to}</span>
                      <span className="text-[10px] text-zinc-600 ml-1.5">{timeAgo(entry.at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          <div className="flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">Actions</span>
          </div>

          {onGenerateBrief && !cell.briefId && (
            <button
              onClick={() => onGenerateBrief(cell.id)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-xs text-white font-medium hover:from-teal-500 hover:to-emerald-500 transition-colors"
            >
              <FileText className="w-3 h-3" /> Generate Brief
            </button>
          )}

          {onSendReview && cell.briefId && cell.status !== 'review' && cell.status !== 'published' && (
            <button
              onClick={() => onSendReview(cell.id)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600/20 border border-teal-500/30 text-xs text-teal-300 hover:bg-teal-600/30 transition-colors font-medium"
            >
              <ExternalLink className="w-3 h-3" /> Send for Review
            </button>
          )}

          {onFlag && (showFlagForm ? (
            <div className="space-y-2">
              <textarea
                value={flagComment}
                onChange={e => setFlagComment(e.target.value)}
                placeholder="Describe what needs to change..."
                rows={2}
                className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none focus:border-amber-500/40 focus:outline-none transition-colors"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleFlag}
                  disabled={!flagComment.trim()}
                  className="px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-[11px] text-amber-300 hover:bg-amber-600/30 transition-colors font-medium disabled:opacity-50"
                >
                  Submit Flag
                </button>
                <button
                  onClick={() => { setShowFlagForm(false); setFlagComment(''); }}
                  className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowFlagForm(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-amber-400 hover:border-amber-500/30 transition-colors"
            >
              <Flag className="w-3 h-3" /> Flag for Changes
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
