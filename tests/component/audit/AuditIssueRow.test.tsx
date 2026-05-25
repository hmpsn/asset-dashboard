/**
 * Component tests for AuditIssueRow.
 * Covers rendering, severity icons/colors, AI suggestion panel,
 * flag-for-client form, action buttons, overflow menu, and status badges.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuditIssueRow } from '../../../src/components/audit/AuditIssueRow';
import type { AuditIssueRowProps } from '../../../src/components/audit/AuditIssueRow';
import type { SeoIssue, PageSeoResult } from '../../../src/components/audit/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );
}

function makePage(overrides: Partial<PageSeoResult> = {}): PageSeoResult {
  return {
    pageId: 'page-1',
    page: 'Home',
    slug: 'home',
    url: 'https://example.com/',
    score: 80,
    issues: [],
    ...overrides,
  };
}

function makeIssue(overrides: Partial<SeoIssue> = {}): SeoIssue {
  return {
    check: 'missing_h1',
    severity: 'error',
    category: 'content',
    message: 'Missing H1 tag',
    recommendation: 'Add a single H1 tag to the page.',
    ...overrides,
  };
}

function makeProps(overrides: Partial<AuditIssueRowProps> = {}): AuditIssueRowProps {
  const page = makePage();
  const issue = makeIssue();
  return {
    page,
    issue,
    idx: 0,
    workspaceId: 'ws-test',
    siteId: 'site-1',
    applyingFix: null,
    appliedFixes: new Set(),
    editedSuggestions: {},
    editingKey: null,
    createdTasks: new Set(),
    creatingTask: null,
    flaggedIssues: new Set(),
    flaggingKey: null,
    flagNote: '',
    flagSending: false,
    actionMenuKey: null,
    onAcceptSuggestion: vi.fn(),
    onSetEditingKey: vi.fn(),
    onSetEditedSuggestion: vi.fn(),
    onSetActionMenuKey: vi.fn(),
    onCreateTask: vi.fn(),
    onFlagForClient: vi.fn(),
    onSetFlaggingKey: vi.fn(),
    onSetFlagNote: vi.fn(),
    onSuppressIssue: vi.fn(),
    issueToTaskKey: (p, iss) => `${p.pageId}-${iss.check}`,
    ...overrides,
  };
}

function renderRow(overrides: Partial<AuditIssueRowProps> = {}) {
  return render(<AuditIssueRow {...makeProps(overrides)} />, { wrapper: makeWrapper() });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditIssueRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Basic render ─────────────────────────────────────────────────────────────

  it('renders without crashing', () => {
    expect(() => renderRow()).not.toThrow();
  });

  it('displays the issue message', () => {
    renderRow();
    expect(screen.getByText('Missing H1 tag')).toBeInTheDocument();
  });

  it('displays the recommendation text', () => {
    renderRow();
    expect(screen.getByText('Add a single H1 tag to the page.')).toBeInTheDocument();
  });

  it('displays the check name badge', () => {
    renderRow();
    expect(screen.getByText('missing_h1')).toBeInTheDocument();
  });

  it('displays category badge when issue has a category', () => {
    renderRow({ issue: makeIssue({ category: 'content' }) });
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('does not show category badge when issue has no category', () => {
    renderRow({ issue: makeIssue({ category: undefined }) });
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('displays the issue value when provided', () => {
    renderRow({ issue: makeIssue({ value: 'Current value: empty' }) });
    expect(screen.getByText('Current value: empty')).toBeInTheDocument();
  });

  // ── Severity icons ────────────────────────────────────────────────────────────

  it('renders an error-severity row without throwing', () => {
    expect(() => renderRow({ issue: makeIssue({ severity: 'error' }) })).not.toThrow();
  });

  it('renders a warning-severity row without throwing', () => {
    expect(() => renderRow({ issue: makeIssue({ severity: 'warning' }) })).not.toThrow();
  });

  it('renders an info-severity row without throwing', () => {
    expect(() => renderRow({ issue: makeIssue({ severity: 'info' }) })).not.toThrow();
  });

  // ── AI suggestion panel ───────────────────────────────────────────────────────

  it('shows the AI Suggestion panel when suggestedFix is present', () => {
    renderRow({ issue: makeIssue({ suggestedFix: 'Add: <h1>Welcome</h1>' }) });
    expect(screen.getByText(/AI Suggestion/i)).toBeInTheDocument();
  });

  it('does not show AI Suggestion panel when suggestedFix is absent', () => {
    renderRow({ issue: makeIssue({ suggestedFix: undefined }) });
    expect(screen.queryByText(/AI Suggestion/i)).not.toBeInTheDocument();
  });

  it('displays the suggested fix text', () => {
    renderRow({ issue: makeIssue({ suggestedFix: 'Add: <h1>Welcome</h1>' }) });
    expect(screen.getByText('Add: <h1>Welcome</h1>')).toBeInTheDocument();
  });

  it('shows "Apply Now" button when fix is not yet applied', () => {
    renderRow({ issue: makeIssue({ suggestedFix: 'Fix text' }) });
    expect(screen.getByRole('button', { name: /Apply Now/i })).toBeInTheDocument();
  });

  it('shows "Applied" badge when fix has been applied', () => {
    const issue = makeIssue({ suggestedFix: 'Fix text' });
    const page = makePage();
    renderRow({
      issue,
      page,
      appliedFixes: new Set([`${page.pageId}-${issue.check}`]),
    });
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });

  it('calls onAcceptSuggestion when Apply Now is clicked', () => {
    const onAcceptSuggestion = vi.fn();
    const issue = makeIssue({ suggestedFix: 'Fix text' });
    renderRow({ issue, onAcceptSuggestion });
    fireEvent.click(screen.getByRole('button', { name: /Apply Now/i }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith('page-1', issue);
  });

  it('shows Edit button in AI suggestion when not editing and not applied', () => {
    renderRow({ issue: makeIssue({ suggestedFix: 'Fix text' }) });
    // Edit button appears inside the suggestion panel
    expect(screen.getByTitle(/Edit before sending/i)).toBeInTheDocument();
  });

  it('calls onSetEditingKey when Edit is clicked', () => {
    const onSetEditingKey = vi.fn();
    renderRow({ issue: makeIssue({ suggestedFix: 'Fix text' }), onSetEditingKey });
    fireEvent.click(screen.getByTitle(/Edit before sending/i));
    expect(onSetEditingKey).toHaveBeenCalled();
  });

  it('shows a textarea when editingKey matches the issue fixKey', () => {
    const issue = makeIssue({ suggestedFix: 'Fix text' });
    const page = makePage();
    renderRow({
      issue,
      page,
      editingKey: `${page.pageId}-${issue.check}`,
      editedSuggestions: { [`${page.pageId}-${issue.check}`]: 'Edited text' },
    });
    expect(screen.getByDisplayValue('Edited text')).toBeInTheDocument();
  });

  // ── Flag-for-client inline form ───────────────────────────────────────────────

  it('shows flag-for-client form when flaggingKey matches taskKey', () => {
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, flaggingKey: taskKey });
    expect(screen.getByPlaceholderText(/Note for client/i)).toBeInTheDocument();
  });

  it('does not show flag form when flaggingKey does not match', () => {
    renderRow({ flaggingKey: 'other-key' });
    expect(screen.queryByPlaceholderText(/Note for client/i)).not.toBeInTheDocument();
  });

  it('calls onSetFlagNote when flag note input changes', () => {
    const onSetFlagNote = vi.fn();
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, flaggingKey: taskKey, onSetFlagNote });
    const input = screen.getByPlaceholderText(/Note for client/i);
    fireEvent.change(input, { target: { value: 'Please fix this' } });
    expect(onSetFlagNote).toHaveBeenCalledWith('Please fix this');
  });

  it('calls onFlagForClient when Send button is clicked in flag form', () => {
    const onFlagForClient = vi.fn();
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, flaggingKey: taskKey, flagNote: 'test note', onFlagForClient });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onFlagForClient).toHaveBeenCalledWith(page, issue, 'test note');
  });

  // ── Fix button navigation ─────────────────────────────────────────────────────

  it('shows Fix button when issue has a mappable check (e.g. missing_h1)', () => {
    renderRow({ issue: makeIssue({ check: 'missing_h1' }) });
    expect(screen.getByTitle(/Open SEO Editor/i)).toBeInTheDocument();
  });

  it('does not show Fix button when issue check has no mapped tab', () => {
    renderRow({ issue: makeIssue({ check: 'unknown_check_xyz' }) });
    expect(screen.queryByTitle(/Open/i)).not.toBeInTheDocument();
  });

  it('navigates to seo-editor when Fix is clicked for a title issue', () => {
    renderRow({ issue: makeIssue({ check: 'title' }) });
    fireEvent.click(screen.getByTitle(/Open SEO Editor/i));
    expect(navigateMock).toHaveBeenCalled();
  });

  it('shows Page button when workspaceId and pageId are present', () => {
    renderRow();
    expect(screen.getByTitle(/Page Intelligence/i)).toBeInTheDocument();
  });

  it('does not show Page button when workspaceId is absent', () => {
    renderRow({ workspaceId: undefined });
    expect(screen.queryByTitle(/Page Intelligence/i)).not.toBeInTheDocument();
  });

  it('navigates to page-intelligence when Page button is clicked', () => {
    renderRow();
    fireEvent.click(screen.getByTitle(/Page Intelligence/i));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('page-intelligence'),
      expect.any(Object),
    );
  });

  // ── Status badges ─────────────────────────────────────────────────────────────

  it('shows "Sent" badge when issue is flagged', () => {
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, flaggedIssues: new Set([taskKey]) });
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('shows "Added" badge when task has been created', () => {
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, createdTasks: new Set([taskKey]) });
    expect(screen.getByText('Added')).toBeInTheDocument();
  });

  // ── Overflow menu ─────────────────────────────────────────────────────────────

  it('shows overflow menu button when workspaceId is present and not both flagged+created', () => {
    renderRow();
    expect(screen.getByLabelText('More actions')).toBeInTheDocument();
  });

  it('opens overflow menu when the MoreVertical button is clicked', () => {
    const onSetActionMenuKey = vi.fn();
    renderRow({ onSetActionMenuKey });
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(onSetActionMenuKey).toHaveBeenCalled();
  });

  it('shows Suppress Issue option in open overflow menu', () => {
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, actionMenuKey: taskKey });
    expect(screen.getByText(/Suppress Issue/i)).toBeInTheDocument();
  });

  it('calls onSuppressIssue when Suppress Issue is clicked in overflow menu', () => {
    const onSuppressIssue = vi.fn();
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, actionMenuKey: taskKey, onSuppressIssue });
    fireEvent.mouseDown(screen.getByText(/Suppress Issue/i));
    expect(onSuppressIssue).toHaveBeenCalledWith(issue.check, page.slug);
  });

  it('shows "Send to Client" option in overflow menu when not yet flagged', () => {
    const issue = makeIssue();
    const page = makePage();
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, actionMenuKey: taskKey });
    expect(screen.getByText(/Send to Client/i)).toBeInTheDocument();
  });

  it('shows Suppress Pattern option when onSuppressPattern is provided and slug has prefix', () => {
    const issue = makeIssue();
    const page = makePage({ slug: 'blog/post-1' });
    const taskKey = `${page.pageId}-${issue.check}`;
    renderRow({ issue, page, actionMenuKey: taskKey, onSuppressPattern: vi.fn() });
    expect(screen.getByText(/Suppress for blog/)).toBeInTheDocument();
  });
});
