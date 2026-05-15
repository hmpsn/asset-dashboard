import { useState, useEffect, useRef } from 'react';
import {
  BarChart3, Mail, Image as ImageIcon, Sparkles,
  Users, Shield, SlidersHorizontal, Brain, CreditCard,
} from 'lucide-react';
import { post } from '../../api/client';
import { SectionCard, Icon, Button } from '../ui';
import { useDeepLinkFocus } from '../../hooks/useDeepLinkFocus';

interface WorkspaceData {
  tier?: 'free' | 'growth' | 'premium';
  trialEndsAt?: string;
  clientPortalEnabled?: boolean;
  billingMode?: 'platform' | 'external';
  seoClientView?: boolean;
  analyticsClientView?: boolean;
  siteIntelligenceClientView?: boolean;
  onboardingEnabled?: boolean;
  onboardingCompleted?: boolean;
  autoReports?: boolean;
  autoReportFrequency?: 'weekly' | 'monthly';
  brandLogoUrl?: string;
  brandAccentColor?: string;
  clientEmail?: string;
  siteHasSearch?: boolean;
  [key: string]: unknown;
}

interface FeaturesTabProps {
  workspaceId: string;
  ws: WorkspaceData | null;
  patchWorkspace: (patch: Record<string, unknown>) => Promise<unknown>;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function FeaturesTab({ workspaceId, ws, patchWorkspace, toast }: FeaturesTabProps) {
  const [sendingReport, setSendingReport] = useState(false);
  // Controlled mirrors of branding inputs — sync from ws so deep-links that
  // render this tab before ws loads still show the persisted values once they
  // arrive. (Devin Review ANALYSIS-0005 round 3 on PR #379.)
  const [logoUrlDraft, setLogoUrlDraft] = useState<string>(ws?.brandLogoUrl ?? '');
  const [accentColorDraft, setAccentColorDraft] = useState<string>(ws?.brandAccentColor ?? '#2dd4bf');
  // Track values WE've submitted so the resync effect doesn't overwrite the
  // user's draft with a stale server response from an in-flight patch.
  // (Devin Review BUG-0001 round 5 on PR #379 — color picker drag flicker.)
  const lastSubmittedLogoRef = useRef<string | null>(null);
  const lastSubmittedColorRef = useRef<string | null>(null);
  // Debounce timer for accent color — color pickers fire onChange continuously
  // during drag; debouncing collapses N patches into 1 final patch when the
  // user stops dragging.
  const accentColorPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const wsLogo = ws?.brandLogoUrl ?? '';
    if (wsLogo !== lastSubmittedLogoRef.current) setLogoUrlDraft(wsLogo);
    const wsColor = ws?.brandAccentColor ?? '#2dd4bf';
    if (wsColor !== lastSubmittedColorRef.current) setAccentColorDraft(wsColor);
  }, [ws?.brandLogoUrl, ws?.brandAccentColor]);
  // Cleanup pending debounce on unmount.
  useEffect(() => () => {
    if (accentColorPatchTimerRef.current) clearTimeout(accentColorPatchTimerRef.current);
  }, []);
  useDeepLinkFocus();

  return (
    <div className="space-y-8">
      {/* Workspace Tier */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-amber-500/10 flex items-center justify-center">
            <Icon as={Sparkles} size="md" className="text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Workspace Tier</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Controls which features the client can access</p>
          </div>
          <span className={`t-caption-sm font-semibold uppercase tracking-wider px-2.5 py-1 rounded-[var(--radius-pill)] border ${
            (ws?.tier || 'free') === 'premium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : (ws?.tier || 'free') === 'growth' ? 'text-teal-400 bg-teal-500/10 border-teal-500/20'
              : 'text-[var(--brand-text)] bg-[var(--surface-3)] border-[var(--brand-border)]'
          }`}>
            {ws?.tier || 'free'}
          </span>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            {(['free', 'growth', 'premium'] as const).map(t => (
              <Button
                key={t}
                onClick={async () => {
                  await patchWorkspace({ tier: t });
                  toast(`Tier set to ${t}`);
                }}
                variant="secondary"
                size="sm"
                className={`flex-1 px-3 py-2 rounded-[var(--radius-lg)] t-caption font-medium border transition-all ${
                  (ws?.tier || 'free') === t
                    ? t === 'premium' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : t === 'growth' ? 'bg-teal-500/15 border-teal-500/30 text-teal-300'
                      : 'bg-[var(--brand-border-hover)]/50 border-[var(--brand-border-hover)] text-[var(--brand-text-bright)]'
                    : 'bg-[var(--surface-3)]/30 border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:border-[var(--brand-border-hover)]'
                }`}
              >
                {t === 'premium' && <Icon as={Sparkles} size="xs" className="mr-1" />}
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Free: limited features &amp; chat • Growth: all features, full chat • Premium: priority support, advanced analytics
          </p>
          {ws?.trialEndsAt && (
            <div className="t-caption-sm text-teal-400/80 bg-teal-500/5 border border-teal-500/15 rounded-[var(--radius-lg)] px-3 py-2">
              Trial active — expires {new Date(ws.trialEndsAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Client Portal Toggles */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
            <Icon as={SlidersHorizontal} size="md" className="text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Client Portal Features</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Control what the client can see and access in their dashboard</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Client Portal */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Icon as={Users} size="md" className="text-[var(--brand-text-muted)]" />
              <div>
                <div className="t-caption font-medium text-[var(--brand-text-bright)]">Client Portal</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Master toggle — enable or disable the client dashboard entirely</div>
              </div>
            </div>
            <Button onClick={async () => {
              const val = !(ws?.clientPortalEnabled !== false);
              await patchWorkspace({ clientPortalEnabled: val });
              toast(val ? 'Client portal enabled' : 'Client portal disabled');
            }}
              variant="ghost"
              size="sm"
              className={`relative inline-flex h-5 w-9 items-center rounded-[var(--radius-pill)] transition-colors ${
                ws?.clientPortalEnabled !== false ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
              } px-0 py-0 min-w-0`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-[var(--radius-pill)] bg-white transition-transform ${
                ws?.clientPortalEnabled !== false ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </Button>
          </label>
          {/* External Billing */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Icon as={CreditCard} size="md" className="text-[var(--brand-text-muted)]" />
              <div>
                <div className="t-caption font-medium text-[var(--brand-text-bright)]">External Billing</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Bypass payment for content requests — billed off-platform</div>
              </div>
            </div>
            <Button onClick={async () => {
              const isExternal = ws?.billingMode === 'external';
              const next = isExternal ? 'platform' : 'external';
              await patchWorkspace({ billingMode: next });
              toast(next === 'external' ? 'External billing enabled — payment bypassed' : 'External billing disabled');
            }}
              variant="ghost"
              size="sm"
              className={`relative inline-flex h-5 w-9 items-center rounded-[var(--radius-pill)] transition-colors ${
                ws?.billingMode === 'external' ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
              } px-0 py-0 min-w-0`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-[var(--radius-pill)] bg-white transition-transform ${
                ws?.billingMode === 'external' ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </Button>
          </label>
          {/* SEO Client View */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Icon as={Shield} size="md" className="text-[var(--brand-text-muted)]" />
              <div>
                <div className="t-caption font-medium text-[var(--brand-text-bright)]">SEO Health View</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Show SEO audit scores and detailed findings to the client (paid upgrade)</div>
              </div>
            </div>
            <Button onClick={async () => {
              const val = !ws?.seoClientView;
              await patchWorkspace({ seoClientView: val });
              toast(val ? 'SEO view enabled for client' : 'SEO view hidden from client');
            }}
              variant="ghost"
              size="sm"
              className={`relative inline-flex h-5 w-9 items-center rounded-[var(--radius-pill)] transition-colors ${
                ws?.seoClientView ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
              } px-0 py-0 min-w-0`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-[var(--radius-pill)] bg-white transition-transform ${
                ws?.seoClientView ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </Button>
          </label>
          {/* Analytics Client View */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Icon as={BarChart3} size="md" className="text-[var(--brand-text-muted)]" />
              <div>
                <div className="t-caption font-medium text-[var(--brand-text-bright)]">Analytics View</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Show Google Analytics and Search Console data to the client</div>
              </div>
            </div>
            <Button onClick={async () => {
              const val = !(ws?.analyticsClientView !== false);
              await patchWorkspace({ analyticsClientView: val });
              toast(val ? 'Analytics view enabled for client' : 'Analytics view hidden from client');
            }}
              variant="ghost"
              size="sm"
              className={`relative inline-flex h-5 w-9 items-center rounded-[var(--radius-pill)] transition-colors ${
                ws?.analyticsClientView !== false ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
              } px-0 py-0 min-w-0`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-[var(--radius-pill)] bg-white transition-transform ${
                ws?.analyticsClientView !== false ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </Button>
          </label>
          {/* Site Intelligence Client View */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Icon as={Brain} size="md" className="text-[var(--brand-text-muted)]" />
              <div>
                <div className="t-caption font-medium text-[var(--brand-text-bright)]">Site Intelligence Summary</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Show the AI-powered insights summary card to the client on their Overview tab</div>
              </div>
            </div>
            <Button onClick={async () => {
              const val = !(ws?.siteIntelligenceClientView !== false);
              await patchWorkspace({ siteIntelligenceClientView: val });
              toast(val ? 'Site Intelligence summary enabled for client' : 'Site Intelligence summary hidden from client');
            }}
              variant="ghost"
              size="sm"
              className={`relative inline-flex h-5 w-9 items-center rounded-[var(--radius-pill)] transition-colors ${
                ws?.siteIntelligenceClientView !== false ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
              } px-0 py-0 min-w-0`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-[var(--radius-pill)] bg-white transition-transform ${
                ws?.siteIntelligenceClientView !== false ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </Button>
          </label>
          {/* Client Onboarding Questionnaire */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-3">
              <Icon as={Sparkles} size="md" className="text-[var(--brand-text-muted)]" />
              <div>
                <div className="t-caption font-medium text-[var(--brand-text-bright)]">Client Onboarding Questionnaire</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">
                  Prompt new clients to share business info, audience, and brand voice
                  {ws?.onboardingCompleted && <span className="ml-1 text-teal-400">(completed)</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ws?.onboardingCompleted && (
                <Button onClick={async (e) => {
                  e.stopPropagation();
                  await patchWorkspace({ onboardingCompleted: false });
                  toast('Onboarding reset — client will see the questionnaire again');
                }}
                  variant="secondary"
                  size="sm"
                  className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-3)] border border-[var(--brand-border)] transition-colors">
                  Reset
                </Button>
              )}
              <Button onClick={async () => {
                const val = !ws?.onboardingEnabled;
                await patchWorkspace({ onboardingEnabled: val });
                toast(val ? 'Onboarding questionnaire enabled' : 'Onboarding questionnaire disabled');
              }}
                variant="ghost"
                size="sm"
                className={`relative inline-flex h-5 w-9 items-center rounded-[var(--radius-pill)] transition-colors ${
                  ws?.onboardingEnabled ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
                } px-0 py-0 min-w-0`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-[var(--radius-pill)] bg-white transition-transform ${
                  ws?.onboardingEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </Button>
            </div>
          </label>
        </div>
      </SectionCard>

      {/* Automated Reports */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-blue-500/10 flex items-center justify-center">
            <Icon as={Mail} size="md" className="text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Automated Reports</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Automatically send SEO and performance reports to the client</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-3">
              <Icon as={Mail} size="md" className="text-[var(--brand-text-muted)]" />
              <div>
                <div className="t-caption font-medium text-[var(--brand-text-bright)]">Enable Auto-Reports</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Send scheduled SEO audit reports to the client email{ws?.clientEmail ? ` (${ws.clientEmail})` : ' — set email in Client Dashboard tab'}</div>
              </div>
            </div>
            <Button onClick={async () => {
              const val = !ws?.autoReports;
              await patchWorkspace({ autoReports: val });
              toast(val ? 'Auto-reports enabled' : 'Auto-reports disabled');
            }}
              variant="ghost"
              size="sm"
              className={`relative inline-flex h-5 w-9 items-center rounded-[var(--radius-pill)] transition-colors ${
                ws?.autoReports ? 'bg-teal-500' : 'bg-[var(--brand-border-hover)]'
              } px-0 py-0 min-w-0`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-[var(--radius-pill)] bg-white transition-transform ${
                ws?.autoReports ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </Button>
          </label>
          {ws?.autoReports && (
            <div className="space-y-3 pl-7">
              <div className="flex items-center gap-3">
                <span className="t-caption text-[var(--brand-text-muted)]">Frequency:</span>
                {(['monthly', 'weekly'] as const).map(freq => (
                  <Button key={freq} onClick={async () => {
                    await patchWorkspace({ autoReportFrequency: freq });
                    toast(`Report frequency set to ${freq}`);
                  }}
                    variant="secondary"
                    size="sm"
                    className={`px-3 py-1.5 rounded-[var(--radius-lg)] t-caption font-medium transition-colors ${
                      (ws?.autoReportFrequency || 'monthly') === freq
                        ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                        : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] hover:text-[var(--brand-text)]'
                    }`}>
                    {freq.charAt(0).toUpperCase() + freq.slice(1)}
                  </Button>
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption font-medium bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors"
              >
                <Icon as={Mail} size="xs" /> Send Report Now
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Branding */}
      <SectionCard noPadding>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
            <Icon as={ImageIcon} size="md" className="text-teal-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">White-Label Branding</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Customize the client dashboard and reports appearance</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="t-caption-sm font-medium mb-1.5 text-[var(--brand-text-muted)]">Logo URL</div>
            <div className="flex items-center gap-2">
              <input type="url" value={logoUrlDraft}
                data-schema-deeplink="brandLogoUrl"
                placeholder="https://example.com/logo.svg"
                onChange={e => setLogoUrlDraft(e.target.value)}
                onBlur={async (e) => {
                  const val = e.target.value.trim();
                  if (val !== (ws?.brandLogoUrl || '')) {
                    lastSubmittedLogoRef.current = val;
                    await patchWorkspace({ brandLogoUrl: val });
                    toast('Logo URL saved');
                  }
                }}
                className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500" />
              {ws?.brandLogoUrl && <img src={ws.brandLogoUrl} alt="" className="h-6 rounded-[var(--radius-sm)]" />}
            </div>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
              Also used as publisher logo in your schema. Required for Article rich snippets in Google search results.
            </p>
          </div>
          <div>
            <div className="t-caption-sm font-medium mb-1.5 text-[var(--brand-text-muted)]">Accent Color</div>
            <div className="flex items-center gap-2">
              <input type="color" value={accentColorDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setAccentColorDraft(val);
                  // Debounce the patch — color pickers fire onChange continuously
                  // during drag. We collapse N patches into 1 fired 250ms after
                  // the user stops dragging. Combined with lastSubmittedColorRef
                  // this also prevents the stale-response → draft-overwrite flicker.
                  if (accentColorPatchTimerRef.current) clearTimeout(accentColorPatchTimerRef.current);
                  accentColorPatchTimerRef.current = setTimeout(() => {
                    lastSubmittedColorRef.current = val;
                    void patchWorkspace({ brandAccentColor: val });
                  }, 250);
                }}
                className="w-8 h-8 rounded-[var(--radius-lg)] border border-[var(--brand-border)] cursor-pointer bg-transparent" />
              <code className="t-caption text-[var(--brand-text)]">{accentColorDraft}</code>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">Used in reports and the client portal header</span>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Site Capabilities */}
      <SectionCard title="Site capabilities">
        <div className="space-y-3">
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Tell schema what your live site supports.</p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              data-schema-deeplink="siteHasSearch"
              // Controlled — reads current ws state on every render so the box
              // reflects the loaded value even if FeaturesTab mounts before ws
              // resolves (e.g. via deep-link). (Devin Review BUG-0002 round 3.)
              checked={!!ws?.siteHasSearch}
              onChange={async (e) => {
                // Capture sync value before await — currentTarget access after
                // await is implementation-defined in React's synthetic event lifecycle.
                const nextChecked = e.currentTarget.checked;
                try {
                  await patchWorkspace({ siteHasSearch: nextChecked });
                  toast(nextChecked ? 'SearchAction will emit on next regenerate' : 'SearchAction emission disabled');
                } catch (err) {
                  toast('Failed to update — please try again');
                  // No manual revert needed — controlled component re-reads ws on next render.
                  throw err;
                }
              }}
              className="mt-0.5"
            />
            <span>
              <span className="t-body font-medium text-[var(--brand-text)]">My site has a working search endpoint</span>
              <span className="block t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                When enabled, schema generation emits <code className="t-mono text-[var(--brand-text)]">WebSite.potentialAction</code> (sitelinks SearchAction) so Google can offer in-SERP search. Your site must actually expose <code className="t-mono">https://yoursite.com/?s=&#123;query&#125;</code> or equivalent — verify this works before enabling.
              </span>
            </span>
          </label>
        </div>
      </SectionCard>

    </div>
  );
}
