import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, Plus, Trash2, Sparkles, Loader2, Save } from 'lucide-react';
import { queryKeys } from '../../lib/queryKeys';
import { voice } from '../../api/brand-engine';
import type {
  VoiceSample,
  VoiceDNA,
  VoiceGuardrails,
  CalibrationSession,
  VoiceSampleContext,
} from '../../../shared/types/brand-engine';
import { PROMPT_TYPE_TO_SECTION_TYPE } from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton, TabBar, Icon, Button, cn, ConfirmDialog } from '../ui';
import { useToast } from '../Toast';

type VoiceSection = 'samples' | 'dna' | 'guardrails' | 'calibration';

const CONTEXT_TAG_OPTIONS: { value: VoiceSampleContext; label: string }[] = [
  { value: 'headline', label: 'Headline' },
  { value: 'body', label: 'Body' },
  { value: 'cta', label: 'CTA' },
  { value: 'about', label: 'About' },
  { value: 'service', label: 'Service' },
  { value: 'social', label: 'Social' },
  { value: 'seo', label: 'SEO' },
];

const PROMPT_TYPE_OPTIONS = Object.keys(PROMPT_TYPE_TO_SECTION_TYPE);

// Map prompt types to VoiceSampleContext values
const PROMPT_TYPE_TO_CONTEXT: Record<string, VoiceSampleContext | undefined> = {
  hero_headline: 'headline',
  about_intro: 'about',
  service_body: 'service',
  cta_copy: 'cta',
  faq_answer: undefined,
  testimonial_copy: undefined,
  blog_intro: 'body',
  meta_description: 'seo',
};

const CONTEXT_TAG_COLORS: Record<VoiceSampleContext, string> = {
  headline: 'bg-teal-500/10 text-teal-400',
  body: 'bg-blue-500/10 text-blue-400',
  cta: 'bg-emerald-500/10 text-emerald-400',
  about: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
  service: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
  social: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
  seo: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
};

// ─── Module-level defaults ────────────────────────────────────────────────────

const defaultDNA: VoiceDNA = {
  personalityTraits: [],
  toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 },
  sentenceStyle: '',
  vocabularyLevel: '',
  humorStyle: '',
};

const defaultGuardrails: VoiceGuardrails = {
  forbiddenWords: [],
  requiredTerminology: [],
  toneBoundaries: [],
  antiPatterns: [],
};

// ─── Context Tag Badge ────────────────────────────────────────────────────────

function ContextTagBadge({ tag }: { tag: VoiceSampleContext }) {
  const colorClass = CONTEXT_TAG_COLORS[tag];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded t-caption font-medium ${colorClass}`}>
      {tag}
    </span>
  );
}

// ─── Samples Section ──────────────────────────────────────────────────────────

interface SamplesSectionProps {
  workspaceId: string;
  samples: VoiceSample[];
  onChanged: () => void;
}

function SamplesSection({ workspaceId, samples, onChanged }: SamplesSectionProps) {
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

  return (<>
    <div className="space-y-4">
      {/* Toolbar */}
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

      {/* Add form */}
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

      {/* Sample list */}
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
              <button
                type="button"
                onClick={() => setConfirmDeleteId(sample.id)}
                disabled={deletingId === sample.id}
                aria-label="Delete sample"
                className="shrink-0 text-[var(--brand-text-muted)] hover:text-red-400 transition-colors p-1 rounded disabled:opacity-50"
              >
                {deletingId === sample.id ? (
                  <Icon as={Loader2} size="md" className="animate-spin" />
                ) : (
                  <Icon as={Trash2} size="md" />
                )}
              </button>
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

// ─── Voice DNA Section ────────────────────────────────────────────────────────

interface DNASectionProps {
  workspaceId: string;
  voiceDNA?: VoiceDNA;
  onChanged: () => void;
}

function DNASection({ workspaceId, voiceDNA, onChanged }: DNASectionProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [dna, setDna] = useState<VoiceDNA>(() => voiceDNA ?? defaultDNA);
  const [newTrait, setNewTrait] = useState('');

  useEffect(() => {
    if (voiceDNA) setDna(voiceDNA);
  }, [voiceDNA]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await voice.updateProfile(workspaceId, { voiceDNA: dna });
      toast('Voice DNA saved');
      onChanged();
    } catch {
      toast('Failed to save Voice DNA', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addTrait = () => {
    const trimmed = newTrait.trim();
    if (!trimmed || dna.personalityTraits.includes(trimmed)) return;
    setDna(prev => ({ ...prev, personalityTraits: [...prev.personalityTraits, trimmed] }));
    setNewTrait('');
  };

  const removeTrait = (trait: string) => {
    setDna(prev => ({ ...prev, personalityTraits: prev.personalityTraits.filter(t => t !== trait) }));
  };

  const updateSpectrum = (key: keyof typeof dna.toneSpectrum, value: number) => {
    setDna(prev => ({
      ...prev,
      toneSpectrum: { ...prev.toneSpectrum, [key]: value },
    }));
  };

  return (
    <div className="space-y-6">
      {/* Personality Traits */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Personality Traits</h3>
        <div className="flex flex-wrap gap-2">
          {dna.personalityTraits.map(trait => (
            <span
              key={trait}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface-3)] rounded-[var(--radius-md)] t-caption text-[var(--brand-text)]"
            >
              {trait}
              <button
                type="button"
                onClick={() => removeTrait(trait)}
                aria-label={`Remove trait: ${trait}`}
                className="text-[var(--brand-text-muted)] hover:text-red-400 transition-colors"
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="dna-new-trait" className="sr-only">New trait</label>
          <input
            id="dna-new-trait"
            type="text"
            value={newTrait}
            onChange={e => setNewTrait(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTrait(); } }}
            placeholder="e.g. Witty but never sarcastic"
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <Button
            type="button"
            onClick={addTrait}
            disabled={!newTrait.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Tone Spectrum */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Tone Spectrum</h3>

        {(
          [
            { key: 'formal_casual' as const, leftLabel: 'Formal', rightLabel: 'Casual' },
            { key: 'serious_playful' as const, leftLabel: 'Serious', rightLabel: 'Playful' },
            { key: 'technical_accessible' as const, leftLabel: 'Technical', rightLabel: 'Accessible' },
          ] as const
        ).map(({ key, leftLabel, rightLabel }) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={`tone-${key}`} className="t-caption text-[var(--brand-text-muted)]">
                {leftLabel} ↔ {rightLabel}
              </label>
              <span className="t-caption font-medium text-teal-400">{dna.toneSpectrum[key]}</span>
            </div>
            <input
              id={`tone-${key}`}
              type="range"
              min={1}
              max={10}
              step={1}
              value={dna.toneSpectrum[key]}
              onChange={e => updateSpectrum(key, Number(e.target.value))}
              className="w-full accent-teal-500"
            />
            <div className="flex justify-between t-caption text-[var(--brand-text-muted)]">
              <span>1</span>
              <span>10</span>
            </div>
          </div>
        ))}
      </div>

      {/* Style fields */}
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="dna-sentence-style" className="t-caption text-[var(--brand-text-muted)]">Sentence Style</label>
          <input
            id="dna-sentence-style"
            type="text"
            value={dna.sentenceStyle}
            onChange={e => setDna(prev => ({ ...prev, sentenceStyle: e.target.value }))}
            placeholder="e.g. Short punchy lines with occasional longer payoff"
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="dna-vocabulary-level" className="t-caption text-[var(--brand-text-muted)]">Vocabulary Level</label>
          <input
            id="dna-vocabulary-level"
            type="text"
            value={dna.vocabularyLevel}
            onChange={e => setDna(prev => ({ ...prev, vocabularyLevel: e.target.value }))}
            placeholder="e.g. Conversational, 8th grade reading level"
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="dna-humor-style" className="t-caption text-[var(--brand-text-muted)]">Humor Style</label>
          <input
            id="dna-humor-style"
            type="text"
            value={dna.humorStyle ?? ''}
            onChange={e => setDna(prev => ({ ...prev, humorStyle: e.target.value }))}
            placeholder="e.g. Self-deprecating, observational"
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
          variant="primary"
          size="sm"
          icon={Save}
          loading={saving}
        >
          Save DNA
        </Button>
      </div>
    </div>
  );
}

// ─── Guardrails Section ───────────────────────────────────────────────────────

interface GuardrailsSectionProps {
  workspaceId: string;
  guardrails?: VoiceGuardrails;
  onChanged: () => void;
}

function addToList(list: string[], setList: (v: string[]) => void, val: string, clearFn: () => void) {
  const trimmed = val.trim();
  if (!trimmed || list.includes(trimmed)) return;
  setList([...list, trimmed]);
  clearFn();
}

function GuardrailsSection({ workspaceId, guardrails, onChanged }: GuardrailsSectionProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [gr, setGr] = useState<VoiceGuardrails>(() => guardrails ?? defaultGuardrails);
  const [newForbidden, setNewForbidden] = useState('');
  const [newTermUse, setNewTermUse] = useState('');
  const [newTermInsteadOf, setNewTermInsteadOf] = useState('');
  const [newToneBoundary, setNewToneBoundary] = useState('');
  const [newAntiPattern, setNewAntiPattern] = useState('');

  useEffect(() => {
    if (guardrails) setGr(guardrails);
  }, [guardrails]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await voice.updateProfile(workspaceId, { guardrails: gr });
      toast('Guardrails saved');
      onChanged();
    } catch {
      toast('Failed to save guardrails', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Forbidden Words */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Forbidden Words</h3>
        <div className="flex flex-wrap gap-2">
          {gr.forbiddenWords.map(word => (
            <span
              key={word}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 text-red-400 rounded-[var(--radius-md)] t-caption"
            >
              {word}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, forbiddenWords: prev.forbiddenWords.filter(w => w !== word) }))}
                aria-label={`Remove forbidden word: ${word}`}
                className="hover:text-red-300 transition-colors"
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-forbidden-word" className="sr-only">New forbidden word</label>
          <input
            id="gr-forbidden-word"
            type="text"
            value={newForbidden}
            onChange={e => setNewForbidden(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addToList(gr.forbiddenWords, list => setGr(prev => ({ ...prev, forbiddenWords: list })), newForbidden, () => setNewForbidden(''));
              }
            }}
            placeholder="e.g. synergy, leverage"
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <Button
            type="button"
            onClick={() => addToList(gr.forbiddenWords, list => setGr(prev => ({ ...prev, forbiddenWords: list })), newForbidden, () => setNewForbidden(''))}
            disabled={!newForbidden.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Required Terminology */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Required Terminology</h3>
        <div className="space-y-2">
          {gr.requiredTerminology.map((term, i) => (
            <div key={`${term.use}::${term.insteadOf}`} className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2">
              <span className="t-caption text-[var(--brand-text-muted)] shrink-0">Use</span>
              <span className="text-sm text-teal-400 font-medium">{term.use}</span>
              <span className="t-caption text-[var(--brand-text-muted)] shrink-0">instead of</span>
              <span className="text-sm text-[var(--brand-text-muted)] line-through">{term.insteadOf}</span>
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, requiredTerminology: prev.requiredTerminology.filter((_, idx) => idx !== i) }))}
                aria-label={`Remove terminology: use ${term.use} instead of ${term.insteadOf}`}
                className="ml-auto text-[var(--brand-text-muted)] hover:text-red-400 transition-colors"
              >
                <Icon as={Trash2} size="md" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-use" className="t-caption text-[var(--brand-text-muted)]">Use</label>
            <input
              id="gr-term-use"
              type="text"
              value={newTermUse}
              onChange={e => setNewTermUse(e.target.value)}
              placeholder="e.g. clients"
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-instead-of" className="t-caption text-[var(--brand-text-muted)]">Instead of</label>
            <input
              id="gr-term-instead-of"
              type="text"
              value={newTermInsteadOf}
              onChange={e => setNewTermInsteadOf(e.target.value)}
              placeholder="e.g. customers"
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const use = newTermUse.trim();
              const insteadOf = newTermInsteadOf.trim();
              if (use && insteadOf) {
                setGr(prev => ({ ...prev, requiredTerminology: [...prev.requiredTerminology, { use, insteadOf }] }));
                setNewTermUse('');
                setNewTermInsteadOf('');
              }
            }}
            disabled={!newTermUse.trim() || !newTermInsteadOf.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
            className="mt-5 shrink-0"
          >
            Add
          </Button>
        </div>
      </div>

      {/* Tone Boundaries */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Tone Boundaries</h3>
        <div className="flex flex-wrap gap-2">
          {gr.toneBoundaries.map(boundary => (
            <span
              key={boundary}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface-3)] text-[var(--brand-text)] rounded-[var(--radius-md)] t-caption"
            >
              {boundary}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, toneBoundaries: prev.toneBoundaries.filter(b => b !== boundary) }))}
                aria-label={`Remove tone boundary: ${boundary}`}
                className="text-[var(--brand-text-muted)] hover:text-red-400 transition-colors"
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-tone-boundary" className="sr-only">New tone boundary</label>
          <input
            id="gr-tone-boundary"
            type="text"
            value={newToneBoundary}
            onChange={e => setNewToneBoundary(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addToList(gr.toneBoundaries, list => setGr(prev => ({ ...prev, toneBoundaries: list })), newToneBoundary, () => setNewToneBoundary(''));
              }
            }}
            placeholder="e.g. Never condescending"
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <Button
            type="button"
            onClick={() => addToList(gr.toneBoundaries, list => setGr(prev => ({ ...prev, toneBoundaries: list })), newToneBoundary, () => setNewToneBoundary(''))}
            disabled={!newToneBoundary.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Anti-patterns */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Anti-patterns</h3>
        <div className="flex flex-wrap gap-2">
          {gr.antiPatterns.map(pattern => (
            <span
              key={pattern}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-[var(--radius-md)] t-caption"
            >
              {pattern}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, antiPatterns: prev.antiPatterns.filter(p => p !== pattern) }))}
                aria-label={`Remove anti-pattern: ${pattern}`}
                className="hover:text-amber-300 transition-colors"
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-anti-pattern" className="sr-only">New anti-pattern</label>
          <input
            id="gr-anti-pattern"
            type="text"
            value={newAntiPattern}
            onChange={e => setNewAntiPattern(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addToList(gr.antiPatterns, list => setGr(prev => ({ ...prev, antiPatterns: list })), newAntiPattern, () => setNewAntiPattern(''));
              }
            }}
            placeholder="e.g. Starting every sentence with 'We'"
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <Button
            type="button"
            onClick={() => addToList(gr.antiPatterns, list => setGr(prev => ({ ...prev, antiPatterns: list })), newAntiPattern, () => setNewAntiPattern(''))}
            disabled={!newAntiPattern.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
          variant="primary"
          size="sm"
          icon={Save}
          loading={saving}
        >
          Save Guardrails
        </Button>
      </div>
    </div>
  );
}

// ─── Calibration Section ──────────────────────────────────────────────────────

interface CalibrationSectionProps {
  workspaceId: string;
  onSampleSaved: () => void;
}

function CalibrationSection({ workspaceId, onSampleSaved }: CalibrationSectionProps) {
  const { toast } = useToast();

  const [promptType, setPromptType] = useState(PROMPT_TYPE_OPTIONS[0]);
  const [generating, setGenerating] = useState(false);
  const [session, setSession] = useState<CalibrationSession | null>(null);
  const [localRatings, setLocalRatings] = useState<Record<number, 'on_brand' | 'close' | 'wrong'>>({});
  const [localFeedback, setLocalFeedback] = useState<Record<number, string>>({});
  const [refineDirection, setRefineDirection] = useState('');
  const [refining, setRefining] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savingFeedbackIndex, setSavingFeedbackIndex] = useState<number | null>(null);

  const saveFeedbackMutation = useMutation({
    mutationFn: ({ sessionId, variationIndex, feedback }: { sessionId: string; variationIndex: number; feedback: string }) =>
      voice.saveVariationFeedback(workspaceId, sessionId, variationIndex, feedback),
    onSuccess: (_data, variables) => {
      setSavingFeedbackIndex(null);
      toast(`Feedback saved for variation ${variables.variationIndex + 1}`);
    },
    onError: () => {
      setSavingFeedbackIndex(null);
      toast('Failed to save feedback', 'error');
    },
  });

  const handleSaveFeedback = (variationIndex: number) => {
    if (!session) return;
    const feedback = localFeedback[variationIndex];
    if (!feedback?.trim()) {
      toast('No feedback to save', 'error');
      return;
    }
    setSavingFeedbackIndex(variationIndex);
    saveFeedbackMutation.mutate({ sessionId: session.id, variationIndex, feedback: feedback.trim() });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setSession(null);
    setLocalRatings({});
    setLocalFeedback({});
    setRefineDirection('');
    try {
      const result = await voice.calibrate(workspaceId, { promptType });
      setSession(result);
      toast('Generated 3 variations');
    } catch {
      toast('Failed to generate variations', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefine = async () => {
    if (!session) return;
    // Find the best-rated variation index
    const bestIndex = (() => {
      // Prefer on_brand, then close, then 0
      for (let i = 0; i < session.variations.length; i++) {
        if (localRatings[i] === 'on_brand') return i;
      }
      for (let i = 0; i < session.variations.length; i++) {
        if (localRatings[i] === 'close') return i;
      }
      return 0;
    })();
    setRefining(true);
    try {
      const updated = await voice.refine(workspaceId, session.id, {
        variationIndex: bestIndex,
        direction: refineDirection.trim() || 'same direction',
      });
      setSession(updated);
      setLocalRatings({});
      setLocalFeedback({});
      setRefineDirection('');
      toast('Refined variations generated');
    } catch {
      toast('Failed to refine variations', 'error');
    } finally {
      setRefining(false);
    }
  };

  const handleSaveAsSample = async (variationIndex: number, text: string) => {
    const contextTag = PROMPT_TYPE_TO_CONTEXT[promptType];
    setSavingIndex(variationIndex);
    try {
      await voice.addSample(workspaceId, {
        content: text,
        contextTag: contextTag,
        source: 'calibration_loop',
      });
      toast('Saved as sample');
      onSampleSaved();
    } catch {
      toast('Failed to save sample', 'error');
    } finally {
      setSavingIndex(null);
    }
  };

  const hasAnyRating = Object.keys(localRatings).length > 0;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-end gap-3">
        <div className="space-y-1 flex-1">
          <label htmlFor="calib-prompt-type" className="t-caption text-[var(--brand-text-muted)]">Prompt type</label>
          <select
            id="calib-prompt-type"
            value={promptType}
            onChange={e => setPromptType(e.target.value)}
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          >
            {PROMPT_TYPE_OPTIONS.map(pt => (
              <option key={pt} value={pt}>{pt.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          variant="primary"
          size="sm"
          icon={Sparkles}
          loading={generating}
        >
          {generating ? 'Generating…' : 'Generate'}
        </Button>
      </div>

      {/* Loading state */}
      {generating && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {/* Variations */}
      {!generating && session && (
        <div className="space-y-4">
          {session.variations.map((variation, i) => {
            const rating = localRatings[i];
            return (
              // pr-check-disable-next-line -- variation card uses dynamic border color for rating feedback; SectionCard does not support dynamic border overrides
              <div
                key={i}
                className={cn(
                  'bg-[var(--surface-2)] border rounded-[var(--radius-xl)] p-4 space-y-3 transition-colors',
                  rating === 'on_brand'
                    ? 'border-teal-500/50'
                    : rating === 'close'
                    ? 'border-[var(--brand-border-hover)]'
                    : rating === 'wrong'
                    ? 'border-red-500/30'
                    : 'border-[var(--brand-border)]'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="t-caption text-[var(--brand-text-muted)] font-medium">Variation {i + 1}</span>
                  {rating && (
                    <span
                      className={cn(
                        't-caption font-medium px-2 py-0.5 rounded',
                        rating === 'on_brand'
                          ? 'bg-teal-500/10 text-teal-400'
                          : rating === 'close'
                          ? 'bg-[var(--surface-3)] text-[var(--brand-text)]'
                          : 'bg-red-500/10 text-red-400'
                      )}
                    >
                      {rating.replace('_', ' ')}
                    </span>
                  )}
                </div>

                <p className="text-sm text-[var(--brand-text)] leading-relaxed">{variation.text}</p>

                {/* Rating buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="t-caption text-[var(--brand-text-muted)]">Rate:</span>
                  {(
                    [
                      { value: 'on_brand' as const, label: 'On-brand', activeClass: 'bg-teal-600 text-white' },
                      { value: 'close' as const, label: 'Close', activeClass: 'bg-[var(--brand-border-hover)] text-white' },
                      { value: 'wrong' as const, label: 'Wrong', activeClass: 'bg-red-600 text-white' },
                    ] as const
                  ).map(({ value, label, activeClass }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLocalRatings(prev => ({ ...prev, [i]: value }))}
                      className={cn(
                        'px-2.5 py-1 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
                        rating === value
                          ? activeClass
                          : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:bg-[var(--brand-border-hover)]'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Feedback input */}
                <div className="space-y-1">
                  <label htmlFor={`calib-feedback-${i}`} className="t-caption text-[var(--brand-text-muted)]">
                    Feedback (optional)
                  </label>
                  <input
                    id={`calib-feedback-${i}`}
                    type="text"
                    value={localFeedback[i] ?? ''}
                    onChange={e => setLocalFeedback(prev => ({ ...prev, [i]: e.target.value }))}
                    placeholder="e.g. Good tone but too long"
                    className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                  />
                </div>

                {/* Actions: Save feedback + Save as Sample */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    onClick={() => handleSaveFeedback(i)}
                    disabled={savingFeedbackIndex === i || !localFeedback[i]?.trim()}
                    variant="secondary"
                    size="sm"
                    icon={savingFeedbackIndex === i ? Loader2 : Save}
                    loading={savingFeedbackIndex === i}
                  >
                    Save feedback
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleSaveAsSample(i, variation.text)}
                    disabled={savingIndex === i}
                    variant="secondary"
                    size="sm"
                    icon={savingIndex === i ? Loader2 : Save}
                    loading={savingIndex === i}
                  >
                    Save as Sample
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Refine panel — show when at least one variation is rated */}
          {hasAnyRating && (
            <SectionCard title="Refine">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="calib-refine-direction" className="t-caption text-[var(--brand-text-muted)]">
                    Steering direction (optional)
                  </label>
                  <input
                    id="calib-refine-direction"
                    type="text"
                    value={refineDirection}
                    onChange={e => setRefineDirection(e.target.value)}
                    placeholder="e.g. Make it punchier and shorter"
                    className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleRefine}
                  disabled={refining}
                  variant="primary"
                  size="sm"
                  icon={refining ? Loader2 : Sparkles}
                  loading={refining}
                >
                  {refining ? 'Refining…' : 'Refine'}
                </Button>
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* Empty state — before first generate */}
      {!generating && !session && (
        <div className="text-center py-10 space-y-2">
          <Icon as={Sparkles} size="2xl" className="text-[var(--brand-text-muted)] mx-auto" />
          <p className="text-sm text-[var(--brand-text-muted)]">Select a prompt type and generate variations to start calibrating.</p>
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function VoiceTab({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<VoiceSection>('samples');

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.admin.voiceProfile(workspaceId),
    queryFn: () => voice.getProfile(workspaceId),
  });

  const createProfileMutation = useMutation({
    mutationFn: () => voice.createProfile(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) });
      toast('Voice profile created');
    },
    onError: () => {
      toast('Failed to create voice profile', 'error');
    },
  });

  const invalidateProfile = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) });
  };

  const sections: { id: string; label: string }[] = [
    { id: 'samples', label: 'Samples' },
    { id: 'dna', label: 'Voice DNA' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'calibration', label: 'Calibration' },
  ];

  if (isLoading) {
    return (
      <SectionCard
        title="Voice Calibration"
        titleIcon={<Icon as={Mic} size="md" className="text-teal-400" />}
      >
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </SectionCard>
    );
  }

  if (!profile) {
    return (
      <SectionCard
        title="Voice Calibration"
        titleIcon={<Icon as={Mic} size="md" className="text-teal-400" />}
      >
        <EmptyState
          icon={Mic}
          title="No voice profile yet"
          description="Create a voice profile to start calibrating your brand's tone and style."
          action={
            <Button
              type="button"
              onClick={() => createProfileMutation.mutate()}
              disabled={createProfileMutation.isPending}
              variant="primary"
              size="sm"
              icon={createProfileMutation.isPending ? Loader2 : undefined}
              loading={createProfileMutation.isPending}
            >
              {createProfileMutation.isPending ? 'Creating…' : 'Create voice profile'}
            </Button>
          }
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Voice Calibration"
      titleIcon={<Icon as={Mic} size="md" className="text-teal-400" />}
    >
      {/* Section tabs */}
      {/* tab-deeplink-ok: VoiceTab section tabs (samples/calibration/analytics) are not externally deep-linked */}
      <TabBar
        tabs={sections}
        active={activeSection}
        onChange={id => setActiveSection(id as VoiceSection)}
        className="mb-5"
      />

      {/* Section content */}
      {activeSection === 'samples' && (
        <SamplesSection
          workspaceId={workspaceId}
          samples={profile.samples ?? []}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'dna' && (
        <DNASection
          workspaceId={workspaceId}
          voiceDNA={profile.voiceDNA}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'guardrails' && (
        <GuardrailsSection
          workspaceId={workspaceId}
          guardrails={profile.guardrails}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'calibration' && (
        <CalibrationSection
          workspaceId={workspaceId}
          onSampleSaved={invalidateProfile}
        />
      )}
    </SectionCard>
  );
}
