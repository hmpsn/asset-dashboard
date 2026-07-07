// @ds-rebuilt
import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Lock, RefreshCw, Save, Search, Send, Sparkles, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SEO_EDITOR_TARGET_TYPES } from '../../../shared/types/seo-editor-write-target';
import { adminPath } from '../../routes';
import { resolvePagePath } from '../../lib/pathUtils';
import {
  getExtraSeoFields,
  getTitleAndDescriptionFields,
} from '../cms-editor/cmsEditorModel';
import {
  Badge,
  Button,
  CharacterCounter,
  ClickableRow,
  Drawer,
  FormInput,
  FormTextarea,
  Icon,
  InlineBanner,
  KeyValueRow,
  SerpPreview,
  SocialPreview,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import type {
  CmsSeoWorkflowState,
  SeoEditorSurfaceRow,
  StaticSeoWorkflowState,
} from './seoEditorSurfaceTypes';
import {
  fieldLengthLabel,
  formatOptionalText,
  formatRank,
  formatTargetTypeForSentence,
  formatTraffic,
} from './seoEditorSurfaceFormatters';
import { mutationErrorMessage } from './seoEditorMutationFeedback';
import { useToast } from '../Toast';

interface SeoEditorPagePanelProps {
  workspaceId: string;
  row: SeoEditorSurfaceRow | null;
  staticWorkflow: StaticSeoWorkflowState;
  cmsWorkflow: CmsSeoWorkflowState;
  onClose: () => void;
}

function VariationList({
  pageId,
  field,
  options,
  descOptions,
  onSelect,
}: {
  pageId: string;
  field: 'seoTitle' | 'seoDescription' | 'both';
  options: string[];
  descOptions?: string[];
  onSelect: (field: 'seoTitle' | 'seoDescription', value: string) => void;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
      <div className="mb-2 t-label text-[var(--brand-text-muted)]">AI variations</div>
      <div className="grid gap-2">
        {options.map((option, index) => {
          const description = descOptions?.[index] ?? '';
          return (
            <ClickableRow
              key={`${pageId}-${field}-${index}`}
              onClick={() => {
                if (field === 'both') {
                  onSelect('seoTitle', option);
                  onSelect('seoDescription', description);
                  return;
                }
                onSelect(field, option);
              }}
              className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 hover:border-[var(--teal)]"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">
                  {index + 1}. {option}
                </span>
                {field === 'both' && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{description}</span>
                )}
              </div>
            </ClickableRow>
          );
        })}
      </div>
    </div>
  );
}

function CmsVariationList({
  itemId,
  titleSlug,
  descSlug,
  fieldSlug,
  options,
  descOptions,
  cmsWorkflow,
}: {
  itemId: string;
  titleSlug?: string;
  descSlug?: string;
  fieldSlug: string;
  options: string[];
  descOptions?: string[];
  cmsWorkflow: CmsSeoWorkflowState;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
      <div className="mb-2 t-label text-[var(--brand-text-muted)]">CMS AI variations</div>
      <div className="grid gap-2">
        {options.map((option, index) => {
          const description = descOptions?.[index] ?? '';
          return (
            <ClickableRow
              key={`${itemId}-${fieldSlug}-${index}`}
              onClick={() => {
                if (fieldSlug === 'both' && titleSlug && descSlug) {
                  cmsWorkflow.applyPairedVariation(itemId, titleSlug, descSlug, option, description);
                  return;
                }
                cmsWorkflow.applySingleVariation(itemId, fieldSlug, option);
              }}
              className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 hover:border-[var(--teal)]"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">
                  {index + 1}. {option}
                </span>
                {fieldSlug === 'both' && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{description}</span>
                )}
              </div>
            </ClickableRow>
          );
        })}
      </div>
    </div>
  );
}

export function SeoEditorPagePanel({
  workspaceId,
  row,
  staticWorkflow,
  cmsWorkflow,
  onClose,
}: SeoEditorPagePanelProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pageTitleDraft, setPageTitleDraft] = useState('');
  const [cmsNote, setCmsNote] = useState('');

  useEffect(() => {
    setPageTitleDraft(row?.target.title ?? '');
    setCmsNote('');
  }, [row?.id, row?.target.title]);

  const targetType = row?.target.targetType;
  const title = row?.target.title ?? 'SEO page detail';
  const subtitle = row?.target.canonicalPath ?? '';

  // Narrowed views of the discriminated write-target union — TS loses the inline
  // `row.target.targetType === …` narrowing inside JSX callbacks, so extract const
  // locals (non-null only inside their matching targetType-guarded block below).
  const cmsTarget = row?.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem ? row.target : undefined;
  const staticTarget = row?.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage ? row.target : undefined;
  const staticVariation = staticTarget ? staticWorkflow.variations[staticTarget.pageId] : undefined;
  const cmsVariation = cmsTarget ? cmsWorkflow.variations[cmsTarget.itemId] : undefined;

  const cmsFields = useMemo(() => {
    if (!row?.cmsCollection) return { titleField: undefined, descField: undefined };
    return getTitleAndDescriptionFields(getExtraSeoFields(row.cmsCollection.seoFields));
  }, [row?.cmsCollection]);

  const footer = (
    <Toolbar label="SEO page detail actions" className="w-full border-none bg-transparent p-0">
      {targetType === SEO_EDITOR_TARGET_TYPES.staticPage && row?.staticPage && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => staticWorkflow.saveDraft(row.staticPage!.id)}
            loading={staticWorkflow.draftSaving.has(row.staticPage.id)}
            disabled={!row.edit?.dirty}
          >
            <Icon as={staticWorkflow.draftSaved.has(row.staticPage.id) ? Check : Save} size="sm" />
            {staticWorkflow.draftSaved.has(row.staticPage.id) ? 'Draft saved' : 'Save draft'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => staticWorkflow.savePage(row.staticPage!.id)}
            loading={staticWorkflow.saving.has(row.staticPage.id)}
            disabled={!row.edit?.dirty}
          >
            <Icon as={staticWorkflow.saved.has(row.staticPage.id) ? Check : Save} size="sm" />
            {staticWorkflow.saved.has(row.staticPage.id) ? 'Saved' : 'Save SEO'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => staticWorkflow.sendPageToClient(row.staticPage!.id)}
            loading={staticWorkflow.sendingPage.has(row.staticPage.id)}
            disabled={!row.edit?.dirty}
          >
            <Icon as={Send} size="sm" />
            {staticWorkflow.sentPage.has(row.staticPage.id) ? 'Sent' : 'Send to client'}
          </Button>
          {row.pageState?.status && staticWorkflow.clearPageTracking && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => staticWorkflow.clearPageTracking?.(row.staticPage!.id)}
            >
              Clear tracking
            </Button>
          )}
        </>
      )}
      {targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && row?.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && (
        <>
          <Button
            size="sm"
            variant="primary"
            onClick={() => cmsWorkflow.saveItem(cmsTarget!.collectionId, cmsTarget!.itemId)}
            loading={cmsWorkflow.saving.has(cmsTarget!.itemId)}
            disabled={!cmsWorkflow.dirty.has(cmsTarget!.itemId)}
          >
            <Icon as={cmsWorkflow.saved.has(cmsTarget!.itemId) ? Check : Save} size="sm" />
            {cmsWorkflow.saved.has(cmsTarget!.itemId) ? 'Draft saved' : 'Save CMS draft'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => cmsWorkflow.publishCollection(cmsTarget!.collectionId)}
            loading={cmsWorkflow.publishing.has(cmsTarget!.collectionId)}
            disabled={!cmsWorkflow.saved.has(cmsTarget!.itemId)}
          >
            <Icon as={cmsWorkflow.published.has(cmsTarget!.collectionId) ? Check : Upload} size="sm" />
            {cmsWorkflow.published.has(cmsTarget!.collectionId) ? 'Published' : 'Publish collection'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!cmsWorkflow.approvalSelected.has(cmsTarget!.itemId)) cmsWorkflow.toggleApprovalItem(cmsTarget!.itemId);
            }}
          >
            <Icon as={Send} size="sm" />
            {cmsWorkflow.approvalSelected.has(cmsTarget!.itemId) ? 'In approval set' : 'Add to approval set'}
          </Button>
        </>
      )}
      <ToolbarSpacer />
      <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
    </Toolbar>
  );

  if (!row) {
    return <Drawer open={false} onClose={onClose} />;
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      eyebrow={`${formatTargetTypeForSentence(row.target.targetType)} detail`}
      subtitle={subtitle}
      width="min(980px, 94vw)"
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={formatTargetTypeForSentence(row.target.targetType)} tone={row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual ? 'amber' : 'teal'} variant="outline" size="sm" />
          <StatusBadge status={row.pageState?.status} size="sm" />
          {row.dirty && <Badge label="Unsaved" tone="blue" variant="soft" size="sm" />}
          {row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual && <Badge label="Visible only" tone="amber" variant="soft" size="sm" icon={Lock} />}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <KeyValueRow label="Optimization score" value={row.metrics.optimizationScore != null ? String(row.metrics.optimizationScore) : '—'} />
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <KeyValueRow label="Rank" value={formatRank(row.metrics.rank)} />
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <KeyValueRow label="Traffic" value={formatTraffic(row.metrics.traffic)} />
          </div>
        </div>

        {row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual && (
          <InlineBanner tone="warning" title="Manual row is visible only">
            {row.target.manualApplyReason || 'This row is not backed by a writable Webflow page or CMS item, so save, publish, bulk rewrite, and client-send actions stay disabled.'}
          </InlineBanner>
        )}

        {row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage && row.staticPage && row.edit && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex flex-col gap-4">
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Page identity</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">Page title can be renamed through the same page SEO endpoint. H1 and slug are reference-only in v1.</div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pageTitleDraft.trim() === row.staticPage.title.trim()}
                    onClick={async () => {
                      try {
                        await staticWorkflow.savePageTitle(row.staticPage!.id, pageTitleDraft.trim());
                        toast('Page title saved', 'success');
                      } catch (error) {
                        toast(mutationErrorMessage(error, 'Page title save failed'), 'error');
                      }
                    }}
                  >
                    <Icon as={Save} size="sm" />
                    Save title
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">Page title</span>
                    <FormInput value={pageTitleDraft} onChange={setPageTitleDraft} className="mt-1" />
                  </label>
                  <div className="grid gap-2">
                    <KeyValueRow label="Slug" value={resolvePagePath(row.staticPage)} />
                    <KeyValueRow label="H1" value="Read-only in v1" />
                  </div>
                </div>
              </div>

              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="t-ui font-semibold text-[var(--brand-text-bright)]">SEO fields</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">OpenGraph mirrors these fields through the existing save workflow.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => staticWorkflow.analyzePage(row.staticPage!.id)} loading={staticWorkflow.analyzing.has(row.staticPage.id)}>
                      <Icon as={Search} size="sm" />
                      {staticWorkflow.analyzedPages.has(row.staticPage.id) ? 'Re-analyze' : 'Analyze'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => staticWorkflow.aiRewrite(row.staticPage!.id, 'both')} loading={staticWorkflow.aiLoading[row.staticPage.id] === 'both'}>
                      <Icon as={Sparkles} size="sm" />
                      Generate pair
                    </Button>
                  </div>
                </div>

                {staticWorkflow.errorStates[row.staticPage.id] && (
                  <InlineBanner tone="error" size="sm" title="Save failed">
                    {staticWorkflow.errorStates[row.staticPage.id].message}
                  </InlineBanner>
                )}

                <div className="grid gap-3">
                  <label className="block">
                    <span className="flex items-center justify-between gap-2 t-caption-sm text-[var(--brand-text-muted)]">
                      SEO title <CharacterCounter current={row.edit.seoTitle.length} max={60} size="sm" />
                    </span>
                    <FormInput value={row.edit.seoTitle} onChange={(value) => staticWorkflow.updateField(row.staticPage!.id, 'seoTitle', value)} className="mt-1" />
                  </label>
                  <label className="block">
                    <span className="flex items-center justify-between gap-2 t-caption-sm text-[var(--brand-text-muted)]">
                      Meta description <CharacterCounter current={row.edit.seoDescription.length} max={160} size="sm" />
                    </span>
                    <FormTextarea rows={4} value={row.edit.seoDescription} onChange={(value) => staticWorkflow.updateField(row.staticPage!.id, 'seoDescription', value)} className="mt-1" />
                  </label>
                </div>

                {staticVariation && (
                  <VariationList
                    pageId={row.staticPage.id}
                    field={staticVariation.field === 'both' ? 'both' : staticVariation.field === 'title' ? 'seoTitle' : 'seoDescription'}
                    options={staticVariation.options}
                    descOptions={staticVariation.descOptions}
                    onSelect={(field, value) => {
                      staticWorkflow.updateField(row.staticPage!.id, field, value);
                      staticWorkflow.clearVariations(row.staticPage!.id);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                <div className="mb-2 t-ui font-semibold text-[var(--brand-text-bright)]">Target keywords</div>
                <div className="flex flex-wrap gap-1.5">
                  {row.keywordAssignment?.primaryKeyword && <Badge label={row.keywordAssignment.primaryKeyword} tone="teal" variant="soft" size="sm" />}
                  {(row.keywordAssignment?.secondaryKeywords ?? []).map((keyword) => <Badge key={keyword} label={keyword} tone="zinc" variant="outline" size="sm" />)}
                  {!row.keywordAssignment?.primaryKeyword && (row.keywordAssignment?.secondaryKeywords.length ?? 0) === 0 && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">No assigned keyword projection.</span>
                  )}
                </div>
                <Button size="sm" variant="link" className="mt-3" onClick={() => navigate(adminPath(workspaceId, 'seo-keywords'))}>
                  <Icon as={ExternalLink} size="sm" />
                  Open Keyword Hub
                </Button>
              </div>

              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                <div className="mb-3 t-ui font-semibold text-[var(--brand-text-bright)]">Preview</div>
                <div className="grid gap-4">
                  <SerpPreview title={row.edit.seoTitle || row.staticPage.title} description={row.edit.seoDescription} url={resolvePagePath(row.staticPage)} siteName="Site" size="sm" />
                  <SocialPreview title={row.edit.seoTitle || row.staticPage.title} description={row.edit.seoDescription} siteName="Site" platform="facebook" size="sm" />
                </div>
              </div>
            </div>
          </div>
        )}

        {row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && row.cmsCollection && row.cmsItem && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="t-ui font-semibold text-[var(--brand-text-bright)]">CMS item fields</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Draft writes use the collection item PATCH route; publish stays collection-scoped.</div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (cmsFields.titleField && cmsFields.descField) {
                      cmsWorkflow.aiRewriteBoth(cmsTarget!.collectionId, cmsTarget!.itemId, cmsFields.titleField.slug, cmsFields.descField.slug);
                    }
                  }}
                  disabled={!cmsFields.titleField || !cmsFields.descField}
                  loading={cmsWorkflow.aiLoading[`${cmsTarget!.itemId}-both`]}
                >
                  <Icon as={Sparkles} size="sm" />
                  Generate pair
                </Button>
              </div>

              {cmsWorkflow.errors[cmsTarget!.itemId] && (
                <InlineBanner tone="error" size="sm" title="CMS save failed">
                  {cmsWorkflow.errors[cmsTarget!.itemId]}
                </InlineBanner>
              )}
              {cmsWorkflow.aiError && <InlineBanner tone="warning" size="sm" title="AI rewrite failed">{cmsWorkflow.aiError}</InlineBanner>}

              <div className="grid gap-3">
                <label className="block">
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">Item name</span>
                  <FormInput value={row.cmsEdit?.name ?? String(row.cmsItem.fieldData.name ?? '')} onChange={(value) => cmsWorkflow.updateField(cmsTarget!.itemId, 'name', value)} className="mt-1" />
                </label>
                {cmsFields.titleField ? (
                  <label className="block">
                    <span className="flex items-center justify-between gap-2 t-caption-sm text-[var(--brand-text-muted)]">
                      {cmsFields.titleField.displayName} <span>{fieldLengthLabel(row.cmsEdit?.[cmsFields.titleField.slug] ?? '', 60)}</span>
                    </span>
                    <FormInput value={row.cmsEdit?.[cmsFields.titleField.slug] ?? ''} onChange={(value) => cmsWorkflow.updateField(cmsTarget!.itemId, cmsFields.titleField!.slug, value)} className="mt-1" />
                  </label>
                ) : (
                  <InlineBanner tone="warning" size="sm" title="No SEO title field">Add a title field in the Webflow collection schema before editing SEO titles here.</InlineBanner>
                )}
                {cmsFields.descField ? (
                  <label className="block">
                    <span className="flex items-center justify-between gap-2 t-caption-sm text-[var(--brand-text-muted)]">
                      {cmsFields.descField.displayName} <span>{fieldLengthLabel(row.cmsEdit?.[cmsFields.descField.slug] ?? '', 160)}</span>
                    </span>
                    <FormTextarea rows={4} value={row.cmsEdit?.[cmsFields.descField.slug] ?? ''} onChange={(value) => cmsWorkflow.updateField(cmsTarget!.itemId, cmsFields.descField!.slug, value)} className="mt-1" />
                  </label>
                ) : (
                  <InlineBanner tone="warning" size="sm" title="No meta description field">Add a description field in the Webflow collection schema before editing meta descriptions here.</InlineBanner>
                )}
              </div>

              {cmsVariation && (
                <CmsVariationList
                  itemId={cmsTarget!.itemId}
                  titleSlug={cmsFields.titleField?.slug}
                  descSlug={cmsFields.descField?.slug}
                  fieldSlug={cmsVariation.fieldSlug}
                  options={cmsVariation.options}
                  descOptions={cmsVariation.descOptions}
                  cmsWorkflow={cmsWorkflow}
                />
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                <div className="mb-2 t-ui font-semibold text-[var(--brand-text-bright)]">Collection target</div>
                <div className="grid gap-2">
                  <KeyValueRow label="Collection" value={row.target.collectionName} />
                  <KeyValueRow label="Item ID" value={cmsTarget!.itemId} />
                  <KeyValueRow label="Slug" value={formatOptionalText(String(row.cmsItem.fieldData.slug ?? ''))} />
                </div>
                <div className="mt-3">
                  <FormTextarea
                    value={cmsNote}
                    onChange={setCmsNote}
                    rows={3}
                    placeholder="Optional note for CMS approval batch"
                  />
                  <Button size="sm" variant="secondary" className="mt-2" onClick={() => cmsWorkflow.sendForApproval(cmsNote)} loading={cmsWorkflow.sendingApproval}>
                    <Icon as={Send} size="sm" />
                    Send selected CMS to client
                  </Button>
                </div>
                {cmsWorkflow.approvalError && (
                  <InlineBanner tone="warning" size="sm" title="CMS approval not sent">
                    {cmsWorkflow.approvalError.message}
                  </InlineBanner>
                )}
              </div>

              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                <div className="mb-3 t-ui font-semibold text-[var(--brand-text-bright)]">Preview</div>
                <SerpPreview
                  title={cmsFields.titleField ? row.cmsEdit?.[cmsFields.titleField.slug] ?? row.target.seo.title : row.target.title}
                  description={cmsFields.descField ? row.cmsEdit?.[cmsFields.descField.slug] ?? row.target.seo.description : row.target.seo.description}
                  url={row.target.canonicalPath}
                  siteName="Site"
                  size="sm"
                />
              </div>
            </div>
          </div>
        )}

        {row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
            <div className="grid gap-2">
              <KeyValueRow label="Title" value={row.target.title} />
              <KeyValueRow label="Path" value={row.target.canonicalPath} />
              <KeyValueRow label="SEO title" value={formatOptionalText(row.target.seo.title)} />
              <KeyValueRow label="Meta description" value={formatOptionalText(row.target.seo.description)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled><Icon as={Save} size="sm" /> Save disabled</Button>
              <Button size="sm" variant="secondary" disabled><Icon as={Upload} size="sm" /> Publish disabled</Button>
              <Button size="sm" variant="secondary" disabled><Icon as={Send} size="sm" /> Send disabled</Button>
              <Button size="sm" variant="secondary" disabled><Icon as={RefreshCw} size="sm" /> Rewrite disabled</Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
