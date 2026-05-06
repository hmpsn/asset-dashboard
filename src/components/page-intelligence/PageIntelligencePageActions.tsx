import { ArrowUpRight, BookOpen, Code2, Pencil } from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { Icon } from '../ui';
import type { KeywordData } from './pageIntelligenceTypes';

interface Props {
  page: UnifiedPage;
  analysis?: KeywordData;
  hasSchemaIssue: boolean;
  onOpenSeoEditor: (page: UnifiedPage) => void;
  onCreateBrief: (page: UnifiedPage, analysis?: KeywordData) => void;
  onAddSchema: (page: UnifiedPage) => void;
  onViewFullAnalysis: () => void;
}

export function PageIntelligencePageActions({
  page,
  analysis,
  hasSchemaIssue,
  onOpenSeoEditor,
  onCreateBrief,
  onAddSchema,
  onViewFullAnalysis,
}: Props) {
  return (
    <div className="flex items-center gap-2 pt-3 mt-1 border-t border-[var(--brand-border)]/60 flex-wrap">
      <button
        onClick={() => onOpenSeoEditor(page)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
      >
        <Icon as={Pencil} size="sm" /> Fix in SEO Editor
      </button>
      <button
        onClick={() => onCreateBrief(page, analysis)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
      >
        <Icon as={BookOpen} size="sm" /> Create Brief
      </button>
      {hasSchemaIssue && (
        <button
          onClick={() => onAddSchema(page)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
        >
          <Icon as={Code2} size="sm" /> Add Schema
        </button>
      )}
      <div className="flex-1" />
      <button
        onClick={onViewFullAnalysis}
        className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-dim)] hover:text-[var(--brand-text)] transition-colors"
      >
        View full analysis <Icon as={ArrowUpRight} size="sm" />
      </button>
    </div>
  );
}
