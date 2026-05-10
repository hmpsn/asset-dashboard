import { useState, useRef } from 'react';
import {
  MessageSquare, Plus, Loader2, Send,
  CheckCircle2, X, Paperclip, FileText, ChevronDown as ChevronDownIcon,
} from 'lucide-react';
import type { ClientRequest, RequestCategory, RequestNote } from './types';
import { Button, ClickableRow, Icon, IconButton, PageHeader, SectionCard } from '../ui';
import { STUDIO_NAME } from '../../constants';
import { RenderMarkdown } from './helpers';
import { post, postForm } from '../../api/client';

/**
 * Maps 6 admin-internal request statuses to 4 client-visible status labels.
 * Priority: team_replied > resolved > in_progress > awaiting_team
 */
function clientStatusLabel(status: string, notes: Pick<RequestNote, 'author'>[]): string {
  // Check if there's an unread team reply
  const lastNote = notes[notes.length - 1];
  if (lastNote?.author === 'team') return 'Team replied';

  switch (status) {
    case 'new':
    case 'in_review':
      return 'Awaiting team';
    case 'in_progress':
    case 'on_hold':
      return 'In progress';
    case 'completed':
    case 'closed':
      return 'Resolved';
    default:
      return 'Awaiting team';
  }
}

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
      <PageHeader
        title="Requests"
        subtitle={`Submit requests for ${STUDIO_NAME} to action on.`}
        icon={<Icon as={MessageSquare} size="lg" className="text-accent-brand" />}
        actions={<Button onClick={() => setShowNewRequest(!showNewRequest)} icon={Plus} size="sm" className="rounded-[var(--radius-lg)]">New Request</Button>}
      />

      {/* New request form */}
      {showNewRequest && (
        <SectionCard title="Submit a Request" className="border-teal-500/20">
          <div className="space-y-4">
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5 block">Quick Templates</label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Content Update', cat: 'content' as RequestCategory, title: 'Content update needed', desc: 'Page/section to update:\n\nCurrent text:\n\nNew text:' },
                { label: 'Bug Report', cat: 'bug' as RequestCategory, title: 'Bug: ', desc: 'What happened:\n\nExpected behavior:\n\nDevice/browser:' },
                { label: 'Design Change', cat: 'design' as RequestCategory, title: 'Design change request', desc: 'What needs to change:\n\nWhy:\n\nReference/example (if any):' },
                { label: 'New Page', cat: 'feature' as RequestCategory, title: 'New page request', desc: 'Page purpose:\n\nTarget URL/slug:\n\nContent outline:' },
                { label: 'SEO Update', cat: 'seo' as RequestCategory, title: 'SEO update request', desc: 'Pages affected:\n\nKeywords to target:\n\nDetails:' },
              ].map(t => (
                <Button key={t.label} onClick={() => { setNewReqCategory(t.cat); setNewReqTitle(t.title); setNewReqDesc(t.desc); }} variant="secondary" size="sm">
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
          {!clientUser && (
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Your Name</label>
            <input value={newReqName} onChange={e => setNewReqName(e.target.value)}
              placeholder="So we know who to follow up with..."
              className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500" />
          </div>
          )}
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Title</label>
            <input value={newReqTitle} onChange={e => setNewReqTitle(e.target.value)}
              placeholder="Brief summary of your request..."
              className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Description</label>
            <textarea value={newReqDesc} onChange={e => setNewReqDesc(e.target.value)} rows={3}
              placeholder="Describe what you need in detail..."
              className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Category</label>
              <select value={newReqCategory} onChange={e => setNewReqCategory(e.target.value as RequestCategory)}
                className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:outline-none focus:border-teal-500">
                <option value="content">Content Update</option>
                <option value="design">Design Change</option>
                <option value="bug">Bug Report</option>
                <option value="seo">SEO</option>
                <option value="feature">New Feature</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Related Page URL <span className="text-[var(--brand-text-muted)]">(optional)</span></label>
              <input value={newReqPage} onChange={e => setNewReqPage(e.target.value)}
                placeholder="/about or full URL..."
                className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500" />
            </div>
          </div>
          <div>
            <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Attachments <span className="text-[var(--brand-text-muted)]">(optional — screenshots, docs)</span></label>
            <input type="file" ref={newReqFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
              onChange={e => { if (e.target.files) setNewReqFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
            <Button onClick={() => newReqFileRef.current?.click()} variant="secondary" icon={Paperclip}>
              Attach Files
            </Button>
            {newReqFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {newReqFiles.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 t-caption-sm bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--brand-text)]">
                    <Icon as={Paperclip} size="xs" />{f.name}
                    <IconButton icon={X} label={`Remove ${f.name}`} size="sm" onClick={() => setNewReqFiles(prev => prev.filter((_, j) => j !== i))} />
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={submitRequest} disabled={submittingReq || !newReqTitle.trim() || !newReqDesc.trim()} loading={submittingReq} icon={Send} className="rounded-[var(--radius-lg)]">
              {submittingReq ? 'Submitting...' : 'Submit Request'}
            </Button>
            <Button onClick={() => setShowNewRequest(false)} variant="ghost">Cancel</Button>
          </div>
          </div>
        </SectionCard>
      )}

      {/* Loading */}
      {requestsLoading && (
        <div className="flex items-center justify-center py-12"><Icon as={Loader2} size="lg" className="animate-spin text-[var(--brand-text-muted)]" /></div>
      )}

      {/* Empty state */}
      {!requestsLoading && requests.length === 0 && !showNewRequest && (
        <div className="text-center py-16">
          {/* pr-check-disable-next-line -- Brand signature radius intentional */}
          <div className="w-16 h-16 bg-[var(--surface-2)] border border-[var(--brand-border)] flex items-center justify-center mx-auto mb-4" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
            <Icon as={MessageSquare} size="2xl" className="text-[var(--brand-text-faint)]" />
          </div>
          <h3 className="t-page font-semibold text-[var(--brand-text-bright)] mb-1">Need something? We're here to help</h3>
          <p className="t-body text-[var(--brand-text-muted)] mb-4">Report a bug, request a design change, or suggest an improvement — {STUDIO_NAME} will get right on it.</p>
          <Button onClick={() => setShowNewRequest(true)} icon={Plus} className="rounded-[var(--radius-lg)]">
            Create Your First Request
          </Button>
        </div>
      )}

      {/* Request list */}
      {!requestsLoading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(req => {
            const isExpanded = expandedRequest === req.id;
            // Group by client-visible status
            const statusColors: Record<string, string> = {
              // Awaiting team
              new: 'bg-blue-500/10 border-blue-500/30 text-accent-info',
              in_review: 'bg-blue-500/10 border-blue-500/30 text-accent-info',
              // In progress
              in_progress: 'bg-teal-500/10 border-teal-500/30 text-accent-brand',
              on_hold: 'bg-teal-500/10 border-teal-500/30 text-accent-brand',
              // Resolved
              completed: 'bg-emerald-500/10 border-emerald-500/30 text-accent-success',
              closed: 'bg-emerald-500/10 border-emerald-500/30 text-accent-success',
            };
            const catLabels: Record<string, string> = {
              bug: 'Bug', content: 'Content', design: 'Design',
              seo: 'SEO', feature: 'Feature', other: 'Other',
            };
            const teamNotes = req.notes.filter(n => n.author === 'team').length;
            return (
              <SectionCard key={req.id} noPadding>
                <ClickableRow
                  active={isExpanded}
                  onClick={() => { setExpandedRequest(isExpanded ? null : req.id); setReqNoteInput(''); }}
                  className="px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="t-body font-medium text-[var(--brand-text)] truncate">{req.title}</span>
                        <span className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] border shrink-0 ${statusColors[req.status] || statusColors.new}`}>
                          {clientStatusLabel(req.status, req.notes)}
                        </span>
                      </div>
                      {req.status === 'on_hold' && req.notes.some(n => n.author === 'team' && n.content?.toLowerCase().includes('on hold')) && (
                        <span className="t-caption-sm text-[var(--brand-text-muted)] block mb-2">
                          {req.notes.filter(n => n.author === 'team' && n.content?.toLowerCase().includes('on hold')).at(-1)?.content}
                        </span>
                      )}
                      <div className="flex items-center gap-2 t-caption-sm text-[var(--brand-text-muted)]">
                        <span className="px-1.5 py-0.5 bg-[var(--surface-3)] rounded-[var(--radius-sm)] text-[var(--brand-text-muted)]">{catLabels[req.category] || req.category}</span>
                        {req.submittedBy && <span className="text-[var(--brand-text-muted)]">by {req.submittedBy}</span>}
                        <span>{new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {teamNotes > 0 && <span className="text-accent-brand">{teamNotes} team note{teamNotes !== 1 ? 's' : ''}</span>}
                        {req.pageUrl && <span className="text-[var(--brand-text-muted)] truncate max-w-[150px]">{req.pageUrl}</span>}
                      </div>
                    </div>
                    <span className={`text-[var(--brand-text-muted)] shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      <Icon as={ChevronDownIcon} size="md" />
                    </span>
                  </div>
                </ClickableRow>

                {isExpanded && (
                  <div className="border-t border-[var(--brand-border)]">
                    {/* Description */}
                    <div className="px-5 py-4">
                      <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Description</div>
                      <div className="t-body text-[var(--brand-text)] leading-relaxed"><RenderMarkdown text={req.description} /></div>
                    </div>

                    {/* Notes / conversation */}
                    {req.notes.length > 0 && (
                      <div className="px-5 pb-3">
                        <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Conversation</div>
                        <div className="space-y-2">
                          {req.notes.map(note => (
                            <div key={note.id} className={`flex gap-2 ${note.author === 'client' ? 'justify-end' : ''}`}>
                              <div className={`max-w-[80%] rounded-[var(--radius-lg)] px-3 py-2 ${
                                note.author === 'team'
                                  ? 'bg-teal-500/10 border border-teal-500/20'
                                  : 'bg-[var(--surface-3)]/50 border border-[var(--brand-border-strong)]'
                              }`}>
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={`t-caption-sm font-medium ${note.author === 'team' ? 'text-accent-brand' : 'text-[var(--brand-text-muted)]'}`}>
                                    {note.author === 'team' ? STUDIO_NAME : 'You'}
                                  </span>
                                  <span className="t-caption-sm text-[var(--brand-text-muted)]">
                                    {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                </div>
                                {note.content && <div className="t-caption-sm text-[var(--brand-text)]"><RenderMarkdown text={note.content} /></div>}
                                {note.attachments && note.attachments.length > 0 && (
                                  <div className="mt-1.5 space-y-1">
                                    {note.attachments.map(att => (
                                      att.mimeType.startsWith('image/') ? (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer" className="block">
                                          <img src={`/api/request-attachments/${att.filename}`} alt={att.originalName} className="max-w-[240px] max-h-[180px] rounded-[var(--radius-md)] border border-[var(--brand-border-strong)]" />
                                        </a>
                                      ) : (
                                        <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer"
                                          className="flex items-center gap-1.5 t-caption-sm text-accent-brand hover:text-accent-brand">
                                          <Icon as={FileText} size="sm" />{att.originalName} <span className="text-[var(--brand-text-muted)]">({(att.size / 1024).toFixed(0)}KB)</span>
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
                      <div className="px-5 py-3 border-t border-[var(--brand-border)]/50 space-y-2">
                        {noteFiles.length > 0 && expandedRequest === req.id && (
                          <div className="flex flex-wrap gap-1.5">
                            {noteFiles.map((f, i) => (
                              <span key={i} className="flex items-center gap-1 t-caption-sm bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--brand-text)]">
                                <Icon as={Paperclip} size="xs" />{f.name}
                                <IconButton icon={X} label={`Remove ${f.name}`} size="sm" onClick={() => setNoteFiles(prev => prev.filter((_, j) => j !== i))} />
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input value={expandedRequest === req.id ? reqNoteInput : ''} onChange={e => setReqNoteInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendReqNote(req.id)}
                            placeholder="Add a note or reply..."
                            className="flex-1 px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500" disabled={sendingNote} />
                          <input type="file" ref={noteFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
                            onChange={e => { if (e.target.files) setNoteFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                          <IconButton icon={Paperclip} label="Attach file" variant="solid" onClick={() => noteFileRef.current?.click()} />
                          <IconButton icon={Send} label="Send note" variant="accent" onClick={() => sendReqNote(req.id)} disabled={sendingNote || (!reqNoteInput.trim() && noteFiles.length === 0)} />
                        </div>
                      </div>
                    )}
                    {(req.status === 'completed' || req.status === 'closed') && (
                      <div className="px-5 py-3 border-t border-[var(--brand-border)]/50">
                        <div className="flex items-center gap-1.5 t-caption-sm text-accent-success">
                          <Icon as={CheckCircle2} size="sm" /> This request has been {req.status}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  </>);
}
