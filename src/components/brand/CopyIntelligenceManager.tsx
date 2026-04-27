import { useState, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Trash2,
  AlertCircle,
  Loader2,
  Star,
  Tag,
  MessageSquare,
  AlignLeft,
  Search,
} from 'lucide-react';
import {
  useCopyIntelligence,
  usePromotablePatterns,
  useTogglePattern,
  useDeletePattern,
} from '../../hooks/admin/useCopyPipeline';
import { copyIntelligence } from '../../api/brand-engine';
import { queryKeys } from '../../lib/queryKeys';
import { SectionCard, Badge, SectionCardSkeleton, EmptyState, Icon, cn } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';
import type { CopyIntelligencePattern, IntelligencePatternType } from '../../../shared/types/copy-pipeline';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
}

// ─── Pattern type config ──────────────────────────────────────────────────────

interface PatternTypeConfig {
  label: string;
  icon: typeof Tag;
  badgeColor: 'teal' | 'blue' | 'amber' | 'zinc';
  description: string;
}

const PATTERN_TYPE_CONFIG: Record<IntelligencePatternType, PatternTypeConfig> = {
  terminology: {
    label: 'Terminology',
    icon: Tag,
    badgeColor: 'teal',
    description: 'Preferred words and phrases used by the client',
  },
  tone: {
    label: 'Tone',
    icon: MessageSquare,
    badgeColor: 'blue',
    description: 'Tonal qualities and stylistic approaches',
  },
  structure: {
    label: 'Structure',
    icon: AlignLeft,
    badgeColor: 'amber',
    description: 'Content structure and formatting patterns',
  },
  keyword_usage: {
    label: 'Keyword Usage',
    icon: Search,
    badgeColor: 'zinc',
    description: 'How keywords are naturally incorporated',
  },
};

const PATTERN_TYPE_ORDER: IntelligencePatternType[] = [
  'terminology',
  'tone',
  'structure',
  'keyword_usage',
];

// ─── Toggle Switch ─────────────────────────────────────────────────────────────

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

function ToggleSwitch({ checked, onChange, disabled, label }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label ?? (checked ? 'Deactivate pattern' : 'Activate pattern')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

// ─── Pattern Row ──────────────────────────────────────────────────────────────

interface PatternRowProps {
  pattern: CopyIntelligencePattern;
  workspaceId: string;
}

function PatternRow({ pattern, workspaceId }: PatternRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(pattern.pattern);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const toggleMutation = useTogglePattern(workspaceId);
  const deleteMutation = useDeletePattern(workspaceId);

  const updateMutation = useMutation({
    mutationFn: ({ id, text, patternType }: { id: string; text: string; patternType: string }) =>
      copyIntelligence.update(workspaceId, id, { pattern: text, patternType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(workspaceId) });
    },
  });

  function handleEditStart() {
    setEditValue(pattern.pattern);
    setIsEditing(true);
    // Focus input on next tick after it mounts
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleEditCommit() {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === pattern.pattern) {
      setEditValue(pattern.pattern);
      setIsEditing(false);
      return;
    }
    updateMutation.mutate(
      { id: pattern.id, text: trimmed, patternType: pattern.patternType },
      {
        onSettled: () => {
          setIsEditing(false);
        },
      }
    );
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditCommit();
    } else if (e.key === 'Escape') {
      setEditValue(pattern.pattern);
      setIsEditing(false);
    }
  }

  const isToggling = toggleMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const isSaving = updateMutation.isPending;

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)] transition-colors group">
      {/* Toggle */}
      <ToggleSwitch
        checked={pattern.active}
        onChange={(active) => toggleMutation.mutate({ patternId: pattern.id, active })}
        disabled={isToggling || isDeleting}
        label={pattern.active ? 'Deactivate pattern' : 'Activate pattern'}
      />

      {/* Pattern text — inline edit */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditCommit}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            className="w-full bg-[var(--surface-3)] border border-teal-500/50 rounded px-2 py-0.5 text-sm text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500 disabled:opacity-60"
            aria-label="Edit pattern text"
          />
        ) : (
          <button
            onClick={handleEditStart}
            disabled={isDeleting}
            className={cn(
              'text-left w-full text-sm truncate transition-colors hover:text-teal-300 disabled:cursor-not-allowed',
              pattern.active ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)] line-through'
            )}
            title="Click to edit"
            aria-label={`Edit: ${pattern.pattern}`}
          >
            {pattern.pattern}
          </button>
        )}
      </div>

      {/* Frequency badge */}
      <span
        className="shrink-0 t-caption text-[var(--brand-text-muted)] tabular-nums"
        title={`Seen ${pattern.frequency} time${pattern.frequency === 1 ? '' : 's'}`}
        aria-label={`Frequency: ${pattern.frequency}`}
      >
        ×{pattern.frequency}
      </span>

      {/* Saving indicator */}
      {isSaving && (
        <Icon as={Loader2} size="md" className="text-teal-400 animate-spin shrink-0" aria-label="Saving..." />
      )}

      {/* Delete */}
      <button
        onClick={() => deleteMutation.mutate(pattern.id)}
        disabled={isDeleting || isEditing}
        aria-label={`Delete pattern: ${pattern.pattern}`}
        className="shrink-0 text-[var(--brand-text-muted)] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
      >
        {isDeleting ? (
          <Icon as={Loader2} size="md" className="animate-spin" />
        ) : (
          <Icon as={Trash2} size="md" />
        )}
      </button>
    </div>
  );
}

// ─── Pattern Group ────────────────────────────────────────────────────────────

interface PatternGroupProps {
  type: IntelligencePatternType;
  patterns: CopyIntelligencePattern[];
  workspaceId: string;
}

function PatternGroup({ type, patterns, workspaceId }: PatternGroupProps) {
  const config = PATTERN_TYPE_CONFIG[type];
  const GroupIcon = config.icon;

  if (patterns.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 mb-2">
        <Icon as={GroupIcon} size="md" className="text-[var(--brand-text-muted)]" />
        <span className="t-caption font-semibold text-[var(--brand-text-muted)] uppercase tracking-wide">
          {config.label}
        </span>
        <Badge label={String(patterns.length)} color={config.badgeColor} />
      </div>
      <div className="space-y-1">
        {patterns.map((p) => (
          <PatternRow key={p.id} pattern={p} workspaceId={workspaceId} />
        ))}
      </div>
    </div>
  );
}

// ─── Promotable Section ───────────────────────────────────────────────────────

interface PromotableSectionProps {
  workspaceId: string;
}

function PromotableSection({ workspaceId }: PromotableSectionProps) {
  const { data: promotable = [], isLoading } = usePromotablePatterns(workspaceId);

  if (isLoading) {
    return <SectionCardSkeleton lines={3} />;
  }

  if (promotable.length === 0) {
    return null;
  }

  return (
    <SectionCard
      title="Ready to Promote"
      titleIcon={<Icon as={Star} size="md" className="text-amber-400" />}
      titleExtra={
        <Badge label={`${promotable.length} pattern${promotable.length === 1 ? '' : 's'}`} color="amber" />
      }
    >
      <p className="t-caption text-[var(--brand-text-muted)] mb-3">
        Patterns seen 3+ times across copy reviews. Promote them to Voice Guardrails for persistent application.
      </p>
      <div className="space-y-2">
        {promotable.map((p) => {
          const config = PATTERN_TYPE_CONFIG[p.patternType];
          return (
            <div
              key={p.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] bg-amber-500/5 border border-amber-500/20"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--brand-text)] truncate">{p.pattern}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge label={config.label} color={config.badgeColor} />
                  <span className="t-caption text-[var(--brand-text-muted)]">×{p.frequency}</span>
                </div>
              </div>
              <button
                disabled
                title="Coming soon — Tier 2 feature"
                aria-label={`Promote "${p.pattern}" to Voice Guardrail (coming soon)`}
                className="shrink-0 px-3 py-1.5 t-caption font-medium rounded-[var(--radius-md)] bg-gradient-to-r from-teal-600/40 to-emerald-600/40 text-teal-400/60 cursor-not-allowed border border-teal-500/20"
              >
                Promote to Guardrail
              </button>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ─── Inner Component ──────────────────────────────────────────────────────────

function CopyIntelligenceManagerInner({ workspaceId }: Props) {
  const { data: patterns = [], isLoading, isError } = useCopyIntelligence(workspaceId);

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-5">
        <SectionCardSkeleton lines={4} />
        <SectionCardSkeleton lines={3} />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div
        className="flex items-start gap-3 bg-red-900/20 border border-red-900/40 rounded-[var(--radius-xl)] px-4 py-4"
        role="alert"
      >
        <Icon as={AlertCircle} size="lg" className="text-red-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-red-300">Failed to load patterns</p>
          <p className="t-caption text-red-400/80 mt-0.5">
            Check your connection and try refreshing the page.
          </p>
        </div>
      </div>
    );
  }

  // Empty state
  if (patterns.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={Brain}
          title="No patterns learned yet"
          description="Patterns are automatically extracted from copy steering notes and client feedback as you review generated copy."
        />
      </div>
    );
  }

  // Group patterns by type
  const grouped = PATTERN_TYPE_ORDER.reduce<Record<IntelligencePatternType, CopyIntelligencePattern[]>>(
    (acc, type) => {
      acc[type] = patterns.filter((p) => p.patternType === type);
      return acc;
    },
    { terminology: [], tone: [], structure: [], keyword_usage: [] }
  );

  const totalActive = patterns.filter((p) => p.active).length;

  return (
    <div className="space-y-5">

      {/* Pattern library */}
      <SectionCard
        title="Learned Patterns"
        titleIcon={<Icon as={Brain} size="md" className="text-[var(--brand-text-muted)]" />}
        titleExtra={
          <Badge
            label={`${totalActive} active`}
            color="teal"
          />
        }
      >
        <div className="space-y-5">
          {PATTERN_TYPE_ORDER.map((type) => (
            <PatternGroup
              key={type}
              type={type}
              patterns={grouped[type]}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      </SectionCard>

      {/* Promotable patterns */}
      <PromotableSection workspaceId={workspaceId} />

    </div>
  );
}

// ─── Public export (wrapped in error boundary) ────────────────────────────────

export function CopyIntelligenceManager({ workspaceId }: Props) {
  return (
    <ErrorBoundary label="Copy Intelligence">
      <CopyIntelligenceManagerInner workspaceId={workspaceId} />
    </ErrorBoundary>
  );
}
