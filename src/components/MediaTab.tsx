import { useState } from 'react';
import { Upload, FolderSearch, ShieldCheck, Clipboard } from 'lucide-react';
import { Icon, cn } from './ui';
import { DropZone } from './DropZone';
import { ProcessingQueue, type QueueItem } from './ProcessingQueue';
import { AssetBrowser } from './AssetBrowser';
import { AssetAudit } from './AssetAudit';

type SubTab = 'upload' | 'browse' | 'audit';

interface Props {
  siteId?: string;
  workspaceId: string;
  workspaceFolder: string;
  queue: QueueItem[];
}

const subTabs: { id: SubTab; label: string; icon: typeof Upload }[] = [
  { id: 'audit', label: 'Audit', icon: ShieldCheck },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'browse', label: 'Browse', icon: FolderSearch },
];

export function MediaTab({ siteId, workspaceId, workspaceFolder, queue }: Props) {
  const [sub, setSub] = useState<SubTab>('audit');

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-0.5 mb-4">
        {subTabs.map(t => {
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium',
                active ? 'bg-teal-500/10 text-teal-400' : 'text-[var(--brand-text-muted)]',
              )}
            >
              <Icon as={t.icon} size="sm" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Upload sub-tab */}
      {sub === 'upload' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <DropZone workspaceId={workspaceFolder} type="asset" />
            <DropZone workspaceId={workspaceFolder} type="meta" />
          </div>
          <div className="flex items-center justify-center gap-2 t-caption-sm text-[var(--brand-text-muted)]">
            <Icon as={Clipboard} size="sm" />
            <span>Press <kbd className="px-1.5 py-0.5 rounded t-mono text-xs bg-[var(--surface-2)] text-[var(--brand-text)]">⌘V</kbd> to paste images from clipboard</span>
          </div>
          <div>
            <h2 className="text-xs font-medium mb-2.5 px-0.5 text-[var(--brand-text-muted)] uppercase tracking-wider">Processing Queue</h2>
            <ProcessingQueue items={queue} />
          </div>
        </div>
      )}

      {/* Browse sub-tab */}
      {sub === 'browse' && siteId && (
        <AssetBrowser key={siteId} siteId={siteId} workspaceId={workspaceId} />
      )}
      {sub === 'browse' && !siteId && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-12 h-12 rounded-[var(--radius-xl)] flex items-center justify-center bg-[var(--surface-2)]">
            <Icon as={FolderSearch} size="lg" className="text-[var(--brand-text-muted)]" />
          </div>
          <p className="text-sm text-[var(--brand-text-muted)]">Link a Webflow site to browse assets</p>
        </div>
      )}

      {/* Audit sub-tab */}
      {sub === 'audit' && siteId && (
        <AssetAudit key={siteId} siteId={siteId} workspaceId={workspaceId} />
      )}
      {sub === 'audit' && !siteId && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-12 h-12 rounded-[var(--radius-xl)] flex items-center justify-center bg-[var(--surface-2)]">
            <Icon as={ShieldCheck} size="lg" className="text-[var(--brand-text-muted)]" />
          </div>
          <p className="text-sm text-[var(--brand-text-muted)]">Link a Webflow site to run an audit</p>
        </div>
      )}
    </div>
  );
}
