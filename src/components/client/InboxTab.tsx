import { useSearchParams } from 'react-router-dom';
import type { Tier } from '../ui';
import type {
  ClientContentRequest,
  ClientRequest,
} from './types';
import { UnifiedInbox } from './inbox/UnifiedInbox';
import { useBetaMode } from './BetaContext';
import { resolveInboxFilter } from './inbox/inbox-filter';

export {
  INBOX_FILTER_VALUES,
  LEGACY_FILTER_MAP,
  isInboxFilter,
} from './inbox/inbox-filter';
export type { InboxFilter } from './inbox/inbox-filter';

interface InboxTabProps {
  workspaceId: string;
  effectiveTier: Tier;
  requests: ClientRequest[];
  requestsLoading: boolean;
  clientUser: { id: string; name: string; email: string; role: string } | null;
  loadRequests: (wsId: string) => void;
  contentRequests: ClientContentRequest[];
  setContentRequests: (val: ClientContentRequest[] | ((prev: ClientContentRequest[]) => ClientContentRequest[])) => void;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  setPricingModal: (modal: {
    serviceType: 'brief_only' | 'full_post';
    topic: string;
    targetKeyword: string;
    intent?: string;
    priority?: string;
    rationale?: string;
    notes?: string;
    source: 'strategy' | 'client' | 'upgrade';
    upgradeReqId?: string;
    pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  } | null) => void;
  pricingConfirming: boolean;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  initialFilter?: import('./inbox/inbox-filter').InboxFilter;
  hidePrices?: boolean;
}

export function InboxTab({
  workspaceId,
  effectiveTier,
  requests,
  requestsLoading,
  clientUser,
  loadRequests,
  contentRequests,
  setContentRequests,
  briefPrice,
  fullPostPrice,
  fmtPrice,
  setPricingModal,
  pricingConfirming,
  setToast,
  initialFilter: seededFilter,
  hidePrices = false,
}: InboxTabProps) {
  const [searchParams] = useSearchParams();
  const betaMode = useBetaMode();
  const requestedTab = searchParams.get('tab');
  const initialFilter = requestedTab !== null || seededFilter
    ? resolveInboxFilter(requestedTab, betaMode, seededFilter ?? 'all')
    : undefined;

  return (
    <div className="space-y-6">
      <p className="t-body text-[var(--brand-text-muted)] mt-0.5">
        Everything that needs your attention — all in one place.
      </p>
      <UnifiedInbox
        workspaceId={workspaceId}
        setToast={setToast}
        clientUser={clientUser}
        requests={requests}
        requestsLoading={requestsLoading}
        loadRequests={loadRequests}
        contentRequests={contentRequests}
        setContentRequests={setContentRequests}
        effectiveTier={effectiveTier}
        briefPrice={briefPrice}
        fullPostPrice={fullPostPrice}
        fmtPrice={fmtPrice}
        setPricingModal={setPricingModal}
        pricingConfirming={pricingConfirming}
        hidePrices={hidePrices}
        initialFilter={initialFilter}
      />
    </div>
  );
}
