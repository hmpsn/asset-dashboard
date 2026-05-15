import { useState } from 'react';
import { Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { ClickableRow, Icon } from '../ui';
import { useBlueprintVersions } from '../../hooks/admin/useBlueprints';
import type { BlueprintVersion } from '../../../shared/types/page-strategy';

interface Props {
  workspaceId: string;
  blueprintId: string;
}

export function BlueprintVersionHistory({ workspaceId, blueprintId }: Props) {
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const { data: versions, isLoading } = useBlueprintVersions(workspaceId, blueprintId);

  function formatVersionDate(createdAt: string): string {
    const date = new Date(createdAt);
    return (
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    );
  }

  function toggleVersion(versionId: string) {
    setExpandedVersion((prev) => (prev === versionId ? null : versionId));
  }

  return (
    <div className="mt-6">
      <h3 className="t-caption font-semibold uppercase tracking-wider text-teal-400 mb-3">
        Version History
      </h3>

      {isLoading && (
        <p className="text-sm text-[var(--brand-text-muted)]">Loading version history...</p>
      )}

      {!isLoading && (!versions || versions.length === 0) && (
        <p className="text-sm text-[var(--brand-text-muted)]">No version history yet.</p>
      )}

      {!isLoading && versions && versions.length > 0 && (
        <ul className="space-y-2">
          {versions.map((v: BlueprintVersion) => {
            const entryCount = v.snapshot?.entries?.length ?? 0;
            const includedCount =
              v.snapshot?.entries?.filter((e) => e.scope === 'included').length ?? 0;
            const isExpanded = expandedVersion === v.id;
              const timeStr = formatVersionDate(v.createdAt);

              return (
                <li key={v.id} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
                  <ClickableRow
                    onClick={() => toggleVersion(v.id)}
                    active={isExpanded}
                    className="flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-3)]/50 rounded-[var(--radius-md)] bg-transparent"
                  >
                    <Icon as={Clock} size="md" className="shrink-0 text-[var(--brand-text-muted)]" />
                    <span className="t-mono text-xs text-teal-400 shrink-0">
                      v{v.version}
                    </span>
                    <span className="t-caption text-[var(--brand-text)] shrink-0">{timeStr}</span>
                    <span className="ml-auto t-caption text-[var(--brand-text-muted)] shrink-0">
                      {includedCount}/{entryCount} pages
                    </span>
                    {isExpanded ? (
                      <Icon as={ChevronDown} size="md" className="shrink-0 text-[var(--brand-text-muted)]" />
                    ) : (
                      <Icon as={ChevronRight} size="md" className="shrink-0 text-[var(--brand-text-muted)]" />
                    )}
                  </ClickableRow>

                  {isExpanded && (
                    <div className="border-t border-[var(--brand-border)] px-3 py-2 space-y-2">
                      {v.changeNotes && (
                        <p className="t-caption text-[var(--brand-text)] italic">{v.changeNotes}</p>
                      )}
                      {entryCount > 0 ? (
                        <ul className="space-y-1">
                          {v.snapshot.entries.map((entry) => (
                            <li
                              key={entry.id}
                              className="flex items-center justify-between t-caption"
                            >
                              <span className="text-[var(--brand-text)] truncate">{entry.name}</span>
                              <span className="ml-2 shrink-0 text-[var(--brand-text-muted)]">
                                {entry.sectionPlan?.length ?? 0} sections
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="t-caption text-[var(--brand-text-muted)]">No entries in this snapshot.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
