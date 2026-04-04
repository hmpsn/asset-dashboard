/**
 * AdminInbox — admin component with a Signals tab showing client interest signals.
 *
 * Color rules (Three Laws of Color):
 *   - Teal: action buttons, status badges for active signals
 *   - Blue: data counts
 *   - No purple (admin AI only, not here)
 *   - Status: amber=new, teal=reviewed, zinc=actioned
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Inbox, MessageSquare, CheckCircle } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { useClientSignals, useUpdateSignalStatus } from '../../hooks/admin/useClientSignals';
import type { ClientSignal, ClientSignalStatus } from '../../../../shared/types/client-signals';

interface AdminInboxProps {
  workspaceId: string;
}

const STATUS_LABELS: Record<ClientSignalStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  actioned: 'Actioned',
};

const STATUS_COLORS: Record<ClientSignalStatus, string> = {
  new: 'bg-amber-500/10 text-amber-400/80 border-amber-500/20',
  reviewed: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  actioned: 'bg-zinc-700/30 text-zinc-500 border-zinc-600/20',
};

const TYPE_LABELS: Record<string, string> = {
  content_interest: 'Content Interest',
  service_interest: 'Service Interest',
};

function SignalCard({ signal, workspaceId }: { signal: ClientSignal; workspaceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const updateStatus = useUpdateSignalStatus(workspaceId);

  const handleStatus = (status: ClientSignalStatus) => {
    updateStatus.mutate({ id: signal.id, status });
  };

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
        onClick={() => {
          setExpanded(p => !p);
          // Mark as reviewed on first open
          if (!expanded && signal.status === 'new') {
            handleStatus('reviewed');
          }
        }}
      >
        <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <MessageSquare className="w-3 h-3 text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium text-zinc-200">
              {TYPE_LABELS[signal.type] ?? signal.type}
            </span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_COLORS[signal.status]}`}>
              {STATUS_LABELS[signal.status]}
            </span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{signal.triggerMessage}</div>
          <div className="text-[9px] text-zinc-600 mt-0.5">
            {new Date(signal.createdAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        </div>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-1" />
          : <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-1" />
        }
      </button>

      {/* Expanded: chat context + actions */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-900/50 space-y-3">
          {/* Chat context */}
          {signal.chatContext.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
                Conversation context
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {signal.chatContext.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-[10px] ${
                      msg.role === 'user'
                        ? 'bg-teal-600/15 border border-teal-500/20 text-zinc-200'
                        : 'bg-zinc-800/60 border border-zinc-700/50 text-zinc-300'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-zinc-600">No conversation context available.</div>
          )}

          {/* Status actions */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-zinc-500">Mark as:</span>
            {(['reviewed', 'actioned'] as ClientSignalStatus[]).map(s => (
              <button
                key={s}
                onClick={() => handleStatus(s)}
                disabled={signal.status === s || updateStatus.isPending}
                className={`text-[10px] px-2 py-1 rounded-md border transition-colors disabled:opacity-40 ${
                  signal.status === s
                    ? STATUS_COLORS[s]
                    : 'border-zinc-700 text-zinc-400 hover:border-teal-500/40 hover:text-teal-400'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminInbox({ workspaceId }: AdminInboxProps) {
  const { data: signals, isLoading } = useClientSignals(workspaceId);
  const [activeTab, setActiveTab] = useState<'all' | 'new'>('new');

  const allSignals = signals ?? [];
  const newSignals = allSignals.filter(s => s.status === 'new');
  const displayedSignals = activeTab === 'new' ? newSignals : allSignals;

  const titleIcon = <Inbox className="w-4 h-4 text-zinc-400" />;

  const newBadge = newSignals.length > 0 ? (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/20">
      {newSignals.length} new
    </span>
  ) : undefined;

  if (isLoading) {
    return (
      <SectionCard title="Client Signals" titleIcon={titleIcon}>
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Client Signals"
      titleIcon={titleIcon}
      action={newBadge}
    >
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {(['new', 'all'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-colors ${
              activeTab === tab
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            {tab === 'new' ? `New (${newSignals.length})` : `All (${allSignals.length})`}
          </button>
        ))}
      </div>

      {/* Signal list */}
      {displayedSignals.length === 0 ? (
        <EmptyState
          icon={activeTab === 'new' ? CheckCircle : Inbox}
          title={activeTab === 'new' ? 'No new signals' : 'No signals yet'}
          description={
            activeTab === 'new'
              ? 'All client signals have been reviewed.'
              : 'Client interest signals will appear here when detected in chat.'
          }
        />
      ) : (
        <div className="space-y-2">
          {displayedSignals.map(signal => (
            <SignalCard key={signal.id} signal={signal} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
