import { useState, useEffect, useCallback } from 'react';
import { DollarSign, BarChart3, Users, Package, Trash2, AlertTriangle } from 'lucide-react';
import { get, del } from '../api/client';
import { SectionCard, EmptyState, TrendBadge, Icon, cn, PageHeader, Button, IconButton } from './ui';

interface RevenueSummary {
  totalRevenue: number;
  totalTransactions: number;
  currentMonthRevenue: number;
  prevMonthRevenue: number;
  months: { month: string; revenue: number; count: number }[];
  byWorkspace: { workspaceId: string; name: string; revenue: number; count: number }[];
  byProduct: { productType: string; revenue: number; count: number }[];
  recent: { id: string; workspaceName: string; productType: string; amount: number; currency: string; paidAt: string }[];
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtProductType(pt: string): string {
  return pt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function RevenueChart({ months }: { months: RevenueSummary['months'] }) {
  const maxRevenue = Math.max(...months.map(m => m.revenue), 1);
  return (
    <div className="flex items-end gap-1.5 h-32">
      {months.map((m, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded px-2 py-1 t-caption-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[var(--z-sticky)]">
            {m.month}: {fmtCents(m.revenue)} ({m.count})
          </div>
          <div
            className="w-full rounded-t bg-teal-500/60 hover:bg-teal-400/70 transition-colors min-h-[2px]"
            style={{ height: `${Math.max((m.revenue / maxRevenue) * 100, 2)}%` }}
          />
          <span className="t-caption-sm text-[var(--brand-text-muted)] truncate w-full text-center">{m.month.split(' ')[0]}</span>
        </div>
      ))}
    </div>
  );
}

export function RevenueDashboard() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const refresh = useCallback(() => {
    get<RevenueSummary>('/api/revenue/summary')
      .then(setData)
      .catch((err) => { console.error('RevenueDashboard operation failed:', err); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await del(`/api/revenue/payments/${id}`);
      refresh();
    } catch (err) { console.error('RevenueDashboard operation failed:', err); }
    setDeleting(null);
  };

  const handlePurgeAll = async () => {
    try {
      await del('/api/revenue/payments');
      setConfirmPurge(false);
      refresh();
    } catch (err) { console.error('RevenueDashboard operation failed:', err); }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="h-8 w-48 bg-[var(--surface-3)] rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {/* pr-check-disable-next-line -- loading skeleton animation row; not a content card */}
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-[var(--surface-2)] rounded-[var(--radius-xl)] animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!data || data.totalTransactions === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <EmptyState icon={DollarSign} title="No Revenue Data" description="Payment data will appear here once transactions are recorded." />
      </div>
    );
  }

  const monthDelta = data.prevMonthRevenue > 0
    ? ((data.currentMonthRevenue - data.prevMonthRevenue) / data.prevMonthRevenue * 100)
    : data.currentMonthRevenue > 0 ? 100 : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <PageHeader
        title="Revenue Analytics"
        subtitle={`${data.totalTransactions} transaction${data.totalTransactions === 1 ? '' : 's'} recorded`}
        icon={<Icon as={DollarSign} size="lg" className="text-accent-brand" />}
        actions={
          !confirmPurge ? (
            <Button
              onClick={() => setConfirmPurge(true)}
              variant="secondary"
              size="sm"
              icon={Trash2}
              className="text-accent-danger hover:text-accent-danger hover:bg-red-500/10 border-red-500/20"
            >
              Purge All
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="t-caption-sm text-accent-danger flex items-center gap-1"><Icon as={AlertTriangle} size="sm" /> Delete all {data.totalTransactions} records?</span>
              <Button onClick={handlePurgeAll} variant="secondary" size="sm" className="font-semibold text-accent-danger bg-red-500/20 hover:bg-red-500/30 border-red-500/30">
                Yes, purge
              </Button>
              <Button onClick={() => setConfirmPurge(false)} variant="secondary" size="sm" className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)] border-[var(--surface-3)]">
                Cancel
              </Button>
            </div>
          )
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SectionCard noPadding>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] mb-1"><Icon as={DollarSign} size="sm" /> Total Revenue</div>
            <div className="text-xl font-bold text-accent-brand">{fmtCents(data.totalRevenue)}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{data.totalTransactions} transactions</div>
          </div>
        </SectionCard>
        <SectionCard noPadding>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] mb-1"><Icon as={BarChart3} size="sm" /> This Month</div>
            <div className="text-xl font-bold text-[var(--brand-text-bright)]">{fmtCents(data.currentMonthRevenue)}</div>
            <TrendBadge value={Math.round(monthDelta)} showSign hideOnZero={false} label="vs last month" className="mt-0.5" />
          </div>
        </SectionCard>
        <SectionCard noPadding>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] mb-1"><Icon as={Users} size="sm" /> Active Clients</div>
            <div className="text-xl font-bold text-[var(--brand-text-bright)]">{data.byWorkspace.length}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">with paid transactions</div>
          </div>
        </SectionCard>
        <SectionCard noPadding>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)] mb-1"><Icon as={Package} size="sm" /> Avg Transaction</div>
            <div className="text-xl font-bold text-[var(--brand-text-bright)]">{fmtCents(Math.round(data.totalRevenue / data.totalTransactions))}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{data.byProduct.length} product types</div>
          </div>
        </SectionCard>
      </div>

      {/* Monthly revenue chart */}
      <SectionCard noPadding>
        <div className="px-4 py-3">
          <div className="t-caption font-medium text-[var(--brand-text-bright)] mb-3">Monthly Revenue (Last 12 Months)</div>
          <RevenueChart months={data.months} />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Revenue by workspace */}
        <SectionCard noPadding>
          <div className="px-4 py-3">
            <div className="t-caption font-medium text-[var(--brand-text-bright)] mb-3">Revenue by Client</div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.byWorkspace.map(ws => (
                <div key={ws.workspaceId} className="flex items-center justify-between">
                  <div>
                    <div className="t-caption text-[var(--brand-text)]">{ws.name}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">{ws.count} transactions</div>
                  </div>
                  <div className="t-caption font-semibold text-accent-brand">{fmtCents(ws.revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Revenue by product */}
        <SectionCard noPadding>
          <div className="px-4 py-3">
            <div className="t-caption font-medium text-[var(--brand-text-bright)] mb-3">Revenue by Product</div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.byProduct.map(prod => (
                <div key={prod.productType} className="flex items-center justify-between">
                  <div>
                    <div className="t-caption text-[var(--brand-text)]">{fmtProductType(prod.productType)}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">{prod.count} sold</div>
                  </div>
                  <div className="t-caption font-semibold text-accent-brand">{fmtCents(prod.revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Recent transactions */}
      <SectionCard noPadding>
        <div className="px-4 py-3">
          <div className="t-caption font-medium text-[var(--brand-text-bright)] mb-3">Recent Transactions</div>
          <div className="overflow-x-auto">
            <table className="w-full t-caption">
              <thead>
                <tr className="text-[var(--brand-text-muted)] text-left">
                  <th className="pb-2 font-medium">Client</th>
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium text-right">Date</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody className={cn('divide-y divide-[var(--brand-border)]')}>
                {data.recent.map(tx => (
                  <tr key={tx.id} className="group">
                    <td className="py-2 text-[var(--brand-text)]">{tx.workspaceName}</td>
                    <td className="py-2 text-[var(--brand-text-muted)]">{fmtProductType(tx.productType)}</td>
                    <td className="py-2 text-accent-brand font-medium text-right">{fmtCents(tx.amount)}</td>
                    <td className="py-2 text-[var(--brand-text-muted)] text-right">{new Date(tx.paidAt).toLocaleDateString()}</td>
                    <td className="py-2 text-right">
                      <IconButton
                        icon={Trash2}
                        label="Delete this transaction"
                        title="Delete this transaction"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(tx.id)}
                        disabled={deleting === tx.id}
                        className="opacity-0 group-hover:opacity-100 text-[var(--brand-border-hover)] hover:text-accent-danger hover:bg-red-500/10 disabled:opacity-50"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
