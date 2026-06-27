import {
  Trash2, AlertTriangle, PenLine, Clipboard, Search, X, ArrowUpDown,
} from 'lucide-react';
import { Badge, Icon, IconButton, ClickableRow, FormInput, FormSelect, Button, Modal, PageHeader, LoadingState, ErrorState, StatusBadge } from './ui';
import { formatDate } from '../utils/formatDates';
import type { FixContext } from '../App';
import { PostEditor } from './PostEditor';
import { BriefGenerator } from './briefs/BriefGenerator';
import { RequestList } from './briefs/RequestList';
import { BriefList } from './briefs/BriefList';
import { useAdminBriefWorkflow, type BriefSortField } from '../hooks/admin/useAdminBriefWorkflow';

export function ContentBriefs({ workspaceId, fixContext, clearFixContext }: { workspaceId: string; fixContext?: FixContext | null; clearFixContext?: () => void }) {
  const {
    activePostId,
    briefError,
    briefSearch,
    briefSort,
    briefs,
    briefsQ,
    businessCtx,
    clientRequests,
    deleteConfirm,
    pendingDelete,
    deliveringReqId,
    deliveryNotes,
    deliveryUrl,
    editingBrief,
    error,
    expanded,
    expandedRequest,
    generationStyle,
    generating,
    generatingBriefFor,
    generatingPostFor,
    hasBlockingQueryError,
    keyword,
    loading,
    loadingBrief,
    pageType,
    posts,
    postsQ,
    refUrls,
    regeneratingBrief,
    regeneratingOutline,
    requestsQ,
    sendingToClient,
    showAdvanced,
    templateCrossref,
    closePostEditor,
    confirmDeleteBrief,
    confirmDeleteRequest,
    copyAsMarkdown,
    executeDelete,
    exportClientHTML,
    generateBrief,
    generateBriefForRequest,
    generatePost,
    getBriefById,
    regenerateBrief,
    regenerateOutline,
    saveBriefField,
    sendToClient,
    setActivePostId,
    setBriefError,
    setBriefSearch,
    setBriefSort,
    setBusinessCtx,
    setDeleteConfirm,
    setDeliveringReqId,
    setDeliveryNotes,
    setDeliveryUrl,
    setEditingBrief,
    setExpanded,
    setExpandedRequest,
    setGenerationStyle,
    setKeyword,
    setPageType,
    setRefUrls,
    setShowAdvanced,
    toggleRequestBrief,
    undoDelete,
    updateRequestStatus,
  } = useAdminBriefWorkflow({ workspaceId, fixContext, clearFixContext });

  if (loading) {
    return (
      <LoadingState message="Loading briefs, client requests, and generated posts..." size="lg" className="py-16" />
    );
  }

  if (hasBlockingQueryError) {
    return (
      <ErrorState
        title="Couldn't load content pipeline data"
        message="Briefs, requests, or post data failed to load. Try reloading this workspace."
        actions={[
          {
            label: 'Retry',
            onClick: () => {
              void briefsQ.refetch();
              void requestsQ.refetch();
              void postsQ.refetch();
            },
          },
          {
            label: 'Refresh page',
            onClick: () => window.location.reload(),
            variant: 'secondary',
          },
        ]}
        type="data"
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Delete Confirmation Modal */}
      <Modal open={Boolean(deleteConfirm)} onClose={() => setDeleteConfirm(null)} size="sm">
        <Modal.Header
          title={`Delete ${deleteConfirm?.type === 'brief' ? 'Brief' : 'Request'}?`}
          onClose={() => setDeleteConfirm(null)}
        />
        {deleteConfirm && (
          <>
            <Modal.Body>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[var(--radius-pill)] bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <Icon as={AlertTriangle} size="lg" className="text-accent-danger" />
                </div>
                <div className="min-w-0">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">You can undo this for a few seconds after deleting.</p>
                  <p className="t-caption-sm text-[var(--brand-text)]">
                    <span className="text-[var(--brand-text-bright)] font-medium">&ldquo;{deleteConfirm.label}&rdquo;</span> will be permanently removed.
                  </p>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="danger" size="sm" icon={Trash2} onClick={executeDelete}>Delete</Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {pendingDelete && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon as={AlertTriangle} size="sm" className="text-amber-400 flex-shrink-0" />
            <span className="t-caption-sm text-[var(--brand-text)] truncate">
              Deleted <span className="font-medium text-[var(--brand-text-bright)]">&ldquo;{pendingDelete.label}&rdquo;</span>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={undoDelete} className="rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">
            Undo
          </Button>
        </div>
      )}

      {/* Active Post Editor */}
      {activePostId && (
        // pr-check-disable-next-line -- Post editor shell uses the brand signature radius outside SectionCard because PostEditor owns its inner chrome.
        <div className="bg-[var(--surface-2)] border border-blue-500/20 p-4" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <PostEditor
            key={activePostId}
            workspaceId={workspaceId}
            postId={activePostId}
            onClose={() => setActivePostId(null)}
            onDelete={closePostEditor}
          />
        </div>
      )}

      <PageHeader
        title="Content Briefs"
        subtitle={`${briefs.length} total brief${briefs.length === 1 ? '' : 's'}`}
        icon={<Icon as={Clipboard} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon as={Search} size="md" className="text-[var(--brand-text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <FormInput
                type="text"
                value={briefSearch}
                onChange={setBriefSearch}
                placeholder="Search briefs..."
                className="w-48 pl-8 pr-7 t-caption-sm"
              />
              {briefSearch && (
                <IconButton
                  onClick={() => setBriefSearch('')}
                  icon={X}
                  label="Clear search"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                />
              )}
            </div>
            <div className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
              <Icon as={ArrowUpDown} size="sm" />
              <FormSelect value={briefSort} onChange={value => setBriefSort(value as BriefSortField)} options={[
                { value: 'date', label: 'Newest' },
                { value: 'keyword', label: 'Keyword A-Z' },
                { value: 'difficulty', label: 'Difficulty' },
              ]} className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded px-1.5 py-1 t-caption-sm text-[var(--brand-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 cursor-pointer" />
            </div>
          </div>
        }
      />

      {/* Generator */}
      <BriefGenerator
        workspaceId={workspaceId}
        keyword={keyword}
        businessCtx={businessCtx}
        pageType={pageType}
        generationStyle={generationStyle}
        refUrls={refUrls}
        showAdvanced={showAdvanced}
        generating={generating}
        error={error}
        templateCrossref={templateCrossref}
        onKeywordChange={setKeyword}
        onBusinessCtxChange={setBusinessCtx}
        onPageTypeChange={setPageType}
        onGenerationStyleChange={setGenerationStyle}
        onRefUrlsChange={setRefUrls}
        onToggleAdvanced={() => setShowAdvanced(v => !v)}
        onGenerate={generateBrief}
      />

      {/* Client Requests */}
      <RequestList
        clientRequests={clientRequests}
        expandedRequest={expandedRequest}
        generatingBriefFor={generatingBriefFor}
        loadingBrief={loadingBrief}
        briefError={briefError}
        deliveringReqId={deliveringReqId}
        deliveryUrl={deliveryUrl}
        deliveryNotes={deliveryNotes}
        getBriefById={getBriefById}
        onToggleRequestBrief={toggleRequestBrief}
        onGenerateBriefForRequest={generateBriefForRequest}
        generationStyle={generationStyle}
        onGenerationStyleChange={setGenerationStyle}
        onUpdateRequestStatus={updateRequestStatus}
        onConfirmDeleteRequest={confirmDeleteRequest}
        onSetDeliveringReqId={setDeliveringReqId}
        onSetDeliveryUrl={setDeliveryUrl}
        onSetDeliveryNotes={setDeliveryNotes}
        onSetBriefError={setBriefError}
        onSetExpandedRequest={setExpandedRequest}
        onCopyAsMarkdown={copyAsMarkdown}
        onExportClientHTML={exportClientHTML}
        editingBrief={editingBrief}
        onSetEditingBrief={setEditingBrief}
        onSaveBriefField={saveBriefField}
        regeneratingBrief={regeneratingBrief}
        onRegenerateBrief={regenerateBrief}
        regeneratingOutline={regeneratingOutline}
        onRegenerateOutline={regenerateOutline}
        sendingToClient={sendingToClient}
        posts={posts}
        generatingPostFor={generatingPostFor}
        onGeneratePost={generatePost}
        onOpenPost={setActivePostId}
      />

      {/* Generated Posts list */}
      {posts.length > 0 && !activePostId && (
        // pr-check-disable-next-line -- Generated-post list is a compact non-SectionCard shell around selectable rows.
        <div className="bg-[var(--surface-2)] border border-blue-500/20 p-4 space-y-3" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Icon as={PenLine} size="md" className="text-accent-info" />
            <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">Generated Posts</span>
            <Badge label={`${posts.length}`} tone="blue" variant="outline" />
          </div>
          <div className="space-y-2">
            {posts.map(post => {
              return (
                <ClickableRow
                  key={post.id}
                  onClick={() => setActivePostId(post.id)}
                  className="w-full text-left rounded-[var(--radius-lg)] bg-[var(--surface-1)] border border-[var(--brand-border)] px-3 py-2.5 hover:border-blue-500/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="t-caption-sm font-medium text-[var(--brand-text-bright)] truncate">{post.title}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">"{post.targetKeyword}" · {post.totalWordCount.toLocaleString()} words</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={post.status} domain="content" fallback="neutral" variant="outline" />
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">{formatDate(post.createdAt)}</span>
                    </div>
                  </div>
                </ClickableRow>
              );
            })}
          </div>
        </div>
      )}

      {/* Briefs list (standalone — not linked to a request) */}
      <BriefList
        briefs={briefs}
        clientRequests={clientRequests as any}
        expanded={expanded}
        briefSearch={briefSearch}
        briefSort={briefSort}
        editingBrief={editingBrief}
        generatingPostFor={generatingPostFor}
        regeneratingBrief={regeneratingBrief}
        sendingToClient={sendingToClient}
        onSetExpanded={setExpanded}
        onSetBriefSearch={setBriefSearch}
        onSetBriefSort={setBriefSort}
        onSetEditingBrief={setEditingBrief}
        onSaveBriefField={saveBriefField}
        onGeneratePost={generatePost}
        onRegenerateBrief={regenerateBrief}
        onCopyAsMarkdown={copyAsMarkdown}
        onExportClientHTML={exportClientHTML}
        onSendToClient={sendToClient}
        onConfirmDeleteBrief={confirmDeleteBrief}
        onRegenerateOutline={regenerateOutline}
        regeneratingOutline={regeneratingOutline}
      />
    </div>
  );
}
