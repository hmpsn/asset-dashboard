import type { RefObject } from 'react';
import { Briefcase, ChevronDown, Plus, X } from 'lucide-react';
import { Button, Icon, IconButton, SectionCard } from '../../ui';
import type { StrategyBusinessPriority } from './useStrategyBusinessPriorities';

interface StrategyBusinessPrioritiesSectionProps {
  businessPrioritiesRef: RefObject<HTMLDivElement | null>;
  workspaceId?: string;
  prioritiesLoaded: boolean;
  priorities: StrategyBusinessPriority[];
  newPriority: string;
  setNewPriority: (value: string) => void;
  newPriorityCategory: string;
  setNewPriorityCategory: (value: string) => void;
  savingPriorities: boolean;
  savePriorities: (priorities: StrategyBusinessPriority[]) => Promise<void>;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
}

const priorityCategoryClass = (category: string) => {
  if (category === 'growth') return 'bg-emerald-500/10 text-accent-success border border-emerald-500/20';
  if (category === 'brand') return 'bg-teal-500/10 text-accent-brand border border-teal-500/20';
  if (category === 'product') return 'bg-blue-500/10 text-accent-info border border-blue-500/20';
  if (category === 'audience') return 'bg-amber-500/10 text-accent-warning border border-amber-500/20';
  if (category === 'competitive') return 'bg-red-500/10 text-accent-danger border border-red-500/20';
  return 'bg-[var(--surface-3)]/50 text-[var(--brand-text-muted)] border border-[var(--brand-border-strong)]/30';
};

export function StrategyBusinessPrioritiesSection({
  businessPrioritiesRef,
  workspaceId,
  prioritiesLoaded,
  priorities,
  newPriority,
  setNewPriority,
  newPriorityCategory,
  setNewPriorityCategory,
  savingPriorities,
  savePriorities,
  expandedSections,
  toggleSection,
}: StrategyBusinessPrioritiesSectionProps) {
  if (!workspaceId || !prioritiesLoaded) return null;

  const addPriority = () => {
    if (!newPriority.trim() || savingPriorities || priorities.length >= 10) return;
    savePriorities([...priorities, { text: newPriority.trim(), category: newPriorityCategory }]);
    setNewPriority('');
  };

  return (
    <div ref={businessPrioritiesRef}>
      <SectionCard noPadding>
        <Button
          onClick={() => toggleSection('business-priorities')}
          variant="ghost"
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors rounded-none"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center">
              <Icon as={Briefcase} size="md" className="text-accent-brand" />
            </div>
            <div className="text-left">
              <div className="t-ui font-medium text-[var(--brand-text-bright)]">Guide This Strategy</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">
                {priorities.length > 0
                  ? `${priorities.length} business ${priorities.length === 1 ? 'priority' : 'priorities'} saved`
                  : 'Tell us what matters most'}
              </div>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('business-priorities') ? '' : '-rotate-90'}`} />
        </Button>

        {expandedSections.has('business-priorities') && (
          <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
            <p className="t-body text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
              Share business goals and priorities that should shape future strategy recommendations. Keywords are managed in the Strategy Keywords section.
            </p>

            {priorities.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {priorities.map((p, i) => (
                  <div key={`${p.category}:${p.text}`} className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/50 group">
                    <span className={`t-micro font-medium px-1.5 py-0.5 rounded-[var(--radius-sm)] ${priorityCategoryClass(p.category)}`}>{p.category}</span>
                    <span className="t-caption-sm text-[var(--brand-text)] flex-1">{p.text}</span>
                    <IconButton
                      onClick={() => {
                        const next = priorities.filter((_, j) => j !== i);
                        savePriorities(next);
                      }}
                      disabled={savingPriorities}
                      icon={X}
                      label={`Remove ${p.category} priority: ${p.text}`}
                      size="sm"
                      variant="danger"
                      className="opacity-0 group-hover:opacity-100 transition-all"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <select
                value={newPriorityCategory}
                onChange={e => setNewPriorityCategory(e.target.value)}
                className="bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-2 py-1.5 t-caption-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-500"
              >
                <option value="growth">Growth</option>
                <option value="brand">Brand</option>
                <option value="product">Product</option>
                <option value="audience">Audience</option>
                <option value="competitive">Competitive</option>
                <option value="other">Other</option>
              </select>
              <input
                value={newPriority}
                onChange={e => setNewPriority(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newPriority.trim()) {
                    addPriority();
                  }
                }}
                placeholder="e.g., We're launching a new product line in Q3..."
                className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-1.5 t-caption-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
              />
              <Button
                onClick={addPriority}
                disabled={!newPriority.trim() || savingPriorities || priorities.length >= 10}
                variant="secondary"
                size="sm"
                icon={Plus}
                className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 text-accent-brand font-medium hover:bg-teal-600/30 transition-colors disabled:opacity-40"
              >
                Add
              </Button>
            </div>
            {priorities.length >= 10 && (
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1.5">Maximum 10 priorities reached</p>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
