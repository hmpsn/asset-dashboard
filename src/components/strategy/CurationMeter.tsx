import { Sparkles } from 'lucide-react';

import { Icon } from '../ui';

interface CurationMeterProps {
  /** Recs sent to the client in the current curation cycle. */
  sentThisCycle: number;
}

/** A healthy curated set is a handful — past this the coachmark framing flips to a nudge. */
const HEALTHY_SEND_CEILING = 8;

export function CurationMeter({ sentThisCycle }: CurationMeterProps) {
  if (sentThisCycle === 0) return null;

  const overSending = sentThisCycle > HEALTHY_SEND_CEILING;
  const phrase = overSending ? 'curate, don’t just send' : 'a healthy curated set';
  const tone = overSending ? 'text-accent-warning' : 'text-teal-400';

  return (
    <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-full)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-1">
      <Icon as={Sparkles} size="sm" className={tone} />
      <span className="t-caption text-[var(--brand-text-bright)]">{sentThisCycle} sent</span>
      <span className={`t-caption-sm ${tone}`}>· {phrase}</span>
    </div>
  );
}
