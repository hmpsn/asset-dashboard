// @ds-rebuilt
import { useNavigate } from 'react-router-dom';
import { adminPath } from '../../routes';
import { useToast } from '../Toast';
import { Button, Icon, InlineBanner, PageHeader } from '../ui';
import { PageRewriterChatPane } from './PageRewriterChatPane';
import { PageRewriterDocumentPane } from './PageRewriterDocumentPane';
import { PageRewriterPagePicker } from './PageRewriterPagePicker';
import { usePageRewriterSurfaceState } from './usePageRewriterSurfaceState';

interface PageRewriterSurfaceProps {
  workspaceId: string;
}

const HEADER_WRAP_CLASS = 'flex-col items-start gap-3 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible [&_p]:text-clip';
const WORKSPACE_GRID_CLASS = 'grid gap-4 xl:grid-cols-[minmax(360px,44%)_minmax(0,1fr)]';

export function PageRewriterSurface({ workspaceId }: PageRewriterSurfaceProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const state = usePageRewriterSurfaceState({ workspaceId, toast });

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Page Rewriter"
        subtitle="Load a live page, rewrite sections with page intelligence, and export the edited draft."
        className={HEADER_WRAP_CLASS}
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
          The page link in this URL must be a full http or https address.
        </InlineBanner>
      )}

      <div className={WORKSPACE_GRID_CLASS}>
        <PageRewriterChatPane state={state} />
        <PageRewriterDocumentPane state={state} onOpenPicker={state.openCombo} />
      </div>
    </div>
  );
}
