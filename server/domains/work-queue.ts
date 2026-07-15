import type {
  WorkQueueClassification,
  WorkQueueDirection,
  WorkQueueItem,
  WorkQueueSourceType,
  WorkQueueStream,
} from '../../shared/types/work-queue.js';
import { WORK_QUEUE_STREAMS } from '../../shared/types/work-queue.js';

export interface WorkQueueRequestInput {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
  status?: string;
}

export interface WorkQueueWorkOrderInput {
  id: string;
  status?: string;
  productType?: string;
  quantity?: number;
  issueChecks?: string[];
}

export interface WorkQueueContentRequestInput {
  id: string;
  topic?: string;
  targetKeyword?: string;
  intent?: string;
  priority?: string;
  status?: string;
  serviceType?: string;
  source?: string;
}

export interface WorkQueueRankInput {
  keyword?: string;
  query?: string;
  term?: string;
  position?: number;
  previousPosition?: number;
  change?: number;
}

export interface WorkQueueContentPipelineInput {
  reviewCells?: number;
}

export interface WorkQueueContentDecayInput {
  critical?: number;
  warning?: number;
  totalDecaying?: number;
  avgDeclinePct?: number;
}

export interface WorkQueueAuditInput {
  errors?: number;
  warnings?: number;
  siteScore?: number;
}

export interface WorkQueueSetupInput {
  webflowSiteId?: string | null;
  gscPropertyUrl?: string | null;
  ga4PropertyId?: string | null;
  includeGaps?: boolean;
}

export interface WorkQueueChurnSignalInput {
  id: string;
  title?: string;
  description?: string;
  severity?: string;
}

export interface WorkQueueClassifierInput {
  clientId?: string;
  requests?: WorkQueueRequestInput[];
  workOrders?: WorkQueueWorkOrderInput[];
  contentRequests?: WorkQueueContentRequestInput[];
  ranks?: WorkQueueRankInput[];
  contentPipeline?: WorkQueueContentPipelineInput | null;
  contentDecay?: WorkQueueContentDecayInput | null;
  audit?: WorkQueueAuditInput | null;
  setup?: WorkQueueSetupInput | null;
  churnSignals?: WorkQueueChurnSignalInput[];
}

const emptyStreams = (): Record<WorkQueueStream, number> => ({
  opt: 0,
  send: 0,
  money: 0,
  unclassified: 0,
});

function positiveNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function addItem(
  items: WorkQueueItem[],
  input: {
    stream: WorkQueueStream;
    id: string;
    title: string;
    meta: string;
    sourceType: WorkQueueSourceType;
    impact?: string;
    direction?: WorkQueueDirection;
    clientId?: string;
  },
): void {
  items.push({
    stream: input.stream,
    id: input.id,
    title: input.title,
    meta: input.meta,
    sourceType: input.sourceType,
    ...(input.impact ? { impact: input.impact } : {}),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
  });
}

function statusIn(status: string | undefined, allowed: readonly string[]): boolean {
  return status != null && allowed.includes(status);
}

function moneyLikeContentRequest(request: WorkQueueContentRequestInput): boolean {
  if (request.status === 'pending_payment') return true;
  return request.serviceType === 'full_post' && (request.priority === 'high' || request.priority === 'urgent');
}

function requestTitle(request: WorkQueueContentRequestInput): string {
  return request.topic?.trim() || request.targetKeyword?.trim() || 'Content request';
}

function rankLabel(rank: WorkQueueRankInput, index: number): string {
  return rank.keyword?.trim() || rank.query?.trim() || rank.term?.trim() || `Tracked keyword ${index + 1}`;
}

function formatRankImpact(rank: WorkQueueRankInput): string | undefined {
  if (typeof rank.previousPosition === 'number' && typeof rank.position === 'number') {
    return `#${rank.previousPosition} -> #${rank.position}`;
  }
  if (typeof rank.change === 'number') return `${rank.change} positions`;
  return undefined;
}

export function classifyWorkQueue(input: WorkQueueClassifierInput): WorkQueueClassification {
  const items: WorkQueueItem[] = [];
  const clientId = input.clientId;

  const newRequests = (input.requests ?? []).filter((request) => request.status === 'new' || request.status === 'open');
  if (newRequests.length > 0) {
    addItem(items, {
      stream: 'unclassified',
      id: 'new-requests',
      title: `${newRequests.length} new client request${newRequests.length === 1 ? '' : 's'}`,
      meta: 'Review and route from the client inbox',
      sourceType: 'request',
      direction: 'neutral',
      clientId,
    });
  }

  const openOrders = (input.workOrders ?? []).filter((order) => statusIn(order.status, ['pending', 'in_progress', 'completed']));
  if (openOrders.length > 0) {
    const completed = openOrders.filter((order) => order.status === 'completed').length;
    const awaiting = openOrders.length - completed;
    addItem(items, {
      stream: 'opt',
      id: 'open-work-orders',
      title: awaiting > 0
        ? `${awaiting} purchased fix${awaiting === 1 ? '' : 'es'} awaiting fulfillment`
        : `${completed} completed order${completed === 1 ? '' : 's'} ready to close out`,
      meta: completed > 0 && awaiting > 0
        ? `${completed} completed and ready to close out`
        : 'Open the work-order conversation to fulfill or close out',
      sourceType: 'work_order',
      impact: 'fix',
      direction: 'neutral',
      clientId,
    });
  }

  for (const signal of input.churnSignals ?? []) {
    addItem(items, {
      stream: 'unclassified',
      id: `churn-${signal.id}`,
      title: signal.title?.trim() || 'Client risk signal',
      meta: signal.description?.trim() || 'Review client health signal',
      sourceType: 'churn_signal',
      direction: signal.severity === 'critical' ? 'negative' : 'neutral',
      clientId,
    });
  }

  const decay = input.contentDecay;
  const decayCritical = positiveNumber(decay?.critical);
  const decayWarning = positiveNumber(decay?.warning);
  if (decayCritical + decayWarning > 0) {
    const total = decayCritical + decayWarning;
    addItem(items, {
      stream: 'opt',
      id: 'content-decay',
      title: `${total} page${total === 1 ? '' : 's'} losing search traffic`,
      meta: decayCritical > 0
        ? `${decayCritical} critical · ${decayWarning} at risk`
        : `${decayWarning} pages declining in clicks`,
      sourceType: 'content_decay',
      impact: typeof decay?.avgDeclinePct === 'number' ? `${Math.round(decay.avgDeclinePct)}% avg decline` : undefined,
      direction: 'negative',
      clientId,
    });
  }

  const contentRequests = input.contentRequests ?? [];
  const pendingMoney = contentRequests.filter(moneyLikeContentRequest);
  if (pendingMoney.length > 0) {
    addItem(items, {
      stream: 'money',
      id: 'monetization-content',
      title: `${pendingMoney.length} monetization play${pendingMoney.length === 1 ? '' : 's'} to price or pitch`,
      meta: pendingMoney.slice(0, 2).map(requestTitle).join(' · '),
      sourceType: 'content_request',
      impact: 'revenue',
      direction: 'positive',
      clientId,
    });
  }

  const readyContent = contentRequests.filter((request) =>
    statusIn(request.status, ['requested', 'brief_generated', 'client_review', 'post_review']),
  );
  if (readyContent.length > 0) {
    addItem(items, {
      stream: 'send',
      id: 'pending-content',
      title: `${readyContent.length} content brief${readyContent.length === 1 ? '' : 's'} awaiting review`,
      meta: readyContent.slice(0, 2).map(requestTitle).join(' · ') || 'Approve or edit briefs',
      sourceType: 'content_request',
      direction: 'neutral',
      clientId,
    });
  }

  const auditErrors = positiveNumber(input.audit?.errors);
  if (auditErrors > 0) {
    addItem(items, {
      stream: 'opt',
      id: 'seo-errors',
      title: `${auditErrors} SEO error${auditErrors === 1 ? '' : 's'} found in audit`,
      meta: `${positiveNumber(input.audit?.warnings)} warnings · Score ${input.audit?.siteScore ?? 0}`,
      sourceType: 'audit_error',
      direction: 'negative',
      clientId,
    });
  }

  const rankDrops = (input.ranks ?? []).filter((rank) => typeof rank.change === 'number' && rank.change < 0);
  if (rankDrops.length > 3) {
    addItem(items, {
      stream: 'opt',
      id: 'rank-drops',
      title: `${rankDrops.length} keywords dropped in position`,
      meta: rankDrops.slice(0, 2).map(rankLabel).join(' · '),
      sourceType: 'rank_drop',
      impact: formatRankImpact(rankDrops[0]),
      direction: 'negative',
      clientId,
    });
  }

  const reviewCells = positiveNumber(input.contentPipeline?.reviewCells);
  if (reviewCells > 0) {
    addItem(items, {
      stream: 'send',
      id: 'pipeline-review',
      title: `${reviewCells} content plan page${reviewCells === 1 ? ' needs' : 's need'} review`,
      meta: 'Client flagged or awaiting approval',
      sourceType: 'content_pipeline',
      direction: 'neutral',
      clientId,
    });
  }

  const setup = input.setup;
  if (setup?.includeGaps) {
    if (!setup.webflowSiteId) {
      addItem(items, {
        stream: 'opt',
        id: 'setup-webflow',
        title: 'No Webflow site linked',
        meta: 'Link a site to enable SEO tools',
        sourceType: 'setup_gap',
        direction: 'neutral',
        clientId,
      });
    }
    if (!setup.gscPropertyUrl) {
      addItem(items, {
        stream: 'opt',
        id: 'setup-gsc',
        title: 'Google Search Console not connected',
        meta: 'Connect GSC for search data',
        sourceType: 'setup_gap',
        direction: 'neutral',
        clientId,
      });
    }
    if (!setup.ga4PropertyId) {
      addItem(items, {
        stream: 'opt',
        id: 'setup-ga4',
        title: 'Google Analytics not connected',
        meta: 'Connect GA4 for traffic data',
        sourceType: 'setup_gap',
        direction: 'neutral',
        clientId,
      });
    }
  }

  const streams = emptyStreams();
  for (const stream of WORK_QUEUE_STREAMS) {
    streams[stream] = items.filter((item) => item.stream === stream).length;
  }

  return { streams, items };
}
