import { CheckCircle2, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

interface Props {
  hasOpenAIKey: boolean;
  hasWebflowToken: boolean;
  connected: boolean;
  workspaceCount?: number;
}

export function StatusBar({ hasOpenAIKey, hasWebflowToken, connected, workspaceCount }: Props) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 text-xs" style={{ borderTop: '1px solid var(--brand-border)', backgroundColor: 'var(--brand-bg-surface)', color: 'var(--brand-text)' }}>
      <div className="flex items-center gap-1.5">
        {connected
          ? <Wifi className="w-3 h-3 text-emerald-400" />
          : <WifiOff className="w-3 h-3 text-red-400" />
        }
        <span>{connected ? 'Connected' : 'Reconnecting...'}</span>
      </div>

      <div className="flex items-center gap-1.5">
        {hasOpenAIKey
          ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          : <AlertTriangle className="w-3 h-3 text-amber-400" />
        }
        <span>Alt Text {hasOpenAIKey ? 'Active' : 'No API Key'}</span>
      </div>

      <div className="flex items-center gap-1.5">
        {hasWebflowToken
          ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          : <AlertTriangle className="w-3 h-3 text-amber-400" />
        }
        <span>Webflow {hasWebflowToken ? 'Active' : 'No Token'}</span>
      </div>

      {workspaceCount != null && (
        <div className="ml-auto text-zinc-500 text-[11px]">
          {workspaceCount} workspace{workspaceCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
