import { useState, useRef } from 'react';
import {
  MessageSquare, Plus, Loader2, Send, ChevronDown, ChevronUp,
  CheckCircle2, X, Paperclip, FileText,
} from 'lucide-react';
import type { ClientRequest, RequestCategory } from './types';
import { STUDIO_NAME } from '../../constants';
import { RenderMarkdown } from './helpers';
import { post, postForm } from '../../api/client';

interface RequestsTabProps {
  workspaceId: string;
  requests: ClientRequest[];
  requestsLoading: boolean;
  clientUser: { id: string; name: string; email: string; role: string } | null;
  loadRequests: (wsId: string) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

export function RequestsTab({ workspaceId, requests, requestsLoading, clientUser, loadRequests, setToast }: RequestsTabProps) {
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqDesc, setNewReqDesc] = useState('');
  const [newReqCategory, setNewReqCategory] = useState<RequestCategory>('other');
  const [newReqPage, setNewReqPage] = useState('');
  const [newReqName, setNewReqName] = useState('');
  const [submittingReq, setSubmittingReq] = useState(false);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [reqNoteInput, setReqNoteInput] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const [newReqFiles, setNewReqFiles] = useState<File[]>([]);
  const newReqFileRef = useRef<HTMLInputElement>(null);

  const submitRequest = async () => {
    if (!newReqTitle.trim() || !newReqDesc.trim()) return;
    setSubmittingReq(true);
    try {
      const created = await post<ClientRequest>(`/api/public/requests/${workspaceId}`, { title: newReqTitle.trim(), description: newReqDesc.trim(), category: newReqCategory, pageUrl: newReqPage.trim() || undefined, submittedBy: clientUser?.name || newReqName.trim() || undefined });
      // Upload attachments if any
      if (newReqFiles.length > 0) {
        const fd = new FormData();
        newReqFiles.forEach(f => fd.append('files', f));
        await postForm(`/api/public/requests/${workspaceId}/${created.id}/attachments`, fd);
      }
      setNewReqTitle(''); setNewReqDesc(''); setNewReqCategory('other'); setNewReqPage(''); setNewReqName(''); setNewReqFiles([]); setShowNewRequest(false);
      loadRequests(workspaceId);
    } catch { setToast({ message: 'Failed to submit request. Please try again.', type: 'error' }); }
    finally { setSubmittingReq(false); }
  };

  const sendReqNote = async (requestId: string) => {
    if (!reqNoteInput.trim() && noteFiles.length === 0) return;
    setSendingNote(true);
    try {
      if (noteFiles.length > 0) {
        const fd = new FormData();
        fd.append('content', reqNoteInput.trim());
        noteFiles.forEach(f => fd.append('files', f));
        await postForm(`/api/public/requests/${workspaceId}/${requestId}/notes-with-files`, fd);
      } else {
        await post(`/api/public/requests/${workspaceId}/${requestId}/notes`, { content: reqNoteInput.trim() });
      }
      setReqNoteInput(''); setNoteFiles([]);
      loadRequests(workspaceId);
    } catch { setToast({ message: 'Failed to send note. Please try again.', type: 'error' }); }
    finally { setSendingNote(false); }
  };

  return (<>
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-teal-400" />
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">Requests</h2>
            <p className="text-sm text-zinc-500 mt-1">Submit requests for {STUDIO_NAME} to action on.</p>
          </div>
        </div>
        <button onClick={() => setShowNewRequest(!showNewRequest)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Request
        </button>
      </div>

      {/* New request form */}
      {showNewRequest && (
        <div className="bg-zinc-900 border border-teal-500/20 p-5 space-y-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <h3 className="text-xs font-semibold text-zinc-200">Submit a Request</h3>
          <div>
            <label className="text-[11px] text-zinc-500 mb-1.5 block">Quick Templates</label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Content Update', cat: 'content' as RequestCategory, title: 'Content update needed', desc: 'Page/section to update:\n\nCurrent text:\n\nNew text:' },
                { label: 'Bug Report', cat: 'bug' as RequestCategory, title: 'Bug: ', desc: 'What happened:\n\nExpected behavior:\n\nDevice/browser:' },
                { label: 'Design Change', cat: 'design' as RequestCategory, title: 'Design change request', desc: 'What needs to change:\n\nWhy:\n\nReference/example (if any):' },
                { label: 'New Page', cat: 'feature' as RequestCategory, title: 'New page request', desc: 'Page purpose:\n\nTarget URL/slug:\n\nContent outline:' },
                { label: 'SEO Update', cat: 'seo' as RequestCategory, title: 'SEO update request', desc: 'Pages affected:\n\nKeywords to target:\n\nDetails:' },
              ].map(t => (
                <button key={t.label} onClick={() => { setNewReqCategory(t.cat); setNewReqTitle(t.title); setNewReqDesc(t.desc); }}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 bg-zinc-800/50 transition-colors">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {!clientUser && (
          <div>
            <label className="text-[11px] text-zinc-500 mb-1 block">Your Name</label>
            <input value={newReqName} onChange={e => setNewReqName(e.target.value)}
              placeholder="So we know who to follow up with..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
          </div>
          )}
          <div>
            <label className="text-[11px] text-zinc-500 mb-1 block">Title</label>
            <input value={newReqTitle} onChange={e => setNewReqTitle(e.target.value)}
              placeholder="Brief summary of your request..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 mb-1 block">Description</label>
            <textarea value={newReqDesc} onChange={e => setNewReqDesc(e.target.value)} rows={3}
              placeholder="Describe what you need in detail..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-zinc-500 mb-1 block">Category</label>
              <select value={newReqCategory} onChange={e => setNewReqCategory(e.target.value as RequestCategory)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500">
                <option value="content">Content Update</option>
                <option value="design">Design Change</option>
                <option value="bug">Bug Report</option>
                <option value="seo">SEO</option>
                <option value="feature">New Feature</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-zinc-500 mb-1 block">Related Page URL <span className="text-zinc-500">(optional)</span></label>
              <input value={newReqPage} onChange={e => setNewReqPage(e.target.value)}
                placeholder="/about or full URL..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 mb-1 block">Attachments <span className="text-zinc-500">(optional — screenshots, docs)</span></label>
            <input type="file" ref={newReqFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
              onChange={e => { if (e.target.files) setNewReqFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
            <button onClick={() => newReqFileRef.current?.click()} type="button"
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
              <Paperclip className="w-3.5 h-3.5" /> Attach Files
            </button>
            {newReqFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {newReqFiles.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 text-[11px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300">
                    <Paperclip className="w-2.5 h-2.5" />{f.name}
                    <button onClick={() => setNewReqFiles(prev => prev.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-zinc-300"><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={submitRequest} disabled={submittingReq || !newReqTitle.trim() || !newReqDesc.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors">
              {submittingReq ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {submittingReq ? 'Submitting...' : 'Submit Request'}
            </button>
            <button onClick={() => setShowNewRequest(false)}
              className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Loading */}
      {requestsLoading && (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
      )}

      {/* Empty state */}
      {!requestsLoading && requests.length === 0 && !showNewRequest && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
            <MessageSquare className="w-8 h-8 text-zinc-700" />
          </div>
          <h3 className="text-sm font-medium text-zinc-400 mb-1">Need something? We're here to help</h3>
          <p className="text-[11px] text-zinc-500 mb-4">Report a bug, request a design change, or suggest an improvement — {STUDIO_NAME} will get right on it.</p>
          <button onClick={() => setShowNewRequest(true)}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors">
            <Plus className="w-3.5 h-3.5 inline mr-1" /> Create Your First Request
          </button>
        </div>
      )}

      {/* Request list */}
      {!requestsLoading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(req => {
            const isExpanded = expandedRequest === req.id;
            const statusColors: Record<string, string> = {
              new: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
              in_review: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
              in_progress: 'bg-teal-500/10 border-teal-500/30 text-teal-400',
              on_hold: 'bg-zinc-500/10 border-zinc-600 text-zinc-400',
              completed: 'bg-green-500/10 border-green-500/30 text-emerald-400',
              closed: 'bg-zinc-500/10 border-zinc-600 text-zinc-500',
            };
            const statusLabels: Record<string, string> = {
              new: 'New', in_review: 'In Review', in_progress: 'In Progress',
              on_hold: 'On Hold', completed: 'Completed', closed: 'Closed',
            };
            const catLabels: Record<string, string> = {
              bug: 'Bug', content: 'Content', design: 'Design',
              seo: 'SEO', feature: 'Feature', other: 'Other',
            };
            const teamNotes = req.notes.filter(n => n.author === 'team').length;
            return (
              <div key={req.id} className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
                <button onClick={() => { setExpandedRequest(isExpanded ? null : req.id); setReqNoteInput(''); }}
                  className="w-full px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-zinc-200 truncate">{req.title}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border shrink-0 ${statusColors[req.status] || statusColors.new}`}>
                          {statusLabels[req.status] || req.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">{catLabels[req.category] || req.category}</span>
                        {req.submittedBy && <span className="text-zinc-400">by {req.submittedBy}</span>}
                        <span>{new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {teamNotes > 0 && <span className="text-teal-400">{teamNotes} team note{teamNotes !== 1 ? 's' : ''}</span>}
                        {req.pageUrl && <span className="text-zinc-500 truncate max-w-[150px]">{req.pageUrl}</span>}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-800">
                    {/* Description */}
                    <div className="px-5 py-4">
                      <div className="text-[11px] text-zinc-500 mb-1">Description</div>
                      <div className="text-[11px] text-zinc-300 leading-relaxed"><RenderMarkdown text={req.description} /></div>
                    </div>

                    {/* Notes / conversation */}
                    {req.notes.length > 0 && (
                      <div className="px-5 pb-3">
                        <div className="text-[11px] text-zinc-500 mb-2">Conversation</div>
                        <div className="space-y-2">
                          {req.notes.map(note => (
                            <div key={note.id} className={`flex gap-2 ${note.author === 'client' ? 'justify-end' : ''}`}>
                              <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
                                note.author === 'team'
                                  ? 'bg-teal-500/10 border border-teal-500/20'
                                  : 'bg-zinc-800/50 border border-zinc-700'
                              }`}>
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={`text-[11px] font-medium ${note.author === 'team' ? 'text-teal-400' : 'text-zinc-400'}`}>
                                    {note.author === 'team' ? STUDIO_NAME : 'You'}
                                  </span>
                                  <span className="text-[11px] text-zinc-500">
                                    {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                </div>
                                {note.content && <div className="text-[11px] text-zinc-300"><RenderMarkdown text={note.content} /></div>}
                                {note.attachments && note.attachments.length > 0 && (
                                  <div className="mt-1.5 space-y-1">
                                    {note.attachments.map(att => (
                                      att.mimeType.startsWith('image/') ? (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer" className="block">
                                          <img src={`/api/request-attachments/${att.filename}`} alt={att.originalName} className="max-w-[240px] max-h-[180px] rounded-md border border-zinc-700" />
                                        </a>
                                      ) : (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer"
                                          className="flex items-center gap-1.5 text-[11px] text-teal-400 hover:text-teal-300">
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

                    {/* Reply input */}
                    {req.status !== 'closed' && req.status !== 'completed' && (
                      <div className="px-5 py-3 border-t border-zinc-800/50 space-y-2">
                        {noteFiles.length > 0 && expandedRequest === req.id && (
                          <div className="flex flex-wrap gap-1.5">
                            {noteFiles.map((f, i) => (
                              <span key={i} className="flex items-center gap-1 text-[11px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300">
                                <Paperclip className="w-2.5 h-2.5" />{f.name}
                                <button onClick={() => setNoteFiles(prev => prev.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-zinc-300"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input value={expandedRequest === req.id ? reqNoteInput : ''} onChange={e => setReqNoteInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendReqNote(req.id)}
                            placeholder="Add a note or reply..."
                            className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" disabled={sendingNote} />
                          <input type="file" ref={noteFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
                            onChange={e => { if (e.target.files) setNoteFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                          <button onClick={() => noteFileRef.current?.click()} className="px-2 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors" title="Attach file">
                            <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
                          </button>
                          <button onClick={() => sendReqNote(req.id)} disabled={sendingNote || (!reqNoteInput.trim() && noteFiles.length === 0)}
                            className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg transition-colors">
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                    {(req.status === 'completed' || req.status === 'closed') && (
                      <div className="px-5 py-3 border-t border-zinc-800/50">
                        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> This request has been {req.status}
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
  </>);
}
