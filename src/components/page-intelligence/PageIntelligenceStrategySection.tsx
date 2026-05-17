import { BarChart3, Check, DollarSign, Pencil, Shield, X } from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { Button, FormInput, Icon, IconButton } from '../ui';
import { SeoCopyPanel } from '../strategy/SeoCopyPanel';
import { kdColor, kdLabel, positionColor } from './pageIntelligenceDisplay';
import type { KeywordEditDraft, SeoCopy } from './pageIntelligenceTypes';
import { PageIntelligenceTrackKeywordButton } from './PageIntelligenceTrackKeywordButton';

interface Props {
  page: UnifiedPage;
  isEditing: boolean;
  editDraft: KeywordEditDraft;
  saving: boolean;
  seoCopyResults: Map<string, SeoCopy>;
  generatingCopy: string | null;
  copiedField: string | null;
  trackedKeywords: Set<string>;
  onTrackKeyword: (keyword: string) => void;
  onStartEdit: (page: UnifiedPage) => void;
  onEditDraftChange: (draft: KeywordEditDraft) => void;
  onSaveEdit: (page: UnifiedPage) => void;
  onCancelEdit: () => void;
  onGenerateSeoCopy: (page: UnifiedPage) => void;
  onCopyText: (text: string, label: string) => void;
}

export function PageIntelligenceStrategySection({
  page,
  isEditing,
  editDraft,
  saving,
  seoCopyResults,
  generatingCopy,
  copiedField,
  trackedKeywords,
  onTrackKeyword,
  onStartEdit,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  onGenerateSeoCopy,
  onCopyText,
}: Props) {
  const sp = page.strategy;
  if (!sp) return null;

  if (isEditing) {
    return (
      <div className="space-y-2">
        <div>
          <label className="t-label text-[var(--brand-text-muted)] block mb-1">Primary Keyword</label>
          <FormInput
            type="text"
            value={editDraft.primary}
            onChange={value => onEditDraftChange({ ...editDraft, primary: value })}
            className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
          />
        </div>
        <div>
          <label className="t-label text-[var(--brand-text-muted)] block mb-1">Secondary Keywords (comma-separated)</label>
          <FormInput
            type="text"
            value={editDraft.secondary}
            onChange={value => onEditDraftChange({ ...editDraft, secondary: value })}
            className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" icon={Check} loading={saving} disabled={saving} onClick={() => onSaveEdit(page)}>
            Save
          </Button>
          <Button variant="secondary" size="sm" icon={X} onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="t-label text-[var(--brand-text-muted)]">Primary Keyword</span>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="t-caption text-[var(--brand-text-bright)]">{sp.primaryKeyword}</p>
            <PageIntelligenceTrackKeywordButton
              keyword={sp.primaryKeyword}
              trackedKeywords={trackedKeywords}
              onTrackKeyword={onTrackKeyword}
            />
          </div>
        </div>
        <IconButton
          icon={Pencil}
          label="Edit keywords"
          size="sm"
          onClick={() => onStartEdit(page)}
          title="Edit keywords"
          className="text-[var(--brand-text-muted)] hover:text-accent-brand"
        />
      </div>
      <div>
        <span className="t-label text-[var(--brand-text-muted)]">Secondary Keywords</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {sp.secondaryKeywords.map((keyword, index) => (
            <span key={index} className="px-1.5 py-0.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption-sm text-[var(--brand-text)]">{keyword}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mt-1">
        {sp.volume != null && sp.volume > 0 && (
          <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
            <Icon as={BarChart3} size="sm" className="text-accent-orange" />
            <span className="text-[var(--brand-text-bright)] font-medium">{sp.volume.toLocaleString()}</span>/mo
          </div>
        )}
        {sp.difficulty != null && sp.difficulty > 0 && (
          <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
            <Icon as={Shield} size="sm" />
            KD: <span className={`font-medium ${kdColor(sp.difficulty)}`}>{sp.difficulty}%</span>
            <span className={kdColor(sp.difficulty)}>({kdLabel(sp.difficulty)})</span>
          </div>
        )}
        {sp.cpc !== undefined && sp.cpc > 0 && (
          <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
            <Icon as={DollarSign} size="sm" className="text-accent-success" />
            CPC: <span className="text-accent-success font-medium">${sp.cpc.toFixed(2)}</span>
          </div>
        )}
        {sp.impressions !== undefined && (
          <span className="t-caption-sm text-[var(--brand-text-muted)]"><span className="text-[var(--brand-text)] font-medium">{sp.impressions.toLocaleString()}</span> impressions</span>
        )}
        {sp.clicks !== undefined && (
          <span className="t-caption-sm text-[var(--brand-text-muted)]"><span className="text-[var(--brand-text)] font-medium">{sp.clicks.toLocaleString()}</span> clicks</span>
        )}
        {sp.currentPosition && (
          <span className="t-caption-sm text-[var(--brand-text-muted)]">Avg position: <span className={`font-medium ${positionColor(sp.currentPosition)}`}>#{sp.currentPosition.toFixed(1)}</span></span>
        )}
      </div>
      {sp.secondaryMetrics && sp.secondaryMetrics.length > 0 && (
        <div className="mt-1">
          <span className="t-label text-[var(--brand-text-muted)]">Secondary keyword data</span>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {sp.secondaryMetrics.filter(metric => metric.volume > 0 || metric.difficulty > 0).map((metric, index) => (
              <span key={index} className="t-caption-sm px-1.5 py-0.5 bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 rounded text-[var(--brand-text-muted)]">
                {metric.keyword} {metric.volume > 0 && <span className="text-[var(--brand-text)]">{metric.volume}/mo</span>} {metric.difficulty > 0 && <span className={kdColor(metric.difficulty)}>KD {metric.difficulty}%</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      <SeoCopyPanel
        page={sp}
        seoCopyResults={seoCopyResults}
        generatingCopy={generatingCopy}
        copiedField={copiedField}
        onGenerateSeoCopy={() => onGenerateSeoCopy(page)}
        onCopyText={onCopyText}
      />
    </div>
  );
}
