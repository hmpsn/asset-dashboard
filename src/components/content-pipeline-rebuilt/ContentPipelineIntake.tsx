// @ds-rebuilt
import type { ContentBrief, ContentTopicRequest, GeneratedPost } from '../../../shared/types/content';
import type { SuggestedBrief } from '../../../shared/types/intelligence';
import type { WorkOrder } from '../../../shared/types/payments';
import { ContentBriefs } from '../ContentBriefs';
import { AiSuggested } from '../pipeline/AiSuggested';
import { Badge, EmptyState, Icon, SectionCard } from '../ui';
import { formatContentDate } from './contentPipelineFormatters';

interface ContentIntakeInputs {
  briefs?: readonly ContentBrief[];
  requests?: readonly ContentTopicRequest[];
  posts?: readonly GeneratedPost[];
  suggestions?: readonly SuggestedBrief[];
  workOrders?: readonly WorkOrder[];
}

export interface ContentIntakeSnapshot {
  requests: ContentTopicRequest[];
  suggestions: SuggestedBrief[];
  workOrders: WorkOrder[];
  total: number;
  summary: string;
}

interface ContentPipelineIntakeProps {
  workspaceId: string;
  snapshot: ContentIntakeSnapshot;
  onCreateBrief: (keyword: string, pageUrl?: string, suggestedBriefId?: string) => void;
}

const TERMINAL_REQUEST_STATUSES = new Set<ContentTopicRequest['status']>([
  'brief_generated',
  'client_review',
  'approved',
  'post_review',
  'delivered',
  'published',
  'declined',
]);

export function isContentWorkOrder(order: WorkOrder): boolean {
  const product = order.productType;
  return product.startsWith('brief_') || product.startsWith('post_') || product.startsWith('content_');
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function deriveContentIntake(inputs: ContentIntakeInputs): ContentIntakeSnapshot {
  const persistedBriefIds = new Set((inputs.briefs ?? []).map((brief) => brief.id));
  const persistedPostIds = new Set((inputs.posts ?? []).map((post) => post.id));
  const requests = (inputs.requests ?? []).filter((request) => {
    if (TERMINAL_REQUEST_STATUSES.has(request.status)) return false;
    if (request.briefId && persistedBriefIds.has(request.briefId)) return false;
    if (request.postId && persistedPostIds.has(request.postId)) return false;
    return true;
  });
  const suggestions = (inputs.suggestions ?? []).filter((suggestion) => suggestion.status === 'pending');
  const workOrders = (inputs.workOrders ?? []).filter((order) =>
    isContentWorkOrder(order) && (order.status === 'pending' || order.status === 'in_progress'));
  const summaryParts = [
    requests.length > 0 ? plural(requests.length, 'request') : null,
    suggestions.length > 0 ? plural(suggestions.length, 'idea') : null,
    workOrders.length > 0 ? plural(workOrders.length, 'content order') : null,
  ].filter((part): part is string => Boolean(part));
  const total = requests.length + suggestions.length + workOrders.length;

  return {
    requests,
    suggestions,
    workOrders,
    total,
    summary: total > 0
      ? `${summaryParts.join(' · ')} waiting to start`
      : 'Nothing waiting · new requests, ideas, and content orders land here.',
  };
}

function IntakeEmptyIcon({ className }: { className?: string }) {
  return <Icon name="clipboard" className={className} />;
}

function workOrderLabel(order: WorkOrder): string {
  return order.productType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ContentPipelineIntake({ workspaceId, snapshot, onCreateBrief }: ContentPipelineIntakeProps) {
  if (snapshot.total === 0) {
    return (
      <EmptyState
        icon={IntakeEmptyIcon}
        title="Nothing waiting in intake"
        description="New content requests, supported ideas, and paid content orders will appear here before production begins."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="content-pipeline-intake">
      {snapshot.requests.length > 0 && (
        <ContentBriefs
          workspaceId={workspaceId}
          display="requests"
          requestIds={snapshot.requests.map((request) => request.id)}
          embedded
        />
      )}

      {snapshot.suggestions.length > 0 && (
        <AiSuggested workspaceId={workspaceId} onCreateBrief={onCreateBrief} />
      )}

      {snapshot.workOrders.length > 0 && (
        <SectionCard
          title="Paid content orders"
          subtitle="Paid content work waiting for production context."
          titleIcon={<Icon name="clipboard" size="sm" className="text-[var(--blue)]" />}
          iconChip
          variant="subtle"
          noPadding
        >
          <div className="divide-y divide-[var(--brand-border)]">
            {snapshot.workOrders.map((order) => (
              <div key={order.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="t-ui font-semibold text-[var(--brand-text-bright)]">
                    {order.notes || workOrderLabel(order)}
                  </div>
                  <div className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">
                    {workOrderLabel(order)} · {order.quantity} deliverable{order.quantity === 1 ? '' : 's'} · updated {formatContentDate(order.updatedAt)}
                  </div>
                </div>
                <Badge
                  label={order.status === 'in_progress' ? 'In progress' : 'Pending'}
                  tone={order.status === 'in_progress' ? 'teal' : 'amber'}
                  variant="outline"
                  size="sm"
                />
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
