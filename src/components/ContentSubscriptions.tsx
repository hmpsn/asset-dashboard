import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, RefreshCw, Plus, Trash2, CheckCircle2, XCircle,
  PauseCircle, AlertTriangle, FileText, Settings2,
} from 'lucide-react';
import { contentSubscriptions } from '../api/misc';
import { PageHeader, SectionCard, Badge, EmptyState, Icon } from './ui';
import type { ContentSubscription, ContentSubPlan } from '../../shared/types/content';
import { CONTENT_SUB_PLANS } from '../../shared/types/content';

interface Props {
  workspaceId: string;
}

type BadgeColor = 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'orange' | 'zinc';

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string; badgeColor: BadgeColor }> = {
  active:    { icon: CheckCircle2,  color: 'text-emerald-400', label: 'Active',    badgeColor: 'emerald' },
  pending:   { icon: Loader2,       color: 'text-amber-400',   label: 'Pending',   badgeColor: 'amber' },
  paused:    { icon: PauseCircle,   color: 'text-zinc-400',    label: 'Paused',    badgeColor: 'zinc' },
  past_due:  { icon: AlertTriangle, color: 'text-red-400',     label: 'Past Due',  badgeColor: 'red' },
  cancelled: { icon: XCircle,       color: 'text-zinc-500',    label: 'Cancelled', badgeColor: 'zinc' },
};

export function ContentSubscriptions({ workspaceId }: Props) {
  const [subs, setSubs] = useState<ContentSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPlan, setNewPlan] = useState<ContentSubPlan>('content_growth');
  const [newSource, setNewSource] = useState<'strategy_gaps' | 'manual' | 'ai_recommended'>('strategy_gaps');
  const [newNotes, setNewNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await contentSubscriptions.list(workspaceId);
      setSubs(data);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await contentSubscriptions.create(workspaceId, {
        plan: newPlan,
        topicSource: newSource,
        notes: newNotes || undefined,
      });
      setShowCreate(false);
      setNewNotes('');
      await load();
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    await contentSubscriptions.update(id, { status });
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this subscription? This cannot be undone.')) return;
    await contentSubscriptions.remove(id);
    await load();
  };

  const handleMarkDelivered = async (id: string) => {
    await contentSubscriptions.markDelivered(id);
    await load();
  };

  const activeSub = subs.find(s => s.status === 'active' || s.status === 'pending' || s.status === 'past_due');

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content Subscriptions"
        subtitle="Recurring monthly content packages"
        icon={<Icon as={RefreshCw} size="md" className="text-[var(--brand-text-muted)]" />}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-colors"
          >
            <Icon as={Plus} size="md" /> New Subscription
          </button>
        }
      />

      {loading && (
        <div className="flex items-center justify-center py-12 gap-3 text-[var(--brand-text-muted)]">
          <Icon as={Loader2} size="md" className="animate-spin" />
          <p className="text-sm">Loading subscriptions...</p>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <SectionCard>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--brand-text-bright)]">Create Content Subscription</h3>
              <button onClick={() => setShowCreate(false)} className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]">
                <Icon as={XCircle} size="md" />
              </button>
            </div>

            {/* Plan selection */}
            <div className="grid grid-cols-3 gap-3">
              {CONTENT_SUB_PLANS.map(plan => (
                <button
                  key={plan.plan}
                  onClick={() => setNewPlan(plan.plan)}
                  style={{ borderRadius: '6px 12px 6px 12px' }}
                  className={`p-4 border text-left transition-colors ${
                    newPlan === plan.plan
                      ? 'border-teal-500 bg-teal-500/10'
                      : 'border-[var(--brand-border)] bg-[var(--surface-3)]/50 hover:border-[var(--brand-border-hover)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--brand-text-bright)]">{plan.displayName}</div>
                  <div className="text-xs text-[var(--brand-text)] mt-1">{plan.description}</div>
                  <div className="text-lg font-semibold text-teal-400 mt-2">${plan.priceUsd}<span className="text-xs text-[var(--brand-text-muted)]">/mo</span></div>
                </button>
              ))}
            </div>

            {/* Topic source */}
            <div>
              <label className="text-xs text-[var(--brand-text)] block mb-1.5">Topic Source</label>
              <select
                value={newSource}
                onChange={e => setNewSource(e.target.value as typeof newSource)}
                className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-lg px-3 py-2 text-sm text-[var(--brand-text-bright)]"
              >
                <option value="strategy_gaps">Strategy Gaps (auto from keyword strategy)</option>
                <option value="ai_recommended">AI Recommended (AI picks topics)</option>
                <option value="manual">Manual (you assign topics)</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs text-[var(--brand-text)] block mb-1.5">Notes (optional)</label>
              <textarea
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                placeholder="Any preferences, instructions, or context..."
                className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-lg px-3 py-2 text-sm text-[var(--brand-text-bright)] h-20 resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
              >
                <Icon as={creating ? Loader2 : Plus} size="md" className={creating ? 'animate-spin' : ''} />
                Create Subscription
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Active subscription summary */}
      {!loading && activeSub && (
        <SectionCard>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-medium text-[var(--brand-text-bright)]">
                  {CONTENT_SUB_PLANS.find(p => p.plan === activeSub.plan)?.displayName || activeSub.plan}
                </h3>
                <Badge
                  label={STATUS_CONFIG[activeSub.status]?.label || activeSub.status}
                  color={STATUS_CONFIG[activeSub.status]?.badgeColor || 'zinc'}
                />
              </div>
              <p className="text-xs text-[var(--brand-text)]">
                ${activeSub.priceUsd}/mo · {activeSub.postsPerMonth} posts per month ·
                Topic source: {activeSub.topicSource.replace(/_/g, ' ')}
              </p>
              {activeSub.notes && (
                <p className="text-xs text-[var(--brand-text-muted)] mt-1 italic">{activeSub.notes}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeSub.status === 'active' && (
                <button
                  onClick={() => handleStatusChange(activeSub.id, 'paused')}
                  className="text-xs text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] flex items-center gap-1"
                >
                  <Icon as={PauseCircle} size="md" /> Pause
                </button>
              )}
              {activeSub.status === 'paused' && (
                <button
                  onClick={() => handleStatusChange(activeSub.id, 'active')}
                  className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1"
                >
                  <Icon as={CheckCircle2} size="md" /> Resume
                </button>
              )}
              <button
                onClick={() => handleDelete(activeSub.id)}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Icon as={Trash2} size="md" /> Delete
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-[var(--brand-text)] mb-1.5">
              <span>Posts delivered this period</span>
              <span className="font-medium text-[var(--brand-text-bright)]">
                {activeSub.postsDeliveredThisPeriod} / {activeSub.postsPerMonth}
              </span>
            </div>
            <div className="h-2 bg-[var(--surface-3)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (activeSub.postsDeliveredThisPeriod / activeSub.postsPerMonth) * 100)}%` }}
              />
            </div>
            {activeSub.currentPeriodEnd && (
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
                Period ends: {new Date(activeSub.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Quick action: mark post as delivered */}
          {activeSub.postsDeliveredThisPeriod < activeSub.postsPerMonth && (
            <button
              onClick={() => handleMarkDelivered(activeSub.id)}
              className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface-3)] hover:bg-[var(--surface-3)]/80 text-[var(--brand-text-bright)] transition-colors"
            >
              <Icon as={FileText} size="md" /> Mark Post Delivered
            </button>
          )}
        </SectionCard>
      )}

      {/* Empty state */}
      {!loading && subs.length === 0 && !showCreate && (
        <EmptyState
          icon={RefreshCw}
          title="No content subscriptions"
          description="Create a recurring content subscription to automatically generate SEO-optimized posts each month."
        />
      )}

      {/* Subscription history */}
      {!loading && subs.length > 1 && (
        <SectionCard>
          <h3 className="text-sm font-medium text-[var(--brand-text-bright)] mb-3">Subscription History</h3>
          <div className="space-y-2">
            {subs.filter(s => s.id !== activeSub?.id).map(sub => {
              const cfg = STATUS_CONFIG[sub.status];
              const SubIcon = cfg?.icon || Settings2;
              return (
                <div key={sub.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--surface-3)]/50">
                  <div className="flex items-center gap-2">
                    <Icon as={SubIcon} size="md" className={cfg?.color || 'text-[var(--brand-text-muted)]'} />
                    <span className="text-xs text-[var(--brand-text-bright)]">
                      {CONTENT_SUB_PLANS.find(p => p.plan === sub.plan)?.displayName || sub.plan}
                    </span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">
                      {sub.postsDeliveredThisPeriod} posts delivered
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </span>
                    <Badge
                      label={cfg?.label || sub.status}
                      color={cfg?.badgeColor || 'zinc'}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
