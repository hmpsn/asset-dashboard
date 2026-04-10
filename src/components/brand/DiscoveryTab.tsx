import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '../../hooks/useWebSocket';
import {
  Upload, FileText, Trash2, Cpu, CheckCircle, XCircle,
  Loader2, ChevronDown, Filter,
} from 'lucide-react';
import { discovery } from '../../api/brand-engine';
import type {
  DiscoverySource, DiscoveryExtraction,
  SourceType, ExtractionStatus,
} from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton, Badge } from '../ui';
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
    low: 'bg-zinc-700 text-zinc-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[confidence]}`}>
      {confidence}
    </span>
  );
}

// ─── Source type badge ────────────────────────────────────────────────────────

function SourceTypeBadge({ sourceType }: { sourceType: SourceType }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-700 text-zinc-300">
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

  const handleAccept = async () => {
    setActing('accept');
    try {
      await onUpdate(extraction.id, { status: 'accepted' });
    } finally {
      setActing(null);
    }
  };

  const handleDismiss = async () => {
    if (!window.confirm('Dismiss this extraction? It will be hidden from the pending queue.')) return;
    setActing('dismiss');
    try {
      await onUpdate(extraction.id, { status: 'dismissed' });
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ConfidenceBadge confidence={extraction.confidence} />
          <span className="text-xs text-zinc-500 bg-zinc-800 rounded px-2 py-0.5">
            {extraction.category.replace(/_/g, ' ')}
          </span>
          {extraction.routedTo && (
            <span className="text-xs text-teal-400 bg-teal-500/10 rounded px-2 py-0.5">
              → {ROUTED_TO_LABELS[extraction.routedTo] ?? extraction.routedTo}
            </span>
          )}
        </div>

        {/* Accept / Dismiss — only show on pending */}
        {extraction.status === 'pending' && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleAccept}
              disabled={acting !== null}
              aria-label="Accept extraction"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {acting === 'accept' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              Accept
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              disabled={acting !== null}
              aria-label="Dismiss extraction"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {acting === 'dismiss' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <XCircle className="w-3.5 h-3.5" />
              )}
              Dismiss
            </button>
          </div>
        )}

        {/* Status indicator for accepted / dismissed */}
        {extraction.status === 'accepted' && (
          <span className="text-xs text-teal-400 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" />
            Accepted
          </span>
        )}
        {extraction.status === 'dismissed' && (
          <span className="text-xs text-zinc-500 flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5" />
            Dismissed
          </span>
        )}
      </div>

      {/* Content */}
      <p className="text-sm text-zinc-200 leading-relaxed">{extraction.content}</p>

      {/* Source quote */}
      {extraction.sourceQuote && (
        <p className="text-xs italic text-zinc-500 border-l-2 border-zinc-700 pl-3">
          "{extraction.sourceQuote}"
        </p>
      )}
    </div>
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

  // React Query prefix matching: the 2-segment invalidation key in useWebSocket
  // covers this 3-segment key automatically — all source extractions are refreshed
  // when any discovery update is broadcast.
  const { data: extractions = [], isLoading } = useQuery({
    queryKey: ['admin-discovery-extractions', workspaceId, source.id],
    queryFn: () => discovery.listExtractionsBySource(workspaceId, source.id),
  });

  const handleUpdate = useCallback(async (id: string, patch: { status?: string; routedTo?: string }) => {
    try {
      await discovery.updateExtraction(workspaceId, id, patch);
      // Invalidate both the source-specific and workspace-wide extraction caches
      queryClient.invalidateQueries({ queryKey: ['admin-discovery-extractions', workspaceId] });
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
          className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          ← All sources
        </button>
        <span className="text-zinc-700">/</span>
        <span className="text-sm font-semibold text-zinc-200 truncate">{source.filename}</span>
        <SourceTypeBadge sourceType={source.sourceType} />
        {pendingCount > 0 && (
          <span className="text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-0.5">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-1">
          {filters.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
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
    <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">Paste Text Source</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="paste-filename" className="text-xs text-zinc-400">Name (optional)</label>
          <input
            id="paste-filename"
            value={filename}
            onChange={e => setFilename(e.target.value)}
            placeholder="e.g. Sales call transcript"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="paste-source-type" className="text-xs text-zinc-400">Source type</label>
          <select
            id="paste-source-type"
            value={sourceType}
            onChange={e => setSourceType(e.target.value as SourceType)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-teal-600"
          >
            {SOURCE_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="paste-content" className="text-xs text-zinc-400">Content</label>
        <textarea
          id="paste-content"
          value={rawContent}
          onChange={e => setRawContent(e.target.value)}
          placeholder="Paste transcript, brand document, competitor copy, or any text to analyze..."
          rows={8}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 resize-none"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={!rawContent.trim() || submitting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Add Source
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">Upload Files</h3>
      <p className="text-xs text-zinc-400">.txt and .md files only — transcripts, brand documents, etc.</p>

      {/* Source type selector */}
      <div className="space-y-1">
        <label htmlFor="upload-source-type" className="text-xs text-zinc-400">Source type</label>
        <select
          id="upload-source-type"
          value={sourceType}
          onChange={e => setSourceType(e.target.value as SourceType)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-teal-600"
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
        className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer ${
          dragOver
            ? 'border-teal-500 bg-teal-500/5'
            : 'border-zinc-700 hover:border-zinc-600'
        }`}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        aria-label="Drop files here or click to browse"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        {uploading ? (
          <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
        ) : (
          <Upload className={`w-8 h-8 transition-colors ${dragOver ? 'text-teal-400' : 'text-zinc-600'}`} />
        )}
        <div className="text-center">
          <p className="text-sm text-zinc-400">
            {uploading ? 'Uploading…' : 'Drop files here'}
          </p>
          {!uploading && (
            <p className="text-xs text-zinc-600 mt-1">or click to browse</p>
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
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Source row ───────────────────────────────────────────────────────────────

interface SourceRowProps {
  source: DiscoverySource;
  onProcess: (source: DiscoverySource) => Promise<void>;
  onDelete: (source: DiscoverySource) => Promise<void>;
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-zinc-200 truncate">{source.filename}</p>
            <SourceTypeBadge sourceType={source.sourceType} />
            {isProcessed && (
              <span className="text-xs text-teal-400 bg-teal-500/10 rounded px-2 py-0.5">
                Processed
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{uploadDate}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* View extractions button (if processed) */}
        {isProcessed && (
          <button
            type="button"
            onClick={() => onViewExtractions(source)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Extractions
          </button>
        )}

        {/* Process button (if not yet processed) */}
        {!isProcessed && (
          <button
            type="button"
            onClick={() => onProcess(source)}
            disabled={anyProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {processing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Cpu className="w-3.5 h-3.5" />
            )}
            {processing ? 'Processing…' : 'Process'}
          </button>
        )}

        {/* Delete button */}
        <button
          type="button"
          onClick={() => onDelete(source)}
          disabled={isDeleting}
          aria-label="Delete source"
          className="text-zinc-600 hover:text-red-400 transition-colors p-1.5 rounded disabled:opacity-50"
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
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
      <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            mode === 'file' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            mode === 'text' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-discovery-sources', workspaceId] });
    queryClient.invalidateQueries({ queryKey: ['admin-discovery-extractions', workspaceId] });
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
    if (!window.confirm(`Delete "${source.filename}"? This will also remove all extractions from this source.`)) return;
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
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium transition-all"
            >
              <Upload className="w-4 h-4" />
              Add Source
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      {!showUpload && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium transition-all"
          >
            <Upload className="w-4 h-4" />
            Add Source
          </button>
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
              onDelete={handleDelete}
              onViewExtractions={onViewExtractions}
              processing={processingId === source.id}
              anyProcessing={processingId !== null}
              deletingId={deletingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function DiscoveryTab({ workspaceId }: Props) {
  const queryClient = useQueryClient();
  const [selectedSource, setSelectedSource] = useState<DiscoverySource | null>(null);

  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['admin-discovery-sources', workspaceId],
    queryFn: () => discovery.listSources(workspaceId),
  });

  // Invalidate on server-pushed discovery events
  useWebSocket({
    'discovery:updated': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-discovery-sources', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['admin-discovery-extractions', workspaceId] });
    },
  });

  // Keep selectedSource in sync when sources list refreshes
  const syncedSource = selectedSource
    ? (sources.find(s => s.id === selectedSource.id) ?? selectedSource)
    : null;

  if (isLoading) {
    return (
      <SectionCard
        title="Discovery Ingestion"
        titleIcon={<Cpu className="w-4 h-4 text-teal-400" />}
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
      titleIcon={<Cpu className="w-4 h-4 text-teal-400" />}
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
