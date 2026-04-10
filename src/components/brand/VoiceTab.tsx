import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Mic, Plus, Trash2, Sparkles, Loader2, Save } from 'lucide-react';
import { voice } from '../../api/brand-engine';
import type {
  VoiceSample,
  VoiceDNA,
  VoiceGuardrails,
  CalibrationSession,
  VoiceSampleContext,
} from '../../../shared/types/brand-engine';
import { PROMPT_TYPE_TO_SECTION_TYPE } from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton, TabBar } from '../ui';
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
  about: 'bg-zinc-700 text-zinc-300',
  service: 'bg-zinc-700 text-zinc-300',
  social: 'bg-zinc-700 text-zinc-300',
  seo: 'bg-zinc-700 text-zinc-300',
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
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
    if (!window.confirm('Delete this sample? This cannot be undone.')) return;
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
    <div className="space-y-4">
      {/* Toolbar */}
      {!showAdd && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Add Sample
          </button>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-200">Add Voice Sample</h3>

          <div className="space-y-1">
            <label htmlFor="sample-context-tag" className="text-xs text-zinc-400">Context tag</label>
            <select
              id="sample-context-tag"
              value={contextTag}
              onChange={e => setContextTag(e.target.value as VoiceSampleContext)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            >
              {CONTEXT_TAG_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="sample-content" className="text-xs text-zinc-400">Content</label>
            <textarea
              id="sample-content"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste an example of on-brand copy..."
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!content.trim() || submitting}
              className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setContent(''); }}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Sample list */}
      {samples.length === 0 && !showAdd ? (
        <EmptyState
          icon={Mic}
          title="No voice samples yet"
          description="Add examples of on-brand copy to train the voice engine."
          action={
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Add Sample
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {samples.map(sample => (
            <div
              key={sample.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0 space-y-2">
                {sample.contextTag && <ContextTagBadge tag={sample.contextTag} />}
                <p className="text-sm text-zinc-200 leading-relaxed">{sample.content}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(sample.id)}
                disabled={deletingId === sample.id}
                aria-label="Delete sample"
                className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors p-1 rounded disabled:opacity-50"
              >
                {deletingId === sample.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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
        <h3 className="text-sm font-semibold text-zinc-200">Personality Traits</h3>
        <div className="flex flex-wrap gap-2">
          {dna.personalityTraits.map(trait => (
            <span
              key={trait}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 rounded-lg text-xs text-zinc-300"
            >
              {trait}
              <button
                type="button"
                onClick={() => removeTrait(trait)}
                aria-label={`Remove trait: ${trait}`}
                className="text-zinc-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
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
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <button
            type="button"
            onClick={addTrait}
            disabled={!newTrait.trim()}
            className="flex items-center gap-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Tone Spectrum */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-200">Tone Spectrum</h3>

        {(
          [
            { key: 'formal_casual' as const, leftLabel: 'Formal', rightLabel: 'Casual' },
            { key: 'serious_playful' as const, leftLabel: 'Serious', rightLabel: 'Playful' },
            { key: 'technical_accessible' as const, leftLabel: 'Technical', rightLabel: 'Accessible' },
          ] as const
        ).map(({ key, leftLabel, rightLabel }) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={`tone-${key}`} className="text-xs text-zinc-400">
                {leftLabel} ↔ {rightLabel}
              </label>
              <span className="text-xs font-medium text-teal-400">{dna.toneSpectrum[key]}</span>
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
            <div className="flex justify-between text-xs text-zinc-600">
              <span>1</span>
              <span>10</span>
            </div>
          </div>
        ))}
      </div>

      {/* Style fields */}
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="dna-sentence-style" className="text-xs text-zinc-400">Sentence Style</label>
          <input
            id="dna-sentence-style"
            type="text"
            value={dna.sentenceStyle}
            onChange={e => setDna(prev => ({ ...prev, sentenceStyle: e.target.value }))}
            placeholder="e.g. Short punchy lines with occasional longer payoff"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="dna-vocabulary-level" className="text-xs text-zinc-400">Vocabulary Level</label>
          <input
            id="dna-vocabulary-level"
            type="text"
            value={dna.vocabularyLevel}
            onChange={e => setDna(prev => ({ ...prev, vocabularyLevel: e.target.value }))}
            placeholder="e.g. Conversational, 8th grade reading level"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="dna-humor-style" className="text-xs text-zinc-400">Humor Style</label>
          <input
            id="dna-humor-style"
            type="text"
            value={dna.humorStyle}
            onChange={e => setDna(prev => ({ ...prev, humorStyle: e.target.value }))}
            placeholder="e.g. Self-deprecating, observational"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save DNA
        </button>
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
        <h3 className="text-sm font-semibold text-zinc-200">Forbidden Words</h3>
        <div className="flex flex-wrap gap-2">
          {gr.forbiddenWords.map(word => (
            <span
              key={word}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-xs"
            >
              {word}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, forbiddenWords: prev.forbiddenWords.filter(w => w !== word) }))}
                aria-label={`Remove forbidden word: ${word}`}
                className="hover:text-red-300 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
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
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <button
            type="button"
            onClick={() => addToList(gr.forbiddenWords, list => setGr(prev => ({ ...prev, forbiddenWords: list })), newForbidden, () => setNewForbidden(''))}
            disabled={!newForbidden.trim()}
            className="flex items-center gap-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Required Terminology */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">Required Terminology</h3>
        <div className="space-y-2">
          {gr.requiredTerminology.map((term, i) => (
            <div key={`${term.use}::${term.insteadOf}`} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <span className="text-xs text-zinc-400 shrink-0">Use</span>
              <span className="text-sm text-teal-400 font-medium">{term.use}</span>
              <span className="text-xs text-zinc-500 shrink-0">instead of</span>
              <span className="text-sm text-zinc-400 line-through">{term.insteadOf}</span>
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, requiredTerminology: prev.requiredTerminology.filter((_, idx) => idx !== i) }))}
                aria-label={`Remove terminology: use ${term.use} instead of ${term.insteadOf}`}
                className="ml-auto text-zinc-600 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-use" className="text-xs text-zinc-400">Use</label>
            <input
              id="gr-term-use"
              type="text"
              value={newTermUse}
              onChange={e => setNewTermUse(e.target.value)}
              placeholder="e.g. clients"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-instead-of" className="text-xs text-zinc-400">Instead of</label>
            <input
              id="gr-term-instead-of"
              type="text"
              value={newTermInsteadOf}
              onChange={e => setNewTermInsteadOf(e.target.value)}
              placeholder="e.g. customers"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>
          <button
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
            className="mt-5 flex items-center gap-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Tone Boundaries */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">Tone Boundaries</h3>
        <div className="flex flex-wrap gap-2">
          {gr.toneBoundaries.map(boundary => (
            <span
              key={boundary}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 text-zinc-300 rounded-lg text-xs"
            >
              {boundary}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, toneBoundaries: prev.toneBoundaries.filter(b => b !== boundary) }))}
                aria-label={`Remove tone boundary: ${boundary}`}
                className="text-zinc-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
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
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <button
            type="button"
            onClick={() => addToList(gr.toneBoundaries, list => setGr(prev => ({ ...prev, toneBoundaries: list })), newToneBoundary, () => setNewToneBoundary(''))}
            disabled={!newToneBoundary.trim()}
            className="flex items-center gap-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Anti-patterns */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">Anti-patterns</h3>
        <div className="flex flex-wrap gap-2">
          {gr.antiPatterns.map(pattern => (
            <span
              key={pattern}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-lg text-xs"
            >
              {pattern}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, antiPatterns: prev.antiPatterns.filter(p => p !== pattern) }))}
                aria-label={`Remove anti-pattern: ${pattern}`}
                className="hover:text-amber-300 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
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
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <button
            type="button"
            onClick={() => addToList(gr.antiPatterns, list => setGr(prev => ({ ...prev, antiPatterns: list })), newAntiPattern, () => setNewAntiPattern(''))}
            disabled={!newAntiPattern.trim()}
            className="flex items-center gap-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Guardrails
        </button>
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
          <label htmlFor="calib-prompt-type" className="text-xs text-zinc-400">Prompt type</label>
          <select
            id="calib-prompt-type"
            value={promptType}
            onChange={e => setPromptType(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          >
            {PROMPT_TYPE_OPTIONS.map(pt => (
              <option key={pt} value={pt}>{pt.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate
            </>
          )}
        </button>
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
              <div
                key={i}
                className={`bg-zinc-900 border rounded-xl p-4 space-y-3 transition-colors ${
                  rating === 'on_brand'
                    ? 'border-teal-500/50'
                    : rating === 'close'
                    ? 'border-zinc-600'
                    : rating === 'wrong'
                    ? 'border-red-500/30'
                    : 'border-zinc-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs text-zinc-500 font-medium">Variation {i + 1}</span>
                  {rating && (
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        rating === 'on_brand'
                          ? 'bg-teal-500/10 text-teal-400'
                          : rating === 'close'
                          ? 'bg-zinc-700 text-zinc-300'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {rating.replace('_', ' ')}
                    </span>
                  )}
                </div>

                <p className="text-sm text-zinc-200 leading-relaxed">{variation.text}</p>

                {/* Rating buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-500">Rate:</span>
                  {(
                    [
                      { value: 'on_brand' as const, label: 'On-brand', activeClass: 'bg-teal-600 text-white' },
                      { value: 'close' as const, label: 'Close', activeClass: 'bg-zinc-600 text-white' },
                      { value: 'wrong' as const, label: 'Wrong', activeClass: 'bg-red-600 text-white' },
                    ] as const
                  ).map(({ value, label, activeClass }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLocalRatings(prev => ({ ...prev, [i]: value }))}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        rating === value
                          ? activeClass
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Feedback input */}
                <div className="space-y-1">
                  <label htmlFor={`calib-feedback-${i}`} className="text-xs text-zinc-400">
                    Feedback (optional)
                  </label>
                  <input
                    id={`calib-feedback-${i}`}
                    type="text"
                    value={localFeedback[i] ?? ''}
                    onChange={e => setLocalFeedback(prev => ({ ...prev, [i]: e.target.value }))}
                    placeholder="e.g. Good tone but too long"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                  />
                </div>

                {/* Save as Sample */}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSaveAsSample(i, variation.text)}
                    disabled={savingIndex === i}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {savingIndex === i ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    Save as Sample
                  </button>
                </div>
              </div>
            );
          })}

          {/* Refine panel — show when at least one variation is rated */}
          {hasAnyRating && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold text-zinc-200">Refine</h4>
              <div className="space-y-1">
                <label htmlFor="calib-refine-direction" className="text-xs text-zinc-400">
                  Steering direction (optional)
                </label>
                <input
                  id="calib-refine-direction"
                  type="text"
                  value={refineDirection}
                  onChange={e => setRefineDirection(e.target.value)}
                  placeholder="e.g. Make it punchier and shorter"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                />
              </div>
              <button
                type="button"
                onClick={handleRefine}
                disabled={refining}
                className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {refining ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Refining…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Refine
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state — before first generate */}
      {!generating && !session && (
        <div className="text-center py-10 space-y-2">
          <Sparkles className="w-8 h-8 text-zinc-600 mx-auto" />
          <p className="text-sm text-zinc-500">Select a prompt type and generate variations to start calibrating.</p>
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function VoiceTab({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<VoiceSection>('samples');

  const { data: profile, isLoading } = useQuery({
    queryKey: ['admin-voice-profile', workspaceId],
    queryFn: () => voice.getProfile(workspaceId),
  });

  useWebSocket({
    'voice:updated': () => {
      queryClient.invalidateQueries({ queryKey: ['admin-voice-profile', workspaceId] });
    },
  });

  const invalidateProfile = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-voice-profile', workspaceId] });
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
        titleIcon={<Mic className="w-4 h-4 text-teal-400" />}
      >
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Voice Calibration"
      titleIcon={<Mic className="w-4 h-4 text-teal-400" />}
    >
      {/* Section tabs */}
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
          samples={profile?.samples ?? []}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'dna' && (
        <DNASection
          workspaceId={workspaceId}
          voiceDNA={profile?.voiceDNA}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'guardrails' && (
        <GuardrailsSection
          workspaceId={workspaceId}
          guardrails={profile?.guardrails}
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
