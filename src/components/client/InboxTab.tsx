import { useSearchParams } from 'react-router-dom';
import type { Tier } from '../ui';
import type {
  ClientContentRequest,
  ClientRequest,
} from './types';
import { UnifiedInbox } from './inbox/UnifiedInbox';
import { resolveInboxFilter } from './inbox/inbox-filter';
import type { PricingModalData } from '../../hooks/usePayments';

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
  briefPrice?: number | null;
  fullPostPrice?: number | null;
  fmtPrice?: (n: number) => string;
  setPricingModal?: (modal: PricingModalData | null) => void;
  pricingConfirming?: boolean;
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
  hidePrices,
}: InboxTabProps) {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialFilter = requestedTab !== null || seededFilter
    ? resolveInboxFilter(requestedTab, seededFilter ?? 'all')
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
