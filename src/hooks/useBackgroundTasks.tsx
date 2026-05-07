import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { ApiError, get, post, del } from '../api/client';
import { getBackgroundJobLabel, type BackgroundJobType } from '../../shared/types/background-jobs';

export interface BackgroundJob {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  progress?: number;
  total?: number;
  message?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string;
  /** When the UI dismissed this job's completion toast */
  dismissed?: boolean;
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

export function isTerminalJobStatus(status: BackgroundJob['status']): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

export function jobMatchesCriteria(job: BackgroundJob, criteria: JobLookupCriteria): boolean {
  return job.type === criteria.type && (!criteria.workspaceId || job.workspaceId === criteria.workspaceId);
}

export function jobBelongsToPanel(job: BackgroundJob, workspaceId: string | undefined): boolean {
  return workspaceId ? job.workspaceId === workspaceId : !job.workspaceId;
}

export function upsertBackgroundJob(prev: BackgroundJob[], job: BackgroundJob): BackgroundJob[] {
  const idx = prev.findIndex(j => j.id === job.id);
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

export function BackgroundTaskProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // WebSocket connection for job events
  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onmessage = (event) => {
        try {
          const { event: eventName, data } = JSON.parse(event.data);
          if (eventName === 'job:created' || eventName === 'job:update') {
            const job = data as BackgroundJob;
            setJobs(prev => upsertBackgroundJob(prev, job));
          }
        } catch (err) { console.error('useBackgroundTasks operation failed:', err); }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  // Load existing jobs on mount
  useEffect(() => {
    get<BackgroundJob[]>('/api/jobs')
      .then((data) => {
        if (Array.isArray(data)) setJobs(data);
      })
      .catch((err) => { console.error('useBackgroundTasks operation failed:', err); });
  }, []);

  const hydrateJob = useCallback((jobId: string) => {
    get<BackgroundJob>(`/api/jobs/${jobId}`)
      .then(job => setJobs(prev => upsertBackgroundJob(prev, job)))
      .catch((err) => { console.error('useBackgroundTasks operation failed:', err); });
  }, []);

  const trackJob = useCallback((type: BackgroundJobType, jobId: string, params: Record<string, unknown>) => {
    setJobs(prev => upsertBackgroundJob(prev, createOptimisticBackgroundJob(jobId, type, params)));
    hydrateJob(jobId);
  }, [hydrateJob]);

  const startJob = useCallback(async (type: BackgroundJobType, params: Record<string, unknown>): Promise<string | null> => {
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
          console.warn('Background job already running; attaching to existing job:', jobId);
          hydrateJob(jobId);
          return jobId;
        }
      }
      console.error('Failed to start job:', err);
      return null;
    }
  }, [hydrateJob, trackJob]);

  const getJobResult = useCallback((jobId: string) => {
    return jobs.find(j => j.id === jobId)?.result;
  }, [jobs]);

  const findActiveJob = useCallback((criteria: JobLookupCriteria) => {
    return jobs.find(j => jobMatchesCriteria(j, criteria) && !isTerminalJobStatus(j.status));
  }, [jobs]);

  const findLatestTerminalJob = useCallback((criteria: JobLookupCriteria & { withResult?: boolean }) => {
    return jobs.find(j => {
      if (!jobMatchesCriteria(j, criteria) || !isTerminalJobStatus(j.status)) return false;
      return !criteria.withResult || j.result !== undefined;
    });
  }, [jobs]);

  const jobsForWorkspace = useCallback((workspaceId: string | undefined) => {
    return jobs.filter(j => jobBelongsToPanel(j, workspaceId));
  }, [jobs]);

  const dismissJob = useCallback((jobId: string) => {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, dismissed: true } : j));
  }, []);

  const cancelJobFn = useCallback(async (jobId: string) => {
    try {
      await del(`/api/jobs/${jobId}`);
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  }, []);

  const clearDone = useCallback((workspaceId?: string) => {
    setJobs(prev => prev.filter(j => {
      const visibleInPanel = jobBelongsToPanel(j, workspaceId);
      return !visibleInPanel || !isTerminalJobStatus(j.status);
    }));
    const query = workspaceId
      ? `workspaceId=${encodeURIComponent(workspaceId)}`
      : 'scope=global';
    del(`/api/jobs/completed?${query}`).catch((err) => { console.error('useBackgroundTasks operation failed:', err); });
  }, []);

  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');

  return (
    <BackgroundTaskContext.Provider value={{ jobs, activeJobs, startJob, trackJob, getJobResult, findActiveJob, findLatestTerminalJob, jobsForWorkspace, cancelJob: cancelJobFn, dismissJob, clearDone }}>
      {children}
    </BackgroundTaskContext.Provider>
  );
}

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTaskContext);
  if (!ctx) throw new Error('useBackgroundTasks must be used within BackgroundTaskProvider');
  return ctx;
}
