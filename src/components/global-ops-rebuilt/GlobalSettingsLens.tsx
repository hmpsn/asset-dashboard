// @ds-rebuilt
import { useEffect, useMemo, useState } from 'react';
import { FeatureFlagSettings } from '../FeatureFlagSettings';
import { McpApiKeysSettings } from '../McpApiKeysSettings';
import { StripeSettings } from '../StripeSettings';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  FormInput,
  Icon,
  InlineBanner,
  MetricTile,
  PageContainer,
  PageHeader,
  SectionCard,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import {
  useDisconnectGlobalGoogle,
  useGlobalOpsGoogleStatus,
  useGlobalOpsGoogleAuthUrl,
  useGlobalOpsGscSites,
  useGlobalOpsHealth,
  useGlobalOpsStorage,
  useGlobalOpsStudioConfig,
  useGlobalOpsWorkspaces,
  usePruneGlobalStorage,
  useSaveGlobalBookingUrl,
  type GlobalOpsPruneType,
} from '../../hooks/admin/useGlobalOpsSettings';
import { formatBytes, formatDateTime, formatNumber } from './globalOpsFormatters';
import { mutationErrorMessage } from './globalOpsMutationFeedback';

const PRUNE_LABELS: Record<GlobalOpsPruneType, { label: string; detail: string }> = {
  backups: { label: 'Prune backups', detail: 'Keeps the configured local retention window.' },
  reports: { label: 'Prune audit snapshots', detail: 'Keeps the retained report history per site.' },
  chat: { label: 'Prune chat history', detail: 'Removes sessions outside the chat retention window.' },
  activity: { label: 'Prune activity logs', detail: 'Trims old activity beyond the retention cap.' },
};

function StatusCell({ ok }: { ok: boolean | undefined }) {
  const label = ok ? 'Configured' : 'Missing';
  const dotClass = ok ? 'bg-[var(--emerald)]' : 'bg-[var(--brand-text-muted)]';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-[var(--radius-pill)] ${dotClass}`} />
      <span>{label}</span>
    </span>
  );
}

export function GlobalSettingsLens() {
  const { toast } = useToast();
  const workspaces = useGlobalOpsWorkspaces();
  const google = useGlobalOpsGoogleStatus();
  const gscSites = useGlobalOpsGscSites(Boolean(google.data?.connected));
  const health = useGlobalOpsHealth();
  const storage = useGlobalOpsStorage();
  const studioConfig = useGlobalOpsStudioConfig();
  const googleAuthUrl = useGlobalOpsGoogleAuthUrl();
  const disconnectGoogle = useDisconnectGlobalGoogle();
  const saveBookingUrl = useSaveGlobalBookingUrl();
  const pruneStorage = usePruneGlobalStorage();
  const [bookingUrl, setBookingUrl] = useState('');
  const [pruneTarget, setPruneTarget] = useState<GlobalOpsPruneType | null>(null);

  useEffect(() => {
    setBookingUrl(studioConfig.data?.bookingUrl ?? '');
  }, [studioConfig.data?.bookingUrl]);

  const linkedWorkspaces = useMemo(
    () => (workspaces.data ?? []).filter((workspace) => Boolean(workspace.webflowSiteId)),
    [workspaces.data],
  );
  const storageData = storage.data ?? null;
  const healthRows = [
    { service: 'OpenAI', status: health.data?.hasOpenAIKey },
    { service: 'Webflow', status: health.data?.hasWebflowToken },
    { service: 'Google Auth', status: health.data?.hasGoogleAuth },
    { service: 'Email', status: health.data?.hasEmailConfig },
    { service: 'Stripe', status: health.data?.hasStripe },
  ];
  const workspaceRows = (workspaces.data ?? []).map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    site: workspace.webflowSiteName ?? '—',
    status: workspace.webflowSiteId ? 'Linked' : 'Not linked',
  }));

  const handleConnectGoogle = async () => {
    googleAuthUrl.mutate(undefined, {
      onSuccess: (data) => {
        if (data.url) window.location.href = data.url;
      },
      onError: (error) => toast(mutationErrorMessage(error, 'Google connection failed'), 'error'),
    });
  };

  const handleDisconnectGoogle = () => {
    disconnectGoogle.mutate(undefined, {
      onSuccess: () => toast('Google account disconnected', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Google disconnect failed'), 'error'),
    });
  };

  const handleSaveBookingUrl = () => {
    saveBookingUrl.mutate(bookingUrl, {
      onSuccess: () => toast(bookingUrl ? 'Booking link saved' : 'Booking link cleared', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Booking link save failed'), 'error'),
    });
  };

  const handlePrune = () => {
    if (!pruneTarget) return;
    pruneStorage.mutate(pruneTarget, {
      onSuccess: (data) => {
        toast(`Storage cleanup finished: ${formatBytes(data?.bytesFreed ?? 0)} freed`, 'success');
        setPruneTarget(null);
      },
      onError: (error) => toast(mutationErrorMessage(error, 'Storage cleanup failed'), 'error'),
    });
  };

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="global-settings-rebuilt" className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Settings"
          subtitle="Global connections, billing, platform health, and operator configuration."
        />

        <div className="grid gap-3 md:grid-cols-4">
          <MetricTile label="Workspaces" value={formatNumber(workspaces.data?.length ?? 0)} accent="var(--blue)" />
          <MetricTile label="Webflow linked" value={formatNumber(linkedWorkspaces.length)} accent="var(--teal)" />
          <MetricTile label="Storage" value={formatBytes(storageData?.totalBytes ?? 0)} accent="var(--amber)" />
          <MetricTile label="GSC properties" value={formatNumber(gscSites.data?.length ?? 0)} accent="var(--emerald)" />
        </div>

        {(workspaces.isError || google.isError || health.isError) && (
          <InlineBanner
            tone="warning"
            title="Some settings data may be stale"
            message="The last loaded configuration is still shown where available."
          />
        )}

        <SectionCard
          title="Google Account"
          titleIcon={<Icon name="search" size="md" className="text-[var(--blue)]" />}
          action={
            google.data?.connected ? (
              <Button variant="secondary" size="sm" onClick={handleDisconnectGoogle} loading={disconnectGoogle.isPending}>
                Disconnect
              </Button>
            ) : google.data?.configured ? (
              <Button size="sm" onClick={handleConnectGoogle} loading={googleAuthUrl.isPending}>Connect Google</Button>
            ) : (
              <Badge label="Not configured" tone="amber" variant="soft" />
            )
          }
        >
          {google.isLoading ? (
            <Skeleton className="h-[52px] w-full" />
          ) : google.data?.connected ? (
            <div className="flex flex-wrap gap-2">
              {(gscSites.data ?? []).map((site) => (
                <Badge key={site.siteUrl} label={site.siteUrl} tone="blue" variant="soft" />
              ))}
              {!gscSites.isLoading && (gscSites.data ?? []).length === 0 && (
                <span className="t-caption text-[var(--brand-text-muted)]">No Search Console properties were returned for this account.</span>
              )}
            </div>
          ) : (
            <p className="t-caption text-[var(--brand-text-muted)]">
              Connect once to make Search Console and GA4 properties available to workspace settings.
            </p>
          )}
        </SectionCard>

        <DataTable
          columns={[
            { key: 'name', label: 'Workspace', sortable: true, width: '1.2fr' },
            { key: 'site', label: 'Webflow site', sortable: true, width: '1.3fr' },
            {
              key: 'status',
              label: 'Status',
              width: '140px',
              render: (value) => (
                <Badge label={String(value)} tone={value === 'Linked' ? 'emerald' : 'zinc'} variant="soft" />
              ),
            },
          ]}
          rows={workspaceRows}
          getRowKey={(row) => String(row.id)}
          loading={workspaces.isLoading}
          empty="No workspaces yet"
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <SectionCard title="Platform Health" titleIcon={<Icon name="gauge" size="md" className="text-[var(--teal)]" />}>
            <div className="space-y-3">
              {health.isLoading ? (
                <Skeleton className="h-[168px] w-full" />
              ) : (
                healthRows.map((row) => (
                  <div key={row.service} className="flex items-center justify-between gap-3 border-b border-[var(--brand-border)] pb-2 last:border-b-0 last:pb-0">
                    <span className="t-caption text-[var(--brand-text)]">{row.service}</span>
                    <StatusCell ok={row.status} />
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Storage Monitor"
            titleIcon={<Icon name="layers" size="md" className="text-[var(--amber)]" />}
            action={
              <Button variant="secondary" size="sm" onClick={() => void storage.refetch()} loading={storage.isFetching}>
                Refresh
              </Button>
            }
          >
            {storage.isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : storageData ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="t-h2 text-[var(--brand-text-bright)]">{formatBytes(storageData.totalBytes)}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">
                      {formatNumber(storageData.totalFiles)} files · scanned {formatDateTime(storageData.timestamp)}
                    </div>
                  </div>
                  <Badge label={`${storageData.backupRetentionDays}d backups`} tone="blue" variant="soft" />
                </div>
                <div className="space-y-2">
                  {storageData.breakdown.map((item) => (
                    <div key={item.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                      <span className="truncate t-caption text-[var(--brand-text)]">{item.label}</span>
                      <span className="t-caption-sm tabular-nums text-[var(--brand-text-muted)]">{formatNumber(item.fileCount)} files</span>
                      <span className="t-caption tabular-nums text-[var(--brand-text-bright)]">{formatBytes(item.bytes)}</span>
                    </div>
                  ))}
                </div>
                <Toolbar label="Storage cleanup actions" className="flex-wrap">
                  {(Object.keys(PRUNE_LABELS) as GlobalOpsPruneType[]).map((type) => (
                    <Button key={type} variant="secondary" size="sm" onClick={() => setPruneTarget(type)}>
                      {PRUNE_LABELS[type].label}
                    </Button>
                  ))}
                  <ToolbarSpacer />
                </Toolbar>
              </div>
            ) : (
              <InlineBanner tone="warning" title="Storage stats unavailable" message="Retry the storage read before running cleanup actions." />
            )}
          </SectionCard>
        </div>

        <SectionCard title="Booking Link" titleIcon={<Icon name="clock" size="md" className="text-[var(--teal)]" />}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <FormInput
              type="url"
              value={bookingUrl}
              onChange={setBookingUrl}
              placeholder="https://cal.com/yourname"
              className="flex-1"
            />
            <Button onClick={handleSaveBookingUrl} loading={saveBookingUrl.isPending}>
              Save
            </Button>
          </div>
        </SectionCard>

        <FeatureFlagSettings />
        <StripeSettings />
        <McpApiKeysSettings />
      </div>

      <ConfirmDialog
        open={!!pruneTarget}
        title={pruneTarget ? PRUNE_LABELS[pruneTarget].label : 'Run cleanup'}
        message={pruneTarget ? PRUNE_LABELS[pruneTarget].detail : ''}
        confirmLabel="Run cleanup"
        variant="destructive"
        onCancel={() => setPruneTarget(null)}
        onConfirm={handlePrune}
      />
    </PageContainer>
  );
}
