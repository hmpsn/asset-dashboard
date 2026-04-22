import { useState } from 'react';
import { Clock, ChevronDown, ChevronRight } from 'lucide-react';
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-teal-400 mb-3">
        Version History
      </h3>

      {isLoading && (
        <p className="text-sm text-zinc-500">Loading version history...</p>
      )}

      {!isLoading && (!versions || versions.length === 0) && (
        <p className="text-sm text-zinc-500">No version history yet.</p>
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
              <li key={v.id} className="rounded-md border border-zinc-800 bg-zinc-900">
                <button
                  type="button"
                  onClick={() => toggleVersion(v.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors rounded-md"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="font-mono text-xs text-teal-400 shrink-0">
                    v{v.version}
                  </span>
                  <span className="text-xs text-zinc-400 shrink-0">{timeStr}</span>
                  <span className="ml-auto text-xs text-zinc-500 shrink-0">
                    {includedCount}/{entryCount} pages
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
                    {v.changeNotes && (
                      <p className="text-xs text-zinc-400 italic">{v.changeNotes}</p>
                    )}
                    {entryCount > 0 ? (
                      <ul className="space-y-1">
                        {v.snapshot.entries.map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-zinc-300 truncate">{entry.name}</span>
                            <span className="ml-2 shrink-0 text-zinc-500">
                              {entry.sectionPlan?.length ?? 0} sections
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-500">No entries in this snapshot.</p>
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
