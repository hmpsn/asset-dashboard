// @ds-rebuilt
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminPath } from '../../routes';
import { useToast } from '../Toast';
import { Button, Icon, InlineBanner, LensSwitcher, PageHeader, Toolbar, ToolbarSpacer } from '../ui';
import { PageRewriterChatPane } from './PageRewriterChatPane';
import { PageRewriterDocumentPane } from './PageRewriterDocumentPane';
import { PageRewriterPagePicker } from './PageRewriterPagePicker';
import { usePageRewriterSurfaceState } from './usePageRewriterSurfaceState';

interface PageRewriterSurfaceProps {
  workspaceId: string;
}

type PageRewriterView = 'split' | 'chat' | 'document';

const VIEW_OPTIONS: Array<{ value: PageRewriterView; label: string }> = [
  { value: 'split', label: 'Split' },
  { value: 'chat', label: 'Chat' },
  { value: 'document', label: 'Document' },
];

function isPageRewriterView(value: string): value is PageRewriterView {
  return VIEW_OPTIONS.some((option) => option.value === value);
}

export function PageRewriterSurface({ workspaceId }: PageRewriterSurfaceProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const state = usePageRewriterSurfaceState({ workspaceId, toast });
  const [view, setView] = useState<PageRewriterView>('split');

  const showChat = view === 'split' || view === 'chat';
  const showDocument = view === 'split' || view === 'document';
  const gridClass = view === 'split'
    ? 'grid gap-4 xl:grid-cols-[minmax(360px,44%)_minmax(0,1fr)]'
    : 'grid gap-4';

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Page Rewriter"
        subtitle="Load a live page, rewrite sections with page intelligence, and export the edited draft."
        actions={(
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(adminPath(workspaceId, 'seo-audit'))}
          >
            <Icon name="arrowLeft" size="sm" />
            Back to audit
          </Button>
        )}
      />

      <Toolbar label="Page rewriter controls" className="w-full">
        <LensSwitcher
          id="page-rewriter-view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={(value) => {
            if (isPageRewriterView(value)) setView(value);
          }}
          size="sm"
        />
        <ToolbarSpacer />
        {state.pageData?.primaryKeyword && (
          <span className="t-caption text-[var(--brand-text-muted)]">
            Primary keyword: <span className="font-semibold text-[var(--teal)]">{state.pageData.primaryKeyword}</span>
          </span>
        )}
      </Toolbar>

      <PageRewriterPagePicker
        pageData={state.pageData}
        pageUrl={state.pageUrl}
        loadingPage={state.loadingPage}
        comboOpen={state.comboOpen}
        comboQuery={state.comboQuery}
        comboIdx={state.comboIdx}
        comboQueryIsUrl={state.comboQueryIsUrl}
        filteredPages={state.filteredPages}
        sitemapPages={state.sitemapPages}
        pagesQuery={state.pagesQuery}
        comboInputRef={state.comboInputRef}
        onOpenCombo={state.openCombo}
        onComboQueryChange={state.setComboQuery}
        onComboKeyDown={state.handleComboKeyDown}
        onSelectPage={state.selectPage}
        onLoadTypedUrl={state.loadTypedUrl}
        onSetComboIdx={state.setComboIdx}
        onCloseCombo={() => state.setComboOpen(false)}
      />

      {state.invalidPageUrlParam && (
        <InlineBanner tone="warning" size="sm" title="Page link ignored">
          The pageUrl parameter must be a full http or https URL.
        </InlineBanner>
      )}

      <div className={gridClass}>
        {showChat && <PageRewriterChatPane state={state} />}
        {showDocument && <PageRewriterDocumentPane state={state} onOpenPicker={state.openCombo} />}
      </div>
    </div>
  );
}
