import { useState, useEffect, useRef } from 'react';
import { patch, post, del, getSafe, postForm } from '../api/client';
import { Icon, Button, IconButton, ClickableRow, FormInput, FormSelect, cn } from './ui';
import { inlineMarkdownToHtml } from '../lib/inline-markdown';
import {
  MessageSquare, Send, Loader2, ChevronDown, ChevronUp,
  Trash2, ExternalLink, Clock, CheckCircle2, AlertTriangle,
  Filter, Search, Paperclip, FileText, X,
  Play, CheckCheck, ArrowRight,
} from 'lucide-react';

function SimpleMarkdown({ text }: { text: string }) {
  const inlineMd = (s: string) => inlineMarkdownToHtml(s, {
    em: 'text-[var(--brand-text-bright)]',
    code: 'bg-[var(--surface-3)] px-1 py-0.5 rounded text-[var(--brand-text-bright)] t-caption',
  });
  return (
    <div className="space-y-1">
      {text.split('\n').map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === '') return <div key={i} className="h-1" />;
        return <p key={i} className="t-caption text-[var(--brand-text-bright)] leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineMd(trimmed) }} />;
      })}
    </div>
  );
}

type RequestPriority = 'low' | 'medium' | 'high' | 'urgent';
type RequestStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';
type RequestCategory = 'bug' | 'content' | 'design' | 'seo' | 'feature' | 'other';

interface RequestAttachment { id: string; filename: string; originalName: string; mimeType: string; size: number; }

interface RequestNote {
  id: string;
  author: 'client' | 'team';
  content: string;
  attachments?: RequestAttachment[];
  createdAt: string;
}

interface ClientRequest {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  category: RequestCategory;
  priority: RequestPriority;
  status: RequestStatus;
  submittedBy?: string;
  pageUrl?: string;
  attachments?: RequestAttachment[];
  notes: RequestNote[];
  createdAt: string;
  updatedAt: string;
}

interface Workspace {
  id: string;
  name: string;
}

const STATUS_OPTIONS: { value: RequestStatus; label: string; color: string }[] = [
  { value: 'new', label: 'New', color: 'bg-blue-500/10 border-blue-500/30 text-accent-info' },
  { value: 'in_review', label: 'In Review', color: 'bg-amber-500/10 border-amber-500/30 text-accent-warning' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-teal-500/10 border-teal-500/30 text-accent-brand' },
  { value: 'on_hold', label: 'On Hold', color: 'bg-[var(--surface-3)] border-[var(--brand-border-hover)] text-[var(--brand-text)]' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-500/10 border-emerald-500/30 text-accent-success' },
  { value: 'closed', label: 'Closed', color: 'bg-[var(--surface-3)] border-[var(--brand-border-hover)] text-[var(--brand-text-muted)]' },
];

const PRIORITY_OPTIONS: { value: RequestPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-[var(--brand-text)]' },
  { value: 'medium', label: 'Medium', color: 'text-accent-info' },
  { value: 'high', label: 'High', color: 'text-accent-warning' },
  { value: 'urgent', label: 'Urgent', color: 'text-accent-danger' },
];

const CAT_LABELS: Record<string, string> = {
  bug: 'Bug', content: 'Content', design: 'Design',
  seo: 'SEO', feature: 'Feature', other: 'Other',
};

export function RequestManager({ workspaceId }: { workspaceId: string }) {
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<RequestStatus | 'all'>('all');
  const [catFilter, setCatFilter] = useState<RequestCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsFilter, setWsFilter] = useState<string>(workspaceId || 'all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  useEffect(() => {
    getSafe<Workspace[]>('/api/workspaces', []).then(setWorkspaces).catch((err) => { console.error('RequestManager operation failed:', err); });
  }, []);

  const refreshRequests = (filter?: string) => {
    const f = filter ?? wsFilter;
    const url = f && f !== 'all' ? `/api/requests?workspaceId=${f}` : '/api/requests';
    setLoading(true);
    getSafe<ClientRequest[]>(url, []).then(data => { if (Array.isArray(data)) setRequests(data); }).catch((err) => { console.error('RequestManager operation failed:', err); }).finally(() => setLoading(false));
  };

  useEffect(() => { refreshRequests(wsFilter); }, [wsFilter]); // refreshRequests is stable — reads wsFilter from closure

  const updateRequest = async (id: string, updates: Record<string, string>) => {
    try {
      const updated = await patch<ClientRequest>(`/api/requests/${id}`, updates);
      setRequests(prev => prev.map(r => r.id === id ? updated : r));
    } catch (err) { console.error('RequestManager operation failed:', err); }
  };

  const sendNote = async (requestId: string) => {
    if (!noteInput.trim() && noteFiles.length === 0) return;
    setSendingNote(true);
    try {
      let updated: ClientRequest;
      if (noteFiles.length > 0) {
        const fd = new FormData();
        fd.append('content', noteInput.trim());
        noteFiles.forEach(f => fd.append('files', f));
        updated = await postForm<ClientRequest>(`/api/requests/${requestId}/notes-with-files`, fd);
      } else {
        updated = await post<ClientRequest>(`/api/requests/${requestId}/notes`, { content: noteInput.trim() });
      }
      setRequests(prev => prev.map(r => r.id === requestId ? updated : r));
      setNoteInput(''); setNoteFiles([]);
    } catch (err) { console.error('RequestManager operation failed:', err); }
    setSendingNote(false);
  };

  const deleteReq = async (id: string) => {
    if (!confirm('Delete this request? This cannot be undone.')) return;
    try {
      await del(`/api/requests/${id}`);
      setRequests(prev => prev.filter(r => r.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      if (expandedId === id) setExpandedId(null);
    } catch (err) { console.error('RequestManager operation failed:', err); }
  };

  // Bulk operations
  const bulkUpdateStatus = async (status: RequestStatus) => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      await patch('/api/requests/bulk', { ids: Array.from(selected), status });
      setRequests(prev => prev.map(r => selected.has(r.id) ? { ...r, status, updatedAt: new Date().toISOString() } : r));
      setSelected(new Set());
    } catch (err) { console.error('RequestManager operation failed:', err); }
    setBulkUpdating(false);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected task${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkUpdating(true);
    try {
      await Promise.all(Array.from(selected).map(id => del(`/api/requests/${id}`)));
      setRequests(prev => prev.filter(r => !selected.has(r.id)));
      setSelected(new Set());
    } catch (err) { console.error('RequestManager operation failed:', err); }
    setBulkUpdating(false);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(r => r.id)));
    }
  };

  const quickStatus = async (id: string, status: RequestStatus) => {
    await updateRequest(id, { status });
  };

  const nextStatus = (current: RequestStatus): RequestStatus | null => {
    const flow: Record<string, RequestStatus> = {
      new: 'in_progress',
      in_review: 'in_progress',
      in_progress: 'completed',
      on_hold: 'in_progress',
    };
    return flow[current] || null;
  };

  const filtered = requests
    .filter(r => statusFilter === 'all' || r.status === statusFilter)
    .filter(r => catFilter === 'all' || r.category === catFilter)
    .filter(r => !searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase()) || r.description.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const counts = {
    total: requests.length,
    new: requests.filter(r => r.status === 'new').length,
    in_progress: requests.filter(r => r.status === 'in_progress' || r.status === 'in_review').length,
    completed: requests.filter(r => r.status === 'completed' || r.status === 'closed').length,
  };

  const wsName = (id: string) => workspaces.find(w => w.id === id)?.name || id;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon as={MessageSquare} size="lg" className="text-accent-brand" />
          <div>
            <h2 className="t-caption text-[var(--brand-text-bright)]">Client Requests</h2>
            <p className="t-caption mt-0.5 text-[var(--brand-text-muted)]">Review, respond to, and manage client requests across workspaces.</p>
          </div>
        </div>
      </div>

      {/* Stats + Progress */}
      {/* pr-check-disable-next-line -- request stats panel uses brand signature radius intentionally */}
      <div className="p-4 bg-[var(--surface-2)] border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-6">
            {[
              { label: 'Total', value: counts.total, cls: 'text-[var(--brand-text-bright)]' },
              { label: 'New', value: counts.new, cls: 'text-accent-info' },
              { label: 'Active', value: counts.in_progress, cls: 'text-accent-brand' },
              { label: 'Resolved', value: counts.completed, cls: 'text-accent-success' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={cn('t-h2', s.cls)}>{s.value}</div>
                <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)]">{s.label}</div>
              </div>
            ))}
          </div>
          {counts.total > 0 && (
            <div className="text-right">
              <div className="t-page font-semibold text-accent-success">
                {Math.round((counts.completed / counts.total) * 100)}%
              </div>
              <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)]">Complete</div>
            </div>
          )}
        </div>
        {counts.total > 0 && (
          <div className="h-2 bg-[var(--surface-1)] rounded-[var(--radius-pill)] overflow-hidden">
            <div className="h-full rounded-[var(--radius-pill)] transition-all duration-500 bg-emerald-400" style={{ width: `${(counts.completed / counts.total) * 100}%` }} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Icon as={Filter} size="sm" className="text-[var(--brand-text-muted)]" />
        </div>
        <FormSelect
          value={wsFilter}
          onChange={setWsFilter}
          options={[{ value: 'all', label: 'All Workspaces' }, ...workspaces.map(w => ({ value: w.id, label: w.name }))]}
          className="px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-2)] text-[var(--brand-text-bright)]"
        />
        <FormSelect
          value={statusFilter}
          onChange={value => setStatusFilter(value as RequestStatus | 'all')}
          options={[{ value: 'all', label: 'All Statuses' }, ...STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))]}
          className="px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-2)] text-[var(--brand-text-bright)]"
        />
        <FormSelect
          value={catFilter}
          onChange={value => setCatFilter(value as RequestCategory | 'all')}
          options={[{ value: 'all', label: 'All Categories' }, ...Object.entries(CAT_LABELS).map(([value, label]) => ({ value, label }))]}
          className="px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-2)] text-[var(--brand-text-bright)]"
        />
        <div className="flex-1 min-w-[140px] max-w-[240px] relative ml-auto">
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <FormInput value={searchQuery} onChange={setSearchQuery} placeholder="Search requests..."
            className="w-full pl-7 pr-3 t-caption" />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-[var(--brand-text-muted)]" /></div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16">
          <Icon as={MessageSquare} size="2xl" className="mx-auto mb-2 text-[var(--brand-text-muted)]" />
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            {requests.length === 0 ? 'No client requests yet' : 'No requests match filters'}
          </p>
          <p className="t-caption mt-1 text-[var(--brand-text-muted)]">Clients can submit requests from their dashboard.</p>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        // pr-check-disable-next-line -- floating bulk-action toolbar
        <div className="rounded-[var(--radius-xl)] px-4 py-3 flex items-center gap-3 flex-wrap bg-[var(--surface-2)] border-2 border-[var(--teal)]" style={{ boxShadow: '0 0 12px color-mix(in srgb, var(--teal) 10%, transparent)' }}>
          <div className="flex items-center gap-2">
            <Icon as={CheckCheck} size="md" className="text-accent-brand" />
            <span className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">{selected.size} selected</span>
          </div>
          <div className="h-4 w-px bg-[var(--brand-border)]" />
          <div className="flex items-center gap-1">
            <span className="t-caption-sm uppercase tracking-wider mr-1 text-[var(--brand-text-muted)]">Set status:</span>
            {STATUS_OPTIONS.map(s => (
              <Button key={s.value} onClick={() => bulkUpdateStatus(s.value)} disabled={bulkUpdating} variant="ghost" size="sm"
                className={cn('rounded border transition-colors hover:opacity-90 disabled:opacity-50', s.color)}>
                {s.label}
              </Button>
            ))}
          </div>
          <div className="h-4 w-px bg-[var(--brand-border)]" />
          <Button onClick={bulkDelete} disabled={bulkUpdating} icon={Trash2} variant="ghost" size="sm"
            className="rounded text-accent-danger hover:bg-red-500/10 disabled:opacity-50">
            Delete
          </Button>
          <Button onClick={() => setSelected(new Set())} variant="link" size="sm" className="ml-auto t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-muted)]">
            Clear selection
          </Button>
        </div>
      )}

      {/* Request list */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {/* Select all header */}
          <div className="flex items-center gap-2 px-2 py-1">
            <Button onClick={selectAll} variant="ghost" size="sm" className="text-[var(--brand-text-muted)]">
              <div className={cn('w-4 h-4 rounded border flex items-center justify-center transition-colors', selected.size === filtered.length && filtered.length > 0 ? 'bg-teal-400 border-teal-400' : 'border-[var(--brand-border-hover)]')}>
                {selected.size === filtered.length && filtered.length > 0 && <CheckCheck className="w-3 h-3 text-black" />}
              </div>
              {selected.size === filtered.length && filtered.length > 0 ? 'Deselect all' : 'Select all'}
            </Button>
          </div>

          {filtered.map(req => {
            const isExpanded = expandedId === req.id;
            const isSelected = selected.has(req.id);
            const statusOpt = STATUS_OPTIONS.find(s => s.value === req.status) || STATUS_OPTIONS[0];
            const priorityOpt = PRIORITY_OPTIONS.find(p => p.value === req.priority) || PRIORITY_OPTIONS[1];
            const unreadTeam = req.notes.filter(n => n.author === 'client').length;
            const isDone = req.status === 'completed' || req.status === 'closed';
            const next = nextStatus(req.status);

            return (
              <div key={req.id} className={cn('rounded-[var(--radius-xl)] overflow-hidden transition-all bg-[var(--surface-2)] border border-[var(--brand-border)]', isSelected && 'ring-1 ring-teal-400')}>
                {/* Row header */}
                <div className="flex items-center">
                  {/* Checkbox */}
                  <Button onClick={() => toggleSelect(req.id)} variant="ghost" size="sm"
                    className="px-3 py-3.5 flex-shrink-0 self-stretch flex items-center border-r border-[var(--brand-border)] rounded-none">
                    <div className={cn('w-4 h-4 rounded border flex items-center justify-center transition-colors', isSelected ? 'bg-teal-400 border-teal-400' : 'border-[var(--brand-border-hover)]')}>
                      {isSelected && <CheckCheck className="w-3 h-3 text-black" />}
                    </div>
                  </Button>
                  {/* Main row */}
                  <ClickableRow onClick={() => { setExpandedId(isExpanded ? null : req.id); setNoteInput(''); }} active={isExpanded}
                    className="flex-1 px-4 py-3.5 text-left hover:opacity-90 transition-opacity min-w-0 bg-transparent">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn('t-caption-sm font-medium truncate text-[var(--brand-text-bright)]', isDone && 'line-through opacity-60')}>{req.title}</span>
                          <span className={cn('t-caption px-1.5 py-0.5 rounded border shrink-0', statusOpt.color)}>
                            {statusOpt.label}
                          </span>
                          <span className={cn('t-caption shrink-0', priorityOpt.color)}>
                            {priorityOpt.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 t-caption text-[var(--brand-text-muted)]">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--surface-1)] text-[var(--brand-text-muted)]">
                            {wsName(req.workspaceId)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[var(--surface-1)]">
                            {CAT_LABELS[req.category] || req.category}
                          </span>
                          {req.submittedBy && <span className="text-[var(--brand-text-bright)]">by {req.submittedBy}</span>}
                          <span><Clock className="w-2.5 h-2.5 inline mr-0.5" />{new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          {unreadTeam > 0 && <span className="text-accent-brand">{unreadTeam} client note{unreadTeam !== 1 ? 's' : ''}</span>}
                          {req.pageUrl && (
                            <span className="flex items-center gap-0.5 truncate max-w-[140px]">
                              <ExternalLink className="w-2.5 h-2.5" />{req.pageUrl}
                            </span>
                          )}
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-[var(--brand-text-muted)]" /> : <ChevronDown className="w-4 h-4 shrink-0 text-[var(--brand-text-muted)]" />}
                    </div>
                  </ClickableRow>
                  {/* Quick action buttons */}
                  <div className="flex items-center gap-1 px-3 flex-shrink-0">
                    {next && !isDone && (
                      <Button onClick={() => quickStatus(req.id, next)} variant="ghost" size="sm"
                        className={cn('rounded t-caption font-medium transition-colors', next === 'completed' ? 'bg-emerald-400/10 text-accent-success' : 'bg-teal-400/10 text-accent-brand')}
                        title={next === 'in_progress' ? 'Start working' : next === 'completed' ? 'Mark complete' : next}>
                        {next === 'in_progress' ? <><Play className="w-3 h-3" /> Start</> : <><CheckCircle2 className="w-3 h-3" /> Done</>}
                      </Button>
                    )}
                    {isDone && (
                      <Button onClick={() => quickStatus(req.id, 'in_progress')} variant="ghost" size="sm"
                        className="rounded t-caption font-medium transition-colors bg-teal-400/10 text-accent-brand"
                        title="Reopen task">
                        <ArrowRight className="w-3 h-3" /> Reopen
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-[var(--brand-border)]">
                    {/* Controls row */}
                    <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-[var(--brand-border)]">
                      <div>
                        <label className="t-caption-sm uppercase tracking-wider block mb-1 text-[var(--brand-text-muted)]">Status</label>
                        <FormSelect
                          value={req.status}
                          onChange={value => updateRequest(req.id, { status: value })}
                          options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
                          className="px-2 py-1 rounded t-caption text-[var(--brand-text-bright)] bg-[var(--surface-1)]"
                        />
                      </div>
                      <div>
                        <label className="t-caption-sm uppercase tracking-wider block mb-1 text-[var(--brand-text-muted)]">Priority</label>
                        <FormSelect
                          value={req.priority}
                          onChange={value => updateRequest(req.id, { priority: value })}
                          options={PRIORITY_OPTIONS.map(p => ({ value: p.value, label: p.label }))}
                          className="px-2 py-1 rounded t-caption text-[var(--brand-text-bright)] bg-[var(--surface-1)]"
                        />
                      </div>
                      <div>
                        <label className="t-caption-sm uppercase tracking-wider block mb-1 text-[var(--brand-text-muted)]">Category</label>
                        <FormSelect
                          value={req.category}
                          onChange={value => updateRequest(req.id, { category: value })}
                          options={Object.entries(CAT_LABELS).map(([value, label]) => ({ value, label }))}
                          className="px-2 py-1 rounded t-caption text-[var(--brand-text-bright)] bg-[var(--surface-1)]"
                        />
                      </div>
                      <IconButton onClick={() => deleteReq(req.id)} icon={Trash2} label="Delete request" variant="danger" size="sm"
                        className="ml-auto" />
                    </div>

                    {/* Description */}
                    <div className="px-5 py-4">
                      <div className="t-caption mb-1 text-[var(--brand-text-muted)]">Description</div>
                      <SimpleMarkdown text={req.description} />
                      {req.pageUrl && (
                        <div className="mt-2 flex items-center gap-1 t-caption text-[var(--brand-text-muted)]">
                          <ExternalLink className="w-3 h-3" />
                          <a href={req.pageUrl.startsWith('http') ? req.pageUrl : `https://${req.pageUrl}`} target="_blank" rel="noopener noreferrer"
                            className="hover:underline">{req.pageUrl}</a>
                        </div>
                      )}
                    </div>

                    {/* Conversation */}
                    {req.notes.length > 0 && (
                      <div className="px-5 pb-3">
                        <div className="t-caption mb-2 text-[var(--brand-text-muted)]">Conversation</div>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {req.notes.map(note => (
                            <div key={note.id} className={cn('flex gap-2', note.author === 'team' && 'justify-end')}>
                              <div className={cn('max-w-[80%] rounded-[var(--radius-lg)] px-3 py-2', note.author === 'team' ? 'bg-teal-400/8 border border-teal-400/15' : 'bg-[var(--surface-1)] border border-[var(--brand-border)]')}>
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={cn('t-caption font-medium', note.author === 'team' ? 'text-accent-brand' : 'text-[var(--brand-text-muted)]')}>
                                    {note.author === 'team' ? 'You (Team)' : 'Client'}
                                  </span>
                                  <span className="t-caption text-[var(--brand-text-muted)]">
                                    {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                </div>
                                {note.content && <SimpleMarkdown text={note.content} />}
                                {note.attachments && note.attachments.length > 0 && (
                                  <div className="mt-1.5 space-y-1">
                                    {note.attachments.map(att => (
                                      att.mimeType.startsWith('image/') ? (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer" className="block">
                                          <img src={`/api/request-attachments/${att.filename}`} alt={att.originalName} className="max-w-[240px] max-h-[180px] rounded-[var(--radius-md)] border border-[var(--brand-border)]" />
                                        </a>
                                      ) : (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer"
                                          className="flex items-center gap-1.5 t-caption hover:underline text-accent-brand">
                                          <FileText className="w-3 h-3" />{att.originalName} <span className="text-[var(--brand-text-muted)]">({(att.size / 1024).toFixed(0)}KB)</span>
                                        </a>
                                      )
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Team reply */}
                    <div className="px-5 py-3 space-y-2 border-t border-[var(--brand-border)]">
                      {noteFiles.length > 0 && expandedId === req.id && (
                        <div className="flex flex-wrap gap-1.5">
                          {noteFiles.map((f, i) => (
                            <span key={i} className="flex items-center gap-1 t-caption rounded px-2 py-1 border border-[var(--brand-border)] text-[var(--brand-text)] bg-[var(--surface-1)]">
                              <Paperclip className="w-2.5 h-2.5" />{f.name}
                              <IconButton onClick={() => setNoteFiles(prev => prev.filter((_, j) => j !== i))} icon={X} label={`Remove ${f.name}`} variant="ghost" size="sm" className="w-4 h-4 hover:opacity-70" />
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <FormInput value={expandedId === req.id ? noteInput : ''} onChange={setNoteInput}
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendNote(req.id)}
                          placeholder="Send a note to the client..."
                          className="flex-1 px-3 py-2 rounded-[var(--radius-lg)] t-caption border border-[var(--brand-border)] text-[var(--brand-text-bright)] bg-[var(--surface-1)]"
                          disabled={sendingNote} />
                        <input type="file" ref={noteFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
                          onChange={e => { if (e.target.files) setNoteFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                        <IconButton onClick={() => noteFileRef.current?.click()} icon={Paperclip} label="Attach file" variant="solid" size="md"
                          className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] text-[var(--brand-text-muted)]" />
                        <IconButton onClick={() => sendNote(req.id)} disabled={sendingNote || (!noteInput.trim() && noteFiles.length === 0)} icon={Send} label="Send note" variant="accent" size="md"
                          className="rounded-[var(--radius-lg)] disabled:opacity-50 text-black bg-teal-400" />
                      </div>
                    </div>

                    {/* Status hints */}
                    {req.status === 'completed' && (
                      <div className="px-5 py-2 border-t border-[var(--brand-border)]">
                        <div className="flex items-center gap-1.5 t-caption text-accent-success">
                          <CheckCircle2 className="w-3 h-3" /> Marked as completed — visible to client
                        </div>
                      </div>
                    )}
                    {req.status === 'new' && (
                      <div className="px-5 py-2 border-t border-[var(--brand-border)]">
                        <div className="flex items-center gap-1.5 t-caption text-accent-info">
                          <AlertTriangle className="w-3 h-3" /> New request — change status to let the client know you&apos;re on it
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
