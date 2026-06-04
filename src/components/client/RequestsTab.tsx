import { useState, useRef } from 'react';
import {
  MessageSquare, Plus, Loader2, Send,
  CheckCircle2, X, Paperclip, FileText, ChevronDown as ChevronDownIcon,
} from 'lucide-react';
import type { ClientRequest } from './types';
import { toClientRequestStatus } from '../../../shared/types/requests';
import { Button, ClickableRow, Icon, IconButton, PageHeader, SectionCard, StatusBadge, FormInput } from '../ui';
import { STUDIO_NAME } from '../../constants';
import { RenderMarkdown } from './helpers';
import { SubmitRequestForm } from './SubmitRequestForm';
import { post, postForm } from '../../api/client';

interface RequestsTabProps {
  workspaceId: string;
  requests: ClientRequest[];
  requestsLoading: boolean;
  clientUser: { id: string; name: string; email: string; role: string } | null;
  loadRequests: (wsId: string) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  embedded?: boolean;
}

export function RequestsTab({
  workspaceId,
  requests,
  requestsLoading,
  clientUser,
  loadRequests,
  setToast,
  embedded = false,
}: RequestsTabProps) {
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [reqNoteInput, setReqNoteInput] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);

  if (embedded && !requestsLoading && requests.length === 0) {
    return null;
  }

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
      {!embedded && (
        <PageHeader
          title="Requests"
          subtitle={`Submit requests for ${STUDIO_NAME} to action on.`}
          icon={<Icon as={MessageSquare} size="lg" className="text-accent-brand" />}
          actions={<Button onClick={() => setShowNewRequest(!showNewRequest)} icon={Plus} size="sm" className="rounded-[var(--radius-lg)]">New Request</Button>}
        />
      )}

      {/* New request form — extracted to SubmitRequestForm (item 1) so the unified-inbox chooser
          modal reuses the SAME form. RequestsTab renders it identically (additive extraction). */}
      {!embedded && showNewRequest && (
        <SubmitRequestForm
          workspaceId={workspaceId}
          clientUser={clientUser}
          setToast={setToast}
          onSubmitted={() => { setShowNewRequest(false); loadRequests(workspaceId); }}
          onCancel={() => setShowNewRequest(false)}
        />
      )}

      {/* Loading */}
      {requestsLoading && (
        <div className="flex items-center justify-center py-12"><Icon as={Loader2} size="lg" className="animate-spin text-[var(--brand-text-muted)]" /></div>
      )}

      {/* Empty state */}
      {!embedded && !requestsLoading && requests.length === 0 && !showNewRequest && (
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
          {[...requests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(req => {
            const isExpanded = expandedRequest === req.id;
            const clientStatus = toClientRequestStatus(req.status, req.notes);
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
                        <StatusBadge domain="request" status={clientStatus} variant="soft" />
                      </div>
                      {req.status === 'on_hold' && req.notes.some(n => n.author === 'team' && n.content?.toLowerCase().includes('on hold')) && (
                        <span className="t-caption-sm text-[var(--brand-text-muted)] block mt-0.5">
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
                          <FormInput value={expandedRequest === req.id ? reqNoteInput : ''} onChange={setReqNoteInput}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendReqNote(req.id)}
                            placeholder="Add a note or reply..."
                            className="flex-1 px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500" disabled={sendingNote} />
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
