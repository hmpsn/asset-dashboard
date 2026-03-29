import { useState } from 'react';
import {
  Globe, Search, BarChart3, Loader2, Check, Unplug, LogIn, LogOut, ExternalLink,
} from 'lucide-react';
import SearchableSelect from '../SearchableSelect';

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
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <Globe className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Webflow Site</h3>
            <p className="text-xs text-zinc-500">Linked via workspace dropdown</p>
          </div>
          {webflowSiteId ? (
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
              <Check className="w-3 h-3" /> {webflowSiteName}
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full flex items-center gap-1">
              <Unplug className="w-3 h-3" /> Not linked
            </span>
          )}
        </div>
        {webflowSiteId && (
          <div className="px-5 py-3 flex items-center gap-3">
            <ExternalLink className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400 whitespace-nowrap">Live Domain</span>
            {domainEditing ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={domainDraft}
                  onChange={e => setDomainDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleDomainSave()}
                  placeholder="www.example.com"
                  className="flex-1 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                  autoFocus
                />
                <button onClick={handleDomainSave} className="px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-medium transition-colors">Save</button>
                <button onClick={() => setDomainEditing(false)} className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[11px] font-medium transition-colors">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-zinc-300 font-mono">{currentDomain || <span className="text-zinc-500 italic">Not set</span>}</span>
                <button
                  onClick={() => { setDomainDraft(currentDomain.replace(/^https?:\/\//, '')); setDomainEditing(true); }}
                  className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors"
                >Edit</button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Google Auth */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Search className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Google Account</h3>
            <p className="text-xs text-zinc-500">Search Console & Analytics access</p>
          </div>
          {googleStatus?.connected ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Connected</span>
              <button onClick={disconnectGoogle} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="Disconnect">
                <LogOut className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
          ) : googleStatus?.configured ? (
            <button onClick={connectGoogle} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
              <LogIn className="w-3.5 h-3.5" /> Connect
            </button>
          ) : (
            <span className="text-[11px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">Not configured</span>
          )}
        </div>
      </section>

      {/* GSC Property */}
      {googleStatus?.connected && gscSites.length > 0 && (
        <section className="rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="px-5 py-4 flex items-center gap-3">
            <Search className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium flex-1 text-zinc-200">Search Console Property</span>
            {loadingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" /> : (
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
        </section>
      )}

      {/* GA4 Property */}
      {googleStatus?.connected && ga4Properties.length > 0 && (
        <section className="rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="px-5 py-4 flex items-center gap-3">
            <BarChart3 className="w-4 h-4 text-teal-400" />
            <span className="text-sm font-medium flex-1 text-zinc-200">GA4 Property</span>
            {loadingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" /> : (
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
        </section>
      )}
    </div>
  );
}
