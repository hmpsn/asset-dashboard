// @ds-rebuilt
import { useNavigate } from 'react-router-dom';
import { ENGINE_LEADS_MAX, ENGINE_LEADS_PAGE, type useEngineRebuilt } from '../../hooks/admin/useEngineRebuilt';
import { adminPath } from '../../routes';
import {
  Button,
  ClickableRow,
  ClientSwitcherRow,
  ClientThreadRow,
  GroupBlock,
  Icon,
  InlineBanner,
} from '../ui';
import { formatCompactNumber, formatDate } from './engineFormatters';
import { StrategyConfigPanel } from '../strategy/StrategyConfigPanel';
import { IssueSetupReadiness } from '../strategy/issue/IssueSetupReadiness';
import { TrustLadderPanel } from '../strategy/issue/TrustLadderPanel';
import { AdminLeadsReadout } from '../strategy/issue/AdminLeadsReadout';
import { ContentWorkOrderLens } from '../strategy/issue/ContentWorkOrderLens';
import { KeywordTargetsLens } from '../strategy/issue/KeywordTargetsLens';

type EngineModel = ReturnType<typeof useEngineRebuilt>;

interface EngineOperationsProps {
  workspaceId: string;
  engine: EngineModel;
  onOpenLocalSeoSetup: () => void;
}

function OperationLink({
  title,
  description,
  iconName,
  onClick,
}: {
  title: string;
  description: string;
  iconName: 'settings' | 'file' | 'target' | 'gauge' | 'external';
  onClick: () => void;
}) {
  return (
    <ClickableRow
      onClick={onClick}
      className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-3"
    >
      <span
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-md)]"
        style={{ background: 'var(--brand-mint-dim)', color: 'var(--teal)' }}
      >
        <Icon name={iconName} size="md" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block t-ui font-semibold text-[var(--brand-text-bright)]">{title}</span>
        <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{description}</span>
      </span>
      <Icon name="arrowRight" size="sm" className="text-[var(--brand-text-muted)]" />
    </ClickableRow>
  );
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'WS';
}

export function EngineOperations({ workspaceId, engine, onOpenLocalSeoSetup }: EngineOperationsProps) {
  const navigate = useNavigate();
  const readiness = engine.conversionStatus.status?.readiness ?? null;
  const hasMoreLeads = engine.leadsLimit < ENGINE_LEADS_MAX;
  const workspaceName = engine.workspace?.name ?? 'Current workspace';
  const workspaceInitials = initialsFor(workspaceName);
  const openWorkItems = engine.workQueue.items.length;
  const clientSignalRows = engine.leads.leads.slice(0, 3);
  const healthTone = openWorkItems > 0 ? 'risk' : 'ok';

  const configPanelProps = {
    workspaceId,
    isAuxLoading: engine.keywordQuery.isAuxLoading,
    settingsOpen: engine.settings.settingsOpen,
    setSettingsOpen: engine.settings.setSettingsOpen,
    seoDataAvailable: engine.settings.seoDataAvailable,
    seoDataMode: engine.settings.seoDataMode,
    setSeoDataMode: engine.settings.setSeoDataMode,
    maxPages: engine.settings.maxPages,
    setMaxPages: engine.settings.setMaxPages,
    competitors: engine.settings.competitors,
    setCompetitors: engine.settings.setCompetitors,
    businessContext: engine.settings.businessContext,
    setBusinessContext: engine.settings.setBusinessContext,
    contextOpen: engine.settings.contextOpen,
    setContextOpen: engine.settings.setContextOpen,
    discoveringCompetitors: engine.settings.discoveringCompetitors,
    discoverError: engine.settings.discoverError,
    onDiscoverCompetitors: engine.settings.discoverCompetitors,
    providerName: engine.settings.selectedSeoDataProvider === 'dataforseo'
      ? 'DataForSEO'
      : engine.settings.selectedSeoDataProvider,
    localMarketLabel: engine.primaryMarket?.label,
    onOpenLocalSeoSetup,
  };

  return (
    <div className="space-y-4" data-testid="engine-lens-operations">
      <GroupBlock
        title="Operations disclosure"
        meta="Setup, capture, trust, and owning-surface handoffs"
        collapsible
        defaultOpen
        stats={[
          { label: 'staged', value: engine.stagedCount, color: 'var(--teal)' },
          { label: 'with client', value: engine.curatedCount, color: 'var(--blue)' },
        ]}
      >
        <div className="space-y-4">
          {engine.measuredCapture && readiness ? (
            <IssueSetupReadiness
              workspaceId={workspaceId}
              readiness={readiness}
              status={engine.conversionStatus.status}
              loading={engine.conversionStatus.isLoading}
            />
          ) : (
            <InlineBanner
              tone="info"
              title="Outcome setup is not showing measured capture yet"
              message="Use Workspace Settings to connect analytics, outcome value, forms, and dashboard configuration."
            >
              <Button
                variant="link"
                size="sm"
                onClick={() => navigate(`${adminPath(workspaceId, 'workspace-settings')}?tab=dashboard`)}
              >
                Open settings
              </Button>
            </InlineBanner>
          )}

          <StrategyConfigPanel {...configPanelProps} />

          <div className="grid gap-3 lg:grid-cols-2">
            <OperationLink
              title="Conversion connections"
              description="GA4, Webflow form capture, and outcome-value setup."
              iconName="settings"
              onClick={() => navigate(`${adminPath(workspaceId, 'workspace-settings')}?tab=connections`)}
            />
            <OperationLink
              title="Diagnostics"
              description="Open deep diagnostics for crawl, provider, and report drill-ins."
              iconName="gauge"
              onClick={() => navigate(adminPath(workspaceId, 'diagnostics'))}
            />
            <OperationLink
              title="Content pipeline"
              description="Advance briefs and posts from curated Engine work-orders."
              iconName="file"
              onClick={() => navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=briefs`)}
            />
            <OperationLink
              title="Keyword Hub"
              description="Manage page-map, rankings, and keyword target execution."
              iconName="target"
              onClick={() => navigate(`${adminPath(workspaceId, 'seo-keywords')}?lens=rankings`)}
            />
          </div>
        </div>
      </GroupBlock>

      <TrustLadderPanel workspaceId={workspaceId} theIssueEnabled />

      <GroupBlock
        title="Client signal intake"
        meta="Read-only client-facing signals that can inform Engine curation."
        collapsible
        defaultOpen={false}
        stats={[{ label: 'queue', value: openWorkItems, color: openWorkItems > 0 ? 'var(--amber)' : 'var(--emerald)' }]}
      >
        <ClientSwitcherRow
          name={workspaceName}
          initials={workspaceInitials}
          meta={`${formatCompactNumber(openWorkItems)} queue items`}
          health={healthTone}
          active
        />
        {clientSignalRows.length > 0 ? (
          clientSignalRows.map((lead) => (
            <ClientThreadRow
              key={lead.id}
              author={lead.leadName ?? lead.leadEmail ?? workspaceName}
              initials={initialsFor(lead.leadName ?? lead.leadEmail ?? workspaceName)}
              kind="request"
              message={`${lead.formName} captured a ${lead.outcomeType.replace(/_/g, ' ')} signal.`}
              when={formatDate(lead.submittedAt)}
            />
          ))
        ) : (
          <div className="border-t border-[var(--brand-border)] px-4 py-3 t-caption-sm text-[var(--brand-text-muted)]">
            No captured client signals are ready for Engine review.
          </div>
        )}
        <div className="border-t border-[var(--brand-border)] px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`${adminPath(workspaceId, 'workspace-settings')}?tab=dashboard`)}
          >
            Open capture setup
          </Button>
        </div>
      </GroupBlock>

      {engine.measuredCapture && (
        <AdminLeadsReadout
          leads={engine.leads.leads}
          total={engine.leads.total}
          loading={engine.leads.isLoading}
          onConnectCta={() => navigate(`${adminPath(workspaceId, 'workspace-settings')}?tab=dashboard`)}
          onLoadMore={hasMoreLeads
            ? () => engine.setLeadsLimit((limit) => Math.min(limit + ENGINE_LEADS_PAGE, ENGINE_LEADS_MAX))
            : undefined}
        />
      )}

      <ContentWorkOrderLens workspaceId={workspaceId} theIssueEnabled />
      <KeywordTargetsLens workspaceId={workspaceId} theIssueEnabled />
    </div>
  );
}
