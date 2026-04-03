import { useState, useEffect } from 'react';
import { BrainCircuit, Save, Loader2, Sparkles } from 'lucide-react';
import { put, post } from '../../api/client';

interface IntelligenceProfile {
  industry?: string;
  goals?: string[];
  targetAudience?: string;
}

interface IntelligenceProfileTabProps {
  workspaceId: string;
  intelligenceProfile?: IntelligenceProfile | null;
  toast: (msg: string, type?: string) => void;
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

  const fieldClass = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors';
  const labelClass = 'block text-[11px] font-medium text-zinc-400 mb-1';

  return (
    <div className="space-y-8">
      {/* Card */}
      <div className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
              <BrainCircuit className="w-4 h-4 text-teal-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Business Intelligence Profile</h3>
              <p className="text-xs text-zinc-500">
                Strategy context — industry, goals, and target audience used to personalise AI insights
              </p>
            </div>
          </div>
          <button
            onClick={handleAutofill}
            disabled={autofilling || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {autofilling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {autofilling ? 'Analysing…' : 'Auto-fill from site data'}
          </button>
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
            <p className="text-[11px] text-zinc-500 mb-1.5">Enter goals separated by commas (e.g. increase organic traffic, generate more leads)</p>
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
            <p className="text-[11px] text-red-400">{autofillError}</p>
          )}

          {/* Save */}
          <div className="flex justify-end pt-2 border-t border-zinc-800">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : 'Save Intelligence Profile'}
            </button>
          </div>
        </div>
      </div>

      {/* Context note */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800 px-4 py-3 text-[11px] text-zinc-500 space-y-1">
        <p className="font-medium text-zinc-400">How this is used</p>
        <p>The intelligence profile feeds into AI-generated insights, keyword strategy recommendations, and chat context. It helps the platform understand the business's strategic direction, not just its contact details.</p>
      </div>
    </div>
  );
}
