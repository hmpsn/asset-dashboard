/**
 * SchemaPlanPanel — Admin panel for reviewing and managing the site-wide schema plan.
 * Shows page roles, canonical entities, and actions to generate/update/send to client.
 */
import { useState, useEffect } from 'react';
import {
  Loader2, Sparkles, Send, CheckCircle, AlertCircle,
  ChevronDown, ChevronRight, Globe, Zap, HelpCircle, Trash2,
} from 'lucide-react';
import { schemaPlan } from '../../api/schema';
import type { SchemaSitePlan, SchemaPageRole } from '../../../shared/types/schema-plan';
import { SCHEMA_ROLE_LABELS, SCHEMA_ROLE_INDEX, SCHEMA_ROLE_PRIMARY_TYPE, SCHEMA_ROLES_THAT_REFERENCE_CANONICAL_ENTITIES } from '../../../shared/types/schema-plan';
import { Badge, FormSelect, Icon, cn, Button, StatusBadge, type BadgeTone } from '../ui';

interface Props {
  siteId: string;
  workspaceId?: string;
}

const ROLE_OPTIONS: SchemaPageRole[] = [
  'homepage', 'pillar', 'service', 'audience', 'lead-gen', 'blog', 'about',
  'contact', 'location', 'product', 'partnership', 'faq', 'case-study',
  'comparison', 'author', 'howto', 'video', 'job-posting', 'course', 'event',
  'review', 'pricing', 'recipe', 'generic',
];

const ROLE_COLORS: Partial<Record<SchemaPageRole, string>> = {
  homepage: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pillar: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  service: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  audience: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'lead-gen': 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  blog: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  about: 'bg-[var(--brand-text-muted)]/15 text-[var(--brand-text)] border-[var(--brand-text-muted)]/30',
  contact: 'bg-[var(--brand-text-muted)]/15 text-[var(--brand-text)] border-[var(--brand-text-muted)]/30',
  location: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  product: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  partnership: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  faq: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'case-study': 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  comparison: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  author: 'bg-[var(--brand-text-muted)]/15 text-[var(--brand-text)] border-[var(--brand-text-muted)]/30',
  howto: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  video: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'job-posting': 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  course: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  event: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  review: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pricing: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  recipe: 'bg-red-500/15 text-red-300 border-red-500/30',
  generic: 'bg-[var(--brand-text-muted)]/10 text-[var(--brand-text)] border-[var(--brand-text-dim)]/30',
};
const DEFAULT_ROLE_COLOR = 'bg-[var(--brand-text-muted)]/10 text-[var(--brand-text)] border-[var(--brand-text-dim)]/30';

const ROLE_TONES: Partial<Record<SchemaPageRole, BadgeTone>> = {
  homepage: 'amber',
  pillar: 'teal',
  service: 'blue',
  audience: 'blue',
  'lead-gen': 'orange',
  blog: 'teal',
  about: 'zinc',
  contact: 'zinc',
  location: 'emerald',
  product: 'emerald',
  partnership: 'blue',
  faq: 'blue',
  'case-study': 'blue',
  comparison: 'amber',
  author: 'zinc',
  howto: 'teal',
  video: 'blue',
  'job-posting': 'blue',
  course: 'teal',
  event: 'orange',
  review: 'amber',
  pricing: 'emerald',
  recipe: 'red',
  generic: 'zinc',
};

export function SchemaPlanPanel({ siteId, workspaceId }: Props) {
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
  const [retracting, setRetracting] = useState(false);
  const [confirmRetract, setConfirmRetract] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await schemaPlan.get(siteId, workspaceId);
        if (!cancelled) setPlan(result ?? null);
      } catch { /* no plan yet */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [siteId, workspaceId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await schemaPlan.generate(siteId, workspaceId);
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
    const canonicalEntityIds = plan.canonicalEntities.map(entity => entity.id).filter(Boolean);
    const updated = plan.pageRoles.map(pr =>
      pr.pagePath === pagePath ? (() => {
        const validExistingRefs = pr.entityRefs.filter(ref => canonicalEntityIds.includes(ref));
        let entityRefs: string[] = [];
        if (newRole === 'homepage') {
          entityRefs = canonicalEntityIds;
        } else if (SCHEMA_ROLES_THAT_REFERENCE_CANONICAL_ENTITIES.has(newRole)) {
          entityRefs = validExistingRefs.length > 0 ? validExistingRefs : (canonicalEntityIds.length === 1 ? canonicalEntityIds : []);
        }
        return {
          ...pr,
          role: newRole,
          primaryType: SCHEMA_ROLE_PRIMARY_TYPE[newRole] ?? 'WebPage',
          entityRefs,
        };
      })() : pr
    );
    setPlan({ ...plan, pageRoles: updated });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const result = await schemaPlan.update(siteId, plan.pageRoles, plan.canonicalEntities, workspaceId);
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
      const { plan: updatedPlan } = await schemaPlan.sendToClient(siteId, plan.workspaceId || workspaceId);
      setPlan(updatedPlan);
      setSuccess('Schema strategy preview sent to client');
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
      const result = await schemaPlan.activate(siteId, workspaceId);
      setPlan(result);
      setSuccess('Plan activated — schema generation will now follow this plan');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate plan');
    }
    setActivating(false);
  };

  const statusBadge = (status: SchemaSitePlan['status']) => {
    return <StatusBadge status={status} domain="schema" fallback="neutral" variant="outline" shape="pill" size="sm" />;
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 t-caption text-[var(--brand-text-muted)]">
        <Icon as={Loader2} size="md" className="animate-spin" /> Loading schema plan...
      </div>
    );
  }

  // No plan yet — show generate button
  if (!plan) {
    return (
      <div className="bg-[var(--surface-2)]/50 border border-[var(--brand-border)] rounded-[var(--radius-signature)] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Icon as={Globe} size="md" className="text-teal-400" />
          <span className="text-sm font-medium text-[var(--brand-text-bright)]">Schema Site Plan</span>
        </div>
        <p className="t-caption text-[var(--brand-text-muted)]">
          Generate a site-wide schema plan that analyzes all pages and your keyword strategy to assign roles and identify canonical entities. This ensures consistent, coordinated schema across your entire site.
        </p>
        {error && (
          <div className="flex items-center gap-1.5 t-caption text-red-400/80">
            <Icon as={AlertCircle} size="sm" /> {error}
          </div>
        )}
        <Button
          onClick={handleGenerate}
          disabled={generating}
          loading={generating}
          icon={Sparkles}
          size="md"
          variant="secondary"
          className="rounded-[var(--radius-md)] bg-teal-600 hover:bg-teal-500 text-white border-0 font-medium disabled:opacity-50"
        >
          {generating ? 'Analyzing site...' : 'Generate Site Plan'}
        </Button>
      </div>
    );
  }

  // Plan exists — show review interface
  const roleCounts = plan.pageRoles.reduce((acc, pr) => {
    acc[pr.role] = (acc[pr.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-[var(--surface-2)]/50 border border-[var(--brand-border)] rounded-[var(--radius-signature)] overflow-hidden">
      {/* Header */}
      <Button
        onClick={() => setExpanded(!expanded)}
        variant="ghost"
        className="w-full h-auto rounded-none flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/30"
      >
        <div className="flex items-center gap-2">
          <Icon as={Globe} size="md" className="text-teal-400" />
          <span className="text-sm font-medium text-[var(--brand-text-bright)]">Schema Site Plan</span>
          {statusBadge(plan.status)}
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {plan.pageRoles.length} pages · {plan.canonicalEntities.length} entities
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="t-caption-sm text-amber-400/80">Unsaved changes</span>}
          {expanded ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />}
        </div>
      </Button>

      {expanded && (
        <div className="border-t border-[var(--brand-border)] px-4 py-3 space-y-4">
          {/* Status messages */}
          {error && (
            <div className="flex items-center gap-1.5 t-caption text-red-400/80 bg-red-500/8 border border-red-500/20 rounded-[var(--radius-md)] px-3 py-2">
              <Icon as={AlertCircle} size="sm" className="shrink-0" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-1.5 t-caption text-emerald-400/80 bg-emerald-500/8 border border-emerald-500/20 rounded-[var(--radius-md)] px-3 py-2">
              <Icon as={CheckCircle} size="sm" className="shrink-0" /> {success}
            </div>
          )}

          {/* Actions bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={handleGenerate}
              disabled={generating}
              loading={generating}
              icon={Sparkles}
              size="sm"
              variant="secondary"
              className="rounded-[var(--radius-md)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text)] border border-[var(--brand-border)] font-medium disabled:opacity-50"
            >
              {generating ? 'Regenerating...' : 'Regenerate'}
            </Button>
            {dirty && (
              <Button
                onClick={handleSave}
                disabled={saving}
                loading={saving}
                icon={CheckCircle}
                size="sm"
                variant="secondary"
                className="rounded-[var(--radius-md)] bg-teal-600 hover:bg-teal-500 text-white border-0 font-medium disabled:opacity-50"
              >
                Save Changes
              </Button>
            )}
            {plan.status === 'draft' && (
              <Button
                onClick={handleSendToClient}
                disabled={sending || dirty}
                title={dirty ? 'Save changes first' : 'Send strategy preview to client'}
                loading={sending}
                icon={Send}
                size="sm"
                variant="primary"
                className="rounded-[var(--radius-md)]"
              >
                Send to client
              </Button>
            )}
            {(plan.status === 'draft' || plan.status === 'client_approved') && (
              <Button
                onClick={handleActivate}
                disabled={activating || dirty}
                loading={activating}
                icon={Zap}
                size="sm"
                variant="secondary"
                className="rounded-[var(--radius-md)] bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 font-medium disabled:opacity-50"
              >
                Activate Plan
              </Button>
            )}
            {confirmRetract ? (
              <div className="flex items-center gap-2">
                <span className="t-caption-sm text-red-400/80">Delete this plan?</span>
                <Button
                  onClick={async () => {
                    setRetracting(true);
                    setError(null);
                    try {
                      await schemaPlan.retract(siteId, workspaceId);
                      setPlan(null);
                      setSuccess('Schema plan retracted');
                      setTimeout(() => setSuccess(null), 4000);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to retract plan');
                    }
                    setRetracting(false);
                    setConfirmRetract(false);
                  }}
                  disabled={retracting}
                  loading={retracting}
                  icon={Trash2}
                  size="sm"
                  variant="secondary"
                  className="px-2 py-1 rounded-[var(--radius-md)] bg-red-600 hover:bg-red-500 text-white border-0 font-medium disabled:opacity-50"
                >
                  Yes, delete
                </Button>
                <Button
                  onClick={() => setConfirmRetract(false)}
                  size="sm"
                  variant="secondary"
                  className="px-2 py-1 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)]"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => setConfirmRetract(true)}
                icon={Trash2}
                size="sm"
                variant="secondary"
                className="rounded-[var(--radius-md)] bg-red-500/8 hover:bg-red-500/15 text-red-400/80 border border-red-500/30 font-medium"
              >
                Retract Plan
              </Button>
            )}
          </div>

          {/* Role summary chips */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(roleCounts).sort((a, b) => b[1] - a[1]).map(([role, count]) => (
              <Badge
                key={role}
                label={`${SCHEMA_ROLE_LABELS[role as SchemaPageRole] || role} (${count})`}
                tone={ROLE_TONES[role as SchemaPageRole] ?? 'zinc'}
                variant="outline"
                shape="pill"
                size="sm"
              />
            ))}
          </div>

          {/* Page Type Guide */}
          <div>
            <Button
              onClick={() => setShowGuide(!showGuide)}
              icon={HelpCircle}
              size="sm"
              variant="ghost"
              className="h-auto px-0 py-0 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-transparent"
            >
              {showGuide ? <Icon as={ChevronDown} size="sm" /> : <Icon as={ChevronRight} size="sm" />}
              Page Type Guide
            </Button>
            {showGuide && (
              <div className="mt-2 bg-[var(--surface-1)]/50 rounded-[var(--radius-md)] border border-[var(--brand-border)] overflow-hidden max-h-[320px] overflow-y-auto">
                {ROLE_OPTIONS.map(role => {
                  const info = SCHEMA_ROLE_INDEX[role];
                  return (
                    <div key={role} className="px-3 py-2 border-b border-[var(--brand-border)]/50 last:border-b-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge label={SCHEMA_ROLE_LABELS[role]} tone={ROLE_TONES[role] ?? 'zinc'} variant="outline" shape="sm" size="sm" />
                      </div>
                      <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">{info.description}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {info.examples.map(ex => (
                          <code key={ex} className="t-mono text-xs text-[var(--brand-text-muted)] bg-[var(--surface-3)]/60 px-1 py-0.5 rounded">{ex}</code>
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
              <Button
                onClick={() => setShowEntities(!showEntities)}
                size="sm"
                variant="ghost"
                className="h-auto px-0 py-0 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-transparent"
              >
                {showEntities ? <Icon as={ChevronDown} size="sm" /> : <Icon as={ChevronRight} size="sm" />}
                Canonical Entities ({plan.canonicalEntities.length})
              </Button>
              {showEntities && (
                <div className="mt-2 space-y-1.5">
                  {plan.canonicalEntities.map((entity, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 bg-[var(--surface-3)]/50 rounded-[var(--radius-md)] border border-[var(--brand-border)]">
                      <Badge label={entity.type} tone="teal" variant="soft" shape="sm" size="sm" className="t-mono" />
                      <span className="t-caption text-[var(--brand-text)] font-medium">{entity.name}</span>
                      <span className="t-mono text-xs text-[var(--brand-text-muted)] truncate">{entity.id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Page roles table */}
          <div className="space-y-1">
            <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium px-1">Page Roles</div>
            <div className="bg-[var(--surface-1)]/50 rounded-[var(--radius-md)] border border-[var(--brand-border)] overflow-hidden max-h-[400px] overflow-y-auto">
              {plan.pageRoles.map((pr) => (
                <div
                  key={pr.pagePath}
                  className="flex items-center gap-3 px-3 py-2 border-b border-[var(--brand-border)]/50 last:border-b-0 hover:bg-[var(--surface-3)]/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="t-caption text-[var(--brand-text)] truncate">{pr.pageTitle}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{pr.pagePath}</div>
                  </div>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono shrink-0">{pr.primaryType}</span>
                  <FormSelect
                    value={pr.role}
                    onChange={value => handleRoleChange(pr.pagePath, value as SchemaPageRole)}
                    options={ROLE_OPTIONS.map(role => ({
                      value: role,
                      label: SCHEMA_ROLE_LABELS[role],
                    }))}
                    className={cn('px-2 py-1 rounded t-caption-sm font-medium border cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:ring-1 focus:ring-teal-500 bg-transparent', ROLE_COLORS[pr.role] ?? DEFAULT_ROLE_COLOR)}
                  />
                  {pr.entityRefs.length > 0 && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)]" title={pr.entityRefs.join(', ')}>
                      {pr.entityRefs.length} ref{pr.entityRefs.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Metadata */}
          <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-3">
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
