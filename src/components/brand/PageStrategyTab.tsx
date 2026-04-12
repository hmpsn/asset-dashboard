import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { Map, Plus, Sparkles, ChevronRight, Trash2, Loader2 } from 'lucide-react';
import { blueprints as blueprintsApi } from '../../api/brand-engine';
import type { SiteBlueprint, BlueprintGenerationInput } from '../../../shared/types/page-strategy';
import { useToast } from '../Toast';
import { useBlueprints } from '../../hooks/admin/useBlueprints';
import { queryKeys } from '../../lib/queryKeys';
import { EmptyState } from '../ui/EmptyState';

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

  // Invalidate blueprints list when server broadcasts updates
  useWorkspaceEvents(workspaceId, {
    'blueprint:updated': () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
    },
    'blueprint:generated': () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
    },
  });

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
        <h2 className="text-lg font-semibold text-zinc-100">Site Blueprints</h2>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Blueprint
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-200">New Blueprint</h3>

          <div className="space-y-1">
            <label htmlFor="bp-name" className="text-xs text-zinc-400">Name</label>
            <input
              id="bp-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Main Site Blueprint"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
              disabled={isCreating || isGenerating}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="bp-industry" className="text-xs text-zinc-400">Industry Type</label>
            <input
              id="bp-industry"
              value={industryType}
              onChange={e => setIndustryType(e.target.value)}
              placeholder="e.g. SaaS, E-commerce, Agency"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
              disabled={isCreating || isGenerating}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreateEmpty}
              disabled={!name.trim() || isCreating || isGenerating}
              className="px-3 py-1.5 bg-zinc-700 text-zinc-200 text-sm rounded-lg font-medium hover:bg-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isCreating ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                'Create Empty'
              )}
            </button>

            <button
              onClick={handleGenerateWithAI}
              disabled={!industryType.trim() || isCreating || isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate with AI
                </>
              )}
            </button>

            <button
              onClick={resetForm}
              disabled={isCreating || isGenerating}
              className="ml-auto px-3 py-1.5 text-zinc-500 text-sm hover:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Blueprint list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-zinc-400 text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading blueprints...
        </div>
      ) : !blueprintList || blueprintList.length === 0 ? (
        <EmptyState
          icon={Map}
          title="No blueprints yet"
          description="Create one to start planning your site strategy."
          action={
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              New Blueprint
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {blueprintList.map(bp => (
            <div
              key={bp.id}
              className="group flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 cursor-pointer hover:border-zinc-700 transition-colors"
              onClick={() => onSelectBlueprint(bp.id)}
            >
              <Map className="w-4 h-4 text-zinc-400 shrink-0" />

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-100 truncate">{bp.name}</div>
                <div className="text-xs text-zinc-500">
                  v{bp.version} · {bp.status}
                  {bp.industryType ? ` · ${bp.industryType}` : ''}
                </div>
              </div>

              <button
                onClick={e => {
                  e.stopPropagation();
                  setDeletingId(bp.id);
                  deleteMutation.mutate(bp.id);
                }}
                disabled={deletingId === bp.id}
                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Delete ${bp.name}`}
              >
                {deletingId === bp.id
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Trash2 className="w-4 h-4" />
                }
              </button>

              <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
