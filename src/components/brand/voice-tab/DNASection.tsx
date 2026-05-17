import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { voice } from '../../../api/brand-engine';
import type { VoiceDNA } from '../../../../shared/types/brand-engine';
import { Button, IconButton, FormInput } from '../../ui';
import { useToast } from '../../Toast';
import { appendUniqueListValue, defaultDNA } from './voiceTabModel';

interface DNASectionProps {
  workspaceId: string;
  voiceDNA?: VoiceDNA;
  onChanged: () => void;
}

export function DNASection({ workspaceId, voiceDNA, onChanged }: DNASectionProps) {
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
    const { next, added } = appendUniqueListValue(dna.personalityTraits, newTrait);
    if (!added) return;
    setDna(prev => ({ ...prev, personalityTraits: next }));
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
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Personality Traits</h3>
        <div className="flex flex-wrap gap-2">
          {dna.personalityTraits.map(trait => (
            <span
              key={trait}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface-3)] rounded-[var(--radius-md)] t-caption text-[var(--brand-text)]"
            >
              {trait}
              <IconButton
                type="button"
                onClick={() => removeTrait(trait)}
                icon={Trash2}
                label={`Remove trait: ${trait}`}
                variant="ghost"
                size="sm"
                className="text-[var(--brand-text-muted)] hover:text-red-400 transition-colors"
              />
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="dna-new-trait" className="sr-only">New trait</label>
          <FormInput
            id="dna-new-trait"
            type="text"
            value={newTrait}
            onChange={setNewTrait}
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
            <FormInput
              id={`tone-${key}`}
              type="range"
              min={1}
              max={10}
              step={1}
              value={dna.toneSpectrum[key]}
              onChange={value => updateSpectrum(key, Number(value))}
              className="w-full accent-teal-500"
            />
            <div className="flex justify-between t-caption text-[var(--brand-text-muted)]">
              <span>1</span>
              <span>10</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="dna-sentence-style" className="t-caption text-[var(--brand-text-muted)]">Sentence Style</label>
          <FormInput
            id="dna-sentence-style"
            type="text"
            value={dna.sentenceStyle}
            onChange={value => setDna(prev => ({ ...prev, sentenceStyle: value }))}
            placeholder="e.g. Short punchy lines with occasional longer payoff"
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="dna-vocabulary-level" className="t-caption text-[var(--brand-text-muted)]">Vocabulary Level</label>
          <FormInput
            id="dna-vocabulary-level"
            type="text"
            value={dna.vocabularyLevel}
            onChange={value => setDna(prev => ({ ...prev, vocabularyLevel: value }))}
            placeholder="e.g. Conversational, 8th grade reading level"
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="dna-humor-style" className="t-caption text-[var(--brand-text-muted)]">Humor Style</label>
          <FormInput
            id="dna-humor-style"
            type="text"
            value={dna.humorStyle ?? ''}
            onChange={value => setDna(prev => ({ ...prev, humorStyle: value }))}
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
