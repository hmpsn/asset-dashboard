// @ds-rebuilt
import {
  GBP_REVIEW_RESPONSE_STATUSES,
  type GbpReviewResponseStatus,
} from '../../../shared/types/google-business-profile';
import type { BadgeTone } from '../ui';
import type { LocalPresenceDesk } from './useLocalPresenceSurfaceState';

interface ReviewStatusMeta {
  label: string;
  tone: BadgeTone;
  desk: LocalPresenceDesk;
  description: string;
}

export const REVIEW_STATUS_ORDER: GbpReviewResponseStatus[] = [
  GBP_REVIEW_RESPONSE_STATUSES.DRAFT,
  GBP_REVIEW_RESPONSE_STATUSES.AWAITING_CLIENT,
  GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED,
  GBP_REVIEW_RESPONSE_STATUSES.DECLINED,
  GBP_REVIEW_RESPONSE_STATUSES.APPROVED,
  GBP_REVIEW_RESPONSE_STATUSES.PUBLISHING,
  GBP_REVIEW_RESPONSE_STATUSES.PUBLISHED,
  GBP_REVIEW_RESPONSE_STATUSES.PUBLISH_FAILED,
  GBP_REVIEW_RESPONSE_STATUSES.CANCELLED,
];

export const REVIEW_STATUS_META: Record<GbpReviewResponseStatus, ReviewStatusMeta> = {
  draft: {
    label: 'Draft',
    tone: 'zinc',
    desk: 'on_your_desk',
    description: 'Editable before approval.',
  },
  awaiting_client: {
    label: 'With client',
    tone: 'blue',
    desk: 'with_client',
    description: 'Waiting for client approval.',
  },
  changes_requested: {
    label: 'Changes requested',
    tone: 'amber',
    desk: 'on_your_desk',
    description: 'Client asked for edits.',
  },
  declined: {
    label: 'Declined',
    tone: 'red',
    desk: 'all',
    description: 'Closed by client decision.',
  },
  approved: {
    label: 'Approved',
    tone: 'teal',
    desk: 'published',
    description: 'Approved and ready to publish.',
  },
  publishing: {
    label: 'Publishing',
    tone: 'blue',
    desk: 'published',
    description: 'Google reply job is running.',
  },
  published: {
    label: 'Published',
    tone: 'emerald',
    desk: 'published',
    description: 'Reply published to Google.',
  },
  publish_failed: {
    label: 'Publish failed',
    tone: 'red',
    desk: 'on_your_desk',
    description: 'Retry after checking the provider error.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'zinc',
    desk: 'all',
    description: 'Closed without publishing.',
  },
};

export function deskIncludesStatus(desk: LocalPresenceDesk, status: GbpReviewResponseStatus): boolean {
  if (desk === 'all') return true;
  return REVIEW_STATUS_META[status].desk === desk;
}

export function canEditReviewResponse(status: GbpReviewResponseStatus): boolean {
  return status === GBP_REVIEW_RESPONSE_STATUSES.DRAFT
    || status === GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED;
}

export function canSendReviewResponse(status: GbpReviewResponseStatus): boolean {
  return status === GBP_REVIEW_RESPONSE_STATUSES.DRAFT
    || status === GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED
    || status === GBP_REVIEW_RESPONSE_STATUSES.AWAITING_CLIENT;
}

export function canApproveAndPublishReviewResponse(status: GbpReviewResponseStatus): boolean {
  return status === GBP_REVIEW_RESPONSE_STATUSES.DRAFT
    || status === GBP_REVIEW_RESPONSE_STATUSES.AWAITING_CLIENT
    || status === GBP_REVIEW_RESPONSE_STATUSES.APPROVED;
}
