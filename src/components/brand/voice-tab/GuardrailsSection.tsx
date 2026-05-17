import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { voice } from '../../../api/brand-engine';
import type { VoiceGuardrails } from '../../../../shared/types/brand-engine';
import { Button, IconButton, FormInput } from '../../ui';
import { useToast } from '../../Toast';
import {
  appendUniqueListValue,
  appendUniqueRequiredTerminology,
  defaultGuardrails,
} from './voiceTabModel';

interface GuardrailsSectionProps {
  workspaceId: string;
  guardrails?: VoiceGuardrails;
  onChanged: () => void;
}

function addToList(list: string[], setList: (v: string[]) => void, val: string, clearFn: () => void) {
  const { next, added } = appendUniqueListValue(list, val);
  if (!added) return;
  setList(next);
  clearFn();
}

export function GuardrailsSection({ workspaceId, guardrails, onChanged }: GuardrailsSectionProps) {
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
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Forbidden Words</h3>
        <div className="flex flex-wrap gap-2">
          {gr.forbiddenWords.map(word => (
            <span
              key={word}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 text-red-400 rounded-[var(--radius-md)] badge-span-ok t-caption"
            >
              {word}
              <IconButton
                type="button"
                icon={Trash2}
                label={`Remove forbidden word: ${word}`}
                size="sm"
                variant="ghost"
                onClick={() => setGr(prev => ({ ...prev, forbiddenWords: prev.forbiddenWords.filter(w => w !== word) }))}
                className="hover:text-red-300 hover:bg-transparent"
              />
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-forbidden-word" className="sr-only">New forbidden word</label>
          <FormInput
            id="gr-forbidden-word"
            type="text"
            value={newForbidden}
            onChange={setNewForbidden}
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

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Required Terminology</h3>
        <div className="space-y-2">
          {gr.requiredTerminology.map((term, i) => (
            <div key={`${term.use}::${term.insteadOf}`} className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2">
              <span className="t-caption text-[var(--brand-text-muted)] shrink-0">Use</span>
              <span className="text-sm text-teal-400 font-medium">{term.use}</span>
              <span className="t-caption text-[var(--brand-text-muted)] shrink-0">instead of</span>
              <span className="text-sm text-[var(--brand-text-muted)] line-through">{term.insteadOf}</span>
              <IconButton
                type="button"
                icon={Trash2}
                label={`Remove terminology: use ${term.use} instead of ${term.insteadOf}`}
                size="sm"
                variant="ghost"
                onClick={() => setGr(prev => ({ ...prev, requiredTerminology: prev.requiredTerminology.filter((_, idx) => idx !== i) }))}
                className="ml-auto text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-transparent"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-use" className="t-caption text-[var(--brand-text-muted)]">Use</label>
            <FormInput
              id="gr-term-use"
              type="text"
              value={newTermUse}
              onChange={setNewTermUse}
              placeholder="e.g. clients"
              className="w-full"
            />
          </div>
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-instead-of" className="t-caption text-[var(--brand-text-muted)]">Instead of</label>
            <FormInput
              id="gr-term-instead-of"
              type="text"
              value={newTermInsteadOf}
              onChange={setNewTermInsteadOf}
              placeholder="e.g. customers"
              className="w-full"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const result = appendUniqueRequiredTerminology(
                gr.requiredTerminology,
                newTermUse,
                newTermInsteadOf
              );
              if (!result.added) return;

              setGr(prev => ({ ...prev, requiredTerminology: result.next }));
              setNewTermUse('');
              setNewTermInsteadOf('');
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

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Tone Boundaries</h3>
        <div className="flex flex-wrap gap-2">
          {gr.toneBoundaries.map(boundary => (
            <span
              key={boundary}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface-3)] text-[var(--brand-text)] rounded-[var(--radius-md)] t-caption"
            >
              {boundary}
              <IconButton
                type="button"
                icon={Trash2}
                label={`Remove tone boundary: ${boundary}`}
                size="sm"
                variant="ghost"
                onClick={() => setGr(prev => ({ ...prev, toneBoundaries: prev.toneBoundaries.filter(b => b !== boundary) }))}
                className="text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-transparent"
              />
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-tone-boundary" className="sr-only">New tone boundary</label>
          <FormInput
            id="gr-tone-boundary"
            type="text"
            value={newToneBoundary}
            onChange={setNewToneBoundary}
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

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Anti-patterns</h3>
        <div className="flex flex-wrap gap-2">
          {gr.antiPatterns.map(pattern => (
            <span
              key={pattern}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-[var(--radius-md)] badge-span-ok t-caption"
            >
              {pattern}
              <IconButton
                type="button"
                icon={Trash2}
                label={`Remove anti-pattern: ${pattern}`}
                size="sm"
                variant="ghost"
                onClick={() => setGr(prev => ({ ...prev, antiPatterns: prev.antiPatterns.filter(p => p !== pattern) }))}
                className="hover:text-amber-300 hover:bg-transparent"
              />
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-anti-pattern" className="sr-only">New anti-pattern</label>
          <FormInput
            id="gr-anti-pattern"
            type="text"
            value={newAntiPattern}
            onChange={setNewAntiPattern}
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
