import { useState, useEffect } from 'react';
import { BrainCircuit, Save, Sparkles } from 'lucide-react';
import { put, post } from '../../api/client';
import { SectionCard, Icon, Button } from '../ui';

interface IntelligenceProfile {
  industry?: string;
  goals?: string[];
  targetAudience?: string;
}

interface IntelligenceProfileTabProps {
  workspaceId: string;
  intelligenceProfile?: IntelligenceProfile | null;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onSave: (profile: IntelligenceProfile) => void;
}

export function IntelligenceProfileTab({ workspaceId, intelligenceProfile, toast, onSave }: IntelligenceProfileTabProps) {
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [industry, setIndustry] = useState(intelligenceProfile?.industry || '');
  const [goalsText, setGoalsText] = useState((intelligenceProfile?.goals || []).join(', '));
  const [targetAudience, setTargetAudience] = useState(intelligenceProfile?.targetAudience || '');

  // Re-initialize form if intelligenceProfile prop arrives after mount (ws loads async)
  useEffect(() => {
    if (!intelligenceProfile) return;
    setIndustry(intelligenceProfile.industry || '');
    setGoalsText((intelligenceProfile.goals || []).join(', '));
    setTargetAudience(intelligenceProfile.targetAudience || '');
  }, [intelligenceProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAutofill = async () => {
    setAutofilling(true);
    setAutofillError(null);
    try {
      const suggestion = await post<{ industry: string; goals: string[]; targetAudience: string }>(
        `/api/workspaces/${workspaceId}/intelligence-profile/autofill`,
        {},
      );
      if (suggestion.industry) setIndustry(suggestion.industry);
      if (suggestion.goals?.length) setGoalsText(suggestion.goals.join(', '));
      if (suggestion.targetAudience) setTargetAudience(suggestion.targetAudience);
    } catch {
      setAutofillError('Auto-fill failed — try again or fill manually');
    } finally {
      setAutofilling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const goals = goalsText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const payload: IntelligenceProfile = {};
      if (industry.trim()) payload.industry = industry.trim();
      if (goals.length > 0) payload.goals = goals;
      if (targetAudience.trim()) payload.targetAudience = targetAudience.trim();

      await put(`/api/workspaces/${workspaceId}/intelligence-profile`, payload);
      onSave(payload);
      toast('Intelligence profile saved');
    } catch {
      toast('Failed to save intelligence profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = 'w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors';
  const labelClass = 'block t-caption-sm font-medium text-[var(--brand-text)] mb-1';

  return (
    <div className="space-y-8">
      {/* Card */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--brand-border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
              <Icon as={BrainCircuit} size="md" className="text-teal-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Business Intelligence Profile</h3>
              <p className="t-caption text-[var(--brand-text-muted)]">
                Strategy context — industry, goals, and target audience used to personalise AI insights
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={handleAutofill}
            disabled={autofilling || saving}
            variant="secondary"
            size="sm"
            loading={autofilling}
            icon={autofilling ? undefined : Sparkles}
            className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/40 transition-all"
          >
            {autofilling ? 'Analysing…' : 'Auto-fill from site data'}
          </Button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Industry */}
          <div>
            <label className={labelClass}>Industry</label>
            <input
              className={fieldClass}
              placeholder="e.g. dental practice, B2B SaaS, ecommerce"
              value={industry}
              onChange={e => setIndustry(e.target.value)}
            />
          </div>

          {/* Goals */}
          <div>
            <label className={labelClass}>Goals</label>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">Enter goals separated by commas (e.g. increase organic traffic, generate more leads)</p>
            <textarea
              className={`${fieldClass} resize-none`}
              rows={3}
              placeholder="increase organic traffic, generate more leads, improve local SEO rankings"
              value={goalsText}
              onChange={e => setGoalsText(e.target.value)}
            />
          </div>

          {/* Target Audience */}
          <div>
            <label className={labelClass}>Target Audience</label>
            <textarea
              className={`${fieldClass} resize-none`}
              rows={3}
              placeholder="Describe your ideal client or customer"
              value={targetAudience}
              onChange={e => setTargetAudience(e.target.value)}
            />
          </div>

          {/* Autofill error */}
          {autofillError && (
            <p className="t-caption-sm text-red-400">{autofillError}</p>
          )}

          {/* Save */}
          <div className="flex justify-end pt-2 border-t border-[var(--brand-border)]">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving}
              loading={saving}
              icon={saving ? undefined : Save}
            >
              {saving ? 'Saving…' : 'Save Intelligence Profile'}
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Context note */}
      <SectionCard variant="subtle">
        <p className="font-medium text-[var(--brand-text)] t-caption-sm">How this is used</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">The intelligence profile feeds into AI-generated insights, keyword strategy recommendations, and chat context. It helps the platform understand the business's strategic direction, not just its contact details.</p>
      </SectionCard>
    </div>
  );
}
