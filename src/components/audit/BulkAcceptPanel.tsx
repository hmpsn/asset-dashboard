import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../lib/wsEvents';
import { jobs as jobsApi } from '../../api/misc';
import { seoBulkJobs } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import type { SeoAuditResult } from './types';

interface BulkAcceptPanelProps {
  workspaceId: string;
  siteId: string;
  data: SeoAuditResult;
  appliedFixes: Set<string>;
  setAppliedFixes: React.Dispatch<React.SetStateAction<Set<string>>>;
  editedSuggestions: Record<string, string>;
  // Callbacks to pass bulk state up to the parent toolbar / error banner
  onBulkApplyingChange: (applying: boolean) => void;
  onBulkProgressChange: (progress: { done: number; total: number } | null) => void;
  onBulkError: (error: string | null) => void;
  // Expose handlers so parent toolbar can call acceptAll / cancel
  onRegisterHandlers: (handlers: { acceptAll: () => Promise<void>; cancel: () => void }) => void;
}

export function BulkAcceptPanel({
  workspaceId,
  siteId,
  data,
  appliedFixes,
  setAppliedFixes,
  editedSuggestions,
  onBulkApplyingChange,
  onBulkProgressChange,
  onBulkError,
  onRegisterHandlers,
}: BulkAcceptPanelProps) {
  const queryClient = useQueryClient();
  const { cancelJob } = useBackgroundTasks();

  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAcceptJobId, setBulkAcceptJobId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(`seo-bulk-accept-job-${workspaceId}`) ?? null;
    } catch {
      return null;
    }
  });
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Sync state up to parent
  useEffect(() => { onBulkApplyingChange(bulkApplying); }, [bulkApplying, onBulkApplyingChange]);
  useEffect(() => { onBulkProgressChange(bulkProgress); }, [bulkProgress, onBulkProgressChange]);
  useEffect(() => { onBulkError(bulkError); }, [bulkError, onBulkError]);

  // ── WebSocket handlers for background bulk accept ──
  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.BULK_OPERATION_PROGRESS]: (rawData: unknown) => {
      const d = rawData as { jobId: string; operation: string; done: number; total: number; failed?: number; appliedKey?: string | null };
      if (d.operation === 'bulk-accept-fixes' && d.jobId === bulkAcceptJobId) {
        setBulkProgress({ done: d.done, total: d.total });
        if (d.appliedKey) {
          setAppliedFixes(prev => new Set([...prev, d.appliedKey!]));
        }
      }
    },
    [WS_EVENTS.BULK_OPERATION_COMPLETE]: (rawData: unknown) => {
      const d = rawData as { jobId: string; operation: string; applied: number; failed: number; total: number; appliedKeys?: string[] };
      if (d.operation === 'bulk-accept-fixes' && d.jobId === bulkAcceptJobId) {
        if (d.appliedKeys?.length) {
          setAppliedFixes(prev => {
            const next = new Set(prev);
            for (const key of d.appliedKeys!) next.add(key);
            return next;
          });
        }
        setBulkApplying(false);
        setBulkProgress(null);
        setBulkAcceptJobId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditAll() });
      }
    },
    [WS_EVENTS.BULK_OPERATION_FAILED]: (rawData: unknown) => {
      const d = rawData as { jobId: string; operation: string; error: string };
      if (d.operation === 'bulk-accept-fixes' && d.jobId === bulkAcceptJobId) {
        setBulkApplying(false);
        setBulkProgress(null);
        setBulkAcceptJobId(null);
        setBulkError('Bulk fix application failed: ' + d.error);
        setTimeout(() => setBulkError(null), 8000);
      }
    },
  });

  // Persist active bulk accept job ID so it survives remount (nav away + back)
  useEffect(() => {
    try {
      bulkAcceptJobId
        ? sessionStorage.setItem(`seo-bulk-accept-job-${workspaceId}`, bulkAcceptJobId)
        : sessionStorage.removeItem(`seo-bulk-accept-job-${workspaceId}`);
    } catch { /* ignore */ }
  }, [bulkAcceptJobId, workspaceId]);

  // On remount, query server to recover progress UI for any restored job ID
  const mountAcceptJobId = useRef(bulkAcceptJobId);
  useEffect(() => {
    const acceptId = mountAcceptJobId.current;
    if (!acceptId) return;
    const TERMINAL = new Set(['done', 'error', 'cancelled']);
    jobsApi.get(acceptId)
      .then(job => {
        if (TERMINAL.has(job.status)) {
          setBulkAcceptJobId(null);
        } else {
          setBulkApplying(true);
          setBulkProgress({ done: job.progress ?? 0, total: job.total ?? 0 });
        }
      })
      .catch(() => setBulkAcceptJobId(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only recovery; ref captures initial value

  const acceptAllSuggestions = async () => {
    if (!data) return;
    const fixes: { pageId: string; check: string; suggestedFix: string; message?: string; pageSlug?: string; pageName?: string }[] = [];
    for (const page of data.pages) {
      for (const issue of page.issues) {
        const fixKey = `${page.pageId}-${issue.check}`;
        if (issue.suggestedFix && !appliedFixes.has(fixKey)) {
          const text = editedSuggestions[fixKey] || issue.suggestedFix;
          fixes.push({ pageId: page.pageId, check: issue.check, suggestedFix: text, message: issue.message, pageSlug: page.slug, pageName: page.page });
        }
      }
    }
    if (fixes.length === 0) return;
    setBulkApplying(true);
    setBulkProgress({ done: 0, total: fixes.length });
    try {
      const { jobId } = await seoBulkJobs.bulkAcceptFixes(workspaceId, { siteId, fixes });
      setBulkAcceptJobId(jobId);
    } catch (err) {
      console.error('Failed to start bulk accept:', err);
      setBulkApplying(false);
      setBulkProgress(null);
    }
  };

  const cancelBulkApply = () => {
    if (bulkAcceptJobId) {
      cancelJob(bulkAcceptJobId);
    }
    setBulkApplying(false);
    setBulkProgress(null);
    setBulkAcceptJobId(null);
  };

  // Register handlers with parent on mount and whenever dependencies change
  useEffect(() => {
    onRegisterHandlers({ acceptAll: acceptAllSuggestions, cancel: cancelBulkApply });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register stable handler references
  }, [data, appliedFixes, editedSuggestions, bulkAcceptJobId]);

  // Render error banner (progress / applying is surfaced via parent via callbacks)
  if (!bulkError) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>{bulkError}</span>
      <button onClick={() => setBulkError(null)} className="ml-auto p-0.5 rounded hover:bg-white/10">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
