import { Loader2, CheckCircle2, AlertCircle, Sparkles, Upload, Copy } from 'lucide-react';
import { EmptyState } from './ui';
import { cn } from '../lib/utils';

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
        const Icon = config.icon;

        return (
          <div
            key={item.id}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl transition-colors',
              item.status === 'done' ? 'bg-zinc-800/30' : 'bg-zinc-800/60'
            )}
          >
            <Icon className={cn('w-4 h-4 shrink-0', config.color, config.spin && 'animate-spin')} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{item.fileName}</span>
                <span className={cn(
                  'text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium',
                  item.type === 'meta'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-blue-500/10 text-blue-400'
                )}>
                  {item.type}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn('text-xs', config.color)}>{config.label}</span>
                {item.altText && item.status === 'done' && (
                  <span className="text-xs text-zinc-500 truncate max-w-[300px]">
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
              <button
                onClick={() => copyToClipboard(item.fileName)}
                className="p-1.5 hover:bg-zinc-700 rounded-lg transition-colors shrink-0"
                title="Copy filename"
              >
                <Copy className="w-3.5 h-3.5 text-zinc-500" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
