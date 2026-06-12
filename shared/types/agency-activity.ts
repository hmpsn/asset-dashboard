/**
 * Agency-at-work feed — client-facing narrative labels and grouping.
 *
 * All client-visible activity types are mapped to narrative copy here.
 * Never use raw activity type strings in client-facing components.
 * The label map is the single source of truth for UI copy (R2-B spec §1).
 */

export interface AgencyActivityLabel {
  /** Short noun label for tag/badge display (e.g. "SEO update"). */
  tag: string;
  /** One-line narrative for feed rows (e.g. "We updated your page metadata."). */
  narrative: string;
}

/**
 * Narrative labels for every activity type surfaced to clients.
 * Keys must be a subset of the server's CLIENT_VISIBLE_TYPES.
 */
export const AGENCY_ACTIVITY_LABELS: Record<string, AgencyActivityLabel> = {
  audit_completed: {
    tag: 'Site audit',
    narrative: 'We ran a site-wide SEO health audit.',
  },
  request_resolved: {
    tag: 'Request resolved',
    narrative: 'We resolved one of your requests.',
  },
  approval_sent: {
    tag: 'Changes ready',
    narrative: 'We prepared site changes for your review.',
  },
  approval_applied: {
    tag: 'Changes live',
    narrative: 'Your approved changes have been applied.',
  },
  approval_reverted: {
    tag: 'Changes reverted',
    narrative: 'A set of changes was rolled back.',
  },
  seo_updated: {
    tag: 'SEO update',
    narrative: 'We updated page metadata on your site.',
  },
  images_optimized: {
    tag: 'Images',
    narrative: 'We optimized images to improve load speed.',
  },
  links_fixed: {
    tag: 'Links',
    narrative: 'We fixed broken links on your site.',
  },
  content_updated: {
    tag: 'Content update',
    narrative: 'Content on your site was updated.',
  },
  content_requested: {
    tag: 'Content requested',
    narrative: 'A new content piece was requested.',
  },
  content_declined: {
    tag: 'Content declined',
    narrative: 'A content request was declined.',
  },
  content_request_commented: {
    tag: 'Content note',
    narrative: 'A note was added to a content request.',
  },
  brief_generated: {
    tag: 'Brief ready',
    narrative: 'We generated a content brief for your review.',
  },
  brief_approved: {
    tag: 'Brief approved',
    narrative: 'A content brief was approved.',
  },
  changes_requested: {
    tag: 'Changes requested',
    narrative: 'Revisions were requested on a deliverable.',
  },
  briefing_published: {
    tag: 'Briefing published',
    narrative: 'Your weekly insights briefing is ready.',
  },
  briefing_auto_published: {
    tag: 'Briefing published',
    narrative: 'Your weekly insights briefing is ready.',
  },
  content_upgraded: {
    tag: 'Content upgraded',
    narrative: 'A content piece was upgraded and improved.',
  },
  fix_completed: {
    tag: 'Fix complete',
    narrative: 'A site fix was completed.',
  },
  work_order_commented: {
    tag: 'Work order note',
    narrative: 'A note was added to an active work order.',
  },
  order_closed: {
    tag: 'Order closed',
    narrative: 'A work order was closed out.',
  },
  content_published: {
    tag: 'Content live',
    narrative: 'A content piece was published to your site.',
  },
  copy_sent_to_client: {
    tag: 'Copy ready',
    narrative: 'Copy is ready for your review.',
  },
  post_approved: {
    tag: 'Post approved',
    narrative: 'A content post was approved.',
  },
  post_changes_requested: {
    tag: 'Revisions requested',
    narrative: 'Revisions were requested on a content post.',
  },
  post_client_edit: {
    tag: 'Post edited',
    narrative: 'A content post was edited.',
  },
  brief_sent_for_review: {
    tag: 'Brief sent',
    narrative: 'A content brief was sent for your review.',
  },
  post_sent_for_review: {
    tag: 'Post sent',
    narrative: 'A content post was sent for your review.',
  },
  client_action_sent: {
    tag: 'Action sent',
    narrative: 'We sent a recommended action for your review.',
  },
  client_action_approved: {
    tag: 'Action approved',
    narrative: 'You approved a recommended action.',
  },
  client_action_changes_requested: {
    tag: 'Revisions requested',
    narrative: 'Revisions were requested on a recommended action.',
  },
  client_action_completed: {
    tag: 'Action done',
    narrative: 'A recommended action was completed.',
  },
  deliverable_sent: {
    tag: 'Deliverable sent',
    narrative: 'We sent a deliverable for your review.',
  },
  deliverable_responded: {
    tag: 'Deliverable responded',
    narrative: 'You responded to a deliverable.',
  },
} as const;

/**
 * Get narrative label for an activity type. Falls back to a generic label
 * so new types never cause UI breakage.
 */
export function getAgencyActivityLabel(type: string): AgencyActivityLabel {
  return AGENCY_ACTIVITY_LABELS[type] ?? { tag: 'Update', narrative: 'Work was completed on your site.' };
}
