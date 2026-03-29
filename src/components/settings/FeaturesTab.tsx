import { useState } from 'react';
import {
  BarChart3, Loader2, Mail, Image as ImageIcon, DollarSign, Sparkles,
  Users, Shield, SlidersHorizontal,
} from 'lucide-react';
import { post } from '../../api/client';

interface WorkspaceData {
  tier?: 'free' | 'growth' | 'premium';
  trialEndsAt?: string;
  clientPortalEnabled?: boolean;
  seoClientView?: boolean;
  analyticsClientView?: boolean;
  onboardingEnabled?: boolean;
  onboardingCompleted?: boolean;
  autoReports?: boolean;
  autoReportFrequency?: 'weekly' | 'monthly';
  brandLogoUrl?: string;
  brandAccentColor?: string;
  clientEmail?: string;
  [key: string]: unknown;
}

interface FeaturesTabProps {
  workspaceId: string;
  ws: WorkspaceData | null;
  patchWorkspace: (patch: Record<string, unknown>) => Promise<unknown>;
  toast: (msg: string, type?: string) => void;
}

export function FeaturesTab({ workspaceId, ws, patchWorkspace, toast }: FeaturesTabProps) {
  const [sendingReport, setSendingReport] = useState(false);

  return (
    <div className="space-y-8">
      {/* Workspace Tier */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Workspace Tier</h3>
            <p className="text-xs text-zinc-500">Controls which features the client can access</p>
          </div>
          <span className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
            (ws?.tier || 'free') === 'premium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : (ws?.tier || 'free') === 'growth' ? 'text-teal-400 bg-teal-500/10 border-teal-500/20'
              : 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20'
          }`}>
            {ws?.tier || 'free'}
          </span>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            {(['free', 'growth', 'premium'] as const).map(t => (
              <button
                key={t}
                onClick={async () => {
                  await patchWorkspace({ tier: t });
                  toast(`Tier set to ${t}`);
                }}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                  (ws?.tier || 'free') === t
                    ? t === 'premium' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : t === 'growth' ? 'bg-teal-500/15 border-teal-500/30 text-teal-300'
                      : 'bg-zinc-700/50 border-zinc-600 text-zinc-200'
                    : 'bg-zinc-800/30 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                }`}
              >
                {t === 'premium' && <Sparkles className="w-3 h-3 inline mr-1" />}
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600">
            Free: limited features &amp; chat • Growth: all features, full chat • Premium: priority support, advanced analytics
          </p>
          {ws?.trialEndsAt && (
            <div className="text-[11px] text-teal-400/80 bg-teal-500/5 border border-teal-500/15 rounded-lg px-3 py-2">
              Trial active — expires {new Date(ws.trialEndsAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </section>

      {/* Client Portal Toggles */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <SlidersHorizontal className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Client Portal Features</h3>
            <p className="text-xs text-zinc-500">Control what the client can see and access in their dashboard</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Client Portal */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Users className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-xs font-medium text-zinc-200">Client Portal</div>
                <div className="text-[11px] text-zinc-500">Master toggle — enable or disable the client dashboard entirely</div>
              </div>
            </div>
            <button onClick={async () => {
              const val = !(ws?.clientPortalEnabled !== false);
              await patchWorkspace({ clientPortalEnabled: val });
              toast(val ? 'Client portal enabled' : 'Client portal disabled');
            }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                ws?.clientPortalEnabled !== false ? 'bg-teal-500' : 'bg-zinc-700'
              }`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                ws?.clientPortalEnabled !== false ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </label>
          {/* SEO Client View */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-xs font-medium text-zinc-200">SEO Health View</div>
                <div className="text-[11px] text-zinc-500">Show SEO audit scores and detailed findings to the client (paid upgrade)</div>
              </div>
            </div>
            <button onClick={async () => {
              const val = !ws?.seoClientView;
              await patchWorkspace({ seoClientView: val });
              toast(val ? 'SEO view enabled for client' : 'SEO view hidden from client');
            }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                ws?.seoClientView ? 'bg-teal-500' : 'bg-zinc-700'
              }`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                ws?.seoClientView ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </label>
          {/* Analytics Client View */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-xs font-medium text-zinc-200">Analytics View</div>
                <div className="text-[11px] text-zinc-500">Show Google Analytics and Search Console data to the client</div>
              </div>
            </div>
            <button onClick={async () => {
              const val = !(ws?.analyticsClientView !== false);
              await patchWorkspace({ analyticsClientView: val });
              toast(val ? 'Analytics view enabled for client' : 'Analytics view hidden from client');
            }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                ws?.analyticsClientView !== false ? 'bg-teal-500' : 'bg-zinc-700'
              }`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                ws?.analyticsClientView !== false ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </label>
          {/* Client Onboarding Questionnaire */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Sparkles className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-xs font-medium text-zinc-200">Client Onboarding Questionnaire</div>
                <div className="text-[11px] text-zinc-500">
                  Prompt new clients to share business info, audience, and brand voice
                  {ws?.onboardingCompleted && <span className="ml-1 text-teal-400">(completed)</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ws?.onboardingCompleted && (
                <button onClick={async (e) => {
                  e.stopPropagation();
                  await patchWorkspace({ onboardingCompleted: false });
                  toast('Onboarding reset — client will see the questionnaire again');
                }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 transition-colors">
                  Reset
                </button>
              )}
              <button onClick={async () => {
                const val = !ws?.onboardingEnabled;
                await patchWorkspace({ onboardingEnabled: val });
                toast(val ? 'Onboarding questionnaire enabled' : 'Onboarding questionnaire disabled');
              }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  ws?.onboardingEnabled ? 'bg-teal-500' : 'bg-zinc-700'
                }`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  ws?.onboardingEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </label>
        </div>
      </section>

      {/* Automated Reports */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Automated Reports</h3>
            <p className="text-xs text-zinc-500">Automatically send SEO and performance reports to the client</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-3">
              <Mail className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-xs font-medium text-zinc-200">Enable Auto-Reports</div>
                <div className="text-[11px] text-zinc-500">Send scheduled SEO audit reports to the client email{ws?.clientEmail ? ` (${ws.clientEmail})` : ' — set email in Client Dashboard tab'}</div>
              </div>
            </div>
            <button onClick={async () => {
              const val = !ws?.autoReports;
              await patchWorkspace({ autoReports: val });
              toast(val ? 'Auto-reports enabled' : 'Auto-reports disabled');
            }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                ws?.autoReports ? 'bg-teal-500' : 'bg-zinc-700'
              }`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                ws?.autoReports ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </label>
          {ws?.autoReports && (
            <div className="space-y-3 pl-7">
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">Frequency:</span>
                {(['monthly', 'weekly'] as const).map(freq => (
                  <button key={freq} onClick={async () => {
                    await patchWorkspace({ autoReportFrequency: freq });
                    toast(`Report frequency set to ${freq}`);
                  }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      (ws?.autoReportFrequency || 'monthly') === freq
                        ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                        : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                    }`}>
                    {freq.charAt(0).toUpperCase() + freq.slice(1)}
                  </button>
                ))}
              </div>
              <button
                disabled={sendingReport}
                onClick={async () => {
                  setSendingReport(true);
                  toast('Generating report...');
                  try {
                    const data = await post<{ sent?: boolean }>(`/api/monthly-report/${workspaceId}`);
                    toast(data.sent ? 'Report sent to client!' : 'Report generated (no client email configured)');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Report failed');
                  } finally {
                    setSendingReport(false);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors"
              >
                <Mail className="w-3 h-3" /> Send Report Now
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Branding */}
      <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">White-Label Branding</h3>
            <p className="text-xs text-zinc-500">Customize the client dashboard and reports appearance</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Logo URL</div>
            <div className="flex items-center gap-2">
              <input type="url" defaultValue={ws?.brandLogoUrl || ''}
                placeholder="https://example.com/logo.svg"
                onBlur={async (e) => {
                  const val = e.target.value.trim();
                  if (val !== (ws?.brandLogoUrl || '')) {
                    await patchWorkspace({ brandLogoUrl: val });
                    toast('Logo URL saved');
                  }
                }}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
              {ws?.brandLogoUrl && <img src={ws.brandLogoUrl} alt="" className="h-6 rounded" />}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Accent Color</div>
            <div className="flex items-center gap-2">
              <input type="color" defaultValue={ws?.brandAccentColor || '#2dd4bf'}
                onChange={async (e) => {
                  const val = e.target.value;
                  await patchWorkspace({ brandAccentColor: val });
                }}
                className="w-8 h-8 rounded-lg border border-zinc-700 cursor-pointer bg-transparent" />
              <code className="text-xs text-zinc-400">{ws?.brandAccentColor || '#2dd4bf'}</code>
              <span className="text-[11px] text-zinc-500">Used in reports and the client portal header</span>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
