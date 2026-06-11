import { useState } from 'react';
import {
  Globe, Search, Loader2, Check, Unplug, LogIn, LogOut, ExternalLink, Server, AlertTriangle, Clock3,
  Eye, EyeOff,
} from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import { Badge, SectionCard, Icon, Button, IconButton, FormInput, ClickableRow, type BadgeTone } from '../ui';
import { useIntegrationHealth } from '../../hooks/admin/useIntegrationHealth';
import { useLinkSiteFlow } from '../../hooks/useLinkSiteFlow';
import { useLinkSite } from '../../hooks/admin/useWorkspaces';
import type { IntegrationHealthItem } from '../../../shared/types/integration-health';

interface GscSite { siteUrl: string; permissionLevel: string; }
interface GA4Property { name: string; displayName: string; propertyId: string; }
interface WorkspaceData {
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  [key: string]: unknown;
}

interface ConnectionsTabProps {
  workspaceId: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  googleStatus: { connected: boolean; configured: boolean } | null;
  gscSites: GscSite[];
  ga4Properties: GA4Property[];
  loadingGoogle: boolean;
  ws: WorkspaceData | null;
  connectGoogle: () => void;
  disconnectGoogle: () => void;
  saveGscProperty: (url: string) => void;
  saveGa4Property: (id: string) => void;
  saveLiveDomain: (domain: string) => void;
  onSiteLinked?: () => void;
}

export function ConnectionsTab({
  workspaceId, webflowSiteId, webflowSiteName, googleStatus, gscSites, ga4Properties,
  loadingGoogle, ws, connectGoogle, disconnectGoogle, saveGscProperty, saveGa4Property, saveLiveDomain,
  onSiteLinked,
}: ConnectionsTabProps) {
  const currentDomain = (ws?.liveDomain as string) || '';
  const [domainDraft, setDomainDraft] = useState('');
  const [domainEditing, setDomainEditing] = useState(false);
  // Track the specific site being linked so the spinner + disabled state apply
  // only to the clicked row (not every row), and surface link failures inline.
  const [linkingSiteId, setLinkingSiteId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const handleLinkSite = async (siteId: string, siteName: string) => {
    setLinkingSiteId(siteId);
    setLinkError(null);
    try {
      await linkSiteMutation.mutateAsync({ workspaceId, siteId, siteName, token: flow.token.trim() });
      flow.reset();
      onSiteLinked?.();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link site. Please try again.');
    } finally {
      setLinkingSiteId(null);
    }
  };
  const integrationHealthQuery = useIntegrationHealth(workspaceId);
  const integrationHealth = integrationHealthQuery.data;
  const linkSiteMutation = useLinkSite();
  const flow = useLinkSiteFlow();

  const handleDomainSave = () => {
    const clean = domainDraft.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (clean) saveLiveDomain(clean);
    setDomainEditing(false);
  };

  const stateBadgeTone = (item: IntegrationHealthItem): BadgeTone => {
    if (item.state === 'configured') return 'emerald';
    if (item.state === 'degraded') return 'amber';
    return 'red';
  };

  const quotaBadgeTone = (item: IntegrationHealthItem): BadgeTone => {
    if (item.quotaStatus === 'ok') return 'emerald';
    if (item.quotaStatus === 'warning') return 'amber';
    if (item.quotaStatus === 'critical') return 'red';
    return 'blue';
  };

  const formatDate = (value: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };

  return (
    <div className="space-y-8">
      {/* Webflow */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
            <Icon as={Globe} size="md" className="text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Webflow Site</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">
              {webflowSiteId ? 'Connected via Webflow API token' : 'Paste a Webflow API token to link a site'}
            </p>
          </div>
          {webflowSiteId ? (
            <Badge label={webflowSiteName ?? 'Connected'} tone="emerald" variant="soft" shape="pill" size="md" icon={Check} />
          ) : (
            <Badge label="Not linked" tone="zinc" variant="soft" shape="pill" size="md" icon={Unplug} />
          )}
        </div>
        {!webflowSiteId && (
          <div className="px-5 py-4 space-y-3">
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              Generate a site token at{' '}
              <a href="https://webflow.com/dashboard/account/integrations" target="_blank" rel="noopener noreferrer" className="text-accent-brand hover:underline inline-flex items-center gap-0.5">
                webflow.com/dashboard <Icon as={ExternalLink} size="xs" />
              </a>
              , then paste it below to link your site.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FormInput
                  ref={flow.tokenInputRef}
                  type={flow.showToken ? 'text' : 'password'}
                  value={flow.token}
                  onChange={flow.setToken}
                  onKeyDown={(e) => e.key === 'Enter' && flow.fetchSites(flow.token)}
                  placeholder="Paste Webflow API token..."
                  className="w-full px-3 py-2 pr-9 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
                />
                <IconButton
                  onClick={() => flow.setShowToken(!flow.showToken)}
                  icon={flow.showToken ? EyeOff : Eye}
                  label={flow.showToken ? 'Hide token' : 'Show token'}
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                />
              </div>
              <Button
                onClick={() => flow.fetchSites(flow.token)}
                disabled={!flow.token.trim() || flow.loadingSites}
                variant="primary"
                size="sm"
                className="bg-teal-600 text-white hover:bg-teal-500 whitespace-nowrap"
              >
                {flow.loadingSites ? (
                  <><Icon as={Loader2} size="sm" className="animate-spin" /> Loading...</>
                ) : (
                  'Find sites'
                )}
              </Button>
            </div>
            {flow.tokenError && <p className="t-caption-sm text-accent-danger">{flow.tokenError}</p>}
            {flow.sites.length > 0 && (
              <div className="border border-[var(--brand-border)] rounded-[var(--radius-lg)] overflow-hidden">
                <p className="px-3 py-2 t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] border-b border-[var(--brand-border)]">Select a site to link:</p>
                {flow.sites.map(site => (
                  <ClickableRow
                    key={site.id}
                    disabled={linkingSiteId != null}
                    onClick={() => handleLinkSite(site.id, site.displayName)}
                    className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-[var(--surface-3)] t-caption"
                  >
                    <Icon as={Globe} size="sm" className="text-accent-brand shrink-0" />
                    <span className="flex-1 truncate">{site.displayName}</span>
                    {linkingSiteId === site.id && <Icon as={Loader2} size="sm" className="animate-spin text-[var(--brand-text-muted)]" />}
                  </ClickableRow>
                ))}
              </div>
            )}
            {linkError && <p className="t-caption-sm text-accent-danger">{linkError}</p>}
          </div>
        )}
        {webflowSiteId && (
          <div className="px-5 py-3 flex items-center gap-3">
            <Icon as={ExternalLink} size="md" className="text-[var(--brand-text-muted)]" />
            <span className="t-caption font-medium text-[var(--brand-text)] whitespace-nowrap">Live Domain</span>
            {domainEditing ? (
              <div className="flex items-center gap-2 flex-1">
                <FormInput
                  type="text"
                  value={domainDraft}
                  onChange={setDomainDraft}
                  onKeyDown={e => e.key === 'Enter' && handleDomainSave()}
                  placeholder="www.example.com"
                  className="flex-1 px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-teal-500"
                  autoFocus
                />
                <Button onClick={handleDomainSave} size="sm" className="px-2.5">
                  Save
                </Button>
                <Button
                  onClick={() => setDomainEditing(false)}
                  size="sm"
                  variant="secondary"
                  className="px-2.5 text-[var(--brand-text)]"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <span className="t-caption text-[var(--brand-text-bright)] font-mono">{currentDomain || <span className="text-[var(--brand-text-muted)] italic">Not set</span>}</span>
                <Button
                  onClick={() => { setDomainDraft(currentDomain.replace(/^https?:\/\//, '')); setDomainEditing(true); }}
                  variant="link"
                  size="sm"
                  className="no-underline text-teal-400 hover:text-teal-300"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Google Auth */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-blue-500/10 flex items-center justify-center">
            <Icon as={Search} size="md" className="text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Google Account</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Search Console & Analytics access</p>
          </div>
          {googleStatus?.connected ? (
            <div className="flex items-center gap-2">
              <Badge label="Connected" tone="emerald" variant="soft" shape="pill" size="md" />
              <IconButton
                onClick={disconnectGoogle}
                icon={LogOut}
                label="Disconnect Google"
                title="Disconnect"
                size="md"
              />
            </div>
          ) : googleStatus?.configured ? (
            <Button onClick={connectGoogle} icon={LogIn} size="md" className="px-3">
              Connect
            </Button>
          ) : (
            <Badge label="Not configured" tone="amber" variant="soft" shape="pill" size="md" />
          )}
        </div>
      </SectionCard>

      {/* Integration Health Center */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-blue-500/10 flex items-center justify-center">
            <Icon as={Server} size="md" className="text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Integration Health Center</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Operational status for critical platform integrations</p>
          </div>
          {integrationHealth && (
            <div className="flex items-center gap-1.5">
              <Badge label={`${integrationHealth.summary.healthy} healthy`} tone="emerald" variant="soft" shape="pill" size="md" />
              <Badge label={`${integrationHealth.summary.degraded} degraded`} tone="amber" variant="soft" shape="pill" size="md" />
              <Badge label={`${integrationHealth.summary.missing} missing`} tone="red" variant="soft" shape="pill" size="md" />
            </div>
          )}
        </div>

        {integrationHealthQuery.isLoading && (
          <div className="px-5 py-4 flex items-center gap-2 text-[var(--brand-text-muted)]">
            <Icon as={Loader2} size="md" className="animate-spin" />
            <span className="t-caption">Checking integration health...</span>
          </div>
        )}

        {integrationHealthQuery.isError && (
          <div className="px-5 py-4 flex items-center gap-2 text-red-400">
            <Icon as={AlertTriangle} size="md" />
            <span className="t-caption">Unable to load integration health right now.</span>
          </div>
        )}

        {integrationHealth && (
          <div className="divide-y divide-[var(--brand-border)]">
            {integrationHealth.integrations.map(item => (
              <div key={item.key} className="px-5 py-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-caption font-semibold text-[var(--brand-text-bright)]">{item.label}</span>
                  <Badge label={item.state} tone={stateBadgeTone(item)} variant="soft" shape="pill" size="md" />
                  <Badge label={`quota ${item.quotaStatus}`} tone={quotaBadgeTone(item)} variant="soft" shape="pill" size="md" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                    <Icon as={Check} size="xs" className="text-[var(--brand-text-muted)]" />
                    Last success: <span className="text-[var(--brand-text)]">{formatDate(item.lastSuccessAt)}</span>
                  </p>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                    <Icon as={Clock3} size="xs" className="text-[var(--brand-text-muted)]" />
                    Token expiry: <span className="text-[var(--brand-text)]">{formatDate(item.tokenExpiresAt)}</span>
                  </p>
                </div>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">Features: <span className="text-[var(--brand-text)]">{item.affectedFeatures.join(', ')}</span></p>
                {item.quotaDetail && (
                  <p className="t-caption-sm text-blue-400 bg-blue-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] inline-flex">{item.quotaDetail}</p>
                )}
                {item.key === 'gsc' && googleStatus?.connected && gscSites.length > 0 && (
                  <div className="pt-1 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] sm:min-w-[120px]">Selected property</span>
                    {loadingGoogle ? (
                      <Icon as={Loader2} size="md" className="animate-spin text-[var(--brand-text-muted)]" />
                    ) : (
                      <SearchableSelect
                        options={gscSites.map(s => ({ value: s.siteUrl, label: s.siteUrl }))}
                        value={ws?.gscPropertyUrl || ''}
                        onChange={saveGscProperty}
                        placeholder="Search properties..."
                        emptyLabel="--- None ---"
                        className="min-w-[220px]"
                        size="md"
                      />
                    )}
                  </div>
                )}
                {item.key === 'ga4' && googleStatus?.connected && ga4Properties.length > 0 && (
                  <div className="pt-1 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] sm:min-w-[120px]">Selected property</span>
                    {loadingGoogle ? (
                      <Icon as={Loader2} size="md" className="animate-spin text-[var(--brand-text-muted)]" />
                    ) : (
                      <SearchableSelect
                        options={ga4Properties.map(p => ({ value: p.propertyId, label: p.displayName }))}
                        value={ws?.ga4PropertyId || ''}
                        onChange={saveGa4Property}
                        placeholder="Search properties..."
                        emptyLabel="--- None ---"
                        className="min-w-[220px]"
                        size="md"
                      />
                    )}
                  </div>
                )}
                {item.lastError && (
                  <p className="t-caption-sm text-red-400">{item.lastError}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
