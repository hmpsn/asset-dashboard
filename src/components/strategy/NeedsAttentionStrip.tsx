import { AlertTriangle, Send, RefreshCw, MessageSquare } from 'lucide-react';

import { Button, Disclosure, Icon } from '../ui';

export type AttentionKind = 'stale_sent' | 'superseded' | 'new_reply';

export interface AttentionItem {
  recId: string;
  title: string;
  kind: AttentionKind;
  detail: string;
}

interface NeedsAttentionStripProps {
  items: AttentionItem[];
  /** Jump the operator to the move review workflow. */
  onAct: (recId: string, kind: AttentionKind) => void;
  /** Opt-in compact disclosure for the Engine move-support row. */
  presentation?: 'default' | 'engine-spine';
}

const KIND_META: Record<AttentionKind, { icon: typeof Send; faIcon: 'send' | 'refresh' | 'message'; cta: string }> = {
  stale_sent: { icon: Send, faIcon: 'send', cta: 'Review' },
  superseded: { icon: RefreshCw, faIcon: 'refresh', cta: 'Review' },
  new_reply: { icon: MessageSquare, faIcon: 'message', cta: 'Review move' },
};

export function NeedsAttentionStrip({ items, onAct, presentation = 'default' }: NeedsAttentionStripProps) {
  if (items.length === 0) return null;

  if (presentation === 'engine-spine') {
    return (
      <div data-testid="needs-attention-disclosure" data-presentation="engine-spine" className="min-w-0 flex-1">
        <Disclosure
          className="border-amber-500/30 bg-amber-500/10"
          summary={(
            <span className="flex min-w-0 items-center gap-2">
              <Icon name="alert" size="sm" className="shrink-0 text-accent-warning" />
              <span className="t-caption font-semibold text-accent-warning">Needs your attention</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{items.length} moves to review</span>
            </span>
          )}
        >
          <ul className="flex flex-col gap-1.5 pt-1">
            {items.map((item) => {
              const meta = KIND_META[item.kind];
              return (
                <li
                  key={`${item.recId}-${item.kind}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-amber-500/20 bg-[var(--surface-3)] px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon name={meta.faIcon} size="sm" className="mt-0.5 shrink-0 text-[var(--brand-text-muted)]" />
                    <div className="min-w-0">
                      <p className="truncate t-caption font-medium text-[var(--brand-text-bright)]">{item.title}</p>
                      <p className="truncate t-caption-sm text-[var(--brand-text-muted)]">{item.detail}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onAct(item.recId, item.kind)}>
                    {meta.cta}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      </div>
    );
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-[var(--radius-lg)] px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon as={AlertTriangle} size="md" className="text-accent-warning flex-shrink-0" />
        <h3 className="t-caption font-semibold text-accent-warning">
          Needs your attention · {items.length}
        </h3>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map(item => {
          const meta = KIND_META[item.kind];
          return (
            <li
              key={`${item.recId}-${item.kind}`}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-amber-500/20 bg-[var(--surface-3)] px-3 py-2"
            >
              <div className="flex items-start gap-2 min-w-0">
                <Icon as={meta.icon} size="sm" className="text-[var(--brand-text-muted)] mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{item.title}</p>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{item.detail}</p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onAct(item.recId, item.kind)}>
                {meta.cta}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
