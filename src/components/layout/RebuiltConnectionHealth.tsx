// @ds-rebuilt
import type { HealthStatus } from '../../hooks/admin/useHealthCheck';
import { Icon } from '../ui';

export interface RebuiltConnectionHealthState extends HealthStatus {
  connected: boolean;
  workspaceCount: number;
}

interface HealthItemProps {
  icon: 'globe' | 'sparkle' | 'link';
  label: string;
  value: string;
  healthy: boolean;
}

function HealthItem({ icon, label, value, healthy }: HealthItemProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <Icon
        name={icon}
        size="sm"
        style={{ color: healthy ? 'var(--emerald)' : 'var(--amber)' }}
      />
      <span className="t-caption-sm" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </span>
      <span className="t-caption-sm" style={{ color: healthy ? 'var(--brand-text)' : 'var(--amber)' }}>
        {value}
      </span>
    </span>
  );
}

export function RebuiltConnectionHealth({
  connected,
  hasOpenAIKey,
  hasWebflowToken,
  workspaceCount,
}: RebuiltConnectionHealthState) {
  return (
    <section
      aria-label="Connection health"
      className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-1.5"
      style={{
        borderTop: '1px solid var(--brand-border)',
        background: 'var(--surface-2)',
      }}
    >
      <HealthItem icon="globe" label="HTTP" value={connected ? 'Connected' : 'Reconnecting'} healthy={connected} />
      <HealthItem icon="sparkle" label="OpenAI" value={hasOpenAIKey ? 'Active' : 'No API key'} healthy={hasOpenAIKey} />
      <HealthItem icon="link" label="Webflow" value={hasWebflowToken ? 'Active' : 'No token'} healthy={hasWebflowToken} />
      <span className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap">
        <Icon name="layers" size="sm" style={{ color: 'var(--blue)' }} />
        <span className="t-caption-sm" style={{ color: 'var(--brand-text-muted)' }}>
          {workspaceCount} workspace{workspaceCount === 1 ? '' : 's'}
        </span>
      </span>
    </section>
  );
}
