import {
  Globe, Search, BarChart3, Loader2, Check, Unplug, LogIn, LogOut,
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
}

export function ConnectionsTab({
  webflowSiteId, webflowSiteName, googleStatus, gscSites, ga4Properties,
  loadingGoogle, ws, connectGoogle, disconnectGoogle, saveGscProperty, saveGa4Property,
}: ConnectionsTabProps) {
  return (
    <div className="space-y-5">
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
