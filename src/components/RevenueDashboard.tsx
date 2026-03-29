import { useState, useEffect, useCallback } from 'react';
import { DollarSign, TrendingUp, TrendingDown, BarChart3, Users, Package, Trash2, AlertTriangle } from 'lucide-react';
import { get, del } from '../api/client';
import { SectionCard, EmptyState } from './ui';

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
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            {m.month}: {fmtCents(m.revenue)} ({m.count})
          </div>
          <div
            className="w-full rounded-t bg-teal-500/60 hover:bg-teal-400/70 transition-colors min-h-[2px]"
            style={{ height: `${Math.max((m.revenue / maxRevenue) * 100, 2)}%` }}
          />
          <span className="text-[9px] text-zinc-600 truncate w-full text-center">{m.month.split(' ')[0]}</span>
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
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-zinc-900 rounded-xl animate-pulse" />)}
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
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-200">Revenue Analytics</h2>
        {!confirmPurge ? (
          <button
            onClick={() => setConfirmPurge(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-400/70 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-all"
          >
            <Trash2 className="w-3 h-3" /> Purge All
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-red-400/80 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Delete all {data.totalTransactions} records?</span>
            <button onClick={handlePurgeAll} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-300 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 transition-all">Yes, purge</button>
            <button onClick={() => setConfirmPurge(false)} className="px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 transition-all">Cancel</button>
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SectionCard>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1"><DollarSign className="w-3 h-3" /> Total Revenue</div>
            <div className="text-xl font-bold text-teal-400">{fmtCents(data.totalRevenue)}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{data.totalTransactions} transactions</div>
          </div>
        </SectionCard>
        <SectionCard>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1"><BarChart3 className="w-3 h-3" /> This Month</div>
            <div className="text-xl font-bold text-zinc-200">{fmtCents(data.currentMonthRevenue)}</div>
            <div className={`flex items-center gap-0.5 text-[11px] mt-0.5 ${monthDelta >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
              {monthDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {monthDelta >= 0 ? '+' : ''}{monthDelta.toFixed(0)}% vs last month
            </div>
          </div>
        </SectionCard>
        <SectionCard>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1"><Users className="w-3 h-3" /> Active Clients</div>
            <div className="text-xl font-bold text-zinc-200">{data.byWorkspace.length}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">with paid transactions</div>
          </div>
        </SectionCard>
        <SectionCard>
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1"><Package className="w-3 h-3" /> Avg Transaction</div>
            <div className="text-xl font-bold text-zinc-200">{fmtCents(Math.round(data.totalRevenue / data.totalTransactions))}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{data.byProduct.length} product types</div>
          </div>
        </SectionCard>
      </div>

      {/* Monthly revenue chart */}
      <SectionCard>
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-zinc-200 mb-3">Monthly Revenue (Last 12 Months)</div>
          <RevenueChart months={data.months} />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Revenue by workspace */}
        <SectionCard>
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-zinc-200 mb-3">Revenue by Client</div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.byWorkspace.map(ws => (
                <div key={ws.workspaceId} className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-zinc-300">{ws.name}</div>
                    <div className="text-[11px] text-zinc-600">{ws.count} transactions</div>
                  </div>
                  <div className="text-xs font-semibold text-teal-400">{fmtCents(ws.revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Revenue by product */}
        <SectionCard>
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-zinc-200 mb-3">Revenue by Product</div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.byProduct.map(prod => (
                <div key={prod.productType} className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-zinc-300">{fmtProductType(prod.productType)}</div>
                    <div className="text-[11px] text-zinc-600">{prod.count} sold</div>
                  </div>
                  <div className="text-xs font-semibold text-teal-400">{fmtCents(prod.revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Recent transactions */}
      <SectionCard>
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-zinc-200 mb-3">Recent Transactions</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 text-left">
                  <th className="pb-2 font-medium">Client</th>
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium text-right">Date</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {data.recent.map(tx => (
                  <tr key={tx.id} className="group">
                    <td className="py-2 text-zinc-300">{tx.workspaceName}</td>
                    <td className="py-2 text-zinc-400">{fmtProductType(tx.productType)}</td>
                    <td className="py-2 text-teal-400 font-medium text-right">{fmtCents(tx.amount)}</td>
                    <td className="py-2 text-zinc-500 text-right">{new Date(tx.paidAt).toLocaleDateString()}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleDelete(tx.id)}
                        disabled={deleting === tx.id}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                        title="Delete this transaction"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
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
