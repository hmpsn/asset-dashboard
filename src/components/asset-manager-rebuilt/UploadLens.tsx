// @ds-rebuilt
import { Clipboard } from 'lucide-react';
import { DropZone } from '../DropZone';
import { ProcessingQueue, type QueueItem } from '../ProcessingQueue';
import { GroupBlock, Icon, InlineBanner, Skeleton } from '../ui';

interface UploadLensProps {
  workspaceFolder: string;
  queue: QueueItem[];
  queueLoading?: boolean;
}

export function UploadLens({ workspaceFolder, queue, queueLoading = false }: UploadLensProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupBlock
          title="Assets"
          meta="General image assets route through AVIF conversion and SVG minification."
          stats={[{ label: 'Profile', value: 'asset' }]}
          collapsible={false}
        >
          <div className="[&>*]:rounded-[var(--radius-lg)]">
            <DropZone workspaceId={workspaceFolder} type="asset" />
          </div>
        </GroupBlock>

        <GroupBlock
          title="Meta / OG"
          meta="Social preview assets keep the JPEG profile for platform compatibility."
          stats={[{ label: 'Profile', value: 'meta' }]}
          collapsible={false}
        >
          <div className="[&>*]:rounded-[var(--radius-lg)]">
            <DropZone workspaceId={workspaceFolder} type="meta" />
          </div>
        </GroupBlock>
      </div>

      <InlineBanner tone="info" title="Clipboard upload">
        <span className="inline-flex items-center gap-2">
          <Icon as={Clipboard} size="sm" />
          Press <kbd className="rounded-[var(--radius-sm)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-1.5 py-0.5 t-mono text-[var(--brand-text)]">Cmd V</kbd> to paste images into the existing upload pipeline.
        </span>
      </InlineBanner>

      <GroupBlock
        title="Processing queue"
        meta="Optimizing, generating alt text, and Webflow upload status."
        stats={[
          { label: 'Active', value: queue.filter((item) => item.status !== 'done' && item.status !== 'error').length },
          { label: 'Done', value: queue.filter((item) => item.status === 'done').length },
        ]}
      >
        {queueLoading ? (
          <div className="flex flex-col gap-2" aria-label="Loading processing queue">
            <Skeleton className="h-[64px] w-full" />
            <Skeleton className="h-[64px] w-full" />
          </div>
        ) : (
          <ProcessingQueue items={queue} />
        )}
      </GroupBlock>
    </div>
  );
}
