import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, Send, Loader2, ChevronDown, ChevronUp,
  Trash2, ExternalLink, Clock, CheckCircle2, AlertTriangle,
  Filter, Search, Paperclip, FileText, X,
  Play, CheckCheck, ArrowRight,
} from 'lucide-react';

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
  { value: 'new', label: 'New', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  { value: 'in_review', label: 'In Review', color: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-teal-500/10 border-teal-500/30 text-teal-400' },
  { value: 'on_hold', label: 'On Hold', color: 'bg-zinc-500/10 border-zinc-600 text-zinc-400' },
  { value: 'completed', label: 'Completed', color: 'bg-green-500/10 border-green-500/30 text-green-400' },
  { value: 'closed', label: 'Closed', color: 'bg-zinc-500/10 border-zinc-600 text-zinc-500' },
];

const PRIORITY_OPTIONS: { value: RequestPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-zinc-400' },
  { value: 'medium', label: 'Medium', color: 'text-blue-400' },
  { value: 'high', label: 'High', color: 'text-amber-400' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-400' },
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
    fetch('/api/workspaces').then(r => r.json()).then(setWorkspaces).catch(() => {});
  }, []);

  const refreshRequests = (filter?: string) => {
    const f = filter ?? wsFilter;
    const url = f && f !== 'all' ? `/api/requests?workspaceId=${f}` : '/api/requests';
    setLoading(true);
    fetch(url).then(r => r.json()).then(data => { if (Array.isArray(data)) setRequests(data); }).catch(() => {}).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshRequests(wsFilter); }, [wsFilter]);

  const updateRequest = async (id: string, updates: Record<string, string>) => {
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => prev.map(r => r.id === id ? updated : r));
      }
    } catch { /* skip */ }
  };

  const sendNote = async (requestId: string) => {
    if (!noteInput.trim() && noteFiles.length === 0) return;
    setSendingNote(true);
    try {
      let res;
      if (noteFiles.length > 0) {
        const fd = new FormData();
        fd.append('content', noteInput.trim());
        noteFiles.forEach(f => fd.append('files', f));
        res = await fetch(`/api/requests/${requestId}/notes-with-files`, { method: 'POST', body: fd });
      } else {
        res = await fetch(`/api/requests/${requestId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: noteInput.trim() }),
        });
      }
      if (res.ok) {
        const updated = await res.json();
        setRequests(prev => prev.map(r => r.id === requestId ? updated : r));
        setNoteInput(''); setNoteFiles([]);
      }
    } catch { /* skip */ }
    setSendingNote(false);
  };

  const deleteReq = async (id: string) => {
    if (!confirm('Delete this request? This cannot be undone.')) return;
    try {
      await fetch(`/api/requests/${id}`, { method: 'DELETE' });
      setRequests(prev => prev.filter(r => r.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      if (expandedId === id) setExpandedId(null);
    } catch { /* skip */ }
  };

  // Bulk operations
  const bulkUpdateStatus = async (status: RequestStatus) => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const res = await fetch('/api/requests/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), status }),
      });
      if (res.ok) {
        setRequests(prev => prev.map(r => selected.has(r.id) ? { ...r, status, updatedAt: new Date().toISOString() } : r));
        setSelected(new Set());
      }
    } catch { /* skip */ }
    setBulkUpdating(false);
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected task${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkUpdating(true);
    try {
      await Promise.all(Array.from(selected).map(id => fetch(`/api/requests/${id}`, { method: 'DELETE' })));
      setRequests(prev => prev.filter(r => !selected.has(r.id)));
      setSelected(new Set());
    } catch { /* skip */ }
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-teal-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Client Requests</h2>
            <p className="text-[11px] mt-0.5 text-zinc-500">Review, respond to, and manage client requests across workspaces.</p>
          </div>
        </div>
      </div>

      {/* Stats + Progress */}
      <div className="rounded-xl p-4 bg-zinc-900 border border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-6">
            {[
              { label: 'Total', value: counts.total, color: '#e4e4e7' },
              { label: 'New', value: counts.new, color: '#60a5fa' },
              { label: 'Active', value: counts.in_progress, color: '#2dd4bf' },
              { label: 'Resolved', value: counts.completed, color: '#4ade80' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{s.label}</div>
              </div>
            ))}
          </div>
          {counts.total > 0 && (
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: '#4ade80' }}>
                {Math.round((counts.completed / counts.total) * 100)}%
              </div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">Complete</div>
            </div>
          )}
        </div>
        {counts.total > 0 && (
          <div className="h-2 rounded-full overflow-hidden bg-[#0f1219]">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(counts.completed / counts.total) * 100}%`, backgroundColor: '#4ade80' }} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3 h-3 text-zinc-500" />
        </div>
        <select value={wsFilter} onChange={e => setWsFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-200">
          <option value="all">All Workspaces</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as RequestStatus | 'all')}
          className="px-2.5 py-1.5 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-200">
          <option value="all">All Statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value as RequestCategory | 'all')}
          className="px-2.5 py-1.5 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-200">
          <option value="all">All Categories</option>
          {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex-1 min-w-[140px] max-w-[240px] relative ml-auto">
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search requests..."
            className="w-full pl-7 pr-3 py-1.5 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-200" />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 text-zinc-500" />
          <p className="text-sm text-zinc-500">
            {requests.length === 0 ? 'No client requests yet' : 'No requests match filters'}
          </p>
          <p className="text-[11px] mt-1 text-zinc-500">Clients can submit requests from their dashboard.</p>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap bg-zinc-900 border-2 border-teal-400" style={{ boxShadow: '0 0 12px rgba(45,212,191,0.1)' }}>
          <div className="flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-teal-400" />
            <span className="text-xs font-semibold text-zinc-200">{selected.size} selected</span>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-1">
            <span className="text-[11px] uppercase tracking-wider mr-1 text-zinc-500">Set status:</span>
            {STATUS_OPTIONS.map(s => (
              <button key={s.value} onClick={() => bulkUpdateStatus(s.value)} disabled={bulkUpdating}
                className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors hover:opacity-90 disabled:opacity-50 ${s.color}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <button onClick={bulkDelete} disabled={bulkUpdating}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
            <Trash2 className="w-3 h-3" /> Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[11px] hover:underline text-zinc-500">
            Clear selection
          </button>
        </div>
      )}

      {/* Request list */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {/* Select all header */}
          <div className="flex items-center gap-2 px-2 py-1">
            <button onClick={selectAll} className="flex items-center gap-1.5 text-[11px] font-medium transition-colors text-zinc-500">
              <div className="w-4 h-4 rounded border flex items-center justify-center transition-colors"
                style={selected.size === filtered.length && filtered.length > 0
                  ? { backgroundColor: '#2dd4bf', borderColor: '#2dd4bf' }
                  : { borderColor: '#27272a' }}>
                {selected.size === filtered.length && filtered.length > 0 && <CheckCheck className="w-3 h-3 text-black" />}
              </div>
              {selected.size === filtered.length && filtered.length > 0 ? 'Deselect all' : 'Select all'}
            </button>
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
              <div key={req.id} className={`rounded-xl overflow-hidden transition-all ${isSelected ? 'ring-1' : ''}`}
                style={{ backgroundColor: '#18181b', border: '1px solid #27272a', ...(isSelected ? { ringColor: '#2dd4bf' } : {}) }}>
                {/* Row header */}
                <div className="flex items-center">
                  {/* Checkbox */}
                  <button onClick={() => toggleSelect(req.id)}
                    className="px-3 py-3.5 flex-shrink-0 self-stretch flex items-center border-r border-zinc-800">
                    <div className="w-4 h-4 rounded border flex items-center justify-center transition-colors"
                      style={isSelected
                        ? { backgroundColor: '#2dd4bf', borderColor: '#2dd4bf' }
                        : { borderColor: '#27272a' }}>
                      {isSelected && <CheckCheck className="w-3 h-3 text-black" />}
                    </div>
                  </button>
                  {/* Main row */}
                  <button onClick={() => { setExpandedId(isExpanded ? null : req.id); setNoteInput(''); }}
                    className="flex-1 px-4 py-3.5 text-left hover:opacity-90 transition-opacity min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium truncate text-zinc-200 ${isDone ? 'line-through opacity-60' : ''}`}>{req.title}</span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded border shrink-0 ${statusOpt.color}`}>
                            {statusOpt.label}
                          </span>
                          <span className={`text-[11px] shrink-0 ${priorityOpt.color}`}>
                            {priorityOpt.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                          <span className="px-1.5 py-0.5 rounded bg-[#0f1219] text-zinc-500">
                            {wsName(req.workspaceId)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#0f1219]">
                            {CAT_LABELS[req.category] || req.category}
                          </span>
                          {req.submittedBy && <span className="text-zinc-200">by {req.submittedBy}</span>}
                          <span><Clock className="w-2.5 h-2.5 inline mr-0.5" />{new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          {unreadTeam > 0 && <span className="text-teal-400">{unreadTeam} client note{unreadTeam !== 1 ? 's' : ''}</span>}
                          {req.pageUrl && (
                            <span className="flex items-center gap-0.5 truncate max-w-[140px]">
                              <ExternalLink className="w-2.5 h-2.5" />{req.pageUrl}
                            </span>
                          )}
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-zinc-500" /> : <ChevronDown className="w-4 h-4 shrink-0 text-zinc-500" />}
                    </div>
                  </button>
                  {/* Quick action buttons */}
                  <div className="flex items-center gap-1 px-3 flex-shrink-0">
                    {next && !isDone && (
                      <button onClick={() => quickStatus(req.id, next)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors"
                        style={{ backgroundColor: next === 'completed' ? 'rgba(74,222,128,0.1)' : 'rgba(45,212,191,0.1)', color: next === 'completed' ? '#4ade80' : '#2dd4bf' }}
                        title={next === 'in_progress' ? 'Start working' : next === 'completed' ? 'Mark complete' : next}>
                        {next === 'in_progress' ? <><Play className="w-3 h-3" /> Start</> : <><CheckCircle2 className="w-3 h-3" /> Done</>}
                      </button>
                    )}
                    {isDone && (
                      <button onClick={() => quickStatus(req.id, 'in_progress')}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors"
                        style={{ backgroundColor: 'rgba(45,212,191,0.1)', color: '#2dd4bf' }}
                        title="Reopen task">
                        <ArrowRight className="w-3 h-3" /> Reopen
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-zinc-800">
                    {/* Controls row */}
                    <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-zinc-800">
                      <div>
                        <label className="text-[11px] uppercase tracking-wider block mb-1 text-zinc-500">Status</label>
                        <select value={req.status} onChange={e => updateRequest(req.id, { status: e.target.value })}
                          className="px-2 py-1 rounded text-[11px] bg-[#0f1219] border border-zinc-800 text-zinc-200">
                          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wider block mb-1 text-zinc-500">Priority</label>
                        <select value={req.priority} onChange={e => updateRequest(req.id, { priority: e.target.value })}
                          className="px-2 py-1 rounded text-[11px] bg-[#0f1219] border border-zinc-800 text-zinc-200">
                          {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-wider block mb-1 text-zinc-500">Category</label>
                        <select value={req.category} onChange={e => updateRequest(req.id, { category: e.target.value })}
                          className="px-2 py-1 rounded text-[11px] bg-[#0f1219] border border-zinc-800 text-zinc-200">
                          {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                      <button onClick={() => deleteReq(req.id)}
                        className="ml-auto p-1.5 rounded hover:bg-red-500/10 transition-colors" title="Delete request">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>

                    {/* Description */}
                    <div className="px-5 py-4">
                      <div className="text-[11px] mb-1 text-zinc-500">Description</div>
                      <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-200">{req.description}</p>
                      {req.pageUrl && (
                        <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500">
                          <ExternalLink className="w-3 h-3" />
                          <a href={req.pageUrl.startsWith('http') ? req.pageUrl : `https://${req.pageUrl}`} target="_blank" rel="noopener noreferrer"
                            className="hover:underline">{req.pageUrl}</a>
                        </div>
                      )}
                    </div>

                    {/* Conversation */}
                    {req.notes.length > 0 && (
                      <div className="px-5 pb-3">
                        <div className="text-[11px] mb-2 text-zinc-500">Conversation</div>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                          {req.notes.map(note => (
                            <div key={note.id} className={`flex gap-2 ${note.author === 'team' ? 'justify-end' : ''}`}>
                              <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
                                note.author === 'team'
                                  ? 'border'
                                  : ''
                              }`} style={
                                note.author === 'team'
                                  ? { backgroundColor: 'rgba(45, 212, 191, 0.08)', borderColor: 'rgba(45, 212, 191, 0.15)' }
                                  : { backgroundColor: '#0f1219', border: '1px solid #27272a' }
                              }>
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={`text-[11px] font-medium ${note.author === 'team' ? 'text-teal-400' : 'text-zinc-500'}`}>
                                    {note.author === 'team' ? 'You (Team)' : 'Client'}
                                  </span>
                                  <span className="text-[11px] text-zinc-500">
                                    {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                </div>
                                {note.content && <p className="text-[11px] whitespace-pre-wrap text-zinc-200">{note.content}</p>}
                                {note.attachments && note.attachments.length > 0 && (
                                  <div className="mt-1.5 space-y-1">
                                    {note.attachments.map(att => (
                                      att.mimeType.startsWith('image/') ? (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer" className="block">
                                          <img src={`/api/request-attachments/${att.filename}`} alt={att.originalName} className="max-w-[240px] max-h-[180px] rounded-md border border-zinc-800" />
                                        </a>
                                      ) : (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer"
                                          className="flex items-center gap-1.5 text-[11px] hover:underline text-teal-400">
                                          <FileText className="w-3 h-3" />{att.originalName} <span className="text-zinc-500">({(att.size / 1024).toFixed(0)}KB)</span>
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
                    <div className="px-5 py-3 space-y-2 border-t border-zinc-800">
                      {noteFiles.length > 0 && expandedId === req.id && (
                        <div className="flex flex-wrap gap-1.5">
                          {noteFiles.map((f, i) => (
                            <span key={i} className="flex items-center gap-1 text-[11px] rounded px-2 py-1 bg-[#0f1219] border border-zinc-800 text-zinc-400">
                              <Paperclip className="w-2.5 h-2.5" />{f.name}
                              <button onClick={() => setNoteFiles(prev => prev.filter((_, j) => j !== i))} className="hover:opacity-70"><X className="w-2.5 h-2.5" /></button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input value={expandedId === req.id ? noteInput : ''} onChange={e => setNoteInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendNote(req.id)}
                          placeholder="Send a note to the client..."
                          className="flex-1 px-3 py-2 rounded-lg text-[11px] bg-[#0f1219] border border-zinc-800 text-zinc-200"
                          disabled={sendingNote} />
                        <input type="file" ref={noteFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
                          onChange={e => { if (e.target.files) setNoteFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                        <button onClick={() => noteFileRef.current?.click()} className="px-2 py-2 rounded-lg transition-colors bg-[#0f1219] border border-zinc-800" title="Attach file">
                          <Paperclip className="w-3.5 h-3.5 text-zinc-500" />
                        </button>
                        <button onClick={() => sendNote(req.id)} disabled={sendingNote || (!noteInput.trim() && noteFiles.length === 0)}
                          className="px-3 py-2 rounded-lg transition-colors disabled:opacity-50 bg-teal-400 text-black">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Status hints */}
                    {req.status === 'completed' && (
                      <div className="px-5 py-2 border-t border-zinc-800">
                        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#4ade80' }}>
                          <CheckCircle2 className="w-3 h-3" /> Marked as completed — visible to client
                        </div>
                      </div>
                    )}
                    {req.status === 'new' && (
                      <div className="px-5 py-2 border-t border-zinc-800">
                        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#60a5fa' }}>
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
