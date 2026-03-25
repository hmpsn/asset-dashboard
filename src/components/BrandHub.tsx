import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { workspaces } from '../api/workspaces';
import { Sparkles, Brain, Users, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { StatCard } from './ui';

interface BrandData {
  brandVoice?: string;
  knowledgeBase?: string;
  personas?: Array<{
    name: string;
    description: string;
    painPoints: string[];
    goals: string[];
  }>;
}

export function BrandHub({ workspaceId }: { workspaceId: string }) {
  const [activeTab, setActiveTab] = useState<'voice' | 'knowledge' | 'personas'>('voice');

  // Get workspace data to display current brand information
  const { data: workspace, isLoading } = useQuery({
    queryKey: ['workspace-brand', workspaceId],
    queryFn: async () => {
      // We'll need to add an endpoint to get workspace brand data
      // For now, we'll use a placeholder
      return {
        brandVoice: '',
        knowledgeBase: '',
        personas: []
      } as BrandData;
    },
  });

  // Mutations for generating brand assets
  const generateBrandVoice = useMutation({
    mutationFn: () => workspaces.generateBrandVoice(workspaceId),
    onSuccess: () => {
      // Invalidate workspace data to show updated brand voice
      // queryClient.invalidateQueries({ queryKey: ['workspace-brand', workspaceId] });
    },
  });

  const generateKnowledgeBase = useMutation({
    mutationFn: () => workspaces.generateKnowledgeBase(workspaceId),
    onSuccess: () => {
      // Invalidate workspace data
      // queryClient.invalidateQueries({ queryKey: ['workspace-brand', workspaceId] });
    },
  });

  const generatePersonas = useMutation({
    mutationFn: () => workspaces.generatePersonas(workspaceId),
    onSuccess: () => {
      // Invalidate workspace data
      // queryClient.invalidateQueries({ queryKey: ['workspace-brand', workspaceId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  const tabs = [
    { id: 'voice', label: 'Brand Voice', icon: Sparkles },
    { id: 'knowledge', label: 'Knowledge Base', icon: Brain },
    { id: 'personas', label: 'Audience Personas', icon: Users },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 mb-2">Brand & AI</h1>
        <p className="text-sm text-zinc-400">
          Manage your brand voice, knowledge base, and audience personas to improve AI-generated content.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-zinc-900 rounded-lg w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'voice' | 'knowledge' | 'personas')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-teal-500 text-white'
                  : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-6">
        {activeTab === 'voice' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100 mb-1">Brand Voice</h2>
                <p className="text-sm text-zinc-400">
                  Define how your content should sound and feel to maintain consistency.
                </p>
              </div>
              <button
                onClick={() => generateBrandVoice.mutate()}
                disabled={generateBrandVoice.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-500/50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {generateBrandVoice.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Voice
                  </>
                )}
              </button>
            </div>

            {workspace?.brandVoice ? (
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-teal-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">{workspace.brandVoice}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Sparkles className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                <p className="text-sm text-zinc-400">No brand voice defined yet.</p>
                <p className="text-xs text-zinc-500 mt-1">Click "Generate Voice" to create one.</p>
              </div>
            )}

            {generateBrandVoice.error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-red-400 font-medium">Failed to generate brand voice</p>
                    <p className="text-xs text-red-400/80 mt-1">
                      {generateBrandVoice.error.message}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100 mb-1">Knowledge Base</h2>
                <p className="text-sm text-zinc-400">
                  Upload documents and information about your business for better context.
                </p>
              </div>
              <button
                onClick={() => generateKnowledgeBase.mutate()}
                disabled={generateKnowledgeBase.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-500/50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {generateKnowledgeBase.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Building...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4" />
                    Build Base
                  </>
                )}
              </button>
            </div>

            {workspace?.knowledgeBase ? (
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-teal-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">{workspace.knowledgeBase}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Brain className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                <p className="text-sm text-zinc-400">No knowledge base built yet.</p>
                <p className="text-xs text-zinc-500 mt-1">Click "Build Base" to create one.</p>
              </div>
            )}

            {generateKnowledgeBase.error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-red-400 font-medium">Failed to build knowledge base</p>
                    <p className="text-xs text-red-400/80 mt-1">
                      {generateKnowledgeBase.error.message}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'personas' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100 mb-1">Audience Personas</h2>
                <p className="text-sm text-zinc-400">
                  Define your target audiences to create more relevant content.
                </p>
              </div>
              <button
                onClick={() => generatePersonas.mutate()}
                disabled={generatePersonas.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-500/50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {generatePersonas.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4" />
                    Generate Personas
                  </>
                )}
              </button>
            </div>

            {workspace?.personas && workspace.personas.length > 0 ? (
              <div className="grid gap-4">
                {workspace.personas.map((persona, index) => (
                  <div key={index} className="bg-zinc-800/50 rounded-lg p-4">
                    <h3 className="font-medium text-zinc-100 mb-2">{persona.name}</h3>
                    <p className="text-sm text-zinc-300 mb-3">{persona.description}</p>
                    
                    {persona.painPoints.length > 0 && (
                      <div className="mb-3">
                        <h4 className="text-xs font-medium text-zinc-400 mb-1">Pain Points</h4>
                        <ul className="text-xs text-zinc-300 space-y-1">
                          {persona.painPoints.map((point, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-teal-400">•</span>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {persona.goals.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-zinc-400 mb-1">Goals</h4>
                        <ul className="text-xs text-zinc-300 space-y-1">
                          {persona.goals.map((goal, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-teal-400">•</span>
                              {goal}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                <p className="text-sm text-zinc-400">No personas defined yet.</p>
                <p className="text-xs text-zinc-500 mt-1">Click "Generate Personas" to create them.</p>
              </div>
            )}

            {generatePersonas.error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-red-400 font-medium">Failed to generate personas</p>
                    <p className="text-xs text-red-400/80 mt-1">
                      {generatePersonas.error.message}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Brand Voice"
          value={workspace?.brandVoice ? "Defined" : "Not Set"}
          icon={Sparkles}
          delta={workspace?.brandVoice ? 1 : undefined}
        />
        <StatCard
          label="Knowledge Base"
          value={workspace?.knowledgeBase ? "Built" : "Empty"}
          icon={Brain}
          delta={workspace?.knowledgeBase ? 1 : undefined}
        />
        <StatCard
          label="Audience Personas"
          value={workspace?.personas?.length || 0}
          icon={Users}
          sub="personas defined"
        />
      </div>
    </div>
  );
}
