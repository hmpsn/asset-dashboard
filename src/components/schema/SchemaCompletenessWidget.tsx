import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ValidationFinding } from '../../../shared/types/schema-validation';
import { SectionCard } from '../ui/SectionCard';
import { adminPath } from '../../routes';
import { fieldToTarget } from './fieldTargets';

interface PageWithFindings {
  pageId?: string;
  validationFindings?: ValidationFinding[];
  validationErrors?: string[];
}

interface SchemaCompletenessWidgetProps {
  pages: PageWithFindings[];
  workspaceId?: string;
}

interface FieldGroup {
  field: string;
  target: { tab: string; focus: string; label: string };
  pageCount: number;
  severity: 'error' | 'warning';
}

export function SchemaCompletenessWidget({ pages, workspaceId }: SchemaCompletenessWidgetProps) {
  const navigate = useNavigate();

  const { groups, completenessPct, totalPages, fullyClean } = useMemo(() => {
    const findingsByField = new Map<string, { severity: 'error' | 'warning'; pages: Set<string> }>();
    let pagesWithIssues = 0;

    for (const page of pages) {
      const findings = page.validationFindings ?? [];
      // Only count pages that have AT LEAST ONE finding with a known target
      let hasActionableIssue = false;
      for (const f of findings) {
        if (!f.field) continue;
        if (!fieldToTarget(f.field)) continue; // skip non-actionable fields
        const key = f.field;
        const entry = findingsByField.get(key) ?? { severity: f.severity, pages: new Set<string>() };
        if (f.severity === 'error') entry.severity = 'error';
        entry.pages.add(page.pageId ?? '');
        findingsByField.set(key, entry);
        hasActionableIssue = true;
      }
      if (hasActionableIssue) pagesWithIssues++;
    }

    const groups: FieldGroup[] = [];
    for (const [field, info] of findingsByField) {
      const target = fieldToTarget(field);
      if (!target) continue;
      groups.push({ field, target, pageCount: info.pages.size, severity: info.severity });
    }
    groups.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.pageCount - a.pageCount;
    });

    const totalPages = pages.length;
    const completenessPct = totalPages === 0 ? 100 : Math.round(((totalPages - pagesWithIssues) / totalPages) * 100);
    const fullyClean = groups.length === 0;

    return { groups, completenessPct, totalPages, fullyClean };
  }, [pages]);

  if (totalPages === 0) return null;

  if (fullyClean) {
    return (
      <SectionCard title="Schema profile completeness" className="mb-6">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 text-lg">✓</span>
          <span className="t-body text-[var(--brand-text)]">Schema profile complete — all pages emit recommended fields.</span>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Schema profile completeness" className="mb-6">
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        {completenessPct}% complete · {groups.length} field{groups.length === 1 ? '' : 's'} missing across pages.
      </p>

      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-[var(--surface-3)] overflow-hidden mb-4">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${completenessPct}%` }}
          role="progressbar"
          aria-valuenow={completenessPct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      {/* Missing-field rows */}
      <div className="space-y-1">
        {groups.map(g => (
          <button
            key={g.field}
            onClick={() => {
              if (!workspaceId) return;
              navigate(`${adminPath(workspaceId, 'settings')}?tab=${g.target.tab}&focus=${g.target.focus}`);
            }}
            className="flex items-center justify-between gap-3 w-full px-3 py-2 rounded text-left hover:bg-[var(--surface-3)] transition-colors group"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className={g.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
                {g.severity === 'error' ? '✗' : '⚠'}
              </span>
              <span className="t-body text-[var(--brand-text)] truncate">{g.target.label}</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                {g.pageCount} page{g.pageCount === 1 ? '' : 's'}
              </span>
            </span>
            <span className="t-caption text-[var(--brand-text-muted)] group-hover:text-[var(--brand-text)] shrink-0">
              Fix →
            </span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}
