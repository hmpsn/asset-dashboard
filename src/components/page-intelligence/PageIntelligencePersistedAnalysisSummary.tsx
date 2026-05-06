import { Sparkles } from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { scoreColorClass } from '../ui';

interface Props {
  page: UnifiedPage;
  onAnalyzePage: (page: UnifiedPage) => void;
}

export function PageIntelligencePersistedAnalysisSummary({
  page,
  onAnalyzePage,
}: Props) {
  const sp = page.strategy;
  if (!sp?.analysisGeneratedAt) return null;

  return (
    <div className="pt-2 border-t border-[var(--brand-border)]">
      <div className="flex items-center justify-between">
        <span className="t-caption-sm text-accent-success">Analysis on file (run {new Date(sp.analysisGeneratedAt).toLocaleDateString()})</span>
        <button onClick={() => onAnalyzePage(page)}
          className="t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-brand flex items-center gap-1 transition-colors">
          <Sparkles className="w-2.5 h-2.5" /> Run fresh analysis
        </button>
      </div>
      {(sp.optimizationIssues?.length || sp.recommendations?.length || sp.contentGaps?.length) ? (
        <div className="mt-2 space-y-2">
          {sp.optimizationScore !== undefined && (
            <div className="flex items-center gap-2">
              <span className="t-caption-sm text-[var(--brand-text-muted)]">Score:</span>
              <span className={`t-body font-bold ${scoreColorClass(sp.optimizationScore)}`}>{sp.optimizationScore}</span>
            </div>
          )}
          {sp.optimizationIssues && sp.optimizationIssues.length > 0 && (
            <div className="t-caption-sm text-[var(--brand-text)]">
              <span className="text-accent-danger font-medium">{sp.optimizationIssues.length} issues</span> · {sp.optimizationIssues.slice(0, 2).join(' · ')}
              {sp.optimizationIssues.length > 2 && ` +${sp.optimizationIssues.length - 2} more`}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
