import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Clock, FileText, Image, Code2, ArrowRightLeft, Package, Wrench } from 'lucide-react';
import { getSafe } from '../../api/client';

interface WorkOrder {
  id: string;
  productType: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  pageIds: string[];
  quantity: number;
  completedAt?: string;
  createdAt: string;
}

const PRODUCT_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  fix_meta:    { label: 'Metadata Optimization', icon: FileText },
  fix_meta_10: { label: 'Metadata Pack (10pg)',  icon: Package },
  fix_alt:     { label: 'Alt Text — Full Site',  icon: Image },
  fix_redirect:{ label: 'Redirect Fix',          icon: ArrowRightLeft },
  schema_page: { label: 'Schema — Per Page',     icon: Code2 },
  schema_10:   { label: 'Schema Pack (10pg)',     icon: Package },
};

const STEPS = ['pending', 'in_progress', 'completed'] as const;
const STEP_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' };

const STATUS_BADGE: Record<string, { label: string; icon: typeof CheckCircle2; color: string; bg: string; border: string }> = {
  pending:     { label: 'Pending',     icon: Clock,        color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  in_progress: { label: 'In Progress', icon: Loader2,      color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  completed:   { label: 'Completed',   icon: CheckCircle2, color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  cancelled:   { label: 'Cancelled',   icon: Clock,        color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20' },
};

function StatusStepper({ status }: { status: string }) {
  const currentIdx = STEPS.indexOf(status as typeof STEPS[number]);
  return (
    <div className="flex items-center gap-1 mt-2">
      {STEPS.map((step, i) => {
        const isActive = i <= currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={step} className="flex items-center gap-1">
            <div className={`flex items-center gap-1 ${isCurrent ? 'opacity-100' : isActive ? 'opacity-70' : 'opacity-30'}`}>
              <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-teal-400' : 'bg-zinc-600'}`} />
              <span className={`text-[10px] ${isActive ? 'text-zinc-300' : 'text-zinc-600'}`}>{STEP_LABELS[step]}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-4 h-px ${i < currentIdx ? 'bg-teal-400' : 'bg-zinc-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface OrderStatusProps {
  workspaceId: string;
}

export function OrderStatus({ workspaceId }: OrderStatusProps) {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSafe<WorkOrder[]>(`/api/public/work-orders/${workspaceId}`, [])
      .then(data => { setOrders(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [workspaceId]);

  if (loading) return null;
  if (orders.length === 0) return null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <Wrench className="w-4 h-4 text-teal-400" />
        <span className="text-xs font-semibold text-zinc-200">Your Fix Orders</span>
        <span className="text-[11px] text-zinc-500 ml-auto">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-zinc-800/50">
        {orders.map(order => {
          const product = PRODUCT_LABELS[order.productType] || { label: order.productType.replace(/_/g, ' '), icon: FileText };
          const badge = STATUS_BADGE[order.status] || STATUS_BADGE.pending;
          const Icon = product.icon;
          const BadgeIcon = badge.icon;

          return (
            <div key={order.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200">{product.label}</div>
                  <div className="text-[11px] text-zinc-500">
                    {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {order.pageIds.length > 0 && ` · ${order.pageIds.length} page${order.pageIds.length !== 1 ? 's' : ''}`}
                    {order.completedAt && ` · Done ${new Date(order.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium ${badge.bg} ${badge.border} border ${badge.color}`}>
                  <BadgeIcon className={`w-3 h-3 ${order.status === 'in_progress' ? 'animate-spin' : ''}`} />
                  {badge.label}
                </div>
              </div>
              {order.status !== 'cancelled' && <StatusStepper status={order.status} />}
              {order.pageIds.length > 0 && order.status !== 'completed' && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {order.pageIds.slice(0, 5).map(p => (
                    <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{p}</span>
                  ))}
                  {order.pageIds.length > 5 && (
                    <span className="text-[10px] text-zinc-500">+{order.pageIds.length - 5} more</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
