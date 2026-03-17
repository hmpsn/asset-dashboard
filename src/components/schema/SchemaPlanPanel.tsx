/**
 * SchemaPlanPanel — Admin panel for reviewing and managing the site-wide schema plan.
 * Shows page roles, canonical entities, and actions to generate/update/send to client.
 */
import { useState, useEffect } from 'react';
import {
  Loader2, Sparkles, Send, CheckCircle, AlertCircle,
  ChevronDown, ChevronRight, Globe, Zap, HelpCircle,
} from 'lucide-react';
import { schemaPlan } from '../../api/seo';
import type { SchemaSitePlan, SchemaPageRole } from '../../../shared/types/schema-plan';
import { SCHEMA_ROLE_LABELS, SCHEMA_ROLE_INDEX } from '../../../shared/types/schema-plan';

interface Props {
  siteId: string;
}

const ROLE_OPTIONS: SchemaPageRole[] = [
  'homepage', 'pillar', 'service', 'audience', 'lead-gen', 'blog', 'about',
  'contact', 'location', 'product', 'partnership', 'faq', 'case-study',
  'comparison', 'generic',
];

const ROLE_COLORS: Record<SchemaPageRole, string> = {
  homepage: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pillar: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  service: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  audience: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'lead-gen': 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  blog: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  about: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  contact: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  location: 'bg-green-500/15 text-green-300 border-green-500/30',
  product: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  partnership: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  faq: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'case-study': 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  comparison: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  generic: 'bg-zinc-500/10 text-zinc-400 border-zinc-600/30',
};

export function SchemaPlanPanel({ siteId }: Props) {
  const [plan, setPlan] = useState<SchemaSitePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showEntities, setShowEntities] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await schemaPlan.get(siteId);
        if (!cancelled) setPlan(result ?? null);
      } catch { /* no plan yet */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [siteId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await schemaPlan.generate(siteId);
      setPlan(result);
      setDirty(false);
      setSuccess(`Plan generated: ${result.pageRoles.length} pages, ${result.canonicalEntities.length} entities`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan');
    }
    setGenerating(false);
  };

  const handleRoleChange = (pagePath: string, newRole: SchemaPageRole) => {
    if (!plan) return;
    const updated = plan.pageRoles.map(pr =>
      pr.pagePath === pagePath ? { ...pr, role: newRole } : pr
    );
    setPlan({ ...plan, pageRoles: updated });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const result = await schemaPlan.update(siteId, plan.pageRoles, plan.canonicalEntities);
      setPlan(result);
      setDirty(false);
      setSuccess('Plan saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan');
    }
    setSaving(false);
  };

  const handleSendToClient = async () => {
    if (!plan) return;
    setSending(true);
    setError(null);
    try {
      const { plan: updatedPlan } = await schemaPlan.sendToClient(siteId);
      setPlan(updatedPlan);
      setSuccess('Schema strategy preview sent to client for review');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send to client');
    }
    setSending(false);
  };

  const handleActivate = async () => {
    if (!plan) return;
    setActivating(true);
    setError(null);
    try {
      const result = await schemaPlan.activate(siteId);
      setPlan(result);
      setSuccess('Plan activated — schema generation will now follow this plan');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate plan');
    }
    setActivating(false);
  };

  const statusBadge = (status: SchemaSitePlan['status']) => {
    const map: Record<string, { label: string; cls: string }> = {
      draft: { label: 'Draft', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' },
      sent_to_client: { label: 'Sent to Client', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
      client_approved: { label: 'Client Approved', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
      client_changes_requested: { label: 'Changes Requested', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
      active: { label: 'Active', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
    };
    const s = map[status] || map.draft;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${s.cls}`}>{s.label}</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading schema plan...
      </div>
    );
  }

  // No plan yet — show generate button
  if (!plan) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-medium text-zinc-200">Schema Site Plan</span>
        </div>
        <p className="text-xs text-zinc-500">
          Generate a site-wide schema plan that analyzes all pages and your keyword strategy to assign roles and identify canonical entities. This ensures consistent, coordinated schema across your entire site.
        </p>
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3 h-3" /> {error}
          </div>
        )}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? 'Analyzing site...' : 'Generate Site Plan'}
        </button>
      </div>
    );
  }

  // Plan exists — show review interface
  const roleCounts = plan.pageRoles.reduce((acc, pr) => {
    acc[pr.role] = (acc[pr.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-medium text-zinc-200">Schema Site Plan</span>
          {statusBadge(plan.status)}
          <span className="text-[10px] text-zinc-500">
            {plan.pageRoles.length} pages · {plan.canonicalEntities.length} entities
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[10px] text-amber-400">Unsaved changes</span>}
          {expanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-4">
          {/* Status messages */}
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3 h-3 shrink-0" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
              <CheckCircle className="w-3 h-3 shrink-0" /> {success}
            </div>
          )}

          {/* Actions bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {generating ? 'Regenerating...' : 'Regenerate'}
            </button>
            {dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                Save Changes
              </button>
            )}
            {plan.status === 'draft' && (
              <button
                onClick={handleSendToClient}
                disabled={sending || dirty}
                title={dirty ? 'Save changes first' : 'Send strategy preview to client for approval'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/30 transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Send to Client
              </button>
            )}
            {(plan.status === 'draft' || plan.status === 'client_approved') && (
              <button
                onClick={handleActivate}
                disabled={activating || dirty}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/30 transition-colors disabled:opacity-50"
              >
                {activating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Activate Plan
              </button>
            )}
          </div>

          {/* Role summary chips */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(roleCounts).sort((a, b) => b[1] - a[1]).map(([role, count]) => (
              <span
                key={role}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${ROLE_COLORS[role as SchemaPageRole] || ROLE_COLORS.generic}`}
              >
                {SCHEMA_ROLE_LABELS[role as SchemaPageRole] || role} ({count})
              </span>
            ))}
          </div>

          {/* Page Type Guide */}
          <div>
            <button
              onClick={() => setShowGuide(!showGuide)}
              className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              <HelpCircle className="w-3 h-3" />
              {showGuide ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Page Type Guide
            </button>
            {showGuide && (
              <div className="mt-2 bg-zinc-950/50 rounded-lg border border-zinc-800 overflow-hidden max-h-[320px] overflow-y-auto">
                {ROLE_OPTIONS.map(role => {
                  const info = SCHEMA_ROLE_INDEX[role];
                  return (
                    <div key={role} className="px-3 py-2 border-b border-zinc-800/50 last:border-b-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${ROLE_COLORS[role]}`}>
                          {SCHEMA_ROLE_LABELS[role]}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">{info.description}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {info.examples.map(ex => (
                          <code key={ex} className="text-[9px] text-zinc-500 bg-zinc-800/60 px-1 py-0.5 rounded font-mono">{ex}</code>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Canonical entities */}
          {plan.canonicalEntities.length > 0 && (
            <div>
              <button
                onClick={() => setShowEntities(!showEntities)}
                className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                {showEntities ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Canonical Entities ({plan.canonicalEntities.length})
              </button>
              {showEntities && (
                <div className="mt-2 space-y-1.5">
                  {plan.canonicalEntities.map((entity, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 bg-zinc-800/50 rounded-lg border border-zinc-800">
                      <span className="px-1.5 py-0.5 bg-teal-500/15 text-teal-300 rounded text-[10px] font-mono">{entity.type}</span>
                      <span className="text-xs text-zinc-300 font-medium">{entity.name}</span>
                      <span className="text-[10px] text-zinc-500 font-mono truncate">{entity.id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Page roles table */}
          <div className="space-y-1">
            <div className="text-[11px] text-zinc-500 font-medium px-1">Page Roles</div>
            <div className="bg-zinc-950/50 rounded-lg border border-zinc-800 overflow-hidden max-h-[400px] overflow-y-auto">
              {plan.pageRoles.map((pr) => (
                <div
                  key={pr.pagePath}
                  className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-300 truncate">{pr.pageTitle}</div>
                    <div className="text-[10px] text-zinc-500 truncate">{pr.pagePath}</div>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono shrink-0">{pr.primaryType}</span>
                  <select
                    value={pr.role}
                    onChange={e => handleRoleChange(pr.pagePath, e.target.value as SchemaPageRole)}
                    className={`px-2 py-1 rounded text-[11px] font-medium border cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500 ${ROLE_COLORS[pr.role] || ROLE_COLORS.generic} bg-transparent`}
                  >
                    {ROLE_OPTIONS.map(role => (
                      <option key={role} value={role} className="bg-zinc-900 text-zinc-300">
                        {SCHEMA_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  {pr.entityRefs.length > 0 && (
                    <span className="text-[9px] text-zinc-500" title={pr.entityRefs.join(', ')}>
                      {pr.entityRefs.length} ref{pr.entityRefs.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Metadata */}
          <div className="text-[10px] text-zinc-600 flex items-center gap-3">
            <span>Generated {new Date(plan.generatedAt).toLocaleDateString()}</span>
            {plan.updatedAt !== plan.generatedAt && (
              <span>Updated {new Date(plan.updatedAt).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
