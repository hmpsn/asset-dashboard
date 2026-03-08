import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Clock, FileText, Image, Code2, ArrowRightLeft, Package } from 'lucide-react';

const fmt = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(cents / 100);

interface FixOrder {
  id: string;
  productType: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  amount: number;
  createdAt: string;
  paidAt?: string;
}

const PRODUCT_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  fix_meta:    { label: 'Metadata Optimization', icon: FileText },
  fix_meta_10: { label: 'Metadata Pack (10pg)',  icon: Package },
  fix_alt:     { label: 'Alt Text — Full Site',  icon: Image },
  fix_redirect:{ label: 'Redirect Fix',          icon: ArrowRightLeft },
  schema_page: { label: 'Schema — Per Page',     icon: Code2 },
  schema_10:   { label: 'Schema Pack (10pg)',     icon: Package },
};

const STATUS_STYLES: Record<string, { label: string; icon: typeof CheckCircle2; color: string; bg: string; border: string }> = {
  paid:     { label: 'Complete',   icon: CheckCircle2, color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  pending:  { label: 'Processing', icon: Loader2,      color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  failed:   { label: 'Failed',     icon: Clock,        color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  refunded: { label: 'Refunded',   icon: Clock,        color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20' },
};

interface OrderStatusProps {
  workspaceId: string;
}

export function OrderStatus({ workspaceId }: OrderStatusProps) {
  const [orders, setOrders] = useState<FixOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/public/fix-orders/${workspaceId}`)
      .then(r => r.json())
      .then(data => { setOrders(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [workspaceId]);

  if (loading) return null;
  if (orders.length === 0) return null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <Package className="w-4 h-4 text-teal-400" />
        <span className="text-xs font-semibold text-zinc-200">Recent Fix Orders</span>
        <span className="text-[11px] text-zinc-500 ml-auto">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-zinc-800/50">
        {orders.map(order => {
          const product = PRODUCT_LABELS[order.productType] || { label: order.productType.replace(/_/g, ' '), icon: FileText };
          const status = STATUS_STYLES[order.status] || STATUS_STYLES.pending;
          const Icon = product.icon;
          const StatusIcon = status.icon;

          return (
            <div key={order.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200">{product.label}</div>
                <div className="text-[11px] text-zinc-500">
                  {order.paidAt
                    ? new Date(order.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' · '}{fmt(order.amount)}
                </div>
              </div>
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium ${status.bg} ${status.border} border ${status.color}`}>
                <StatusIcon className={`w-3 h-3 ${order.status === 'pending' ? 'animate-spin' : ''}`} />
                {status.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
