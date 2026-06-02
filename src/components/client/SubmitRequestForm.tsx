// src/components/client/SubmitRequestForm.tsx
//
// Item 1 — the reusable "Submit a Request" task-request form, EXTRACTED from RequestsTab so BOTH the
// legacy RequestsTab AND the new unified-inbox chooser modal mount the SAME form (DRY). The
// extraction is purely additive: RequestsTab now renders <SubmitRequestForm/> in place of the inline
// SectionCard block, producing byte-identical DOM + behavior. The free-form request lands via
// POST /api/public/requests/:ws (the proven public requests route) + optional attachment upload.
//
// Per docs/workflows/ui-vocabulary.md this is the canonical "request" noun (Content Update / Design
// Change / Bug Report / SEO / New Feature / Other categories preserved verbatim).
import { useState, useRef } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import type { ClientRequest, RequestCategory } from './types';
import { Button, Icon, IconButton, SectionCard, FormInput, FormSelect, FormTextarea } from '../ui';
import { post, postForm } from '../../api/client';

interface SubmitRequestFormProps {
  workspaceId: string;
  clientUser: { id: string; name: string; email: string; role: string } | null;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  /** Called after a request is created (RequestsTab reloads its list; the inbox chooser closes). */
  onSubmitted: (created: ClientRequest) => void;
  /** Cancel affordance (RequestsTab collapses the form; the inbox chooser closes the modal). */
  onCancel: () => void;
}

/**
 * SubmitRequestForm — the "Submit a Request" form, byte-identical to the block it was extracted from
 * in RequestsTab. Owns its own form state + submit so it can be mounted standalone (the unified-inbox
 * chooser modal) OR inside RequestsTab. The markup is the SAME SectionCard + fields so the legacy tab
 * renders identically.
 */
export function SubmitRequestForm({ workspaceId, clientUser, setToast, onSubmitted, onCancel }: SubmitRequestFormProps) {
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqDesc, setNewReqDesc] = useState('');
  const [newReqCategory, setNewReqCategory] = useState<RequestCategory>('other');
  const [newReqPage, setNewReqPage] = useState('');
  const [newReqName, setNewReqName] = useState('');
  const [submittingReq, setSubmittingReq] = useState(false);
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
      setNewReqTitle(''); setNewReqDesc(''); setNewReqCategory('other'); setNewReqPage(''); setNewReqName(''); setNewReqFiles([]);
      onSubmitted(created);
    } catch { setToast({ message: 'Failed to submit request. Please try again.', type: 'error' }); }
    finally { setSubmittingReq(false); }
  };

  return (
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
        <FormInput value={newReqName} onChange={setNewReqName}
          placeholder="So we know who to follow up with..."
          className="w-full t-caption" />
      </div>
      )}
      <div>
        <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Title</label>
        <FormInput value={newReqTitle} onChange={setNewReqTitle}
          placeholder="Brief summary of your request..."
          className="w-full t-caption" />
      </div>
      <div>
        <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Description</label>
        <FormTextarea value={newReqDesc} onChange={setNewReqDesc} rows={3}
          placeholder="Describe what you need in detail..."
          className="w-full t-caption" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Category</label>
          <FormSelect
            value={newReqCategory}
            onChange={value => setNewReqCategory(value as RequestCategory)}
            options={[
              { value: 'content', label: 'Content Update' },
              { value: 'design', label: 'Design Change' },
              { value: 'bug', label: 'Bug Report' },
              { value: 'seo', label: 'SEO' },
              { value: 'feature', label: 'New Feature' },
              { value: 'other', label: 'Other' },
            ]}
            className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
          />
        </div>
        <div>
          <label className="t-caption-sm text-[var(--brand-text-muted)] mb-1 block">Related Page URL <span className="text-[var(--brand-text-muted)]">(optional)</span></label>
          <FormInput value={newReqPage} onChange={setNewReqPage}
            placeholder="/about or full URL..."
            className="w-full t-caption" />
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
        <Button onClick={onCancel} variant="ghost">Cancel</Button>
      </div>
      </div>
    </SectionCard>
  );
}
