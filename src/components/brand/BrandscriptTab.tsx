import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Plus, Trash2, Sparkles, ChevronDown, ChevronUp,
  Save, Loader2, FileText,
} from 'lucide-react';
import { brandscripts } from '../../api/brand-engine';
import { ApiError } from '../../api/client';
import type { Brandscript, BrandscriptSection, BrandscriptTemplate } from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton, Icon, Button, ClickableRow, IconButton, cn, ConfirmDialog, FormInput, FormSelect, FormTextarea } from '../ui';
import { useToast } from '../Toast';
import { queryKeys } from '../../lib/queryKeys';

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
    <SectionCard title="New Brandscript">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="bs-name" className="t-caption text-[var(--brand-text-muted)]">Name</label>
          <FormInput
            id="bs-name"
            value={name}
            onChange={setName}
            placeholder="e.g. StoryBrand 2024"
            className="w-full"
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bs-framework" className="t-caption text-[var(--brand-text-muted)]">Framework (optional)</label>
          <FormSelect
            id="bs-framework"
            value={frameworkType}
            onChange={setFrameworkType}
            options={[
              { value: '', label: 'Custom (blank)' },
              ...templates.map(t => ({ value: t.id, label: t.name })),
            ]}
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-600"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="submit"
            disabled={!name.trim() || submitting}
            variant="primary"
            size="sm"
            icon={submitting ? Loader2 : Plus}
            loading={submitting}
          >
            Create
          </Button>
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost"
            size="sm"
          >
            Cancel
          </Button>
        </div>
      </form>
    </SectionCard>
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
    <SectionCard title="Import Brandscript">
      <form onSubmit={handleImport} className="space-y-4">
        <p className="t-caption text-[var(--brand-text-muted)]">
          Paste existing brandscript copy — sections will be automatically detected.
        </p>

        <div className="space-y-1">
          <label htmlFor="import-name" className="t-caption text-[var(--brand-text-muted)]">Name (optional)</label>
          <FormInput
            id="import-name"
            value={name}
            onChange={setName}
            placeholder="e.g. Imported v1"
            className="w-full"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="import-raw-text" className="t-caption text-[var(--brand-text-muted)]">Raw text</label>
          <FormTextarea
            id="import-raw-text"
            value={rawText}
            onChange={setRawText}
            placeholder="Paste your brandscript content here..."
            rows={8}
            className="w-full"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="submit"
            disabled={!rawText.trim() || submitting}
            variant="primary"
            size="sm"
            icon={submitting ? Loader2 : FileText}
            loading={submitting}
          >
            Import
          </Button>
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost"
            size="sm"
          >
            Cancel
          </Button>
        </div>
      </form>
    </SectionCard>
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
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast('This brandscript was updated by another session. Reload to see the latest changes.', 'error');
      } else {
        toast('Failed to save section', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    // pr-check-disable-next-line -- expandable section editor: the entire header row IS the toggle button, SectionCard title would duplicate it
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] overflow-hidden">
      <ClickableRow
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 text-left"
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-[var(--brand-text-bright)]">{section.title}</span>
          {!expanded && section.content && (
            <p className="t-caption text-[var(--brand-text-muted)] truncate mt-0.5">{section.content}</p>
          )}
          {!expanded && !section.content && (
            <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">Empty — click to edit</p>
          )}
        </div>
        {expanded ? (
          <Icon as={ChevronUp} size="md" className="text-[var(--brand-text-muted)] shrink-0 ml-2" />
        ) : (
          <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] shrink-0 ml-2" />
        )}
      </ClickableRow>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--brand-border)]">
          {section.purpose && (
            <p className="t-caption text-[var(--brand-text-muted)] pt-3 italic">{section.purpose}</p>
          )}
          <FormTextarea
            value={content}
            onChange={setContent}
            rows={5}
            placeholder="Enter section content..."
            className="w-full"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              variant="primary"
              size="sm"
              icon={saving ? Loader2 : Save}
              loading={saving}
            >
              Save
            </Button>
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
      brandscript.updatedAt,
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
        <Button
          onClick={onBack}
          aria-label="Back to all brandscripts"
          variant="ghost"
          size="sm"
          className="px-0 py-0 h-auto min-h-0 t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
        >
          ← All brandscripts
        </Button>
        <span className="text-[var(--brand-text-muted)]">/</span>
        <span className="text-sm font-semibold text-[var(--brand-text-bright)] truncate">{brandscript.name}</span>
        {brandscript.frameworkType && (
          <span className="t-caption text-[var(--brand-text-muted)] bg-[var(--surface-3)] rounded px-2 py-0.5">
            {brandscript.frameworkType}
          </span>
        )}
      </div>

      {/* Mode toggle + AI complete */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className={cn('flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-md)] p-1')}>
          <Button
            onClick={() => setMode('edit')}
            variant="ghost"
            size="sm"
            className={cn(
              'px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
              mode === 'edit'
                ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text-bright)]'
                : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
            )}
          >
            Edit sections
          </Button>
          <Button
            onClick={() => setMode('import')}
            variant="ghost"
            size="sm"
            className={cn(
              'px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
              mode === 'import'
                ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text-bright)]'
                : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
            )}
          >
            Import text
          </Button>
        </div>

        {mode === 'edit' && emptySectionCount > 0 && (
          <Button
            type="button"
            onClick={handleComplete}
            disabled={completing}
            variant="primary"
            size="sm"
            icon={completing ? Loader2 : Sparkles}
            loading={completing}
          >
            {completing ? 'Completing…' : `Complete ${emptySectionCount} empty section${emptySectionCount !== 1 ? 's' : ''}`}
          </Button>
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
            <div className="text-sm text-[var(--brand-text-muted)] text-center py-8">
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const executeDelete = async (id: string) => {
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
            <Button
              type="button"
              onClick={() => setShowCreate(true)}
              variant="primary"
              size="sm"
              icon={Plus}
            >
              Create Brandscript
            </Button>
          }
        />
      </div>
    );
  }

  return (<>
    <div className="space-y-5">
      {/* Toolbar */}
      {!showCreate && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => setShowCreate(true)}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            New Brandscript
          </Button>
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
          // pr-check-disable-next-line -- list item button row, not a section card
          <ClickableRow
            key={bs.id}
            onClick={() => onSelect(bs)}
            className="text-left bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] px-4 py-3 hover:border-[var(--brand-border-hover)] group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-[var(--radius-md)] bg-teal-500/10 flex items-center justify-center shrink-0">
                  <Icon as={BookOpen} size="md" className="text-teal-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--brand-text-bright)] truncate">{bs.name}</p>
                  <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
                    {bs.frameworkType || 'Custom'} · {bs.sections.length} section{bs.sections.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <IconButton
                onClick={e => { e.stopPropagation(); setConfirmDeleteId(bs.id); }}
                disabled={deletingId === bs.id}
                icon={deletingId === bs.id ? Loader2 : Trash2}
                label="Delete brandscript"
                size="sm"
                variant="ghost"
                className={cn(
                  'shrink-0 text-[var(--brand-text-muted)] hover:text-red-400 transition-colors',
                  deletingId === bs.id && '[&_svg]:animate-spin',
                )}
              />
            </div>
          </ClickableRow>
        ))}
      </div>
    </div>

    <ConfirmDialog
      open={!!confirmDeleteId}
      title="Delete Brandscript"
      message="Delete this brandscript? This cannot be undone."
      variant="destructive"
      confirmLabel="Delete"
      onConfirm={() => {
        if (confirmDeleteId) executeDelete(confirmDeleteId);
        setConfirmDeleteId(null);
      }}
      onCancel={() => setConfirmDeleteId(null)}
    />
  </>
  );
}

// ─── Root component ──────────────────────────────────────────────────────────

export function BrandscriptTab({ workspaceId }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: items = [], isLoading: loadingList } = useQuery({
    queryKey: queryKeys.admin.brandscripts(workspaceId),
    queryFn: () => brandscripts.list(workspaceId),
  });

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: queryKeys.admin.brandscriptTemplates(),
    queryFn: () => brandscripts.templates(),
    staleTime: 5 * 60 * 1000,
  });

  const handleCreated = (bs: Brandscript) => {
    queryClient.setQueryData<Brandscript[]>(
      queryKeys.admin.brandscripts(workspaceId),
      (old) => [bs, ...(old ?? [])],
    );
    setSelectedId(bs.id);
  };

  const handleDeleted = (id: string) => {
    queryClient.setQueryData<Brandscript[]>(
      queryKeys.admin.brandscripts(workspaceId),
      prev => prev ? prev.filter(b => b.id !== id) : [],
    );
    if (selectedId === id) setSelectedId(null);
  };

  const handleUpdated = (bs: Brandscript) => {
    queryClient.setQueryData<Brandscript[]>(
      queryKeys.admin.brandscripts(workspaceId),
      prev => prev ? prev.map(b => b.id === bs.id ? bs : b) : [bs],
    );
  };

  const selectedBrandscript = items.find(b => b.id === selectedId) ?? null;

  const isLoading = loadingList || loadingTemplates;

  if (isLoading) {
    return (
      <SectionCard
        title="Brandscript Builder"
        titleIcon={<Icon as={BookOpen} size="md" className="text-teal-400" />}
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
      titleIcon={<Icon as={BookOpen} size="md" className="text-teal-400" />}
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
