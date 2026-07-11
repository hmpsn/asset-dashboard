// @ds-rebuilt
import { useNavigate } from 'react-router-dom';
import { adminPath } from '../../routes';
import { useRebuiltFocusMode } from '../layout/RebuiltAppChrome';
import { useToast } from '../Toast';
import { Button, Icon, InlineBanner } from '../ui';
import { PageRewriterChatPane } from './PageRewriterChatPane';
import { PageRewriterDocumentPane } from './PageRewriterDocumentPane';
import { PageRewriterPagePicker } from './PageRewriterPagePicker';
import { usePageRewriterSurfaceState } from './usePageRewriterSurfaceState';

interface PageRewriterSurfaceProps {
  workspaceId: string;
}

const WORKSPACE_GRID_CLASS = 'grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(330px,44%)_minmax(0,1fr)] lg:overflow-hidden';

export function PageRewriterSurface({ workspaceId }: PageRewriterSurfaceProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { focusMode, setFocusMode } = useRebuiltFocusMode();
  const state = usePageRewriterSurfaceState({ workspaceId, toast });

  return (
    <div
      data-testid="page-rewriter-workspace"
      className="mx-auto flex min-h-full w-full max-w-[var(--page-max)] flex-col gap-3 lg:h-[calc(100dvh_-_var(--shell-topbar)_-_var(--page-pad-y)_-_var(--page-pad-bottom))] lg:min-h-0"
    >
      <div data-testid="page-rewriter-context-row" className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex min-w-0 items-center gap-2 t-micro font-semibold uppercase text-[var(--purple)]">
          <span className="h-2 w-2 flex-none rounded-[var(--radius-pill)] bg-[var(--purple)]" aria-hidden="true" />
          <span className="truncate">Page rewriter · AI rewrite workspace</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(adminPath(workspaceId, 'seo-audit'))}
        >
          <Icon name="arrowLeft" size="sm" />
          Back to audit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
          aria-pressed={focusMode}
          title={focusMode ? 'Exit focus mode (Esc)' : 'Enter focus mode'}
          onClick={() => setFocusMode(!focusMode)}
        >
          <Icon name={focusMode ? 'eyeOff' : 'eye'} size="sm" />
          {focusMode ? 'Exit focus' : 'Focus'}
        </Button>
      </div>

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
