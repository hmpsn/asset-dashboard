import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Map, Plus, Sparkles, ChevronRight, Trash2, Loader2 } from 'lucide-react';
import { blueprints as blueprintsApi } from '../../api/brand-engine';
import type { SiteBlueprint, BlueprintGenerationInput } from '../../../shared/types/page-strategy';
import { useToast } from '../Toast';
import { useBlueprints } from '../../hooks/admin/useBlueprints';
import { queryKeys } from '../../lib/queryKeys';
import { EmptyState, SectionCard, Icon, Button } from '../ui';

interface Props {
  workspaceId: string;
  onSelectBlueprint: (blueprintId: string) => void;
}

export function PageStrategyTab({ workspaceId, onSelectBlueprint }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [industryType, setIndustryType] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: blueprintList, isLoading } = useBlueprints(workspaceId);

  const createMutation = useMutation({
    mutationFn: (body: { name: string; industryType?: string }) =>
      blueprintsApi.create(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
      toast('Blueprint created');
      resetForm();
    },
    onError: () => toast('Failed to create blueprint', 'error'),
  });

  const generateMutation = useMutation({
    mutationFn: (input: BlueprintGenerationInput) =>
      blueprintsApi.generate(workspaceId, input),
    onSuccess: (bp: SiteBlueprint) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
      toast('Blueprint generated');
      resetForm();
      onSelectBlueprint(bp.id);
    },
    onError: () => toast('Failed to generate blueprint', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (blueprintId: string) =>
      blueprintsApi.remove(workspaceId, blueprintId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
      toast('Blueprint deleted');
      setDeletingId(null);
    },
    onError: () => {
      toast('Failed to delete blueprint', 'error');
      setDeletingId(null);
    },
  });

  function resetForm() {
    setShowCreateForm(false);
    setName('');
    setIndustryType('');
  }

  function handleCreateEmpty() {
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim(), industryType: industryType.trim() || undefined });
  }

  function handleGenerateWithAI() {
    if (!industryType.trim()) return;
    generateMutation.mutate({
      industryType: industryType.trim(),
    });
  }

  const isGenerating = generateMutation.isPending;
  const isCreating = createMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--brand-text-bright)]">Site Blueprints</h2>
        {!showCreateForm && (
          <Button
            onClick={() => setShowCreateForm(true)}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            New Blueprint
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <SectionCard title="New Blueprint">
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="bp-name" className="t-caption text-[var(--brand-text-muted)]">Name</label>
              <input
                id="bp-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Main Site Blueprint"
                className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
                disabled={isCreating || isGenerating}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="bp-industry" className="t-caption text-[var(--brand-text-muted)]">Industry Type</label>
              <input
                id="bp-industry"
                value={industryType}
                onChange={e => setIndustryType(e.target.value)}
                placeholder="e.g. SaaS, E-commerce, Agency"
                className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
                disabled={isCreating || isGenerating}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleCreateEmpty}
                disabled={!name.trim() || isCreating || isGenerating}
                variant="secondary"
                size="sm"
                loading={isCreating}
              >
                {isCreating ? 'Creating...' : 'Create Empty'}
              </Button>

              <Button
                onClick={handleGenerateWithAI}
                disabled={!industryType.trim() || isCreating || isGenerating}
                variant="primary"
                size="sm"
                icon={Sparkles}
                loading={isGenerating}
              >
                {isGenerating ? 'Generating...' : 'Generate with AI'}
              </Button>

              <Button
                onClick={resetForm}
                disabled={isCreating || isGenerating}
                variant="ghost"
                size="sm"
                className="ml-auto"
              >
                Cancel
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Blueprint list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-[var(--brand-text-muted)] text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading blueprints...
        </div>
      ) : !blueprintList || blueprintList.length === 0 ? (
        <EmptyState
          icon={Map}
          title="No blueprints yet"
          description="Create one to start planning your site strategy."
          action={
            <Button
              onClick={() => setShowCreateForm(true)}
              variant="primary"
              size="sm"
              icon={Plus}
            >
              New Blueprint
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {blueprintList.map(bp => (
            // pr-check-disable-next-line -- list item row used as a clickable navigation element, not a section card
            <div
              key={bp.id}
              className="group flex items-center gap-3 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] px-4 py-3 cursor-pointer hover:border-[var(--brand-border-hover)] transition-colors"
              onClick={() => onSelectBlueprint(bp.id)}
            >
              <Icon as={Map} size="md" className="text-[var(--brand-text-muted)] shrink-0" />

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--brand-text-bright)] truncate">{bp.name}</div>
                <div className="t-caption text-[var(--brand-text-muted)]">
                  v{bp.version} · {bp.status}
                  {bp.industryType ? ` · ${bp.industryType}` : ''}
                </div>
              </div>

              <button
                onClick={e => {
                  e.stopPropagation();
                  if (!window.confirm(`Delete "${bp.name}"? This cannot be undone.`)) return;
                  setDeletingId(bp.id);
                  deleteMutation.mutate(bp.id);
                }}
                disabled={deletingId === bp.id}
                className="opacity-0 group-hover:opacity-100 p-1 text-[var(--brand-text-muted)] hover:text-red-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Delete ${bp.name}`}
              >
                {deletingId === bp.id
                  ? <Icon as={Loader2} size="md" className="animate-spin" />
                  : <Icon as={Trash2} size="md" />
                }
              </button>

              <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
