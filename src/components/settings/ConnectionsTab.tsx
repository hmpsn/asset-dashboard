import { useState } from 'react';
import {
  Globe, Search, BarChart3, Loader2, Check, Unplug, LogIn, LogOut, ExternalLink,
} from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import { SectionCard, Icon } from '../ui';

interface GscSite { siteUrl: string; permissionLevel: string; }
interface GA4Property { name: string; displayName: string; propertyId: string; }
interface WorkspaceData {
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  [key: string]: unknown;
}

interface ConnectionsTabProps {
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
  webflowSiteId, webflowSiteName, googleStatus, gscSites, ga4Properties,
  loadingGoogle, ws, connectGoogle, disconnectGoogle, saveGscProperty, saveGa4Property, saveLiveDomain,
}: ConnectionsTabProps) {
  const currentDomain = (ws?.liveDomain as string) || '';
  const [domainDraft, setDomainDraft] = useState('');
  const [domainEditing, setDomainEditing] = useState(false);

  const handleDomainSave = () => {
    const clean = domainDraft.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (clean) saveLiveDomain(clean);
    setDomainEditing(false);
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
            <span className="t-caption-sm font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
              <Icon as={Check} size="xs" /> {webflowSiteName}
            </span>
          ) : (
            <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-2 py-1 rounded-full flex items-center gap-1">
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
                <button onClick={handleDomainSave} className="px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-teal-600 hover:bg-teal-500 text-white t-caption-sm font-medium transition-colors">Save</button>
                <button onClick={() => setDomainEditing(false)} className="px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text)] t-caption-sm font-medium transition-colors">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <span className="t-caption text-[var(--brand-text-bright)] font-mono">{currentDomain || <span className="text-[var(--brand-text-muted)] italic">Not set</span>}</span>
                <button
                  onClick={() => { setDomainDraft(currentDomain.replace(/^https?:\/\//, '')); setDomainEditing(true); }}
                  className="t-caption-sm text-teal-400 hover:text-teal-300 transition-colors"
                >Edit</button>
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
              <span className="t-caption-sm font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Connected</span>
              <button onClick={disconnectGoogle} className="p-1.5 rounded-[var(--radius-lg)] hover:bg-white/5 transition-colors" title="Disconnect">
                <Icon as={LogOut} size="md" className="text-[var(--brand-text-muted)]" />
              </button>
            </div>
          ) : googleStatus?.configured ? (
            <button onClick={connectGoogle} className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-lg)] bg-blue-600 hover:bg-blue-500 text-white t-caption font-medium transition-colors">
              <Icon as={LogIn} size="md" /> Connect
            </button>
          ) : (
            <span className="t-caption-sm text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">Not configured</span>
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
    </div>
  );
}
