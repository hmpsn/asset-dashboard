/**
 * Client notification recipient authority.
 *
 * Most client-facing notifications still target the workspace-level client email.
 * Work-order conversation/fix emails are per-client-user because those flows belong
 * to authenticated client seats. Explicit-recipient events (welcome/password reset)
 * keep their caller-owned addresses and are documented here so future notification
 * preferences can branch from a single policy table.
 */
import { listClientUsers } from './client-users.js';
import type { EmailEventType } from './email-templates.js';
import { compactStrings, uniqStrings } from './utils/collections.js';
import { getWorkspace } from './workspaces.js';

export type ClientNotificationRecipientAuthority =
  | 'workspace_primary'
  | 'client_users'
  | 'explicit_recipient';

export interface ClientNotificationRecipientPolicy {
  authority: ClientNotificationRecipientAuthority;
  source: 'workspace.clientEmail' | 'client_users.email' | 'caller';
  note: string;
}

export type ClientNotificationEventType = Extract<
  EmailEventType,
  | 'approval_ready'
  | 'request_status'
  | 'request_response'
  | 'content_brief_ready'
  | 'content_post_ready'
  | 'content_published'
  | 'fixes_applied'
  | 'recommendations_ready'
  | 'anomaly_alert'
  | 'audit_complete'
  | 'client_briefing_ready'
  | 'work_order_comment_client'
  | 'curated_recs_sent'
  | 'trial_expiry_warning'
  | 'client_welcome'
  | 'password_reset'
>;

export const CLIENT_NOTIFICATION_RECIPIENT_POLICIES = {
  approval_ready: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Workspace-level review nudges are still shared-dashboard notifications.',
  },
  request_status: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Request status digests follow the shared workspace contact until per-user preferences exist.',
  },
  request_response: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Request replies follow the shared workspace contact until per-user preferences exist.',
  },
  content_brief_ready: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Content review sends target the primary workspace client contact.',
  },
  content_post_ready: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Content review sends target the primary workspace client contact.',
  },
  content_published: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Published-content notifications target the primary workspace client contact.',
  },
  recommendations_ready: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Audit follow-up notifications target the primary workspace client contact.',
  },
  anomaly_alert: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Critical anomaly client alerts target the primary workspace client contact.',
  },
  audit_complete: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Audit-complete summaries target the primary workspace client contact.',
  },
  client_briefing_ready: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Briefing notifications target the primary workspace client contact.',
  },
  trial_expiry_warning: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Trial lifecycle emails belong to the workspace subscription contact.',
  },
  fixes_applied: {
    authority: 'client_users',
    source: 'client_users.email',
    note: 'Work-order purchase/fix updates belong to authenticated client seats.',
  },
  work_order_comment_client: {
    authority: 'client_users',
    source: 'client_users.email',
    note: 'Work-order conversations belong to authenticated client seats.',
  },
  client_welcome: {
    authority: 'explicit_recipient',
    source: 'caller',
    note: 'The newly created client user is the only intended recipient.',
  },
  password_reset: {
    authority: 'explicit_recipient',
    source: 'caller',
    note: 'The submitted and verified client-user email is the only intended recipient.',
  },
  curated_recs_sent: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Curated recommendation sends notify the primary workspace client contact — the doorbell back to the hub.',
  },
} as const satisfies Record<ClientNotificationEventType, ClientNotificationRecipientPolicy>;

type ExplicitRecipientEventType = {
  [K in ClientNotificationEventType]:
    typeof CLIENT_NOTIFICATION_RECIPIENT_POLICIES[K]['authority'] extends 'explicit_recipient' ? K : never
}[ClientNotificationEventType];

export type ResolvableClientNotificationEventType =
  Exclude<ClientNotificationEventType, ExplicitRecipientEventType>;

export interface ClientNotificationRecipient {
  email: string;
  source: 'workspace.clientEmail' | 'client_users.email';
}

export function getClientNotificationRecipientPolicy(
  eventType: ClientNotificationEventType,
): ClientNotificationRecipientPolicy {
  return CLIENT_NOTIFICATION_RECIPIENT_POLICIES[eventType];
}

export function listClientNotificationRecipients(
  workspaceId: string,
  eventType: ResolvableClientNotificationEventType,
): ClientNotificationRecipient[] {
  const policy = CLIENT_NOTIFICATION_RECIPIENT_POLICIES[eventType];

  if (policy.authority === 'workspace_primary') {
    const workspace = getWorkspace(workspaceId);
    const email = compactStrings([workspace?.clientEmail])[0];
    return email ? [{ email, source: 'workspace.clientEmail' }] : [];
  }

  if (policy.authority === 'client_users') {
    return uniqStrings(
      compactStrings(listClientUsers(workspaceId).map(user => user.email)),
      { caseInsensitive: true },
    ).map(email => ({ email, source: 'client_users.email' }));
  }

  return [];
}
