import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import {
  BookOpen, Plus, Trash2, Sparkles, ChevronDown, ChevronUp,
  Save, Loader2, FileText,
} from 'lucide-react';
import { brandscripts } from '../../api/brand-engine';
import type { Brandscript, BrandscriptSection, BrandscriptTemplate } from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton } from '../ui';
import { useToast } from '../Toast';

interface Props {
  workspaceId: string;
}

// ─── Create form ───────────────────────────────────────────────────────────

interface CreateFormProps {
  workspaceId: string;
  templates: BrandscriptTemplate[];
  onCreated: (bs: Brandscript) => void;
  onCancel: () => void;
}

function CreateForm({ workspaceId, templates, onCreated, onCancel }: CreateFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [frameworkType, setFrameworkType] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const bs = await brandscripts.create(workspaceId, {
        name: name.trim(),
        frameworkType: frameworkType || undefined,
      });
      toast('Brandscript created');
      onCreated(bs);
    } catch {
      toast('Failed to create brandscript', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">New Brandscript</h3>

      <div className="space-y-1">
        <label htmlFor="bs-name" className="text-xs text-zinc-400">Name</label>
        <input
          id="bs-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. StoryBrand 2024"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600"
          autoFocus
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="bs-framework" className="text-xs text-zinc-400">Framework (optional)</label>
        <select
          id="bs-framework"
          value={frameworkType}
          onChange={e => setFrameworkType(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-teal-600"
        >
          <option value="">Custom (blank)</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={!name.trim() || submitting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Import form ────────────────────────────────────────────────────────────

interface ImportFormProps {
  workspaceId: string;
  onImported: (bs: Brandscript) => void;
  onCancel: () => void;
}

function ImportForm({ workspaceId, onImported, onCancel }: ImportFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;
    setSubmitting(true);
    try {
      const bs = await brandscripts.import(workspaceId, {
        name: name.trim() || undefined,
        rawText: rawText.trim(),
      });
      toast('Brandscript imported');
      onImported(bs);
    } catch {
      toast('Failed to import brandscript', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleImport} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">Import Brandscript</h3>
      <p className="text-xs text-zinc-400">
        Paste existing brandscript copy — sections will be automatically detected.
      </p>

      <div className="space-y-1">
        <label htmlFor="import-name" className="text-xs text-zinc-400">Name (optional)</label>
        <input
          id="import-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Imported v1"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="import-raw-text" className="text-xs text-zinc-400">Raw text</label>
        <textarea
          id="import-raw-text"
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder="Paste your brandscript content here..."
          rows={8}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 resize-none font-mono"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={!rawText.trim() || submitting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Import
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Section editor card ─────────────────────────────────────────────────────

interface SectionEditorCardProps {
  section: BrandscriptSection;
  onSave: (updated: BrandscriptSection) => Promise<void>;
}

function SectionEditorCard({ section, onSave }: SectionEditorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState(section.content ?? '');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Used by the Save button — disabled while local content matches the saved
  // server value. Recomputed on every render against the *current* prop.
  const isDirty = content !== (section.content ?? '');

  // Track the last prop value we synced into local state. This is the baseline
  // for "did the user edit since the last sync?" — and it intentionally lags
  // behind `section.content` until the effect below decides whether to copy
  // the new prop into local state.
  const lastSyncedRef = useRef(section.content ?? '');

  // Sync content from prop on external updates (e.g. WebSocket-driven refetch)
  // unless the user has typed something the parent doesn't yet know about.
  // We compare against `lastSyncedRef.current`, NOT against the new prop:
  // comparing against the new prop would always read as "dirty" the moment
  // an external update arrives, and the sync would be skipped, leaving stale
  // content in the textarea.
  useEffect(() => {
    const userHasUnsavedEdits = content !== lastSyncedRef.current;
    if (!userHasUnsavedEdits) {
      setContent(section.content ?? '');
    }
    lastSyncedRef.current = section.content ?? '';
  }, [section.content]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...section, content });
      toast('Section saved');
    } catch {
      toast('Failed to save section', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-zinc-200">{section.title}</span>
          {!expanded && section.content && (
            <p className="text-xs text-zinc-500 truncate mt-0.5">{section.content}</p>
          )}
          {!expanded && !section.content && (
            <p className="text-xs text-zinc-600 mt-0.5">Empty — click to edit</p>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0 ml-2" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0 ml-2" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800">
          {section.purpose && (
            <p className="text-xs text-zinc-400 pt-3 italic">{section.purpose}</p>
          )}
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={5}
            placeholder="Enter section content..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 resize-y"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Brandscript detail view ─────────────────────────────────────────────────

interface BrandscriptDetailProps {
  workspaceId: string;
  brandscript: Brandscript;
  onBack: () => void;
  onUpdated: (bs: Brandscript) => void;
}

type DetailMode = 'edit' | 'import';

function BrandscriptDetail({ workspaceId, brandscript, onBack, onUpdated }: BrandscriptDetailProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<DetailMode>('edit');
  const [completing, setCompleting] = useState(false);

  // NOTE: we intentionally do NOT mirror `brandscript.sections` into local state.
  // React Query's cache is the single source of truth — the parent calls
  // `handleUpdated(result)` after every mutation, which writes through `setQueryData`
  // and flows a new `brandscript` prop down. Maintaining a parallel local copy is a
  // known anti-pattern (see CLAUDE.md rule 11): it drops external updates whenever
  // the sync effect's deps don't include content (e.g. a concurrent admin editing
  // the same brandscript triggers a WS refetch — same id, same count, different
  // content → stale local state). Per-section dirty tracking still lives in
  // `SectionEditorCard` via its own `lastSyncedRef`, which is where it belongs.
  const sections = brandscript.sections;

  const handleSaveSection = async (updated: BrandscriptSection) => {
    const newSections = sections.map(s => s.id === updated.id ? updated : s);
    const result = await brandscripts.updateSections(
      workspaceId,
      brandscript.id,
      newSections.map(s => ({
        id: s.id,
        title: s.title,
        purpose: s.purpose,
        content: s.content,
      })),
    );
    onUpdated(result);
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const result = await brandscripts.complete(workspaceId, brandscript.id);
      onUpdated(result);
      toast('Sections completed by AI');
    } catch {
      toast('Failed to complete sections', 'error');
    } finally {
      setCompleting(false);
    }
  };

  const handleImported = (bs: Brandscript) => {
    onUpdated(bs);
    setMode('edit');
  };

  const emptySectionCount = sections.filter(s => !s.content?.trim()).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to all brandscripts"
          className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          ← All brandscripts
        </button>
        <span className="text-zinc-700">/</span>
        <span className="text-sm font-semibold text-zinc-200 truncate">{brandscript.name}</span>
        {brandscript.frameworkType && (
          <span className="text-xs text-zinc-500 bg-zinc-800 rounded px-2 py-0.5">
            {brandscript.frameworkType}
          </span>
        )}
      </div>

      {/* Mode toggle + AI complete */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode('edit')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'edit'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Edit sections
          </button>
          <button
            type="button"
            onClick={() => setMode('import')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'import'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Import text
          </button>
        </div>

        {mode === 'edit' && emptySectionCount > 0 && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={completing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {completing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {completing ? 'Completing…' : `Complete ${emptySectionCount} empty section${emptySectionCount !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* Content */}
      {mode === 'import' ? (
        <ImportForm
          workspaceId={workspaceId}
          onImported={handleImported}
          onCancel={() => setMode('edit')}
        />
      ) : (
        <div className="space-y-3">
          {sections.length === 0 ? (
            <div className="text-sm text-zinc-500 text-center py-8">
              No sections yet.
            </div>
          ) : (
            sections
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map(section => (
                <SectionEditorCard
                  key={section.id}
                  section={section}
                  onSave={handleSaveSection}
                />
              ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────────

interface ListViewProps {
  workspaceId: string;
  items: Brandscript[];
  templates: BrandscriptTemplate[];
  onSelect: (bs: Brandscript) => void;
  onDeleted: (id: string) => void;
  onCreated: (bs: Brandscript) => void;
}

function ListView({ workspaceId, items, templates, onSelect, onDeleted, onCreated }: ListViewProps) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this brandscript? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await brandscripts.remove(workspaceId, id);
      onDeleted(id);
      toast('Brandscript deleted');
    } catch {
      toast('Failed to delete brandscript', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreated = (bs: Brandscript) => {
    setShowCreate(false);
    onCreated(bs);
  };

  if (items.length === 0 && !showCreate) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={BookOpen}
          title="No brandscripts yet"
          description="Create a StoryBrand script, a custom brand narrative, or import existing copy."
          action={
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Brandscript
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      {!showCreate && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium transition-all"
          >
            <Plus className="w-4 h-4" />
            New Brandscript
          </button>
        </div>
      )}

      {showCreate && (
        <CreateForm
          workspaceId={workspaceId}
          templates={templates}
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* List */}
      <div className="space-y-3">
        {items.map(bs => (
          <button
            key={bs.id}
            type="button"
            onClick={() => onSelect(bs)}
            className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-zinc-700 transition-colors group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
                  <BookOpen className="w-4 h-4 text-teal-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-200 truncate">{bs.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {bs.frameworkType || 'Custom'} · {bs.sections.length} section{bs.sections.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={e => handleDelete(e, bs.id)}
                disabled={deletingId === bs.id}
                className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors p-1 rounded disabled:opacity-50"
                aria-label="Delete brandscript"
              >
                {deletingId === bs.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Root component ──────────────────────────────────────────────────────────

export function BrandscriptTab({ workspaceId }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: items = [], isLoading: loadingList } = useQuery({
    queryKey: ['admin-brandscripts', workspaceId],
    queryFn: () => brandscripts.list(workspaceId),
  });

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ['admin-brandscript-templates'],
    queryFn: () => brandscripts.templates(),
    staleTime: 5 * 60 * 1000,
  });

  useWorkspaceEvents(workspaceId, {
    'brandscript:updated': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-brandscripts', workspaceId] });
    },
  });

  const handleCreated = (bs: Brandscript) => {
    queryClient.setQueryData<Brandscript[]>(
      ['admin-brandscripts', workspaceId],
      (old) => [bs, ...(old ?? [])],
    );
    setSelectedId(bs.id);
  };

  const handleDeleted = (id: string) => {
    queryClient.setQueryData<Brandscript[]>(
      ['admin-brandscripts', workspaceId],
      prev => prev ? prev.filter(b => b.id !== id) : [],
    );
    if (selectedId === id) setSelectedId(null);
  };

  const handleUpdated = (bs: Brandscript) => {
    queryClient.setQueryData<Brandscript[]>(
      ['admin-brandscripts', workspaceId],
      prev => prev ? prev.map(b => b.id === bs.id ? bs : b) : [bs],
    );
  };

  const selectedBrandscript = items.find(b => b.id === selectedId) ?? null;

  const isLoading = loadingList || loadingTemplates;

  if (isLoading) {
    return (
      <SectionCard
        title="Brandscript Builder"
        titleIcon={<BookOpen className="w-4 h-4 text-teal-400" />}
      >
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Brandscript Builder"
      titleIcon={<BookOpen className="w-4 h-4 text-teal-400" />}
    >
      {selectedBrandscript ? (
        <BrandscriptDetail
          workspaceId={workspaceId}
          brandscript={selectedBrandscript}
          onBack={() => setSelectedId(null)}
          onUpdated={handleUpdated}
        />
      ) : (
        <ListView
          workspaceId={workspaceId}
          items={items}
          templates={templates}
          onSelect={bs => setSelectedId(bs.id)}
          onDeleted={handleDeleted}
          onCreated={handleCreated}
        />
      )}
    </SectionCard>
  );
}
