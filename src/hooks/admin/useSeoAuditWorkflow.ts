import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOptional, getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { useBackgroundTasks, type BackgroundJob } from '../useBackgroundTasks';
import type { SeoAuditResult, SnapshotSummary } from '../../components/audit/types';

interface UseSeoAuditWorkflowOptions {
  siteId: string;
  workspaceId?: string;
}

interface AuditSnapshot {
  id: string;
  audit: SeoAuditResult;
}

function hasAuditPages(value: unknown): value is SeoAuditResult {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as SeoAuditResult).pages);
}

function isSeoAuditJobForWorkspace(job: BackgroundJob, workspaceId: string | undefined): boolean {
  return job.type === 'seo-audit' && job.workspaceId === workspaceId;
}

function reportWorkspaceQuery(workspaceId: string | undefined): string {
  return workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
}

export function useSeoAuditWorkflow({ siteId, workspaceId }: UseSeoAuditWorkflowOptions) {
  const queryClient = useQueryClient();
  const { startJob, jobs } = useBackgroundTasks();
  const auditJobId = useRef<string | null>(null);
  const [data, setData] = useState<SeoAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [skipLinkCheck, setSkipLinkCheck] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);

  const workspaceQuery = reportWorkspaceQuery(workspaceId);
  const latestKey = queryKeys.admin.auditLatest(siteId, workspaceId);
  const historyKey = queryKeys.admin.auditHistory(siteId, workspaceId);

  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: async (): Promise<SnapshotSummary[]> => {
      const history = await getSafe<SnapshotSummary[]>(`/api/reports/${siteId}/history${workspaceQuery}`, []);
      return Array.isArray(history) ? history : [];
    },
    enabled: !!siteId,
    retry: false,
    staleTime: 0,
  });

  const latestSnapshotQuery = useQuery({
    queryKey: latestKey,
    queryFn: async (): Promise<AuditSnapshot | null> => {
      const snapshot = await getOptional<AuditSnapshot>(`/api/reports/${siteId}/latest${workspaceQuery}`);
      return snapshot && hasAuditPages(snapshot.audit) ? snapshot : null;
    },
    enabled: !!siteId,
    retry: false,
    staleTime: 0,
  });

  const completedAuditJob = useMemo(() => jobs
    .filter(job => isSeoAuditJobForWorkspace(job, workspaceId) && job.status === 'done' && job.result)
    .find(job => hasAuditPages(job.result)), [jobs, workspaceId]);

  const runningAuditJob = useMemo(() => jobs.find(job => (
    isSeoAuditJobForWorkspace(job, workspaceId)
      && (job.status === 'running' || job.status === 'pending')
  )), [jobs, workspaceId]);

  const refreshAuditReads = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditAll() });
  }, [queryClient]);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setHasRun(true);
    setAuditError(null);
    setShowNextSteps(false);
    const jobId = await startJob('seo-audit', { siteId, workspaceId, skipLinkCheck });
    if (jobId) {
      auditJobId.current = jobId;
    } else {
      setAuditError('Failed to start audit job');
      setLoading(false);
    }
  }, [siteId, skipLinkCheck, startJob, workspaceId]);

  useEffect(() => {
    if (!auditJobId.current) return;
    const job = jobs.find(candidate => candidate.id === auditJobId.current);
    if (!job) return;
    if (job.status === 'done' && job.result) {
      if (hasAuditPages(job.result)) {
        setData(job.result);
        setShowNextSteps(true);
        refreshAuditReads();
      } else {
        setAuditError('Invalid audit response');
      }
      setLoading(false);
      auditJobId.current = null;
    } else if (job.status === 'error') {
      setAuditError(job.error || 'Audit failed');
      setLoading(false);
      auditJobId.current = null;
    }
  }, [jobs, refreshAuditReads]);

  useEffect(() => {
    if (completedAuditJob && !data) {
      setData(completedAuditJob.result as SeoAuditResult);
      setHasRun(true);
      setAuditError(null);
    } else if (runningAuditJob && !auditJobId.current) {
      auditJobId.current = runningAuditJob.id;
      setLoading(true);
      setHasRun(true);
      setAuditError(null);
    }
  }, [completedAuditJob, data, runningAuditJob]);

  useEffect(() => {
    if (data || completedAuditJob || runningAuditJob) return;
    const snapshot = latestSnapshotQuery.data;
    if (snapshot && hasAuditPages(snapshot.audit)) {
      setData({ ...snapshot.audit, snapshotId: snapshot.id } as SeoAuditResult & { snapshotId: string });
      setHasRun(true);
      setAuditError(null);
    }
  }, [completedAuditJob, data, latestSnapshotQuery.data, runningAuditJob]);

  return {
    data,
    loading,
    hasRun,
    history: historyQuery.data ?? [],
    auditError,
    showNextSteps,
    setShowNextSteps,
    skipLinkCheck,
    setSkipLinkCheck,
    runAudit,
    refreshAuditHistory: refreshAuditReads,
    runningAuditJob: auditJobId.current ? jobs.find(job => job.id === auditJobId.current) : runningAuditJob,
  };
}
