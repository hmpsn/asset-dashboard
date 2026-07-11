// @ds-rebuilt
import { useEffect, useState } from 'react';
import { FeatureFlagSettings } from '../FeatureFlagSettings';
import { McpApiKeysSettings } from '../McpApiKeysSettings';
import { StripeSettings } from '../StripeSettings';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  ConfirmDialog,
  FormInput,
  Icon,
  InlineBanner,
  SectionCard,
  Skeleton,
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
import { formatBytes } from './globalOpsFormatters';
import { mutationErrorMessage } from './globalOpsMutationFeedback';
import { PlatformHealthCard } from './wave-a/PlatformHealthCard';
import { StorageMonitorCard } from './wave-a/StorageMonitorCard';
import { WebflowConnectionsCard } from './wave-a/WebflowConnectionsCard';

const PRUNE_LABELS: Record<GlobalOpsPruneType, { label: string; detail: string }> = {
  backups: { label: 'Prune old backups', detail: 'Keeps the configured local retention window.' },
  reports: { label: 'Prune audit snapshots', detail: 'Keeps the retained report history per site.' },
  chat: { label: 'Prune chat history', detail: 'Removes sessions outside the chat retention window.' },
  activity: { label: 'Prune activity logs', detail: 'Trims old activity beyond the retention cap.' },
};

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

  const workspaceList = workspaces.data ?? [];
  const linkedWorkspaceCount = workspaceList.filter((workspace) => Boolean(workspace.webflowSiteId)).length;

  const handleConnectGoogle = () => {
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
    <div
      data-testid="global-settings-rebuilt"
      className="mx-auto flex min-h-full w-full max-w-[860px] flex-col gap-4 px-4 pb-[90px] pt-2 sm:px-[30px]"
    >
      <header className="mb-1">
        <h1 className="t-h2 text-[var(--brand-text-bright)]">Settings</h1>
        <p className="mt-1 t-caption text-[var(--brand-text-muted)]">
          Account-level connections and configuration
        </p>
      </header>

      {(workspaces.isError || google.isError || health.isError) && (
        <InlineBanner
          tone="warning"
          title="Some settings data may be stale"
          message="The last loaded configuration is still shown where available."
        />
      )}

      <SectionCard
        title="Google Account"
        subtitle="Connect once for Search Console and GA4 across all workspaces"
        titleIcon={<Icon name="search" size="md" className="text-[var(--blue)]" />}
        iconChip
        action={google.data?.connected ? (
          <Badge label="Connected" tone="emerald" variant="soft" dot />
        ) : google.data?.configured ? (
          <Button size="sm" onClick={handleConnectGoogle} loading={googleAuthUrl.isPending}>Connect Google</Button>
        ) : (
          <Badge label="Not configured" tone="amber" variant="soft" />
        )}
      >
        {google.isLoading ? (
          <Skeleton className="h-7 w-full" />
        ) : google.data?.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            {(gscSites.data ?? []).map((site) => (
              <code
                key={site.siteUrl}
                className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-2 py-1 t-micro text-[var(--brand-text-muted)]"
              >
                {site.siteUrl}
              </code>
            ))}
            {!gscSites.isLoading && (gscSites.data ?? []).length === 0 && (
              <span className="t-caption text-[var(--brand-text-muted)]">
                No Search Console properties were returned for this account.
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={handleDisconnectGoogle}
              loading={disconnectGoogle.isPending}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <p className="t-caption text-[var(--brand-text-muted)]">
            Connect Google to make Search Console and GA4 properties available in workspace settings.
          </p>
        )}
      </SectionCard>

      <WebflowConnectionsCard workspaces={workspaceList} loading={workspaces.isLoading} />

      <PlatformHealthCard
        health={health.data}
        loading={health.isLoading}
        workspaceCount={workspaceList.length}
        linkedWorkspaceCount={linkedWorkspaceCount}
      />

      <StorageMonitorCard
        data={storage.data ?? null}
        loading={storage.isLoading}
        fetching={storage.isFetching}
        onRefresh={() => void storage.refetch()}
        onPrune={setPruneTarget}
      />

      <SectionCard
        title="Booking Link"
        subtitle="Shown in client AI chat when a client is ready to book"
        titleIcon={<Icon name="clock" size="md" className="text-[var(--teal)]" />}
        iconChip
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <FormInput
            type="url"
            value={bookingUrl}
            onChange={setBookingUrl}
            placeholder="https://cal.com/yourname"
            className="flex-1"
          />
          <Button onClick={handleSaveBookingUrl} loading={saveBookingUrl.isPending}>
            <Icon name="check" size="sm" /> Save
          </Button>
        </div>
      </SectionCard>

      <FeatureFlagSettings />
      <McpApiKeysSettings />
      <StripeSettings />

      <p className="pb-2 text-center t-caption-sm text-[var(--brand-text-muted)]">
        Workspace-specific connections, publishing, and client dashboard controls live in Workspace Settings.
      </p>

      <ConfirmDialog
        open={pruneTarget !== null}
        title={pruneTarget ? PRUNE_LABELS[pruneTarget].label : 'Run cleanup'}
        message={pruneTarget ? PRUNE_LABELS[pruneTarget].detail : ''}
        confirmLabel="Run cleanup"
        variant="destructive"
        onCancel={() => setPruneTarget(null)}
        onConfirm={handlePrune}
      />
    </div>
  );
}
