import { ChevronDown, Layers } from 'lucide-react';
import { Button, Icon, SectionCard, TierGate, type Tier } from '../../ui';
import { PageKeywordMapContent } from '../PageKeywordMapContent';
import type { ClientKeywordStrategy } from '../types';

type KeywordFeedbackStatus = 'approved' | 'declined' | 'requested';

interface StrategyPageKeywordMapSectionProps {
  effectiveTier: Tier;
  pageMap: ClientKeywordStrategy['pageMap'];
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  workspaceId?: string;
  setToast?: (msg: string) => void;
  onContentRequested?: () => void;
  keywordFeedback: Map<string, KeywordFeedbackStatus>;
  submitFeedback: (keyword: string, status: 'approved' | 'declined', source: string) => Promise<void>;
  onDeclineKeyword: (keyword: string, source: string) => void;
  undoFeedback: (keyword: string) => Promise<void>;
  isLoadingFeedback: (keyword: string) => boolean;
}

export function StrategyPageKeywordMapSection({
  effectiveTier,
  pageMap,
  expandedSections,
  toggleSection,
  workspaceId,
  setToast,
  onContentRequested,
  keywordFeedback,
  submitFeedback,
  onDeclineKeyword,
  undoFeedback,
  isLoadingFeedback,
}: StrategyPageKeywordMapSectionProps) {
  return (
    <div>
      <TierGate tier={effectiveTier} required="growth" feature="Keyword Map" teaser={`${pageMap.length} pages tracked`}>
        <SectionCard noPadding>
          <Button
            onClick={() => toggleSection('page-keyword-map')}
            variant="ghost"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors rounded-none"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center">
                <Icon as={Layers} size="md" className="text-accent-info" />
              </div>
              <div className="text-left">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">Page Keyword Map</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{pageMap.length} pages mapped · advanced page-to-keyword detail</div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('page-keyword-map') ? '' : '-rotate-90'}`} />
          </Button>

          {expandedSections.has('page-keyword-map') && (
            <PageKeywordMapContent
              pageMap={pageMap}
              workspaceId={workspaceId}
              setToast={setToast}
              onContentRequested={onContentRequested}
              keywordFeedback={keywordFeedback}
              onApproveKeyword={(kw, source) => submitFeedback(kw, 'approved', source)}
              onDeclineKeyword={onDeclineKeyword}
              onUndoFeedback={undoFeedback}
              isLoadingFeedback={isLoadingFeedback}
            />
          )}
        </SectionCard>
      </TierGate>
    </div>
  );
}
