import { ArrowUpRight, BookOpen, Code2, Pencil } from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { Button } from '../ui';
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
      <Button
        onClick={() => onOpenSeoEditor(page)}
        icon={Pencil}
        size="sm"
        variant="secondary"
        className="rounded-[var(--radius-lg)] font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20"
      >
        Fix in SEO Editor
      </Button>
      <Button
        onClick={() => onCreateBrief(page, analysis)}
        icon={BookOpen}
        size="sm"
        variant="secondary"
        className="rounded-[var(--radius-lg)] font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20"
      >
        Create Brief
      </Button>
      {hasSchemaIssue && (
        <Button
          onClick={() => onAddSchema(page)}
          icon={Code2}
          size="sm"
          variant="secondary"
          className="rounded-[var(--radius-lg)] font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20"
        >
          Add Schema
        </Button>
      )}
      <div className="flex-1" />
      <Button
        onClick={onViewFullAnalysis}
        icon={ArrowUpRight}
        iconPosition="right"
        size="sm"
        variant="ghost"
        className="h-auto px-0 py-0 text-[var(--brand-text-dim)] hover:text-[var(--brand-text)] hover:bg-transparent"
      >
        View full analysis
      </Button>
    </div>
  );
}
