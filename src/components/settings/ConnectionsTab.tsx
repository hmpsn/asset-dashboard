import { useState } from 'react';
import {
  Globe, Search, BarChart3, Loader2, Check, Unplug, LogIn, LogOut, ExternalLink, Server, AlertTriangle, Clock3,
} from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import { SectionCard, Icon, Button, IconButton } from '../ui';
import { useIntegrationHealth } from '../../hooks/admin/useIntegrationHealth';
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
}

export function ConnectionsTab({
  workspaceId, webflowSiteId, webflowSiteName, googleStatus, gscSites, ga4Properties,
  loadingGoogle, ws, connectGoogle, disconnectGoogle, saveGscProperty, saveGa4Property, saveLiveDomain,
}: ConnectionsTabProps) {
  const currentDomain = (ws?.liveDomain as string) || '';
  const [domainDraft, setDomainDraft] = useState('');
  const [domainEditing, setDomainEditing] = useState(false);
  const integrationHealthQuery = useIntegrationHealth(workspaceId);
  const integrationHealth = integrationHealthQuery.data;

  const handleDomainSave = () => {
    const clean = domainDraft.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (clean) saveLiveDomain(clean);
    setDomainEditing(false);
  };

  const stateBadgeClass = (item: IntegrationHealthItem) => {
    if (item.state === 'configured') return 'bg-emerald-500/10 text-emerald-400';
    if (item.state === 'degraded') return 'bg-amber-500/10 text-amber-400';
    return 'bg-red-500/10 text-red-400';
  };

  const quotaBadgeClass = (item: IntegrationHealthItem) => {
    if (item.quotaStatus === 'ok') return 'bg-emerald-500/10 text-emerald-400';
    if (item.quotaStatus === 'warning') return 'bg-amber-500/10 text-amber-400';
    if (item.quotaStatus === 'critical') return 'bg-red-500/10 text-red-400';
    return 'bg-blue-500/10 text-blue-400';
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
            <p className="t-caption text-[var(--brand-text-muted)]">Linked via workspace dropdown</p>
          </div>
          {webflowSiteId ? (
            <span className="t-caption-sm font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-[var(--radius-pill)] flex items-center gap-1">
              <Icon as={Check} size="xs" /> {webflowSiteName}
            </span>
          ) : (
            <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-2 py-1 rounded-[var(--radius-pill)] flex items-center gap-1">
              <Icon as={Unplug} size="xs" /> Not linked
            </span>
          )}
        </div>
        {webflowSiteId && (
          <div className="px-5 py-3 flex items-center gap-3">
            <Icon as={ExternalLink} size="md" className="text-[var(--brand-text-muted)]" />
            <span className="t-caption font-medium text-[var(--brand-text)] whitespace-nowrap">Live Domain</span>
            {domainEditing ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={domainDraft}
                  onChange={e => setDomainDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleDomainSave()}
                  placeholder="www.example.com"
                  className="flex-1 px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
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
              <span className="t-caption-sm font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-[var(--radius-pill)]">Connected</span>
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
            <span className="t-caption-sm text-amber-400 bg-amber-500/10 px-2 py-1 rounded-[var(--radius-pill)]">Not configured</span>
          )}
        </div>
      </SectionCard>

      {/* GSC Property */}
      {googleStatus?.connected && gscSites.length > 0 && (
        <SectionCard noPadding>
          <div className="px-5 py-4 flex items-center gap-3">
            <Icon as={Search} size="md" className="text-blue-400" />
            <span className="text-sm font-medium flex-1 text-[var(--brand-text-bright)]">Search Console Property</span>
            {loadingGoogle ? <Icon as={Loader2} size="md" className="animate-spin text-[var(--brand-text-muted)]" /> : (
              <SearchableSelect
                options={gscSites.map(s => ({ value: s.siteUrl, label: s.siteUrl }))}
                value={ws?.gscPropertyUrl || ''}
                onChange={saveGscProperty}
                placeholder="Search properties..."
                emptyLabel="— None —"
                className="min-w-[200px]"
                size="md"
              />
            )}
          </div>
        </SectionCard>
      )}

      {/* GA4 Property */}
      {googleStatus?.connected && ga4Properties.length > 0 && (
        <SectionCard noPadding>
          <div className="px-5 py-4 flex items-center gap-3">
            <Icon as={BarChart3} size="md" className="text-teal-400" />
            <span className="text-sm font-medium flex-1 text-[var(--brand-text-bright)]">GA4 Property</span>
            {loadingGoogle ? <Icon as={Loader2} size="md" className="animate-spin text-[var(--brand-text-muted)]" /> : (
              <SearchableSelect
                options={ga4Properties.map(p => ({ value: p.propertyId, label: p.displayName }))}
                value={ws?.ga4PropertyId || ''}
                onChange={saveGa4Property}
                placeholder="Search properties..."
                emptyLabel="— None —"
                className="min-w-[220px]"
                size="md"
              />
            )}
          </div>
        </SectionCard>
      )}

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
              <span className="t-caption-sm px-2 py-1 rounded-[var(--radius-pill)] bg-emerald-500/10 text-emerald-400">{integrationHealth.summary.healthy} healthy</span>
              <span className="t-caption-sm px-2 py-1 rounded-[var(--radius-pill)] bg-amber-500/10 text-amber-400">{integrationHealth.summary.degraded} degraded</span>
              <span className="t-caption-sm px-2 py-1 rounded-[var(--radius-pill)] bg-red-500/10 text-red-400">{integrationHealth.summary.missing} missing</span>
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
                  <span className={`t-caption-sm px-2 py-1 rounded-[var(--radius-pill)] ${stateBadgeClass(item)}`}>{item.state}</span>
                  <span className={`t-caption-sm px-2 py-1 rounded-[var(--radius-pill)] ${quotaBadgeClass(item)}`}>quota {item.quotaStatus}</span>
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
