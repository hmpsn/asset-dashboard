import { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Database, Pencil, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { SeoEditor } from './SeoEditor';
import { CmsEditor } from './CmsEditor';
import { PendingApprovals } from './PendingApprovals';
import type { FixContext } from '../App';
import { useCmsEditor, useSeoEditor } from '../hooks/admin';
import { pageEditStatesKey } from '../hooks/usePageEditStates';
import { resolveSeoEditorWriteTargets } from './editor/seoWriteTargetResolver';
import { Icon, SectionCard, Button } from './ui';
import { SEO_EDITOR_TARGET_TYPES } from '../../shared/types/seo-editor-write-target';
import type { SeoEditorTargetType } from '../../shared/types/seo-editor-write-target';

type SourceFilter = 'all' | SeoEditorTargetType;

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
}

export function SeoEditorWrapper({ siteId, workspaceId, fixContext }: Props) {
  return <UnifiedSeoEditorWrapper siteId={siteId} workspaceId={workspaceId} fixContext={fixContext} />;
}

function UnifiedSeoEditorWrapper({ siteId, workspaceId, fixContext }: Props) {
  const queryClient = useQueryClient();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const { data: pages = [] } = useSeoEditor(siteId, workspaceId);
  const { data: cmsData } = useCmsEditor(siteId, workspaceId);
  const resolvedTargets = useMemo(
    () => resolveSeoEditorWriteTargets({
      pages,
      collections: cmsData?.collections ?? [],
    }),
    [pages, cmsData?.collections],
  );

  const sourceOptions = [
    { id: 'all' as const, label: 'All', count: resolvedTargets.targets.length },
    { id: SEO_EDITOR_TARGET_TYPES.staticPage, label: 'Static', count: resolvedTargets.staticTargets.length },
    { id: SEO_EDITOR_TARGET_TYPES.cmsItem, label: 'CMS', count: resolvedTargets.cmsTargets.length },
    { id: SEO_EDITOR_TARGET_TYPES.manual, label: 'Manual', count: resolvedTargets.manualTargets.length },
  ];

  const showStatic = sourceFilter === 'all' || sourceFilter === SEO_EDITOR_TARGET_TYPES.staticPage;
  const showCms = sourceFilter === 'all' || sourceFilter === SEO_EDITOR_TARGET_TYPES.cmsItem;
  const showManual = sourceFilter === 'all' || sourceFilter === SEO_EDITOR_TARGET_TYPES.manual;
  const manualTargets = resolvedTargets.manualTargets.filter(target => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return target.title.toLowerCase().includes(query) || target.canonicalPath.toLowerCase().includes(query);
  });
  const handleUnifiedApprovalMutation = useCallback(() => {
    setApprovalRefreshKey(key => key + 1);
  }, []);
  const handleUnifiedApprovalsRetracted = useCallback(() => {
    setApprovalRefreshKey(key => key + 1);
    if (!workspaceId) return;
    queryClient.invalidateQueries({ queryKey: pageEditStatesKey(workspaceId, false) });
  }, [workspaceId, queryClient]);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {sourceOptions.map(option => (
            <Button
              key={option.id}
              onClick={() => setSourceFilter(option.id)}
              variant={sourceFilter === option.id ? 'primary' : 'secondary'}
              size="sm"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors ${
                sourceFilter === option.id
                  ? ''
                  : 'bg-[var(--surface-2)]'
              }`}
            >
              {option.id === SEO_EDITOR_TARGET_TYPES.staticPage && <Icon as={Pencil} size="sm" />}
              {option.id === SEO_EDITOR_TARGET_TYPES.cmsItem && <Icon as={Database} size="sm" />}
              {option.id === SEO_EDITOR_TARGET_TYPES.manual && <Icon as={AlertCircle} size="sm" />}
              {option.label}
              <span className={sourceFilter === option.id ? 'text-white/80' : 'text-[var(--brand-text-muted)]'}>{option.count}</span>
            </Button>
          ))}
          {resolvedTargets.collectionOptions.length > 0 && sourceFilter !== SEO_EDITOR_TARGET_TYPES.staticPage && (
            <select
              value={collectionFilter}
              onChange={event => setCollectionFilter(event.target.value)}
              className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text-bright)] focus:outline-none focus:border-[var(--brand-border-hover)]"
              aria-label="Filter CMS collection"
            >
              <option value="all">All collections</option>
              {resolvedTargets.collectionOptions.map(collection => (
                <option key={collection.collectionId} value={collection.collectionId}>
                  {collection.collectionName} ({collection.itemCount})
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="relative">
          <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search pages and CMS items..."
            className="w-full pl-9 pr-3 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
          />
        </div>
      </div>

      {workspaceId && (
        <PendingApprovals
          workspaceId={workspaceId}
          nameFilter="SEO"
          refreshKey={approvalRefreshKey}
          onRetracted={handleUnifiedApprovalsRetracted}
        />
      )}

      {showStatic && (
        <section className="space-y-3">
          {sourceFilter === 'all' && (
            <div>
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Static pages</h3>
              <p className="t-caption-sm text-[var(--brand-text-muted)]">Direct Webflow page SEO writes.</p>
            </div>
          )}
          <SeoEditor
            siteId={siteId}
            workspaceId={workspaceId}
            fixContext={fixContext}
            externalSearch={search}
            showPendingApprovals={false}
            onApprovalBatchMutated={handleUnifiedApprovalMutation}
          />
        </section>
      )}

      {showCms && (
        <section className="space-y-3">
          {sourceFilter === 'all' && (
            <div>
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">CMS collection items</h3>
              <p className="t-caption-sm text-[var(--brand-text-muted)]">Real collection item writes with publish controls.</p>
            </div>
          )}
          <CmsEditor
            siteId={siteId}
            workspaceId={workspaceId}
            collectionFilter={collectionFilter}
            externalSearch={search}
            showPendingApprovals={false}
            onApprovalBatchMutated={handleUnifiedApprovalMutation}
          />
        </section>
      )}

      {showManual && manualTargets.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Manual CMS URLs</h3>
            <p className="t-caption-sm text-[var(--brand-text-muted)]">Sitemap URLs that could not be matched to editable collection items.</p>
          </div>
          <div className="space-y-2">
            {manualTargets.map(target => (
              <SectionCard key={target.id} noPadding className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <Icon as={AlertCircle} size="md" className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--brand-text-bright)] truncate">{target.title}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] font-mono truncate">{target.canonicalPath}</div>
                    <div className="t-caption-sm text-amber-400/80 mt-1">{target.manualApplyReason}</div>
                  </div>
                </div>
              </SectionCard>
            ))}
          </div>
        </section>
      )}

      {sourceFilter === SEO_EDITOR_TARGET_TYPES.manual && manualTargets.length === 0 && (
        <SectionCard className="text-center">
          <div className="t-ui font-medium text-[var(--brand-text-bright)]">No manual CMS URLs found</div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
            Every discovered CMS URL currently maps to an editable Webflow collection item.
          </p>
        </SectionCard>
      )}
    </div>
  );
}
