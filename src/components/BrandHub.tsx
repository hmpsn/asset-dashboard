import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from './Toast';
import {
  Loader2, Save, Sparkles, BookOpen, Users, MessageSquare,
  Plus, Pencil, Trash2, Check, Upload, FileText, X, ScrollText,
} from 'lucide-react';
import { PageHeader } from './ui';
import { get, patch, post, del } from '../api/client';

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

interface BrandDocFile {
  name: string;
  size: number;
  modifiedAt: string;
}

interface WorkspaceData {
  id: string;
  webflowSiteId?: string;
  knowledgeBase?: string;
  brandVoice?: string;
  rewritePlaybook?: string;
  personas?: AudiencePersona[];
}

interface Props {
  workspaceId: string;
  webflowSiteId?: string;
}

export function BrandHub({ workspaceId, webflowSiteId }: Props) {
  const { toast } = useToast();

  // Workspace data
  const [ws, setWs] = useState<WorkspaceData | null>(null);

  // Brand Voice state
  const [brandVoice, setBrandVoice] = useState('');
  const [savingBrandVoice, setSavingBrandVoice] = useState(false);
  const [generatingBrandVoice, setGeneratingBrandVoice] = useState(false);

  // Knowledge Base state
  const [kbDraft, setKbDraft] = useState<string | null>(null);
  const [generatingKB, setGeneratingKB] = useState(false);

  // Rewriting Playbook state
  const [playbookDraft, setPlaybookDraft] = useState<string | null>(null);
  const [savingPlaybook, setSavingPlaybook] = useState(false);

  // Personas state
  const [showPersonas, setShowPersonas] = useState(false);
  const [localPersonas, setLocalPersonas] = useState<AudiencePersona[]>([]);
  const [savingPersonas, setSavingPersonas] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [personaDraft, setPersonaDraft] = useState({ name: '', description: '', painPoints: '', goals: '', objections: '', preferredContentFormat: '', buyingStage: '' as string });
  const [generatingPersonas, setGeneratingPersonas] = useState(false);

  // Brand docs state
  const [brandDocs, setBrandDocs] = useState<BrandDocFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBrandDocs = useCallback(async () => {
    try {
      const data = await get<{ files: BrandDocFile[] }>(`/api/brand-docs/${workspaceId}`);
      setBrandDocs(data.files);
    } catch (err) { console.error('BrandHub operation failed:', err); }
  }, [workspaceId]);

  const handleUploadFiles = async (files: FileList | File[]) => {
    const valid = Array.from(files).filter(f => /\.(txt|md)$/i.test(f.name));
    if (valid.length === 0) { toast('Only .txt and .md files are allowed', 'error'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      valid.forEach(f => fd.append('files', f));
      const resp = await fetch(`/api/brand-docs/${workspaceId}`, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error('Upload failed');
      const data = await resp.json();
      setBrandDocs(data.files);
      toast(`Uploaded ${data.uploaded.length} file${data.uploaded.length > 1 ? 's' : ''}`);
    } catch { toast('Upload failed', 'error'); }
    setUploading(false);
  };

  const handleDeleteDoc = async (name: string) => {
    try {
      await del(`/api/brand-docs/${workspaceId}/${encodeURIComponent(name)}`);
      setBrandDocs(prev => prev.filter(f => f.name !== name));
      toast(`Deleted ${name}`);
    } catch { toast('Failed to delete', 'error'); }
  };

  // Load workspace data
  useEffect(() => {
    get<WorkspaceData>(`/api/workspaces/${workspaceId}`).then(d => {
      setWs(d);
      if (d.brandVoice) setBrandVoice(d.brandVoice);
    }).catch((err) => { console.error('BrandHub operation failed:', err); });
    loadBrandDocs();
  }, [workspaceId, loadBrandDocs]);

  const patchWorkspace = async (fields: Record<string, unknown>) => {
    const updated = await patch<WorkspaceData>(`/api/workspaces/${workspaceId}`, fields);
    setWs(prev => prev ? { ...prev, ...updated } : updated);
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
    <div className="space-y-6">
      <PageHeader
        title="Brand & AI Context"
        subtitle="Everything that feeds into AI content generation — voice, knowledge, and audience"
        icon={<Sparkles className="w-5 h-5 text-teal-400" />}
      />

      {/* ═══ BRAND VOICE ═══ */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-violet-400" />
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
                  const data = await post<{ brandVoice: string; pagesScraped: number }>(`/api/workspaces/${workspaceId}/generate-brand-voice`);
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
        </div>
      </section>

      {/* ═══ BRAND DOCS UPLOAD ═══ */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <FileText className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Brand Documents</h3>
            <p className="text-xs text-zinc-500">
              Upload <code className="text-teal-400">.txt</code> or <code className="text-teal-400">.md</code> files — automatically included in all AI prompts alongside brand voice
            </p>
          </div>
          {brandDocs.length > 0 && <span className="text-[11px] text-emerald-400 font-medium">({brandDocs.length} file{brandDocs.length > 1 ? 's' : ''})</span>}
        </div>
        <div className="px-5 py-4 space-y-3">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleUploadFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-teal-500 bg-teal-500/5'
                : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleUploadFiles(e.target.files); e.target.value = ''; }}
            />
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <Upload className="w-5 h-5 text-zinc-500" />
                <span className="text-xs text-zinc-400">Drop .txt or .md files here, or click to browse</span>
                <span className="text-[10px] text-zinc-600">Files are injected into AI context for content generation</span>
              </div>
            )}
          </div>

          {/* File list */}
          {brandDocs.length > 0 && (
            <div className="space-y-1">
              {brandDocs.map(file => (
                <div key={file.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 group">
                  <FileText className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                  <span className="text-xs text-zinc-300 flex-1 truncate">{file.name}</span>
                  <span className="text-[10px] text-zinc-600">{(file.size / 1024).toFixed(1)} KB</span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteDoc(file.name); }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title={`Delete ${file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ KNOWLEDGE BASE ═══ */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
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
                  const data = await post<{ knowledgeBase: string; pagesScraped: number }>(`/api/workspaces/${workspaceId}/generate-knowledge-base`);
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

      {/* ═══ REWRITING PLAYBOOK ═══ */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <ScrollText className="w-4 h-4 text-orange-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Rewriting Playbook</h3>
            <p className="text-xs text-zinc-500">
              Instructions for the AI Page Rewriter — how to structure rewrites, AEO rules, formatting preferences
            </p>
          </div>
          {ws?.rewritePlaybook && <span className="text-[11px] text-emerald-400 font-medium">(configured)</span>}
        </div>
        <div className="px-5 py-4 space-y-3">
          <textarea
            value={playbookDraft !== null ? playbookDraft : (ws?.rewritePlaybook || '')}
            onChange={(e) => setPlaybookDraft(e.target.value)}
            rows={8}
            placeholder={"Example:\n- Always lead with a direct answer to the page's implied question\n- Use H2s for major sections, H3s for sub-topics\n- Include an FAQ section with 3-5 questions at the bottom\n- Add a definition-style opening sentence for key terms\n- Keep paragraphs under 3 sentences\n- Include data points and statistics where possible\n- End each section with a clear transition to the next"}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-y font-mono leading-relaxed min-h-[80px]"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setSavingPlaybook(true);
                try {
                  const val = (playbookDraft !== null ? playbookDraft : (ws?.rewritePlaybook || '')).trim();
                  await patchWorkspace({ rewritePlaybook: val });
                  toast('Rewriting playbook saved');
                  setPlaybookDraft(null);
                } catch { toast('Failed to save playbook', 'error'); }
                finally { setSavingPlaybook(false); }
              }}
              disabled={savingPlaybook}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-[11px] font-medium"
            >
              {savingPlaybook ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Playbook
            </button>
            {playbookDraft !== null && playbookDraft !== (ws?.rewritePlaybook || '') && (
              <span className="text-[11px] text-amber-400">Unsaved changes</span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500">
            These instructions are injected into the AI Page Rewriter's system prompt. Use them to enforce consistent rewriting standards across all pages.
          </p>
        </div>
      </section>

      {/* ═══ AUDIENCE PERSONAS ═══ */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
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
            style={{ backgroundColor: '#27272a', color: '#a1a1aa' }}>
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
                    const data = await post<{ personas: AudiencePersona[]; pagesScraped: number }>(`/api/workspaces/${workspaceId}/generate-personas`);
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
    </div>
  );
}
