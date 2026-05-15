import { Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionCard, Icon, ClickableRow } from '../ui';
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
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--brand-border)]">
      {seoStatus.issueDetected > 0 && (
        <ClickableRow onClick={() => navigate(adminPath(workspaceId, 'seo-audit'))} className="flex flex-col items-center py-3 hover:bg-[var(--surface-3)] transition-colors bg-[var(--surface-2)]">
          <span className="text-lg font-bold text-amber-400/80">{seoStatus.issueDetected}</span>
          <span className="t-micro text-[var(--brand-text-muted)]">issues found</span>
        </ClickableRow>
      )}
      {seoStatus.inReview > 0 && (
        <ClickableRow onClick={() => navigate(adminPath(workspaceId, 'seo-editor'))} className="flex flex-col items-center py-3 hover:bg-[var(--surface-3)] transition-colors bg-[var(--surface-2)]">
          <span className="text-lg font-bold text-blue-400">{seoStatus.inReview}</span>
          <span className="t-micro text-[var(--brand-text-muted)]">in review</span>
        </ClickableRow>
      )}
      {seoStatus.approved > 0 && (
        <ClickableRow onClick={() => navigate(adminPath(workspaceId, 'seo-editor'))} className="flex flex-col items-center py-3 hover:bg-[var(--surface-3)] transition-colors bg-[var(--surface-2)]">
          <span className="text-lg font-bold text-emerald-400/80">{seoStatus.approved}</span>
          <span className="t-micro text-[var(--brand-text-muted)]">approved</span>
        </ClickableRow>
      )}
      {seoStatus.rejected > 0 && (
        <ClickableRow onClick={() => navigate(adminPath(workspaceId, 'seo-editor'))} className="flex flex-col items-center py-3 hover:bg-[var(--surface-3)] transition-colors bg-[var(--surface-2)]">
          <span className="text-lg font-bold text-red-400/80">{seoStatus.rejected}</span>
          <span className="t-micro text-[var(--brand-text-muted)]">rejected</span>
        </ClickableRow>
      )}
      {seoStatus.live > 0 && (
        <div className="flex flex-col items-center py-3 bg-[var(--surface-2)]">
          <span className="text-lg font-bold text-teal-400">{seoStatus.live}</span>
          <span className="t-micro text-[var(--brand-text-muted)]">live</span>
        </div>
      )}
      {seoStatus.clean > 0 && (
        <div className="flex flex-col items-center py-3 bg-[var(--surface-2)]">
          <span className="text-lg font-bold text-[var(--brand-text-muted)]">{seoStatus.clean}</span>
          <span className="t-micro text-[var(--brand-text-muted)]">clean</span>
        </div>
      )}
    </div>
  );

  if (embedded) return grid;

  return (
    <SectionCard title="SEO Work Status" titleIcon={<Icon as={Pencil} size="md" className="text-teal-400" />} noPadding>
      {grid}
    </SectionCard>
  );
}
