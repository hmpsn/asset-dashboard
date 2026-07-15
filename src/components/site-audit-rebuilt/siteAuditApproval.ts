import { auditApprovalFieldForCheck } from '../../../shared/types/seo-audit.js';

interface SiteAuditApprovalPage {
  pageId: string;
  page: string;
  slug: string;
}

interface SiteAuditApprovalIssue {
  check: string;
  message: string;
  recommendation: string;
  value?: string;
  suggestedFix?: string;
}

interface BuildSiteAuditApprovalInput {
  siteId: string;
  page: SiteAuditApprovalPage;
  issue: SiteAuditApprovalIssue;
  editedSuggestion?: string;
  note?: string;
}

/** Build the strict `/api/approvals/:workspaceId` payload for a Site Audit review. */
export function buildSiteAuditApprovalPayload({
  siteId,
  page,
  issue,
  editedSuggestion = '',
  note = '',
}: BuildSiteAuditApprovalInput) {
  const suggestion = editedSuggestion || issue.suggestedFix || '';
  const clientNote = note.trim();

  return {
    siteId,
    name: `[Review] ${issue.message.slice(0, 60)}`,
    ...(clientNote ? { note: clientNote } : {}),
    items: [{
      pageId: page.pageId,
      pageTitle: page.page,
      pageSlug: page.slug,
      field: auditApprovalFieldForCheck(issue.check),
      currentValue: issue.value || '',
      proposedValue: suggestion || issue.recommendation || issue.message,
      reason: issue.recommendation || issue.message,
    }],
  };
}
