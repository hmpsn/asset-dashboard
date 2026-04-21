/**
 * ServiceInterestCTA — rendered below AI chat responses when intent is detected.
 *
 * content_interest: calls onAction immediately (parent handles strategy tab navigation)
 * service_interest: fires a signal mutation via useCreateClientSignal, then shows confirmation.
 *   If bookingUrl is set, also opens the booking link in a new tab on click.
 *
 * Contract: tests/integration/client-cta-contracts.test.ts (21 tests) is the
 * executable spec for server-side behavior this component depends on.
 *
 * Color rule: teal for actions (Three Laws of Color). Never purple.
 */
import { ArrowRight, CheckCircle, Loader2, Clock, RefreshCw, CalendarDays } from 'lucide-react';
import { useCreateClientSignal } from '../../hooks/admin/useClientSignals';
import { ApiError } from '../../api/client';

interface ServiceInterestCTAProps {
  type: 'content_interest' | 'service_interest';
  workspaceId: string | undefined;
  /** Called after user acts on the CTA (content_interest: navigation; service_interest: post-confirm callback) */
  onAction: (type: 'content_interest' | 'service_interest') => void;
  /** If set, the service_interest CTA links directly here (opens in new tab) and still fires the signal. */
  bookingUrl?: string | null;
}

export function ServiceInterestCTA({ type, workspaceId, onAction, bookingUrl }: ServiceInterestCTAProps) {
  const mutation = useCreateClientSignal(workspaceId);

  const isRateLimited =
    mutation.isError &&
    mutation.error instanceof ApiError &&
    mutation.error.status === 429;

  const hasBooking = type === 'service_interest' && !!bookingUrl;

  const label =
    type === 'content_interest'
      ? 'Explore content recommendations'
      : hasBooking ? 'Book a call' : 'Get in touch';

  const subtext =
    type === 'content_interest'
      ? 'See what content we recommend for your site.'
      : hasBooking
        ? 'Schedule time with us to map out a plan.'
        : "We'll reach out to discuss how we can help.";

  const handleClick = () => {
    if (type === 'content_interest') {
      // Navigate immediately — no signal POST for content_interest via CTA
      onAction(type);
      return;
    }
    // service_interest: open booking link if available, then fire signal
    if (hasBooking) {
      window.open(bookingUrl!, '_blank', 'noopener,noreferrer');
    }
    // button disables immediately on mutate() call (dedup is component's job)
    mutation.mutate(
      { type: 'service_interest', triggerMessage: 'CTA click', chatContext: [] },
      { onSuccess: () => onAction(type) },
    );
  };

  // Confirmed — permanent state, mutation.reset() is never called here
  if (mutation.isSuccess) {
    return (
      <div className="mt-3 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-teal-500/10 border border-teal-500/20">
        <CheckCircle className="w-4 h-4 text-teal-400 flex-shrink-0" />
        <span className="text-xs text-teal-300">
          {hasBooking ? "Booked! We'll see you soon." : "Got it — we'll be in touch soon."}
        </span>
      </div>
    );
  }

  // Rate limited — show retry button so user can actually try again
  if (isRateLimited) {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-xs text-amber-300">Please try again in a moment.</span>
        </div>
        <button
          onClick={() => mutation.reset()}
          className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
          aria-label="Retry"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  // Network/server error — retry button resets mutation to idle
  if (mutation.isError) {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
        <span className="text-xs text-zinc-400">Something went wrong.</span>
        <button
          onClick={() => mutation.reset()}
          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-300 transition-colors"
          aria-label="Try again"
        >
          <RefreshCw className="w-3 h-3" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        onClick={handleClick}
        disabled={mutation.isPending}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-teal-600/10 hover:bg-teal-600/20 border border-teal-500/20 hover:border-teal-500/40 transition-all disabled:opacity-60 group"
        aria-label={label}
      >
        <div className="text-left">
          <div className="text-xs font-medium text-teal-300">{label}</div>
          <div className="text-[10px] text-teal-400/60 mt-0.5">{subtext}</div>
        </div>
        {mutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 text-teal-400 animate-spin flex-shrink-0" />
        ) : hasBooking ? (
          <CalendarDays className="w-3.5 h-3.5 text-teal-400 flex-shrink-0 group-hover:scale-110 transition-transform" />
        ) : (
          <ArrowRight className="w-3.5 h-3.5 text-teal-400 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
        )}
      </button>
    </div>
  );
}
