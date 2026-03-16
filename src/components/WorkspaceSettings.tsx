import { useState, useEffect } from 'react';
import { Download, Pencil, Check, X } from 'lucide-react';
import { useToast } from './Toast';
import { ConnectionsTab } from './settings/ConnectionsTab';
import { FeaturesTab } from './settings/FeaturesTab';
import { ClientDashboardTab } from './settings/ClientDashboardTab';
import { PublishSettings } from './PublishSettings';
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
  publishTarget?: { collectionId: string; collectionName: string; fieldMap: Record<string, string | undefined> } | null;
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

type SectionTab = 'connections' | 'features' | 'dashboard' | 'publishing' | 'export';

export function WorkspaceSettings({ workspaceId, workspaceName, webflowSiteId, webflowSiteName, onUpdate }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<SectionTab>('connections');
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(workspaceName);
  const [savingName, setSavingName] = useState(false);

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
      {/* Header with editable name */}
      <div>
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  (async () => {
                    if (!nameDraft.trim() || nameDraft === workspaceName) { setEditingName(false); return; }
                    setSavingName(true);
                    try {
                      await patchWorkspace({ name: nameDraft.trim() });
                      toast('Workspace name updated');
                      setEditingName(false);
                    } catch { toast('Failed to rename', 'error'); }
                    setSavingName(false);
                  })();
                }
                if (e.key === 'Escape') { setNameDraft(workspaceName); setEditingName(false); }
              }}
              className="text-lg font-semibold text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 focus:outline-none focus:border-teal-500"
            />
            <button
              disabled={savingName || !nameDraft.trim()}
              onClick={async () => {
                if (!nameDraft.trim() || nameDraft === workspaceName) { setEditingName(false); return; }
                setSavingName(true);
                try {
                  await patchWorkspace({ name: nameDraft.trim() });
                  toast('Workspace name updated');
                  setEditingName(false);
                } catch { toast('Failed to rename', 'error'); }
                setSavingName(false);
              }}
              className="p-1 rounded hover:bg-teal-600/20 text-teal-400 transition-colors"
            >
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => { setNameDraft(workspaceName); setEditingName(false); }} className="p-1 rounded hover:bg-zinc-700 text-zinc-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <h2 className="text-lg font-semibold text-zinc-200">{workspaceName}</h2>
            <button onClick={() => { setNameDraft(workspaceName); setEditingName(true); }} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 opacity-0 group-hover:opacity-100 transition-all" title="Rename workspace">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <p className="text-xs text-zinc-500 mt-0.5">
          {webflowSiteName ? `Connected to ${webflowSiteName}` : 'No Webflow site linked'}
        </p>
      </div>

      {/* Tab nav */}
      <nav className="flex items-center gap-1 border-b border-zinc-800">
        {([['connections', 'Connections'], ['features', 'Features'], ['publishing', 'Publishing'], ['dashboard', 'Client Dashboard'], ['export', 'Data Export']] as [SectionTab, string][]).map(([id, label]) => (
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
          saveLiveDomain={async (domain: string) => {
            try { await patchWorkspace({ liveDomain: domain }); toast('Live domain saved'); }
            catch { toast('Failed to save', 'error'); }
          }}
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

      {tab === 'publishing' && (
        <PublishSettings
          workspaceId={workspaceId}
          webflowSiteId={webflowSiteId}
          publishTarget={ws?.publishTarget as Parameters<typeof PublishSettings>[0]['publishTarget']}
          onSave={async (target) => { await patchWorkspace({ publishTarget: target }); }}
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

      {tab === 'export' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">Data Export</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Download workspace data as CSV or JSON files.</p>
          </div>
          {[
            { key: 'briefs', label: 'Content Briefs', desc: 'All generated content briefs with keywords, titles, and metrics' },
            { key: 'requests', label: 'Content Requests', desc: 'Topic requests with status, priority, and service type' },
            { key: 'strategy', label: 'Keyword Strategy', desc: 'Page-keyword map with primary and secondary keywords' },
            { key: 'activity', label: 'Activity Log', desc: 'Recent workspace activity (up to 500 entries)' },
            { key: 'payments', label: 'Payments', desc: 'Payment records with amounts, status, and dates' },
          ].map(item => (
            <div key={item.key} className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-zinc-200">{item.label}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{item.desc}</div>
              </div>
              <div className="flex items-center gap-2">
                <a href={`/api/export/${workspaceId}/${item.key}?format=csv`} download className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
                  <Download className="w-3 h-3" /> CSV
                </a>
                <a href={`/api/export/${workspaceId}/${item.key}?format=json`} download className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors">
                  <Download className="w-3 h-3" /> JSON
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
