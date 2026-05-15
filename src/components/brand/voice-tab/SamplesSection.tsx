import { useState } from 'react';
import { Loader2, Mic, Plus, Trash2 } from 'lucide-react';
import { voice } from '../../../api/brand-engine';
import type { VoiceSample, VoiceSampleContext } from '../../../../shared/types/brand-engine';
import { Button, ConfirmDialog, EmptyState, Icon, SectionCard } from '../../ui';
import { useToast } from '../../Toast';
import { CONTEXT_TAG_COLORS, CONTEXT_TAG_OPTIONS } from './voiceTabModel';

interface SamplesSectionProps {
  workspaceId: string;
  samples: VoiceSample[];
  onChanged: () => void;
}

function ContextTagBadge({ tag }: { tag: VoiceSampleContext }) {
  const colorClass = CONTEXT_TAG_COLORS[tag];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded t-caption font-medium ${colorClass}`}>
      {tag}
    </span>
  );
}

export function SamplesSection({ workspaceId, samples, onChanged }: SamplesSectionProps) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [content, setContent] = useState('');
  const [contextTag, setContextTag] = useState<VoiceSampleContext>('headline');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await voice.addSample(workspaceId, {
        content: content.trim(),
        contextTag,
        source: 'manual',
      });
      toast('Sample added');
      setContent('');
      setShowAdd(false);
      onChanged();
    } catch {
      toast('Failed to add sample', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (sampleId: string) => {
    setDeletingId(sampleId);
    try {
      await voice.deleteSample(workspaceId, sampleId);
      toast('Sample deleted');
      onChanged();
    } catch {
      toast('Failed to delete sample', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {!showAdd && (
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => setShowAdd(true)}
              variant="primary"
              size="sm"
              icon={Plus}
            >
              Add Sample
            </Button>
          </div>
        )}

        {showAdd && (
          <SectionCard title="Add Voice Sample">
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="sample-context-tag" className="t-caption text-[var(--brand-text-muted)]">Context tag</label>
                <select
                  id="sample-context-tag"
                  value={contextTag}
                  onChange={e => setContextTag(e.target.value as VoiceSampleContext)}
                  className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                >
                  {CONTEXT_TAG_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="sample-content" className="t-caption text-[var(--brand-text-muted)]">Content</label>
                <textarea
                  id="sample-content"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Paste an example of on-brand copy..."
                  rows={4}
                  className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-none"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={!content.trim() || submitting}
                  variant="primary"
                  size="sm"
                  icon={Plus}
                  loading={submitting}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  onClick={() => { setShowAdd(false); setContent(''); }}
                  variant="secondary"
                  size="sm"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </SectionCard>
        )}

        {samples.length === 0 && !showAdd ? (
          <EmptyState
            icon={Mic}
            title="No voice samples yet"
            description="Add examples of on-brand copy to train the voice engine."
            action={
              <Button
                type="button"
                onClick={() => setShowAdd(true)}
                variant="primary"
                size="sm"
                icon={Plus}
              >
                Add Sample
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {samples.map(sample => (
              // pr-check-disable-next-line -- list item row with delete control, not a section card
              <div
                key={sample.id}
                className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] p-4 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0 space-y-2">
                  {sample.contextTag && <ContextTagBadge tag={sample.contextTag} />}
                  <p className="text-sm text-[var(--brand-text)] leading-relaxed">{sample.content}</p>
                </div>
                <Button
                  type="button"
                  onClick={() => setConfirmDeleteId(sample.id)}
                  disabled={deletingId === sample.id}
                  variant="ghost"
                  size="sm"
                  aria-label="Delete sample"
                  className="shrink-0 text-[var(--brand-text-muted)] hover:text-red-400 transition-colors p-1 rounded disabled:opacity-50"
                >
                  {deletingId === sample.id ? (
                    <Icon as={Loader2} size="md" className="animate-spin" />
                  ) : (
                    <Icon as={Trash2} size="md" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete Sample"
        message="Delete this sample? This cannot be undone."
        variant="destructive"
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDeleteId) handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
}
