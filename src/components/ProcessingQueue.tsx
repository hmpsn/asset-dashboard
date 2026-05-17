import { Loader2, CheckCircle2, AlertCircle, Sparkles, Upload, Copy } from 'lucide-react';
import { Badge, EmptyState, Icon, IconButton, cn } from './ui';

export interface QueueItem {
  id: string;
  fileName: string;
  workspace: string;
  type: 'asset' | 'meta';
  status: 'optimizing' | 'generating-alt' | 'uploading' | 'done' | 'error';
  altText?: string;
  outputPath?: string;
  error?: string;
  startedAt: number;
}

interface Props {
  items: QueueItem[];
}

const statusConfig = {
  'optimizing': { icon: Loader2, label: 'Optimizing', color: 'text-blue-400', spin: true },
  'generating-alt': { icon: Sparkles, label: 'Generating alt text', color: 'text-teal-400', spin: true },
  'uploading': { icon: Upload, label: 'Uploading to Webflow', color: 'text-amber-400', spin: true },
  'done': { icon: CheckCircle2, label: 'Done', color: 'text-emerald-400', spin: false },
  'error': { icon: AlertCircle, label: 'Error', color: 'text-red-400', spin: false },
};

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

export function ProcessingQueue({ items }: Props) {
  if (items.length === 0) {
    return (
      <EmptyState icon={Upload} title="No files processed yet" description="Drop files above to get started" className="py-12" />
    );
  }

  const sorted = [...items].sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="space-y-1">
      {sorted.map(item => {
        const config = statusConfig[item.status];
        const StatusIcon = config.icon;

        return (
          <div
            key={item.id}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-[var(--radius-xl)] transition-colors',
              item.status === 'done' ? 'bg-[var(--surface-3)]/30' : 'bg-[var(--surface-3)]/60',
            )}
          >
            <Icon
              as={StatusIcon}
              size="md"
              className={cn('shrink-0', config.color, config.spin && 'animate-spin')}
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{item.fileName}</span>
                <Badge
                  label={item.type}
                  tone={item.type === 'meta' ? 'amber' : 'blue'}
                  className="uppercase tracking-wider"
                />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn('text-xs', config.color)}>{config.label}</span>
                {item.altText && item.status === 'done' && (
                  <span className="text-xs text-[var(--brand-text-muted)] truncate max-w-[300px]">
                    — {item.altText}
                  </span>
                )}
                {item.error && (
                  <span className="text-xs text-red-400 truncate max-w-[300px]">
                    — {item.error}
                  </span>
                )}
              </div>
            </div>

            {item.status === 'done' && item.fileName && (
              <IconButton
                icon={Copy}
                label="Copy filename"
                size="sm"
                variant="ghost"
                onClick={() => copyToClipboard(item.fileName)}
                className="hover:bg-[var(--brand-border-hover)] rounded-[var(--radius-md)] shrink-0"
                title="Copy filename"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
