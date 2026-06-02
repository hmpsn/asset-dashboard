/**
 * Component tests for the R4 in-shell projected review modal (ProjectedReviewModal, DARK behind
 * `unified-inbox`).
 *
 * Asserts:
 *  1. type='copy_section'     → mounts <ClientCopyReview> with the projected entry auto-expanded
 *                               (initialExpandedEntryId === externalRef).
 *  2. type='content_request'  → mounts <ContentTab> with the projected request auto-expanded
 *                               (initialExpandedRequestId === externalRef) AND forwards the
 *                               ContentTab pass-through props.
 *  3. Escape with focus in a contenteditable / input / textarea / select does NOT close the modal
 *     (the RichTextEditor/useAutoSave guard); Escape elsewhere DOES close.
 *
 * The two heavy bespoke surfaces are mocked to capture the props they receive — the wiring is what
 * this modal owns; the surfaces themselves are tested elsewhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks: capture the props the bespoke surfaces receive ──
const copyReviewProps = vi.fn();
vi.mock('../../src/components/client/ClientCopyReview', () => ({
  ClientCopyReview: (props: Record<string, unknown>) => {
    copyReviewProps(props);
    return <div data-testid="client-copy-review">ClientCopyReview surface</div>;
  },
}));

const contentTabProps = vi.fn();
vi.mock('../../src/components/client/ContentTab', () => ({
  ContentTab: (props: Record<string, unknown>) => {
    contentTabProps(props);
    return <div data-testid="content-tab">ContentTab surface</div>;
  },
}));

import { ProjectedReviewModal } from '../../src/components/client/inbox/ProjectedReviewModal';

// The ContentTab pass-through bag the unified inbox forwards (no workspaceId/setToast/seed).
const passThrough = {
  contentRequests: [],
  setContentRequests: vi.fn(),
  effectiveTier: 'growth' as const,
  briefPrice: null,
  fullPostPrice: null,
  fmtPrice: (n: number) => `$${n}`,
  setPricingModal: vi.fn(),
  pricingConfirming: false,
  hidePrices: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectedReviewModal', () => {
  it('copy_section → mounts ClientCopyReview with the projected entry auto-expanded', () => {
    render(
      <ProjectedReviewModal
        type="copy_section"
        externalRef="entry-42"
        workspaceId="ws-1"
        setToast={vi.fn()}
        onDismiss={vi.fn()}
        {...passThrough}
      />,
    );

    expect(screen.getByTestId('client-copy-review')).toBeInTheDocument();
    expect(screen.queryByTestId('content-tab')).not.toBeInTheDocument();
    // Auto-expand seed wired from externalRef AND the solo id (ISSUE 2c) forwarded from externalRef.
    expect(copyReviewProps).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', initialExpandedEntryId: 'entry-42', soloEntryId: 'entry-42' }),
    );
    // Modal chrome — accessible dialog with the Copy Review label.
    expect(screen.getByRole('dialog', { name: 'Copy Review' })).toBeInTheDocument();
  });

  it('content_request → mounts ContentTab with the projected request auto-expanded + pass-through props', () => {
    render(
      <ProjectedReviewModal
        type="content_request"
        externalRef="cr-7"
        workspaceId="ws-1"
        setToast={vi.fn()}
        onDismiss={vi.fn()}
        {...passThrough}
      />,
    );

    expect(screen.getByTestId('content-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('client-copy-review')).not.toBeInTheDocument();
    expect(contentTabProps).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        initialExpandedRequestId: 'cr-7',
        // ISSUE 2c — the solo id is forwarded from externalRef alongside the auto-expand seed.
        soloRequestId: 'cr-7',
        // pass-through props forwarded
        effectiveTier: 'growth',
        contentRequests: [],
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Content Review' })).toBeInTheDocument();
  });

  it('Escape with focus in an input/textarea/select/contenteditable does NOT close (autosave guard)', () => {
    const onDismiss = vi.fn();
    render(
      <ProjectedReviewModal
        type="content_request"
        externalRef="cr-7"
        workspaceId="ws-1"
        setToast={vi.fn()}
        onDismiss={onDismiss}
        {...passThrough}
      />,
    );

    // Simulate focus inside an input — a real RichTextEditor mounts a contenteditable; the guard
    // keys off the event target, so any guarded element type is sufficient to prove the guard.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();

    // contenteditable (the RichTextEditor case). jsdom does not resolve `isContentEditable` from the
    // attribute, so define the property to mirror a real browser and exercise the guard's check.
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true });
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();

    input.remove();
    editable.remove();
  });

  it('Escape outside an editable element DOES close the modal', () => {
    const onDismiss = vi.fn();
    render(
      <ProjectedReviewModal
        type="content_request"
        externalRef="cr-7"
        workspaceId="ws-1"
        setToast={vi.fn()}
        onDismiss={onDismiss}
        {...passThrough}
      />,
    );

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('backdrop click closes the modal', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <ProjectedReviewModal
        type="copy_section"
        externalRef="entry-42"
        workspaceId="ws-1"
        setToast={vi.fn()}
        onDismiss={onDismiss}
        {...passThrough}
      />,
    );

    // The backdrop is the first absolute-inset overlay inside the dialog.
    const backdrop = container.querySelector('.absolute.inset-0');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
