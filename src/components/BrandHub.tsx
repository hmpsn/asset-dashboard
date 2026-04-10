import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import {
  Loader2, Save, Sparkles, BookOpen, Users, MessageSquare,
  Plus, Pencil, Trash2, Check, Upload, Mic, Award,
} from 'lucide-react';
import { PageHeader, TabBar } from './ui';
import { themeColor } from './ui/constants';
import { workspaces } from '../api';
import { BrandscriptTab } from './brand/BrandscriptTab';
import { DiscoveryTab } from './brand/DiscoveryTab';
import { VoiceTab } from './brand/VoiceTab';
import { IdentityTab } from './brand/IdentityTab';

interface AudiencePersona {
  id: string;
  name: string;
  description: string;
  painPoints: string[];
  goals: string[];
  objections: string[];
  preferredContentFormat?: string;
  buyingStage?: 'awareness' | 'consideration' | 'decision';
}

interface WorkspaceData {
  id: string;
  webflowSiteId?: string;
  knowledgeBase?: string;
  brandVoice?: string;
  personas?: AudiencePersona[];
}

interface Props {
  workspaceId: string;
  webflowSiteId?: string;
}

type BrandHubTab = 'overview' | 'brandscript' | 'discovery' | 'voice' | 'identity';

export function BrandHub({ workspaceId, webflowSiteId }: Props) {
  const { toast } = useToast();

  // Active tab
  const [activeTab, setActiveTab] = useState<BrandHubTab>('overview');

  // Workspace data
  const [ws, setWs] = useState<WorkspaceData | null>(null);

  // Brand Voice state
  const [brandVoice, setBrandVoice] = useState('');
  const [savingBrandVoice, setSavingBrandVoice] = useState(false);
  const [generatingBrandVoice, setGeneratingBrandVoice] = useState(false);

  // Knowledge Base state
  const [kbDraft, setKbDraft] = useState<string | null>(null);
  const [generatingKB, setGeneratingKB] = useState(false);

  // Personas state
  const [showPersonas, setShowPersonas] = useState(false);
  const [localPersonas, setLocalPersonas] = useState<AudiencePersona[]>([]);
  const [savingPersonas, setSavingPersonas] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [personaDraft, setPersonaDraft] = useState({ name: '', description: '', painPoints: '', goals: '', objections: '', preferredContentFormat: '', buyingStage: '' as string });
  const [generatingPersonas, setGeneratingPersonas] = useState(false);

  // Load workspace data
  useEffect(() => {
    workspaces.getById(workspaceId).then((d) => {
      const ws = d as WorkspaceData;
      setWs(ws);
      if (ws.brandVoice) setBrandVoice(ws.brandVoice);
    }).catch(() => {});
  }, [workspaceId]);

  const patchWorkspace = async (patch: Record<string, unknown>) => {
    const updated = await workspaces.update(workspaceId, patch);
    setWs(prev => prev ? { ...prev, ...(updated as WorkspaceData) } : updated as WorkspaceData);
    return updated;
  };

  const saveBrandVoiceHandler = async () => {
    setSavingBrandVoice(true);
    try {
      await patchWorkspace({ brandVoice: brandVoice.trim() });
      toast('Brand voice saved');
    } catch { toast('Failed to save brand voice', 'error'); }
    finally { setSavingBrandVoice(false); }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Brand & AI Context"
        subtitle="Everything that feeds into AI content generation — voice, knowledge, and audience"
        icon={<Sparkles className="w-5 h-5 text-teal-400" />}
      />

      <TabBar
        active={activeTab}
        onChange={(id) => setActiveTab(id as BrandHubTab)}
        tabs={[
          { id: 'overview', label: 'Overview', icon: Sparkles },
          { id: 'brandscript', label: 'Brandscript', icon: BookOpen },
          { id: 'discovery', label: 'Discovery', icon: Upload },
          { id: 'voice', label: 'Voice', icon: Mic },
          { id: 'identity', label: 'Identity', icon: Award },
        ]}
      />

      {activeTab === 'brandscript' && <BrandscriptTab workspaceId={workspaceId} />}
      {activeTab === 'discovery' && <DiscoveryTab workspaceId={workspaceId} />}
      {activeTab === 'voice' && <VoiceTab workspaceId={workspaceId} />}
      {activeTab === 'identity' && <IdentityTab workspaceId={workspaceId} />}

      {activeTab === 'overview' && <>
      {/* ═══ BRAND VOICE ═══ */}
      <section className="overflow-hidden bg-zinc-900 border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Brand Voice & Style</h3>
            <p className="text-xs text-zinc-500">
              Tone, personality, and writing guidelines — used in ALL AI-generated copy (SEO rewrites, content briefs, blog posts)
            </p>
          </div>
          {brandVoice && <span className="text-[11px] text-emerald-400 font-medium">(configured)</span>}
        </div>
        <div className="px-5 py-4 space-y-3">
          <textarea
            value={brandVoice}
            onChange={e => setBrandVoice(e.target.value)}
            placeholder="e.g., Professional but approachable. Use active voice. Avoid jargon. Speak directly to the reader. Our tone is confident and helpful, never salesy..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-y font-mono leading-relaxed min-h-[80px]"
            rows={5}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveBrandVoiceHandler}
              disabled={savingBrandVoice}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-[11px] font-medium"
            >
              {savingBrandVoice ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Brand Voice
            </button>
            <button
              onClick={async () => {
                setGeneratingBrandVoice(true);
                try {
                  const data = await workspaces.generateBrandVoice(workspaceId) as { brandVoice: string; pagesScraped: number };
                  setBrandVoice(data.brandVoice);
                  toast(`Brand voice generated from ${data.pagesScraped} pages — review and save`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Failed to generate', 'error');
                } finally {
                  setGeneratingBrandVoice(false);
                }
              }}
              disabled={generatingBrandVoice || !webflowSiteId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generatingBrandVoice ? <><Loader2 className="w-3 h-3 animate-spin" /> Crawling site...</> : <><Sparkles className="w-3 h-3" /> Generate from Website</>}
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            You can also drop <code className="text-teal-400">.txt</code> or <code className="text-teal-400">.md</code> files into the <code className="text-teal-400">brand-docs/</code> folder in your workspace uploads.
          </p>
        </div>
      </section>

      {/* ═══ KNOWLEDGE BASE ═══ */}
      <section className="overflow-hidden bg-zinc-900 border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Knowledge Base</h3>
            <p className="text-xs text-zinc-500">Business context for AI — services, capabilities, FAQs, industry info</p>
          </div>
          {ws?.knowledgeBase && <span className="text-[11px] text-emerald-400 font-medium">(configured)</span>}
        </div>
        <div className="px-5 py-4 space-y-3">
          <textarea
            value={kbDraft !== null ? kbDraft : (ws?.knowledgeBase || '')}
            onChange={(e) => setKbDraft(e.target.value)}
            rows={8}
            placeholder={"Example:\n- Industry: Home services (plumbing, HVAC)\n- Location: Denver metro area\n- Key services: Emergency repair, new installations, maintenance plans\n- Differentiators: 24/7 availability, licensed & insured, 15+ years\n- Target audience: Homeowners, property managers\n- Common client questions: pricing, response time, service areas"}
            onBlur={async (e) => {
              const val = e.target.value.trim();
              if (val !== (ws?.knowledgeBase || '')) {
                await patchWorkspace({ knowledgeBase: val });
                toast('Knowledge base saved');
                setKbDraft(null);
              }
            }}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-y font-mono leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setGeneratingKB(true);
                try {
                  const data = await workspaces.generateKnowledgeBase(workspaceId) as { knowledgeBase: string; pagesScraped: number };
                  setKbDraft(data.knowledgeBase);
                  toast(`Knowledge base generated from ${data.pagesScraped} pages — review and save`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Failed to generate', 'error');
                } finally {
                  setGeneratingKB(false);
                }
              }}
              disabled={generatingKB || !webflowSiteId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generatingKB ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Crawling site...</> : <><Sparkles className="w-3.5 h-3.5" /> Generate from Website</>}
            </button>
            {kbDraft !== null && kbDraft !== (ws?.knowledgeBase || '') && (
              <span className="text-[11px] text-amber-400">Unsaved changes — click outside the textarea to save</span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500">
            This context is shared with both the client Insights Engine and Admin Insights chatbots.
            You can also place <code className="text-zinc-400">.txt</code> or <code className="text-zinc-400">.md</code> files in the <code className="text-zinc-400">knowledge-docs/</code> folder for longer documents.
          </p>
        </div>
      </section>

      {/* ═══ AUDIENCE PERSONAS ═══ */}
      <section className="overflow-hidden bg-zinc-900 border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Audience Personas</h3>
            <p className="text-xs text-zinc-500">Define target audience segments — used in content briefs and AI writing prompts</p>
          </div>
          <button
            onClick={() => {
              if (!showPersonas) setLocalPersonas(ws?.personas || []);
              setShowPersonas(!showPersonas);
              setEditingPersonaId(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: themeColor('#27272a', '#e2e8f0'), color: themeColor('#a1a1aa', '#64748b') }}>
            {showPersonas ? 'Close' : <><Plus className="w-3 h-3" /> Manage</>}
          </button>
        </div>

        {/* Summary when collapsed */}
        {!showPersonas && (
          <div className="px-5 py-3">
            {(ws?.personas?.length || 0) > 0 ? (
              <div className="flex flex-wrap gap-2">
                {ws!.personas!.map(p => (
                  <span key={p.id} className="text-[11px] px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {p.name}{p.buyingStage ? ` · ${p.buyingStage}` : ''}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[11px] text-zinc-500">No personas defined — AI will use generic audience targeting</span>
            )}
          </div>
        )}

        {/* Expanded persona manager */}
        {showPersonas && (
          <div className="px-5 py-4 space-y-4">
            {/* Existing personas */}
            {localPersonas.map(p => (
              <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200">{p.name}</span>
                    {p.buyingStage && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{p.buyingStage}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => {
                      if (editingPersonaId === p.id) { setEditingPersonaId(null); return; }
                      setEditingPersonaId(p.id);
                      setPersonaDraft({
                        name: p.name, description: p.description,
                        painPoints: p.painPoints.join('\n'), goals: p.goals.join('\n'),
                        objections: p.objections.join('\n'),
                        preferredContentFormat: p.preferredContentFormat || '',
                        buyingStage: p.buyingStage || '',
                      });
                    }} className="p-1 rounded text-zinc-500 hover:text-zinc-300"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => setLocalPersonas(prev => prev.filter(x => x.id !== p.id))}
                      className="p-1 rounded text-zinc-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
                {editingPersonaId !== p.id && (
                  <div className="px-3 pb-2.5 text-[11px] text-zinc-500">{p.description}</div>
                )}
                {editingPersonaId === p.id && (
                  <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-zinc-500 block mb-0.5">Name</label>
                        <input value={personaDraft.name} onChange={e => setPersonaDraft(d => ({ ...d, name: e.target.value }))}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none focus:border-teal-500" />
                      </div>
                      <div>
                        <label className="text-[11px] text-zinc-500 block mb-0.5">Buying Stage</label>
                        <select value={personaDraft.buyingStage} onChange={e => setPersonaDraft(d => ({ ...d, buyingStage: e.target.value }))}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none cursor-pointer">
                          <option value="">None</option>
                          <option value="awareness">Awareness</option>
                          <option value="consideration">Consideration</option>
                          <option value="decision">Decision</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-zinc-500 block mb-0.5">Description</label>
                      <input value={personaDraft.description} onChange={e => setPersonaDraft(d => ({ ...d, description: e.target.value }))}
                        placeholder="Who is this person?"
                        className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-zinc-500 block mb-0.5">Pain Points (one per line)</label>
                        <textarea value={personaDraft.painPoints} onChange={e => setPersonaDraft(d => ({ ...d, painPoints: e.target.value }))}
                          rows={3} className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none" />
                      </div>
                      <div>
                        <label className="text-[11px] text-zinc-500 block mb-0.5">Goals (one per line)</label>
                        <textarea value={personaDraft.goals} onChange={e => setPersonaDraft(d => ({ ...d, goals: e.target.value }))}
                          rows={3} className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none" />
                      </div>
                      <div>
                        <label className="text-[11px] text-zinc-500 block mb-0.5">Objections (one per line)</label>
                        <textarea value={personaDraft.objections} onChange={e => setPersonaDraft(d => ({ ...d, objections: e.target.value }))}
                          rows={3} className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-zinc-500 block mb-0.5">Preferred Content Format</label>
                      <input value={personaDraft.preferredContentFormat} onChange={e => setPersonaDraft(d => ({ ...d, preferredContentFormat: e.target.value }))}
                        placeholder="e.g. how-to guides, case studies, comparison articles"
                        className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                    </div>
                    <button onClick={() => {
                      setLocalPersonas(prev => prev.map(x => x.id === p.id ? {
                        ...x, name: personaDraft.name.trim(), description: personaDraft.description.trim(),
                        painPoints: personaDraft.painPoints.split('\n').map(s => s.trim()).filter(Boolean),
                        goals: personaDraft.goals.split('\n').map(s => s.trim()).filter(Boolean),
                        objections: personaDraft.objections.split('\n').map(s => s.trim()).filter(Boolean),
                        preferredContentFormat: personaDraft.preferredContentFormat.trim() || undefined,
                        buyingStage: (personaDraft.buyingStage || undefined) as AudiencePersona['buyingStage'],
                      } : x));
                      setEditingPersonaId(null);
                    }} className="flex items-center gap-1 px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-medium transition-colors">
                      <Check className="w-3 h-3" /> Apply Changes
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Add new persona */}
            <button onClick={() => {
              const newP: AudiencePersona = {
                id: `persona_${Date.now()}`, name: 'New Persona', description: '',
                painPoints: [], goals: [], objections: [],
              };
              setLocalPersonas(prev => [...prev, newP]);
              setEditingPersonaId(newP.id);
              setPersonaDraft({ name: newP.name, description: '', painPoints: '', goals: '', objections: '', preferredContentFormat: '', buyingStage: '' });
            }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors w-full justify-center">
              <Plus className="w-3 h-3" /> Add Persona
            </button>

            {/* Save button */}
            <div className="pt-2 border-t border-zinc-800 flex items-center gap-3">
              <button
                disabled={savingPersonas}
                onClick={async () => {
                  setSavingPersonas(true);
                  try {
                    await patchWorkspace({ personas: localPersonas });
                    toast('Audience personas saved');
                  } catch { toast('Failed to save personas', 'error'); }
                  finally { setSavingPersonas(false); }
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                {savingPersonas ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Personas
              </button>
              <button
                onClick={async () => {
                  setGeneratingPersonas(true);
                  try {
                    const data = await workspaces.generatePersonas(workspaceId) as { personas: AudiencePersona[]; pagesScraped: number };
                    setLocalPersonas(data.personas);
                    toast(`${data.personas.length} personas generated from ${data.pagesScraped} pages — review and save`);
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Failed to generate', 'error');
                  } finally {
                    setGeneratingPersonas(false);
                  }
                }}
                disabled={generatingPersonas || !webflowSiteId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generatingPersonas ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Crawling site...</> : <><Sparkles className="w-3.5 h-3.5" /> Generate from Website</>}
              </button>
              <span className="text-[11px] text-zinc-500">{localPersonas.length} persona{localPersonas.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        )}
      </section>

      {/* Info footer */}
      <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 px-4 py-3">
        <div className="flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
          <div className="text-[11px] text-zinc-500">
            <strong className="text-zinc-400">How it works:</strong> These three sources — brand voice, knowledge base, and personas — are automatically
            injected into every AI-generated output: content briefs, blog posts, SEO rewrites, and chatbot conversations.
            The more context you provide, the more accurate and on-brand the AI outputs will be.
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
