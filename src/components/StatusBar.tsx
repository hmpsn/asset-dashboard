import { Icon } from './ui';
import { CheckCircle2, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

interface Props {
  hasOpenAIKey: boolean;
  hasWebflowToken: boolean;
  connected: boolean;
  workspaceCount?: number;
}

export function StatusBar({ hasOpenAIKey, hasWebflowToken, connected, workspaceCount }: Props) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 t-caption border-t border-[var(--brand-border)] bg-[var(--surface-2)] text-[var(--brand-text-muted)]">
      <div className="flex items-center gap-1.5">
        {connected
          ? <Icon as={Wifi} size="sm" className="text-emerald-400" />
          : <Icon as={WifiOff} size="sm" className="text-red-400/80" />
        }
        <span>{connected ? 'Connected' : 'Reconnecting...'}</span>
      </div>

      <div className="flex items-center gap-1.5">
        {hasOpenAIKey
          ? <Icon as={CheckCircle2} size="sm" className="text-emerald-400" />
          : <Icon as={AlertTriangle} size="sm" className="text-amber-400/80" />
        }
        <span>Alt Text {hasOpenAIKey ? 'Active' : 'No API Key'}</span>
      </div>

      <div className="flex items-center gap-1.5">
        {hasWebflowToken
          ? <Icon as={CheckCircle2} size="sm" className="text-emerald-400" />
          : <Icon as={AlertTriangle} size="sm" className="text-amber-400/80" />
        }
        <span>Webflow {hasWebflowToken ? 'Active' : 'No Token'}</span>
      </div>

      {workspaceCount != null && (
        <div className="ml-auto t-caption-sm text-[var(--brand-text-muted)]">
          {workspaceCount} workspace{workspaceCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
