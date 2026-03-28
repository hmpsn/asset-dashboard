import { Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionCard } from '../ui';
import { adminPath } from '../../routes';

interface SeoWorkStatusProps {
  seoStatus: {
    total: number;
    issueDetected: number;
    inReview: number;
    approved: number;
    rejected: number;
    live: number;
    clean: number;
  };
  workspaceId: string;
  embedded?: boolean;
}

export function SeoWorkStatus({ seoStatus, workspaceId, embedded }: SeoWorkStatusProps) {
  const navigate = useNavigate();
  if (seoStatus.total === 0) return null;

  const grid = (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800/50">
      {seoStatus.issueDetected > 0 && (
        <button onClick={() => navigate(adminPath(workspaceId, 'seo-audit'))} className="flex flex-col items-center py-3 hover:bg-zinc-800/30 transition-colors bg-zinc-900">
          <span className="text-lg font-bold text-amber-400">{seoStatus.issueDetected}</span>
          <span className="text-[10px] text-zinc-500">issues found</span>
        </button>
      )}
      {seoStatus.inReview > 0 && (
        <button onClick={() => navigate(adminPath(workspaceId, 'seo-editor'))} className="flex flex-col items-center py-3 hover:bg-zinc-800/30 transition-colors bg-zinc-900">
          <span className="text-lg font-bold text-purple-400">{seoStatus.inReview}</span>
          <span className="text-[10px] text-zinc-500">in review</span>
        </button>
      )}
      {seoStatus.approved > 0 && (
        <button onClick={() => navigate(adminPath(workspaceId, 'seo-editor'))} className="flex flex-col items-center py-3 hover:bg-zinc-800/30 transition-colors bg-zinc-900">
          <span className="text-lg font-bold text-green-400">{seoStatus.approved}</span>
          <span className="text-[10px] text-zinc-500">approved</span>
        </button>
      )}
      {seoStatus.rejected > 0 && (
        <button onClick={() => navigate(adminPath(workspaceId, 'seo-editor'))} className="flex flex-col items-center py-3 hover:bg-zinc-800/30 transition-colors bg-zinc-900">
          <span className="text-lg font-bold text-red-400">{seoStatus.rejected}</span>
          <span className="text-[10px] text-zinc-500">rejected</span>
        </button>
      )}
      {seoStatus.live > 0 && (
        <div className="flex flex-col items-center py-3 bg-zinc-900">
          <span className="text-lg font-bold text-teal-400">{seoStatus.live}</span>
          <span className="text-[10px] text-zinc-500">live</span>
        </div>
      )}
      {seoStatus.clean > 0 && (
        <div className="flex flex-col items-center py-3 bg-zinc-900">
          <span className="text-lg font-bold text-zinc-400">{seoStatus.clean}</span>
          <span className="text-[10px] text-zinc-500">clean</span>
        </div>
      )}
    </div>
  );

  if (embedded) return grid;

  return (
    <SectionCard title="SEO Work Status" titleIcon={<Pencil className="w-4 h-4 text-teal-400" />} noPadding>
      {grid}
    </SectionCard>
  );
}
