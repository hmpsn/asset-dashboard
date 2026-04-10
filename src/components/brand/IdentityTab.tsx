import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Sparkles, Check, Download, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { identity } from '../../api/brand-engine';
import type { BrandDeliverable, DeliverableType, DeliverableTier } from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton } from '../ui';
import { useToast } from '../Toast';
import { WS_EVENTS } from '../../lib/wsEvents';

// ─── Constants ───────────────────────────────────────────────────────────────

const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  mission: 'Mission Statement',
  vision: 'Vision Statement',
  values: 'Core Values',
  tagline: 'Tagline',
  voice_guidelines: 'Voice Guidelines',
  elevator_pitch: 'Elevator Pitch',
  archetypes: 'Brand Archetypes',
  personality_traits: 'Personality Traits',
  messaging_pillars: 'Messaging Pillars',
  differentiators: 'Differentiators',
  tone_examples: 'Tone Examples',
  positioning_matrix: 'Positioning Matrix',
  brand_story: 'Brand Story',
  personas: 'Customer Personas',
  customer_journey: 'Customer Journey',
  objection_handling: 'Objection Handling',
  emotional_triggers: 'Emotional Triggers',
};

const TIER_ORDER: DeliverableTier[] = ['essentials', 'professional', 'premium'];

const TIER_LABELS: Record<DeliverableTier, string> = {
  essentials: 'Essentials',
  professional: 'Professional',
  premium: 'Premium',
};

const TIER_TYPES: Record<DeliverableTier, DeliverableType[]> = {
  essentials: ['mission', 'vision', 'values', 'tagline', 'voice_guidelines'],
  professional: ['elevator_pitch', 'archetypes', 'personality_traits', 'messaging_pillars', 'differentiators', 'tone_examples'],
  premium: ['positioning_matrix', 'brand_story', 'personas', 'customer_journey', 'objection_handling', 'emotional_triggers'],
};

// ─── Deliverable Card ─────────────────────────────────────────────────────────

interface DeliverableCardProps {
  workspaceId: string;
  deliverableType: DeliverableType;
  deliverable: BrandDeliverable | undefined;
  onChanged: () => void;
}

function DeliverableCard({ workspaceId, deliverableType, deliverable, onChanged }: DeliverableCardProps) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [approving, setApproving] = useState(false);
  const [refineInput, setRefineInput] = useState('');
  const [expanded, setExpanded] = useState(false);

  const label = DELIVERABLE_LABELS[deliverableType] ?? deliverableType;
  const hasContent = !!deliverable?.content;
  const isApproved = deliverable?.status === 'approved';
  const isLoading = generating || refining || approving;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await identity.generate(workspaceId, { deliverableType });
      toast(`${label} generated`);
      onChanged();
    } catch {
      toast(`Failed to generate ${label}`, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refineInput.trim() || !deliverable) return;
    setRefining(true);
    try {
      await identity.refine(workspaceId, deliverable.id, { direction: refineInput.trim() });
      toast(`${label} refined`);
      setRefineInput('');
      onChanged();
    } catch {
      toast(`Failed to refine ${label}`, 'error');
    } finally {
      setRefining(false);
    }
  };

  const handleToggleApprove = async () => {
    if (!deliverable) return;
    setApproving(true);
    const newStatus = isApproved ? 'draft' : 'approved';
    try {
      await identity.updateStatus(workspaceId, deliverable.id, newStatus);
      toast(newStatus === 'approved' ? `${label} approved` : `${label} moved back to draft`);
      onChanged();
    } catch {
      toast(`Failed to update ${label} status`, 'error');
    } finally {
      setApproving(false);
    }
  };

  const contentPreview = deliverable?.content ?? '';
  const contentLines = contentPreview.split('\n');
  const showToggle = contentLines.length > 3 || contentPreview.length > 240;
  const displayContent = expanded ? contentPreview : contentLines.slice(0, 3).join('\n').slice(0, 240);

  return (
    <SectionCard
      title={label}
      action={
        deliverable ? (
          <span
            className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              isApproved
                ? 'bg-teal-500/10 text-teal-400'
                : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            {isApproved ? 'Approved' : 'Draft'}
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {/* Content preview */}
        {hasContent && (
          <div className="space-y-1">
            <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{displayContent}{!expanded && showToggle ? '…' : ''}</p>
            {showToggle && (
              <button
                type="button"
                onClick={() => setExpanded(prev => !prev)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {expanded ? (
                  <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
                ) : (
                  <><ChevronDown className="w-3.5 h-3.5" /> Show more</>
                )}
              </button>
            )}
          </div>
        )}

        {/* Refine form — only when content exists */}
        {hasContent && (
          <form onSubmit={handleRefine} className="flex gap-2">
            <label htmlFor={`refine-${deliverableType}`} className="sr-only">
              Refine direction for {label}
            </label>
            <input
              id={`refine-${deliverableType}`}
              type="text"
              value={refineInput}
              onChange={e => setRefineInput(e.target.value)}
              disabled={isLoading}
              placeholder="Refinement direction..."
              className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!refineInput.trim() || isLoading}
              className="flex items-center gap-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Refine
            </button>
          </form>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {!hasContent ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isLoading}
              className="flex items-center gap-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Regenerate
              </button>
              <button
                type="button"
                onClick={handleToggleApprove}
                disabled={isLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  isApproved
                    ? 'bg-teal-500/10 text-teal-400 hover:bg-teal-500/20'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                {approving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                {isApproved ? 'Approved' : 'Approve'}
              </button>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Tier Section ─────────────────────────────────────────────────────────────

interface TierSectionProps {
  tier: DeliverableTier;
  workspaceId: string;
  deliverableMap: Map<DeliverableType, BrandDeliverable>;
  onChanged: () => void;
}

function TierSection({ tier, workspaceId, deliverableMap, onChanged }: TierSectionProps) {
  const types = TIER_TYPES[tier];

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {TIER_LABELS[tier]}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {types.map(type => (
          <DeliverableCard
            key={type}
            workspaceId={workspaceId}
            deliverableType={type}
            deliverable={deliverableMap.get(type)}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

// ─── IdentityTab ──────────────────────────────────────────────────────────────

export function IdentityTab({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [generatingMission, setGeneratingMission] = useState(false);

  const { data: deliverables, isLoading, isError } = useQuery({
    queryKey: ['admin-brand-identity', workspaceId],
    queryFn: () => identity.list(workspaceId),
  });

  useWebSocket({
    [WS_EVENTS.BRAND_IDENTITY_UPDATED]: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-brand-identity', workspaceId] });
    },
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-brand-identity', workspaceId] });
  }, [queryClient, workspaceId]);

  // Build a fast-lookup map: deliverableType → BrandDeliverable
  const { deliverableMap, approvedCount } = useMemo(() => {
    const map = new Map<DeliverableType, BrandDeliverable>();
    let count = 0;
    if (deliverables) {
      for (const d of deliverables) {
        map.set(d.deliverableType, d);
        if (d.status === 'approved') count++;
      }
    }
    return { deliverableMap: map, approvedCount: count };
  }, [deliverables]);

  const hasAnyDeliverable = (deliverables?.length ?? 0) > 0;

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const result = await identity.export(workspaceId);
      const blob = new Blob([result.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'brand-identity.md';
      a.click();
      URL.revokeObjectURL(url);
      toast('Brand identity exported');
    } catch {
      toast('Failed to export brand identity', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleGenerateMission = async () => {
    setGeneratingMission(true);
    try {
      await identity.generate(workspaceId, { deliverableType: 'mission' });
      toast('Mission Statement generated');
      invalidate();
    } catch {
      toast('Failed to generate Mission Statement', 'error');
    } finally {
      setGeneratingMission(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        {TIER_ORDER.map(tier => (
          <div key={tier} className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {TIER_TYPES[tier].map(type => (
                <Skeleton key={type} className="h-40 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-sm text-zinc-500 py-8 text-center">
        Failed to load brand deliverables.{' '}
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-brand-identity', workspaceId] })}
          className="text-teal-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!hasAnyDeliverable) {
    return (
      <EmptyState
        title="No brand deliverables yet"
        description="Generate your first brand deliverable to start building your identity."
        action={
          <button
            type="button"
            onClick={handleGenerateMission}
            disabled={generatingMission}
            className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {generatingMission ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate Mission
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Top bar */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleExportAll}
          disabled={approvedCount === 0 || exporting}
          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Export All
          {approvedCount > 0 && (
            <span className="ml-1 text-xs text-zinc-500">({approvedCount} approved)</span>
          )}
        </button>
      </div>

      {/* Tier sections */}
      {TIER_ORDER.map(tier => (
        <TierSection
          key={tier}
          tier={tier}
          workspaceId={workspaceId}
          deliverableMap={deliverableMap}
          onChanged={invalidate}
        />
      ))}
    </div>
  );
}
