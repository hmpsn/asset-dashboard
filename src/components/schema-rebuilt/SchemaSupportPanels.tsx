// @ds-rebuilt
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BarChart3, CheckCircle, Clock, FileJson, Globe, HelpCircle, Layers, MapPin, Settings } from 'lucide-react';
import type { SchemaImpactData } from '../../api/schema';
import { adminPath } from '../../routes';
import type { BusinessProfileContact } from '../../../shared/types/workspace';
import type { SchemaFieldTarget } from '../../../shared/types/site-inventory';
import type { SchemaMappingCollection } from '../schema/schemaSuggesterTypes';
import type { SchemaPageSuggestion } from '../schema/schemaSuggesterTypes';
import { fieldToTarget } from '../schema/fieldTargets';
import { SchemaPlanPanel } from '../schema/SchemaPlanPanel';
import {
  Badge,
  Button,
  ClickableRow,
  FormSelect,
  GroupBlock,
  Icon,
  InlineBanner,
  KeyValueRow,
  MetricTile,
  TrendBadge,
} from '../ui';
import { formatDate } from '../../utils/formatDates';
import { formatInteger } from './schemaFormatters';

export type LocalBusinessIntent = 'unknown' | 'local' | 'non-local-saas';

interface BusinessProfileCalloutProps {
  businessProfile?: BusinessProfileContact | null;
  localBusinessIntent: LocalBusinessIntent;
  dismissed: boolean;
  workspaceId: string;
  onDismiss: () => void;
}

export function inferLocalBusinessIntent(
  businessProfile: BusinessProfileContact | null | undefined,
  intelligenceProfile: { industry?: string; targetAudience?: string } | null | undefined,
): LocalBusinessIntent {
  if (businessProfile?.address?.street || businessProfile?.address?.city) return 'local';
  const profileText = [
    intelligenceProfile?.industry,
    intelligenceProfile?.targetAudience,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!profileText) return 'unknown';
  if (/\b(?:dental|dentist|clinic|medical|healthcare|restaurant|retail|salon|spa|law firm|real estate|local)\b/.test(profileText)) return 'local';
  if (/\b(?:saas|software|platform|developer|engineering|b2b|cloud|ai|artificial intelligence)\b/.test(profileText)) return 'non-local-saas';
  return 'unknown';
}

export function SchemaBusinessProfilePanel({
  businessProfile,
  localBusinessIntent,
  dismissed,
  workspaceId,
  onDismiss,
}: BusinessProfileCalloutProps) {
  const navigate = useNavigate();
  const showCallout = !dismissed
    && localBusinessIntent !== 'non-local-saas'
    && !(businessProfile?.address?.street || businessProfile?.address?.city);

  if (!showCallout) return null;

  return (
    <InlineBanner
      tone="warning"
      title="Business profile needs location data"
      onDismiss={onDismiss}
      dismissLabel="Dismiss business profile reminder"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>Add an address to unlock LocalBusiness schema on high-value pages.</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate(`${adminPath(workspaceId, 'brand')}?tab=business-footprint`)}
        >
          <Icon as={MapPin} size="sm" />
          Complete profile
        </Button>
      </div>
    </InlineBanner>
  );
}

interface CmsMappingPanelProps {
  collections: SchemaMappingCollection[];
  cmsMappingError: string | null;
  savingCmsMapping: string | null;
  fieldMappingTargets: Array<{
    target: SchemaFieldTarget;
    label: string;
    roles: Array<'location' | 'service'>;
  }>;
  onSaveCmsFieldMapping: (collection: SchemaMappingCollection, target: SchemaFieldTarget, value: string) => void;
  maxCollections: number;
}

export function SchemaCmsMappingPanel({
  collections,
  cmsMappingError,
  savingCmsMapping,
  fieldMappingTargets,
  onSaveCmsFieldMapping,
  maxCollections,
}: CmsMappingPanelProps) {
  if (collections.length === 0) return null;

  return (
    <GroupBlock
      icon={Settings}
      iconColor="var(--teal)"
      title="CMS field mapping"
      meta="Locations and Services can publish through mapped CMS schema fields."
      stats={[{ label: 'Collections', value: collections.length }]}
      collapsible
      defaultOpen={false}
    >
      <div className="flex flex-col gap-3 p-2">
        {cmsMappingError && (
          <InlineBanner tone="warning" size="sm" title="Mapping was not saved">
            {cmsMappingError}
          </InlineBanner>
        )}
        {collections.slice(0, maxCollections).map((collection) => (
          <div
            key={collection.collectionId}
            className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="t-ui font-semibold text-[var(--brand-text-bright)]">{collection.collectionName}</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{collection.collectionSlug}</div>
              </div>
              <Badge label={collection.schemaRole} tone={collection.schemaRole === 'location' ? 'emerald' : 'teal'} variant="outline" size="sm" />
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {fieldMappingTargets.filter((target) => target.roles.includes(collection.schemaRole)).map(({ target, label }) => {
                const selected = collection.mapping?.fieldMappings?.[target]
                  ?? collection.fields.find((field) => field.target === target)?.slug
                  ?? '';
                return (
                  <label key={target} className="block">
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">{label}</span>
                    <FormSelect
                      value={selected}
                      disabled={savingCmsMapping === `${collection.collectionId}:${target}`}
                      onChange={(value) => onSaveCmsFieldMapping(collection, target, value)}
                      options={[
                        { value: '', label: 'Not mapped' },
                        ...collection.fields.map((field) => ({
                          value: field.slug,
                          label: `${field.displayName || field.slug} (${field.type})`,
                        })),
                      ]}
                      className="mt-1 w-full"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </GroupBlock>
  );
}

interface CompletenessPanelProps {
  pages: SchemaPageSuggestion[];
  workspaceId: string;
}

export function SchemaCompletenessPanel({ pages, workspaceId }: CompletenessPanelProps) {
  const navigate = useNavigate();
  const groups = useMemo(() => {
    const byField = new Map<string, { severity: 'error' | 'warning'; pages: Set<string>; label: string; tab: string; focus: string }>();
    for (const page of pages) {
      for (const finding of page.validationFindings ?? []) {
        if (!finding.field) continue;
        const target = fieldToTarget(finding.field);
        if (!target) continue;
        const entry = byField.get(finding.field) ?? {
          severity: finding.severity,
          pages: new Set<string>(),
          label: target.label,
          tab: target.tab,
          focus: target.focus,
        };
        if (finding.severity === 'error') entry.severity = 'error';
        entry.pages.add(page.pageId);
        byField.set(finding.field, entry);
      }
    }
    return [...byField.entries()]
      .map(([field, entry]) => ({ field, ...entry, pageCount: entry.pages.size }))
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return b.pageCount - a.pageCount;
      });
  }, [pages]);

  if (pages.length === 0) return null;

  return (
    <GroupBlock
      icon={CheckCircle}
      iconColor={groups.length === 0 ? 'var(--emerald)' : 'var(--amber)'}
      title="Schema profile completeness"
      meta={groups.length === 0 ? 'All generated pages include the recommended profile fields.' : 'Known profile gaps from validation findings.'}
      stats={[{ label: 'Fields', value: groups.length }, { label: 'Pages', value: pages.length }]}
      collapsible
      defaultOpen={groups.length > 0}
    >
      {groups.length === 0 ? (
        <div className="p-3 t-caption text-[var(--brand-text-muted)]">No actionable profile gaps were found in this snapshot.</div>
      ) : (
        <div className="flex flex-col gap-1 p-1">
          {groups.map((group) => {
            const routeTab = new Set(['business-footprint', 'intelligence-profile', 'eeat-assets']).has(group.tab)
              ? 'brand'
              : 'workspace-settings';
            return (
              <ClickableRow
                key={group.field}
                onClick={() => navigate(`${adminPath(workspaceId, routeTab)}?tab=${group.tab}&focus=${group.focus}`)}
                className="rounded-[var(--radius-md)] px-3 py-2 duration-[var(--dur-fast)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon
                        as={group.severity === 'error' ? AlertTriangle : HelpCircle}
                        size="sm"
                        style={{ color: group.severity === 'error' ? 'var(--red)' : 'var(--amber)' }}
                      />
                      <span className="t-ui text-[var(--brand-text-bright)]">{group.label}</span>
                    </div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">{group.pageCount} page{group.pageCount === 1 ? '' : 's'}</div>
                  </div>
                  <Icon as={Settings} size="sm" className="text-[var(--brand-text-muted)]" />
                </div>
              </ClickableRow>
            );
          })}
        </div>
      )}
    </GroupBlock>
  );
}

interface ImpactPanelProps {
  data: SchemaImpactData | null | undefined;
  loading?: boolean;
}

export function SchemaImpactPanel({ data, loading }: ImpactPanelProps) {
  if (loading) {
    return (
      <GroupBlock icon={BarChart3} iconColor="var(--blue)" title="Schema impact" meta="Loading measured deployment impact." />
    );
  }

  if (!data || data.totalDeployments === 0) {
    return (
      <GroupBlock icon={BarChart3} iconColor="var(--blue)" title="Schema impact" meta="No measured deployment window yet.">
        <div className="p-3">
          <InlineBanner tone="info" size="sm" title="Impact is not available yet">
            Publish schema and wait for a Search Console before/after window before reading this panel.
          </InlineBanner>
        </div>
      </GroupBlock>
    );
  }

  return (
    <GroupBlock
      icon={BarChart3}
      iconColor="var(--blue)"
      title="Schema impact"
      meta="Search Console before/after readout for schema deployments."
      stats={[
        { label: 'Deployments', value: data.totalDeployments },
        { label: 'With data', value: data.pagesWithData },
        { label: 'Pending', value: data.tooRecent },
      ]}
      collapsible
      defaultOpen={false}
    >
      <div className="grid gap-2 p-2 md:grid-cols-4">
        <MetricTile label="Avg clicks" value={data.avgClicksDelta ?? '—'} delta={data.avgClicksDelta ?? undefined} accent="var(--blue)" />
        <MetricTile label="Avg impressions" value={data.avgImpressionsDelta ?? '—'} delta={data.avgImpressionsDelta ?? undefined} accent="var(--blue)" />
        <MetricTile label="Avg CTR" value={data.avgCtrDelta !== null ? `${data.avgCtrDelta}%` : '—'} delta={data.avgCtrDelta ?? undefined} accent="var(--blue)" />
        <MetricTile label="Avg position" value={data.avgPositionDelta ?? '—'} delta={data.avgPositionDelta ?? undefined} invertDelta accent="var(--blue)" />
      </div>
      <div className="flex max-h-[260px] flex-col overflow-y-auto border-t border-[var(--brand-border)]">
        {data.deployments.map((deployment) => (
          <div key={deployment.change.id} className="flex items-center gap-3 border-b border-[var(--brand-border)] px-3 py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="t-caption text-[var(--brand-text-bright)]">{deployment.change.pageTitle || deployment.change.pageSlug || 'Unknown page'}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">
                {formatDate(deployment.change.changedAt)} · {deployment.daysSinceChange}d ago
              </div>
            </div>
            {deployment.tooRecent ? (
              <Badge label="Pending window" tone="zinc" variant="outline" size="sm" icon={Clock} />
            ) : deployment.before && deployment.after ? (
              <div className="flex items-center gap-3">
                <TrendBadge value={deployment.after.clicks - deployment.before.clicks} suffix="" label="clicks" hideOnZero={false} />
                <span className="t-caption-sm text-[var(--brand-text-muted)]">pos {deployment.after.position.toFixed(1)}</span>
              </div>
            ) : (
              <span className="t-caption-sm text-[var(--brand-text-muted)]">No GSC data</span>
            )}
          </div>
        ))}
      </div>
    </GroupBlock>
  );
}

interface SitePlanBridgeProps {
  siteId: string;
  workspaceId: string;
}

export function SchemaSitePlanBridge({ siteId, workspaceId }: SitePlanBridgeProps) {
  return (
    <GroupBlock
      icon={Globe}
      iconColor="var(--teal)"
      title="Schema site plan"
      meta="T1 carry-over: role assignment, canonical entities, send, activate, and retract stay on the proven machinery."
      collapsible
      defaultOpen
    >
      <div className="p-2">
        <SchemaPlanPanel siteId={siteId} workspaceId={workspaceId} />
      </div>
    </GroupBlock>
  );
}

export function SchemaHowToFooter() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)]">
          <Icon as={FileJson} size="md" style={{ color: 'var(--blue)' }} />
        </span>
        <div className="min-w-0">
          <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Publishing contract</div>
          <div className="mt-1 grid gap-1.5 md:grid-cols-3">
            <KeyValueRow label="Webflow pages" value="Custom code publish, with manual fallback" />
            <KeyValueRow label="CMS items" value="Mapped schema field publish" />
            <KeyValueRow label="Managed scope" value="Generated JSON-LD only" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface EmptySetupProps {
  onRunScan: () => void;
}

export function SchemaGeneratorEmptySetup({ onRunScan }: EmptySetupProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-6">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-3)]">
          <Icon as={Layers} size="xl" style={{ color: 'var(--teal)' }} />
        </span>
        <div>
          <h2 className="t-h2 text-[var(--brand-text-bright)]">Schema generator</h2>
          <p className="mt-1 t-caption text-[var(--brand-text-muted)]">Generate structured data across the connected Webflow site, then review, edit, validate, send, or publish page by page.</p>
        </div>
        <Button size="md" variant="primary" onClick={onRunScan}>
          <Icon as={Layers} size="sm" />
          Generate all pages
        </Button>
      </div>
    </div>
  );
}

export function SchemaInventoryAbsentBanner() {
  return (
    <InlineBanner tone="info" size="sm" title="Server-owned coverage is pending">
      Coverage and missing-schema counts are intentionally absent until the schema snapshot and Site Audit projections provide authoritative values.
    </InlineBanner>
  );
}

export function SchemaQuickStats({ total, unpublished }: { total: number; unpublished: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 t-caption-sm text-[var(--brand-text-muted)]">
      <Badge label={`${formatInteger(total)} pages`} tone="blue" variant="outline" size="sm" />
      <Badge label={`${formatInteger(unpublished)} publishable`} tone="teal" variant="outline" size="sm" />
    </div>
  );
}
