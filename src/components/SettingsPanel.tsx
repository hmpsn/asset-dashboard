import { useState, useEffect } from 'react';
import { Settings, Check, Globe, Link2Off, ExternalLink } from 'lucide-react';

interface Workspace {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onTokenSaved: () => void;
}

export function SettingsPanel({ open, onClose }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    if (open) {
      fetch('/api/workspaces')
        .then(r => r.json())
        .then(setWorkspaces)
        .catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  const linked = workspaces.filter(w => w.webflowSiteId);
  const unlinked = workspaces.filter(w => !w.webflowSiteId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border-hover)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
          <Settings className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
          <h2 className="text-base font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Settings</h2>
          <button
            onClick={onClose}
            className="ml-auto text-sm px-2.5 py-1 rounded-md hover:bg-white/5 transition-colors"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            Done
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Webflow Connections */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>Webflow Connections</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                Each workspace has its own API token. To link a site, hover over a workspace in the dropdown and click the{' '}
                <Globe className="w-3 h-3 inline text-zinc-400" /> icon.
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                Generate tokens at{' '}
                <a
                  href="https://webflow.com/dashboard/account/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-1"
                >
                  webflow.com/dashboard <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            {linked.length > 0 && (
              <div className="space-y-1">
                {linked.map(ws => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'var(--brand-bg-surface)' }}
                  >
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{ws.name}</span>
                      <span className="text-xs text-zinc-500 ml-2">{ws.webflowSiteName}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {unlinked.length > 0 && (
              <div className="space-y-1">
                {unlinked.map(ws => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'var(--brand-bg-surface)', opacity: 0.7 }}
                  >
                    <Link2Off className="w-4 h-4 text-zinc-600 shrink-0" />
                    <span className="text-sm text-zinc-500">{ws.name}</span>
                    <span className="text-xs text-zinc-600 ml-auto">Not linked</span>
                  </div>
                ))}
              </div>
            )}

            {workspaces.length === 0 && (
              <p className="text-sm text-zinc-500 px-3 py-2">
                No workspaces yet. Create one from the workspace dropdown.
              </p>
            )}
          </div>

          {/* OpenAI API Key status */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>OpenAI API Key</h3>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--brand-bg-surface)' }}>
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-zinc-300">Configured (via .env)</span>
            </div>
            <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Used for AI-generated alt text (GPT-4o mini).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
