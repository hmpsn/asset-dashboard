import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, del, get, post } from '../api/client';
import {
  getBackgroundJobLabel,
  type BackgroundJobRecord,
  type BackgroundJobStatus,
  type BackgroundJobType,
  type PublicBackgroundJob,
} from '../../shared/types/background-jobs';
import { subscribeWorkspaceEvents } from './workspaceEventBus';
import { WS_EVENTS } from '../lib/wsEvents';

export interface BackgroundJob extends BackgroundJobRecord {
  dismissed?: boolean;
}

interface BackgroundTaskProviderProps {
  children: ReactNode;
  workspaceId?: string;
  publicMode?: boolean;
}

interface BackgroundTaskContextValue {
  jobs: BackgroundJob[];
  activeJobs: BackgroundJob[];
  startJob: (type: BackgroundJobType, params: Record<string, unknown>) => Promise<string | null>;
  trackJob: (type: BackgroundJobType, jobId: string, params: Record<string, unknown>) => void;
  getJobResult: (jobId: string) => unknown | undefined;
  findActiveJob: (criteria: JobLookupCriteria) => BackgroundJob | undefined;
  findLatestTerminalJob: (criteria: JobLookupCriteria & { withResult?: boolean }) => BackgroundJob | undefined;
  jobsForWorkspace: (workspaceId: string | undefined) => BackgroundJob[];
  cancelJob: (jobId: string) => Promise<void>;
  dismissJob: (jobId: string) => void;
  clearDone: (workspaceId?: string) => void;
}

interface JobLookupCriteria {
  type: BackgroundJobType | string;
  workspaceId?: string;
}

const BackgroundTaskContext = createContext<BackgroundTaskContextValue>({
  jobs: [],
  activeJobs: [],
  startJob: async () => null,
  trackJob: () => {},
  getJobResult: () => undefined,
  findActiveJob: () => undefined,
  findLatestTerminalJob: () => undefined,
  jobsForWorkspace: () => [],
  cancelJob: async () => {},
  dismissJob: () => {},
  clearDone: () => {},
});

export function isTerminalJobStatus(status: BackgroundJobStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

export function jobMatchesCriteria(job: BackgroundJob, criteria: JobLookupCriteria): boolean {
  return job.type === criteria.type && (!criteria.workspaceId || job.workspaceId === criteria.workspaceId);
}

export function jobBelongsToPanel(job: BackgroundJob, workspaceId: string | undefined): boolean {
  return workspaceId ? job.workspaceId === workspaceId : !job.workspaceId;
}

export function upsertBackgroundJob(prev: BackgroundJob[], job: BackgroundJob): BackgroundJob[] {
  const idx = prev.findIndex(existing => existing.id === job.id);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = { ...next[idx], ...job };
    return next;
  }
  return [job, ...prev];
}

export function createOptimisticBackgroundJob(
  id: string,
  type: BackgroundJobType,
  params: Record<string, unknown>,
): BackgroundJob {
  const now = new Date().toISOString();
  return {
    id,
    type,
    status: 'pending',
    progress: 0,
    message: `Starting ${getBackgroundJobLabel(type)}...`,
    createdAt: now,
    updatedAt: now,
    workspaceId: typeof params.workspaceId === 'string' ? params.workspaceId : undefined,
  };
}

function toBackgroundJob(job: BackgroundJobRecord | PublicBackgroundJob): BackgroundJob {
  return job as BackgroundJob;
}

function getListUrl(workspaceId: string | undefined, publicMode: boolean): string | null {
  if (publicMode) {
    return workspaceId ? `/api/public/jobs/${workspaceId}` : null;
  }
  return workspaceId
    ? `/api/jobs?workspaceId=${encodeURIComponent(workspaceId)}`
    : '/api/jobs';
}

function getDetailUrl(jobId: string, workspaceId: string | undefined, publicMode: boolean): string | null {
  if (publicMode) {
    return workspaceId ? `/api/public/jobs/${workspaceId}/${jobId}` : null;
  }
  return `/api/jobs/${jobId}`;
}

export function BackgroundTaskProvider({
  children,
  workspaceId,
  publicMode = false,
}: BackgroundTaskProviderProps) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const socketRef = useRef<WebSocket | null>(null);

  const handleIncomingJobEvent = useCallback((eventName: string | undefined, data: unknown) => {
    if (eventName !== WS_EVENTS.JOB_CREATED && eventName !== WS_EVENTS.JOB_UPDATED) return;
    if (!data || typeof data !== 'object') return;
    setJobs(prev => upsertBackgroundJob(prev, toBackgroundJob(data as BackgroundJobRecord)));
  }, []);

  useEffect(() => {
    if (publicMode || !workspaceId) return undefined;
    return subscribeWorkspaceEvents(workspaceId, {
      onMessage: (msg) => handleIncomingJobEvent(msg.event, msg.data),
    });
  }, [handleIncomingJobEvent, publicMode, workspaceId]);

  useEffect(() => {
    if (!publicMode || !workspaceId) return undefined;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ action: 'subscribe', workspaceId }));
        } catch (err) {
          console.error('useBackgroundTasks operation failed:', err);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { event?: string; data?: unknown };
          handleIncomingJobEvent(msg.event, msg.data);
        } catch (err) {
          console.error('useBackgroundTasks operation failed:', err);
        }
      };

      ws.onclose = () => {
        if (!disposed) reconnectTimer.current = setTimeout(connect, 2000);
      };

      socketRef.current = ws;
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [handleIncomingJobEvent, publicMode, workspaceId]);

  useEffect(() => {
    if (publicMode || workspaceId) return undefined;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        try {
          const authToken = localStorage.getItem('auth_token');
          if (authToken) {
            ws.send(JSON.stringify({ action: 'authenticate', token: authToken }));
          }
        } catch (err) {
          console.error('useBackgroundTasks operation failed:', err);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { event?: string; data?: unknown };
          handleIncomingJobEvent(msg.event, msg.data);
        } catch (err) {
          console.error('useBackgroundTasks operation failed:', err);
        }
      };

      ws.onclose = () => {
        if (!disposed) reconnectTimer.current = setTimeout(connect, 2000);
      };

      socketRef.current = ws;
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [handleIncomingJobEvent, publicMode, workspaceId]);

  useEffect(() => {
    const url = getListUrl(workspaceId, publicMode);
    if (!url) {
      setJobs([]);
      return;
    }
    let cancelled = false;
    get<Array<BackgroundJobRecord | PublicBackgroundJob>>(url)
      .then(data => {
        if (cancelled || !Array.isArray(data)) return;
        setJobs(data.map(toBackgroundJob));
      })
      .catch((err) => {
        if (!cancelled) console.error('useBackgroundTasks operation failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [publicMode, workspaceId]);

  const hydrateJob = useCallback((jobId: string) => {
    const url = getDetailUrl(jobId, workspaceId, publicMode);
    if (!url) return;
    get<BackgroundJobRecord | PublicBackgroundJob>(url)
      .then(job => setJobs(prev => upsertBackgroundJob(prev, toBackgroundJob(job))))
      .catch((err) => { console.error('useBackgroundTasks operation failed:', err); });
  }, [publicMode, workspaceId]);

  useEffect(() => {
    const activeJobs = jobs.filter(job => !isTerminalJobStatus(job.status));
    if (activeJobs.length === 0) return undefined;
    const interval = window.setInterval(() => {
      for (const job of activeJobs) hydrateJob(job.id);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [hydrateJob, jobs]);

  const trackJob = useCallback((type: BackgroundJobType, jobId: string, params: Record<string, unknown>) => {
    setJobs(prev => upsertBackgroundJob(prev, createOptimisticBackgroundJob(jobId, type, params)));
    hydrateJob(jobId);
  }, [hydrateJob]);

  const startJob = useCallback(async (type: BackgroundJobType, params: Record<string, unknown>): Promise<string | null> => {
    if (publicMode) {
      console.error('Failed to start job: public background tasks are read-only');
      return null;
    }
    try {
      const data = await post<{ jobId?: string; error?: string }>('/api/jobs', { type, params });
      if (data.jobId) {
        trackJob(type, data.jobId, params);
        return data.jobId;
      }
      console.error('Failed to start job:', data.error);
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body && typeof err.body === 'object' && 'jobId' in err.body) {
        const jobId = (err.body as { jobId?: unknown }).jobId;
        if (typeof jobId === 'string') {
          hydrateJob(jobId);
          return jobId;
        }
      }
      console.error('Failed to start job:', err);
      return null;
    }
  }, [hydrateJob, publicMode, trackJob]);

  const getJobResult = useCallback((jobId: string) => jobs.find(job => job.id === jobId)?.result, [jobs]);

  const findActiveJob = useCallback((criteria: JobLookupCriteria) => {
    return jobs.find(job => jobMatchesCriteria(job, criteria) && !isTerminalJobStatus(job.status));
  }, [jobs]);

  const findLatestTerminalJob = useCallback((criteria: JobLookupCriteria & { withResult?: boolean }) => {
    return jobs.find(job => {
      if (!jobMatchesCriteria(job, criteria) || !isTerminalJobStatus(job.status)) return false;
      return !criteria.withResult || job.result !== undefined;
    });
  }, [jobs]);

  const jobsForWorkspace = useCallback((panelWorkspaceId: string | undefined) => {
    return jobs.filter(job => jobBelongsToPanel(job, panelWorkspaceId));
  }, [jobs]);

  const dismissJob = useCallback((jobId: string) => {
    setJobs(prev => prev.map(job => job.id === jobId ? { ...job, dismissed: true } : job));
  }, []);

  const cancelJobFn = useCallback(async (jobId: string) => {
    if (publicMode) {
      console.error('Failed to cancel job: public background tasks are read-only');
      return;
    }
    try {
      await del(`/api/jobs/${jobId}`);
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  }, [publicMode]);

  const clearDone = useCallback((panelWorkspaceId?: string) => {
    setJobs(prev => prev.filter(job => {
      const visibleInPanel = jobBelongsToPanel(job, panelWorkspaceId);
      return !visibleInPanel || !isTerminalJobStatus(job.status);
    }));
    if (publicMode) return;
    const query = panelWorkspaceId
      ? `workspaceId=${encodeURIComponent(panelWorkspaceId)}`
      : 'scope=global';
    del(`/api/jobs/completed?${query}`).catch((err) => { console.error('useBackgroundTasks operation failed:', err); });
  }, [publicMode]);

  const activeJobs = useMemo(
    () => jobs.filter(job => job.status === 'pending' || job.status === 'running'),
    [jobs],
  );

  return (
    <BackgroundTaskContext.Provider
      value={{
        jobs,
        activeJobs,
        startJob,
        trackJob,
        getJobResult,
        findActiveJob,
        findLatestTerminalJob,
        jobsForWorkspace,
        cancelJob: cancelJobFn,
        dismissJob,
        clearDone,
      }}
    >
      {children}
    </BackgroundTaskContext.Provider>
  );
}

export function useBackgroundTasks() {
  return useContext(BackgroundTaskContext);
}
