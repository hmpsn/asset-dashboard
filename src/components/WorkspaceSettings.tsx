import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { ConnectionsTab } from './settings/ConnectionsTab';
import { FeaturesTab } from './settings/FeaturesTab';
import { ClientDashboardTab } from './settings/ClientDashboardTab';
import { get, patch, post } from '../api/client';

interface GscSite { siteUrl: string; permissionLevel: string; }
interface GA4Property { name: string; displayName: string; propertyId: string; }
interface WorkspaceData {
  id: string; name: string;
  webflowSiteId?: string; webflowSiteName?: string;
  gscPropertyUrl?: string; ga4PropertyId?: string;
  hasPassword?: boolean;
  clientEmail?: string;
  eventConfig?: { eventName: string; displayName: string; pinned: boolean; group?: string }[];
  eventGroups?: { id: string; name: string; order: number; color: string; defaultPageFilter?: string; allowedPages?: string[] }[];
  clientPortalEnabled?: boolean;
  seoClientView?: boolean;
  analyticsClientView?: boolean;
  autoReports?: boolean;
  autoReportFrequency?: 'weekly' | 'monthly';
  brandLogoUrl?: string;
  brandAccentColor?: string;
  knowledgeBase?: string;
  personas?: { id: string; name: string; description: string; painPoints: string[]; goals: string[]; objections: string[]; preferredContentFormat?: string; buyingStage?: 'awareness' | 'consideration' | 'decision' }[];
  contentPricing?: { briefPrice: number; fullPostPrice: number; currency: string; briefLabel?: string; fullPostLabel?: string; briefDescription?: string; fullPostDescription?: string } | null;
  tier?: 'free' | 'growth' | 'premium';
  trialEndsAt?: string;
  onboardingEnabled?: boolean;
  onboardingCompleted?: boolean;
}

interface Props {
  workspaceId: string;
  workspaceName: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  onUpdate?: (patch: Record<string, unknown>) => void;
}

type SectionTab = 'connections' | 'features' | 'dashboard';

export function WorkspaceSettings({ workspaceId, workspaceName, webflowSiteId, webflowSiteName, onUpdate }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<SectionTab>('connections');
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  useEffect(() => {
    get<WorkspaceData>(`/api/workspaces/${workspaceId}`).then(d => { setWs(d); }).catch(() => {});
    get<{ connected: boolean; configured: boolean }>('/api/google/status').then(s => {
      setGoogleStatus(s);
      if (s.connected) {
        setLoadingGoogle(true);
        Promise.all([
          get<GscSite[]>('/api/google/gsc-sites').then(d => { if (Array.isArray(d)) setGscSites(d); }).catch(() => {}),
          get<GA4Property[]>('/api/google/ga4-properties').then(d => { if (Array.isArray(d)) setGa4Properties(d); }).catch(() => {}),
        ]).finally(() => setLoadingGoogle(false));
      }
    }).catch(() => {});
  }, [workspaceId]);

  const patchWorkspace = async (fields: Record<string, unknown>) => {
    const updated = await patch<WorkspaceData>(`/api/workspaces/${workspaceId}`, fields);
    setWs(updated);
    onUpdate?.(fields);
    return updated;
  };

  const connectGoogle = async () => {
    const data = await get<{ url?: string }>('/api/google/auth-url');
    if (data.url) window.location.href = data.url;
  };

  const disconnectGoogle = async () => {
    await post('/api/google/disconnect');
    setGoogleStatus({ connected: false, configured: true });
    setGscSites([]); setGa4Properties([]);
  };

  const saveGscProperty = async (gscPropertyUrl: string) => {
    try { await patchWorkspace({ gscPropertyUrl }); toast('Search Console property saved'); }
    catch { toast('Failed to save', 'error'); }
  };

  const saveGa4Property = async (ga4PropertyId: string) => {
    try { await patchWorkspace({ ga4PropertyId }); toast('GA4 property saved'); }
    catch { toast('Failed to save', 'error'); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">{workspaceName}</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {webflowSiteName ? `Connected to ${webflowSiteName}` : 'No Webflow site linked'}
        </p>
      </div>

      {/* Tab nav */}
      <nav className="flex items-center gap-1 border-b border-zinc-800">
        {([['connections', 'Connections'], ['features', 'Features'], ['dashboard', 'Client Dashboard']] as [SectionTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px"
            style={tab === id ? { borderColor: '#2dd4bf', color: '#2dd4bf' } : { borderColor: 'transparent', color: '#71717a' }}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'connections' && (
        <ConnectionsTab
          webflowSiteId={webflowSiteId}
          webflowSiteName={webflowSiteName}
          googleStatus={googleStatus}
          gscSites={gscSites}
          ga4Properties={ga4Properties}
          loadingGoogle={loadingGoogle}
          ws={ws}
          connectGoogle={connectGoogle}
          disconnectGoogle={disconnectGoogle}
          saveGscProperty={saveGscProperty}
          saveGa4Property={saveGa4Property}
        />
      )}

      {tab === 'features' && (
        <FeaturesTab
          workspaceId={workspaceId}
          ws={ws}
          patchWorkspace={patchWorkspace}
          toast={toast}
        />
      )}

      {tab === 'dashboard' && (
        <ClientDashboardTab
          workspaceId={workspaceId}
          webflowSiteId={webflowSiteId}
          ws={ws}
          patchWorkspace={patchWorkspace}
          toast={toast}
        />
      )}
    </div>
  );
}
