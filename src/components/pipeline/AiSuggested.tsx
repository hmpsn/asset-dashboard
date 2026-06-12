import { useState } from 'react';
import {
  useAiSuggestedBriefs,
  useDismissSuggestedBrief,
  useSnoozeSuggestedBrief,
  useAcceptSuggestedBrief,
} from '../../hooks/admin/useAiSuggestedBriefs.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Badge } from '../ui/Badge.js';
import { Icon } from '../ui/Icon.js';
import { Button } from '../ui/Button.js';
import { Sparkles, FileText, RefreshCw, X, Clock } from 'lucide-react';
import type { SuggestedBrief } from '../../hooks/admin/useAiSuggestedBriefs.js';

interface Props {
  workspaceId: string;
  onCreateBrief?: (keyword: string, pageUrl?: string, suggestedBriefId?: string) => void;
}

const sourceIconMap: Record<string, typeof FileText> = {
  content_decay: RefreshCw,
  ranking_opportunity: FileText,
};

/** Returns a date string 7 days from now in YYYY-MM-DD format */
function snoozeUntilOneWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** Returns a date string 30 days from now in YYYY-MM-DD format */
function snoozeUntilOneMonth(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function priorityTone(p: SuggestedBrief['priority']): 'red' | 'amber' | 'blue' {
  if (p === 'high') return 'red';
  if (p === 'medium') return 'amber';
  return 'blue';
}

interface SnoozeMenuProps {
  briefId: string;
  onSnooze: (briefId: string, until: string) => void;
  onClose: () => void;
}

function SnoozeMenu({ briefId, onSnooze, onClose }: SnoozeMenuProps) {
  return (
    // pr-check-disable-next-line -- snooze dropdown
    <div className="absolute right-0 top-full mt-1 w-40 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl z-[var(--z-dropdown)] py-1 overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-3 py-2 text-xs rounded-none text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]"
        onClick={() => { onSnooze(briefId, snoozeUntilOneWeek()); onClose(); }}
      >
        Snooze 1 week
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start px-3 py-2 text-xs rounded-none text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]"
        onClick={() => { onSnooze(briefId, snoozeUntilOneMonth()); onClose(); }}
      >
        Snooze 1 month
      </Button>
    </div>
  );
}

export function AiSuggested({ workspaceId, onCreateBrief }: Props) {
  const { data: briefs = [], isLoading } = useAiSuggestedBriefs(workspaceId);
  const dismissMutation = useDismissSuggestedBrief(workspaceId);
  const snoozeMutation = useSnoozeSuggestedBrief(workspaceId);
  const acceptMutation = useAcceptSuggestedBrief(workspaceId);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);

  const handleDismiss = (briefId: string) => {
    dismissMutation.mutate(briefId);
  };

  const handleSnooze = (briefId: string, until: string) => {
    snoozeMutation.mutate({ briefId, until });
  };

  const handleCreateBrief = (brief: SuggestedBrief) => {
    // Mark as accepted in the store so the lifecycle is recorded.
    acceptMutation.mutate(brief.id);
    onCreateBrief?.(brief.keyword, brief.pageUrl ?? undefined, brief.id);
  };

  if (isLoading) {
    return (
      <SectionCard
        title="AI Suggested"
        titleIcon={<Icon as={Sparkles} size="md" className="text-teal-400" />}
      >
        <div className="animate-pulse space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-12 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (!briefs.length) {
    return (
      <SectionCard
        title="AI Suggested"
        titleIcon={<Icon as={Sparkles} size="md" className="text-teal-400" />}
      >
        <EmptyState
          icon={Sparkles}
          title="No suggestions yet"
          description="Suggestions appear when the insight engine finds content opportunities"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="AI Suggested"
      titleIcon={<Icon as={Sparkles} size="md" className="text-teal-400" />}
      titleExtra={<Badge label={`${briefs.length}`} tone="teal" />}
    >
      <div className="space-y-2">
        {briefs.slice(0, 8).map(brief => {
          const BriefIcon = sourceIconMap[brief.source] ?? FileText;
          const isRefresh = brief.source === 'content_decay';
          return (
            <div
              key={brief.id}
              className="flex items-start gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/30 hover:bg-[var(--surface-3)]/50 transition-colors relative"
            >
              <Icon as={BriefIcon} size="md" className="mt-0.5 text-teal-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--brand-text-bright)] truncate">
                    {brief.keyword || 'Untitled'}
                  </span>
                  <Badge
                    label={isRefresh ? 'Refresh' : 'New Brief'}
                    tone={isRefresh ? 'amber' : 'blue'}
                  />
                  <Badge
                    label={brief.priority}
                    tone={priorityTone(brief.priority)}
                  />
                  {brief.status === 'snoozed' && brief.snoozedUntil && (
                    <Badge
                      label={`Snoozed until ${brief.snoozedUntil}`}
                      tone="blue"
                    />
                  )}
                </div>
                <p className="text-xs text-[var(--brand-text)] mt-0.5">{brief.reason}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {onCreateBrief && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleCreateBrief(brief)}
                  >
                    {isRefresh ? 'Refresh brief' : 'Create Brief'}
                  </Button>
                )}

                {/* Snooze */}
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Snooze suggestion"
                    aria-label="Snooze suggestion"
                    onClick={() => setSnoozeOpenId(snoozeOpenId === brief.id ? null : brief.id)}
                  >
                    <Icon as={Clock} size="sm" className="text-[var(--brand-text-muted)]" />
                  </Button>
                  {snoozeOpenId === brief.id && (
                    <SnoozeMenu
                      briefId={brief.id}
                      onSnooze={handleSnooze}
                      onClose={() => setSnoozeOpenId(null)}
                    />
                  )}
                </div>

                {/* Dismiss */}
                <Button
                  variant="ghost"
                  size="sm"
                  title="Dismiss suggestion permanently"
                  aria-label="Dismiss suggestion"
                  onClick={() => handleDismiss(brief.id)}
                >
                  <Icon as={X} size="sm" className="text-[var(--brand-text-muted)] hover:text-accent-danger" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
