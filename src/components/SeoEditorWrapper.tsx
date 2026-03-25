import { useState } from 'react';
import { Pencil, Database } from 'lucide-react';
import { SeoEditor } from './SeoEditor';
import { CmsEditor } from './CmsEditor';
import type { FixContext } from '../App';

type EditorTab = 'pages' | 'cms';

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
}

export function SeoEditorWrapper({ siteId, workspaceId, fixContext }: Props) {
  const [tab, setTab] = useState<EditorTab>('pages');

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-zinc-800 pb-0 mb-4">
        {([
          { id: 'pages' as const, label: 'Pages', icon: Pencil },
          { id: 'cms' as const, label: 'CMS Collections', icon: Database },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? 'border-teal-500 text-teal-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ display: tab === 'pages' ? undefined : 'none' }}>
        <SeoEditor siteId={siteId} workspaceId={workspaceId} fixContext={fixContext} />
      </div>
      <div style={{ display: tab === 'cms' ? undefined : 'none' }}>
        <CmsEditor siteId={siteId} workspaceId={workspaceId} />
      </div>
    </div>
  );
}
