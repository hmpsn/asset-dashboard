import { useState } from 'react';
import { Upload, FolderSearch, ShieldCheck, Clipboard } from 'lucide-react';
import { DropZone } from './DropZone';
import { ProcessingQueue, type QueueItem } from './ProcessingQueue';
import { AssetBrowser } from './AssetBrowser';
import { AssetAudit } from './AssetAudit';

type SubTab = 'upload' | 'browse' | 'audit';

interface Props {
  siteId?: string;
  workspaceFolder: string;
  queue: QueueItem[];
}

const subTabs: { id: SubTab; label: string; icon: typeof Upload }[] = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'browse', label: 'Browse', icon: FolderSearch },
  { id: 'audit', label: 'Audit', icon: ShieldCheck },
];

export function MediaTab({ siteId, workspaceFolder, queue }: Props) {
  const [sub, setSub] = useState<SubTab>('upload');

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-0.5 mb-4">
        {subTabs.map(t => {
          const Icon = t.icon;
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
              style={active ? {
                backgroundColor: 'var(--brand-mint-dim)',
                color: 'var(--brand-mint)',
              } : {
                color: 'var(--brand-text-muted)',
              }}
            >
              <Icon className="w-3 h-3" /> {t.label}
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
          <div className="flex items-center justify-center gap-2 text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
            <Clipboard className="w-3 h-3" />
            <span>Press <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ backgroundColor: 'var(--brand-bg-elevated)', color: 'var(--brand-text)' }}>⌘V</kbd> to paste images from clipboard</span>
          </div>
          <div>
            <h2 className="text-xs font-medium mb-2.5 px-0.5" style={{ color: 'var(--brand-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Processing Queue</h2>
            <ProcessingQueue items={queue} />
          </div>
        </div>
      )}

      {/* Browse sub-tab */}
      {sub === 'browse' && siteId && (
        <AssetBrowser key={siteId} siteId={siteId} />
      )}
      {sub === 'browse' && !siteId && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-bg-elevated)' }}>
            <FolderSearch className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
          </div>
          <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Link a Webflow site to browse assets</p>
        </div>
      )}

      {/* Audit sub-tab */}
      {sub === 'audit' && siteId && (
        <AssetAudit key={siteId} siteId={siteId} />
      )}
      {sub === 'audit' && !siteId && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-bg-elevated)' }}>
            <ShieldCheck className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
          </div>
          <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Link a Webflow site to run an audit</p>
        </div>
      )}
    </div>
  );
}
