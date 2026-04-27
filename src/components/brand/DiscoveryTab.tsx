import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import {
  Upload, FileText, Trash2, Cpu, CheckCircle, XCircle,
  Loader2, ChevronDown, Filter,
} from 'lucide-react';
import { discovery } from '../../api/brand-engine';
import type {
  DiscoverySource, DiscoveryExtraction,
  SourceType, ExtractionStatus,
} from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton, Icon, Button, cn, ConfirmDialog } from '../ui';
import { useToast } from '../Toast';

interface Props {
  workspaceId: string;
}

// ─── Source type label helpers ────────────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  transcript: 'Transcript',
  brand_doc: 'Brand Doc',
  competitor: 'Competitor',
  existing_copy: 'Existing Copy',
  website_crawl: 'Website Crawl',
};

// Note: 'website_crawl' is excluded — website crawl sources are created server-side only
const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: 'transcript', label: 'Transcript' },
  { value: 'brand_doc', label: 'Brand Doc' },
  { value: 'competitor', label: 'Competitor' },
  { value: 'existing_copy', label: 'Existing Copy' },
];

// ─── Routing destination label helpers ───────────────────────────────────────

const ROUTED_TO_LABELS: Record<string, string> = {
  voice_profile: 'Voice Profile',
  brandscript: 'Brandscript',
  identity: 'Brand Identity',
};

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: DiscoveryExtraction['confidence'] }) {
  const styles = {
    high: 'bg-teal-500/10 text-teal-400',
    medium: 'bg-amber-500/10 text-amber-400',
    low: 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded t-caption font-medium ${styles[confidence]}`}>
      {confidence}
    </span>
  );
}

// ─── Source type badge ────────────────────────────────────────────────────────

function SourceTypeBadge({ sourceType }: { sourceType: SourceType }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded t-caption font-medium bg-[var(--surface-3)] text-[var(--brand-text)]">
      {SOURCE_TYPE_LABELS[sourceType] ?? sourceType}
    </span>
  );
}

// ─── Extraction review card ───────────────────────────────────────────────────

interface ExtractionCardProps {
  extraction: DiscoveryExtraction;
  onUpdate: (id: string, patch: { status?: string; routedTo?: string }) => Promise<void>;
}

function ExtractionCard({ extraction, onUpdate }: ExtractionCardProps) {
  const [acting, setActing] = useState<'accept' | 'dismiss' | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  const handleAccept = async () => {
    setActing('accept');
    try {
      await onUpdate(extraction.id, { status: 'accepted' });
    } finally {
      setActing(null);
    }
  };

  const executeDismiss = async () => {
    setActing('dismiss');
    try {
      await onUpdate(extraction.id, { status: 'dismissed' });
    } finally {
      setActing(null);
    }
  };

  const handleDismiss = () => {
    setConfirmDismiss(true);
  };

  return (<>
    <SectionCard>
      <div className="space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <ConfidenceBadge confidence={extraction.confidence} />
            <span className="t-caption text-[var(--brand-text-muted)] bg-[var(--surface-3)] rounded px-2 py-0.5">
              {extraction.category.replace(/_/g, ' ')}
            </span>
            {extraction.routedTo && (
              <span className="t-caption text-teal-400 bg-teal-500/10 rounded px-2 py-0.5">
                → {ROUTED_TO_LABELS[extraction.routedTo] ?? extraction.routedTo}
              </span>
            )}
          </div>

          {/* Accept / Dismiss — only show on pending */}
          {extraction.status === 'pending' && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                onClick={handleAccept}
                disabled={acting !== null}
                variant="primary"
                size="sm"
                icon={CheckCircle}
                loading={acting === 'accept'}
                aria-label="Accept extraction"
              >
                Accept
              </Button>
              <Button
                type="button"
                onClick={handleDismiss}
                disabled={acting !== null}
                variant="secondary"
                size="sm"
                icon={XCircle}
                loading={acting === 'dismiss'}
                aria-label="Dismiss extraction"
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Status indicator for accepted / dismissed */}
          {extraction.status === 'accepted' && (
            <span className="t-caption text-teal-400 flex items-center gap-1">
              <Icon as={CheckCircle} size="md" />
              Accepted
            </span>
          )}
          {extraction.status === 'dismissed' && (
            <span className="t-caption text-[var(--brand-text-muted)] flex items-center gap-1">
              <Icon as={XCircle} size="md" />
              Dismissed
            </span>
          )}
        </div>

        {/* Content */}
        <p className="text-sm text-[var(--brand-text)] leading-relaxed">{extraction.content}</p>

        {/* Source quote */}
        {extraction.sourceQuote && (
          <p className="t-caption italic text-[var(--brand-text-muted)] border-l-2 border-[var(--brand-border)] pl-3">
            "{extraction.sourceQuote}"
          </p>
        )}
      </div>
    </SectionCard>

    <ConfirmDialog
      open={confirmDismiss}
      title="Dismiss Extraction"
      message="Dismiss this extraction? It will be hidden from the pending queue."
      variant="destructive"
      confirmLabel="Dismiss"
      onConfirm={() => {
        setConfirmDismiss(false);
        executeDismiss();
      }}
      onCancel={() => setConfirmDismiss(false)}
    />
  </>
  );
}

// ─── Extractions panel (for a specific source) ─────────────────────────────

interface ExtractionsPanelProps {
  workspaceId: string;
  source: DiscoverySource;
  onBack: () => void;
}

type StatusFilter = ExtractionStatus | 'all';

function ExtractionsPanel({ workspaceId, source, onBack }: ExtractionsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');

  // React Query prefix matching: the 2-segment invalidation key in useWorkspaceEvents
  // covers this 3-segment key automatically — all source extractions are refreshed
  // when any discovery update is broadcast.
  const { data: extractions = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.discoveryExtractions(workspaceId, source.id),
    queryFn: () => discovery.listExtractionsBySource(workspaceId, source.id),
  });

  const handleUpdate = useCallback(async (id: string, patch: { status?: string; routedTo?: string }) => {
    try {
      await discovery.updateExtraction(workspaceId, id, patch);
      // Invalidate both the source-specific and workspace-wide extraction caches
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoveryExtractionsAll(workspaceId) });
      toast(patch.status === 'accepted' ? 'Extraction accepted' : 'Extraction dismissed');
    } catch {
      toast('Failed to update extraction', 'error');
    }
  }, [workspaceId, queryClient, toast]);

  const filters: { value: StatusFilter; label: string }[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'dismissed', label: 'Dismissed' },
    { value: 'all', label: 'All' },
  ];

  const filtered = statusFilter === 'all'
    ? extractions
    : extractions.filter(e => e.status === statusFilter);

  const pendingCount = extractions.filter(e => e.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Back navigation */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to sources"
          className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
        >
          ← All sources
        </button>
        <span className="text-[var(--brand-border-hover)]">/</span>
        <span className="text-sm font-semibold text-[var(--brand-text)] truncate">{source.filename}</span>
        <SourceTypeBadge sourceType={source.sourceType} />
        {pendingCount > 0 && (
          <span className="t-caption text-amber-400 bg-amber-500/10 rounded px-2 py-0.5">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-2">
        <Icon as={Filter} size="md" className="text-[var(--brand-text-muted)] shrink-0" />
        <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-md)] p-1">
          {filters.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
                statusFilter === f.value
                  ? 'bg-[var(--surface-2)] text-[var(--brand-text-bright)]'
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Extractions */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={statusFilter === 'all' ? 'No extractions yet' : `No ${statusFilter} extractions`}
          description={
            statusFilter === 'all'
              ? 'Process this source to extract brand insights.'
              : `No extractions with status "${statusFilter}" for this source.`
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(extraction => (
            <ExtractionCard
              key={extraction.id}
              extraction={extraction}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Text paste form ──────────────────────────────────────────────────────────

interface TextPasteFormProps {
  workspaceId: string;
  onUploaded: () => void;
  onCancel: () => void;
}

function TextPasteForm({ workspaceId, onUploaded, onCancel }: TextPasteFormProps) {
  const { toast } = useToast();
  const [rawContent, setRawContent] = useState('');
  const [filename, setFilename] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('brand_doc');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawContent.trim()) return;
    setSubmitting(true);
    try {
      await discovery.uploadText(workspaceId, {
        filename: filename.trim() || undefined,
        sourceType,
        rawContent: rawContent.trim(),
      });
      toast('Text source added');
      onUploaded();
    } catch {
      toast('Failed to add text source', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SectionCard title="Paste Text Source">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="paste-filename" className="t-caption text-[var(--brand-text-muted)]">Name (optional)</label>
            <input
              id="paste-filename"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              placeholder="e.g. Sales call transcript"
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-600"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="paste-source-type" className="t-caption text-[var(--brand-text-muted)]">Source type</label>
            <select
              id="paste-source-type"
              value={sourceType}
              onChange={e => setSourceType(e.target.value as SourceType)}
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-600"
            >
              {SOURCE_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="paste-content" className="t-caption text-[var(--brand-text-muted)]">Content</label>
          <textarea
            id="paste-content"
            value={rawContent}
            onChange={e => setRawContent(e.target.value)}
            placeholder="Paste transcript, brand document, competitor copy, or any text to analyze..."
            rows={8}
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-600 resize-none"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="submit"
            disabled={!rawContent.trim() || submitting}
            variant="primary"
            size="md"
            icon={FileText}
            loading={submitting}
          >
            Add Source
          </Button>
          <Button
            type="button"
            onClick={onCancel}
            variant="secondary"
            size="md"
          >
            Cancel
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

interface UploadZoneProps {
  workspaceId: string;
  onUploaded: () => void;
  onCancel: () => void;
}

function UploadZone({ workspaceId, onUploaded, onCancel }: UploadZoneProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sourceType, setSourceType] = useState<SourceType>('brand_doc');
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: File[]) => {
    const valid = files.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'txt' || ext === 'md';
    });

    if (valid.length === 0) {
      toast('Only .txt and .md files are supported', 'error');
      return;
    }
    if (valid.length < files.length) {
      toast(`${files.length - valid.length} file(s) skipped — only .txt and .md are supported`);
    }

    setUploading(true);
    try {
      const result = await discovery.uploadFiles(workspaceId, valid, sourceType);
      toast(`${result.sources.length} file${result.sources.length !== 1 ? 's' : ''} uploaded`);
      onUploaded();
    } catch {
      toast('Failed to upload files', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  };

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) handleFiles(files);
    // Reset input so re-selecting the same file triggers onChange
    e.target.value = '';
  };

  return (
    <SectionCard title="Upload Files">
      <div className="space-y-4">
        <p className="t-caption text-[var(--brand-text-muted)]">.txt and .md files only — transcripts, brand documents, etc.</p>

        {/* Source type selector */}
        <div className="space-y-1">
          <label htmlFor="upload-source-type" className="t-caption text-[var(--brand-text-muted)]">Source type</label>
          <select
            id="upload-source-type"
            value={sourceType}
            onChange={e => setSourceType(e.target.value as SourceType)}
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] focus:outline-none focus:border-teal-600"
          >
            {SOURCE_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            'border-2 border-dashed rounded-[var(--radius-xl)] p-8 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer',
            dragOver
              ? 'border-teal-500 bg-teal-500/5'
              : 'border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]'
          )}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          aria-label="Drop files here or click to browse"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        >
          {uploading ? (
            <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
          ) : (
            <Icon as={Upload} size="2xl" className={cn('transition-colors', dragOver ? 'text-teal-400' : 'text-[var(--brand-text-muted)]')} />
          )}
          <div className="text-center">
            <p className="text-sm text-[var(--brand-text-muted)]">
              {uploading ? 'Uploading…' : 'Drop files here'}
            </p>
            {!uploading && (
              <p className="t-caption text-[var(--brand-text-muted)] mt-1">or click to browse</p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            multiple
            onChange={handleBrowse}
            className="hidden"
            aria-hidden="true"
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onCancel}
            variant="secondary"
            size="md"
          >
            Cancel
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Source row ───────────────────────────────────────────────────────────────

interface SourceRowProps {
  source: DiscoverySource;
  onProcess: (source: DiscoverySource) => Promise<void>;
  onDelete: (source: DiscoverySource) => void;
  onViewExtractions: (source: DiscoverySource) => void;
  processing: boolean;
  anyProcessing: boolean;
  deletingId: string | null;
}

function SourceRow({ source, onProcess, onDelete, onViewExtractions, processing, anyProcessing, deletingId }: SourceRowProps) {
  const isDeleting = deletingId === source.id;
  const isProcessed = !!source.processedAt;

  const uploadDate = new Date(source.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    // pr-check-disable-next-line -- list item row with inline controls, not a section card
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--surface-3)] flex items-center justify-center shrink-0">
          <Icon as={FileText} size="md" className="text-[var(--brand-text-muted)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-[var(--brand-text)] truncate">{source.filename}</p>
            <SourceTypeBadge sourceType={source.sourceType} />
            {isProcessed && (
              <span className="t-caption text-teal-400 bg-teal-500/10 rounded px-2 py-0.5">
                Processed
              </span>
            )}
          </div>
          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">{uploadDate}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* View extractions button (if processed) */}
        {isProcessed && (
          <Button
            type="button"
            onClick={() => onViewExtractions(source)}
            variant="secondary"
            size="sm"
            icon={ChevronDown}
          >
            Extractions
          </Button>
        )}

        {/* Process button (if not yet processed) */}
        {!isProcessed && (
          <Button
            type="button"
            onClick={() => onProcess(source)}
            disabled={anyProcessing}
            variant="primary"
            size="sm"
            icon={Cpu}
            loading={processing}
          >
            {processing ? 'Processing…' : 'Process'}
          </Button>
        )}

        {/* Delete button */}
        <button
          type="button"
          onClick={() => onDelete(source)}
          disabled={isDeleting}
          aria-label="Delete source"
          className="text-[var(--brand-text-muted)] hover:text-red-400 transition-colors p-1.5 rounded disabled:opacity-50"
        >
          {isDeleting ? (
            <Icon as={Loader2} size="md" className="animate-spin" />
          ) : (
            <Icon as={Trash2} size="md" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Upload panel (toggle between file and text) ──────────────────────────────

type UploadMode = 'file' | 'text';

interface UploadPanelProps {
  workspaceId: string;
  onUploaded: () => void;
  onCancel: () => void;
}

function UploadPanel({ workspaceId, onUploaded, onCancel }: UploadPanelProps) {
  const [mode, setMode] = useState<UploadMode>('file');

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-md)] p-1 w-fit">
        <button
          type="button"
          onClick={() => setMode('file')}
          className={cn(
            'px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
            mode === 'file' ? 'bg-[var(--surface-2)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
          )}
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={cn(
            'px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
            mode === 'text' ? 'bg-[var(--surface-2)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
          )}
        >
          Paste text
        </button>
      </div>

      {mode === 'file' ? (
        <UploadZone workspaceId={workspaceId} onUploaded={onUploaded} onCancel={onCancel} />
      ) : (
        <TextPasteForm workspaceId={workspaceId} onUploaded={onUploaded} onCancel={onCancel} />
      )}
    </div>
  );
}

// ─── Sources list view ────────────────────────────────────────────────────────

interface SourcesListProps {
  workspaceId: string;
  sources: DiscoverySource[];
  onViewExtractions: (source: DiscoverySource) => void;
}

function SourcesList({ workspaceId, sources, onViewExtractions }: SourcesListProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<DiscoverySource | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoverySources(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.discoveryExtractionsAll(workspaceId) });
  };

  const handleUploaded = () => {
    setShowUpload(false);
    invalidate();
  };

  const handleProcess = async (source: DiscoverySource) => {
    setProcessingId(source.id);
    try {
      const result = await discovery.process(workspaceId, source.id);
      toast(`Extracted ${result.extractions.length} insight${result.extractions.length !== 1 ? 's' : ''}`);
      invalidate();
      // Auto-navigate to extractions view after processing
      onViewExtractions({ ...source, processedAt: new Date().toISOString() });
    } catch (err) {
      // Surface "already processed" error distinctly
      const msg = err instanceof Error ? err.message : 'Processing failed';
      toast(msg, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (source: DiscoverySource) => {
    setDeletingId(source.id);
    try {
      await discovery.deleteSource(workspaceId, source.id);
      toast('Source deleted');
      invalidate();
    } catch {
      toast('Failed to delete source', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  if (sources.length === 0 && !showUpload) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={Upload}
          title="No sources yet"
          description="Upload transcripts, brand documents, or competitor copy to extract brand insights."
          action={
            <Button
              type="button"
              onClick={() => setShowUpload(true)}
              variant="primary"
              size="md"
              icon={Upload}
            >
              Add Source
            </Button>
          }
        />
      </div>
    );
  }

  return (<>
    <div className="space-y-5">
      {/* Toolbar */}
      {!showUpload && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => setShowUpload(true)}
            variant="primary"
            size="md"
            icon={Upload}
          >
            Add Source
          </Button>
        </div>
      )}

      {showUpload && (
        <UploadPanel
          workspaceId={workspaceId}
          onUploaded={handleUploaded}
          onCancel={() => setShowUpload(false)}
        />
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <div className="space-y-3">
          {sources.map(source => (
            <SourceRow
              key={source.id}
              source={source}
              onProcess={handleProcess}
              onDelete={(s: DiscoverySource) => setConfirmDeleteSource(s)}
              onViewExtractions={onViewExtractions}
              processing={processingId === source.id}
              anyProcessing={processingId !== null}
              deletingId={deletingId}
            />
          ))}
        </div>
      )}
    </div>

    <ConfirmDialog
      open={!!confirmDeleteSource}
      title="Delete Source"
      message={confirmDeleteSource ? `Delete "${confirmDeleteSource.filename}"? This will also remove all extractions from this source.` : ''}
      variant="destructive"
      confirmLabel="Delete"
      onConfirm={() => {
        if (confirmDeleteSource) handleDelete(confirmDeleteSource);
        setConfirmDeleteSource(null);
      }}
      onCancel={() => setConfirmDeleteSource(null)}
    />
  </>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function DiscoveryTab({ workspaceId }: Props) {
  const [selectedSource, setSelectedSource] = useState<DiscoverySource | null>(null);

  const { data: sources = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.discoverySources(workspaceId),
    queryFn: () => discovery.listSources(workspaceId),
  });

  // Keep selectedSource in sync when sources list refreshes
  const syncedSource = selectedSource
    ? (sources.find(s => s.id === selectedSource.id) ?? selectedSource)
    : null;

  if (isLoading) {
    return (
      <SectionCard
        title="Discovery Ingestion"
        titleIcon={<Icon as={Cpu} size="md" className="text-teal-400" />}
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
      title="Discovery Ingestion"
      titleIcon={<Icon as={Cpu} size="md" className="text-teal-400" />}
    >
      {syncedSource ? (
        <ExtractionsPanel
          workspaceId={workspaceId}
          source={syncedSource}
          onBack={() => setSelectedSource(null)}
        />
      ) : (
        <SourcesList
          workspaceId={workspaceId}
          sources={sources}
          onViewExtractions={setSelectedSource}
        />
      )}
    </SectionCard>
  );
}
