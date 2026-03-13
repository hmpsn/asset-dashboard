import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { get, post, del } from '../api/client';

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
  startJob: (type: string, params: Record<string, unknown>) => Promise<string | null>;
  getJobResult: (jobId: string) => unknown | undefined;
  cancelJob: (jobId: string) => Promise<void>;
  dismissJob: (jobId: string) => void;
  clearDone: () => void;
}

const BackgroundTaskContext = createContext<BackgroundTaskContextValue>({
  jobs: [],
  activeJobs: [],
  startJob: async () => null,
  getJobResult: () => undefined,
  cancelJob: async () => {},
  dismissJob: () => {},
  clearDone: () => {},
});

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
            setJobs(prev => {
              const idx = prev.findIndex(j => j.id === job.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], ...job };
                return next;
              }
              return [job, ...prev];
            });
          }
        } catch { /* ignore parse errors */ }
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
      .catch(() => {});
  }, []);

  const startJob = useCallback(async (type: string, params: Record<string, unknown>): Promise<string | null> => {
    try {
      const data = await post<{ jobId?: string; error?: string }>('/api/jobs', { type, params });
      if (data.jobId) return data.jobId;
      console.error('Failed to start job:', data.error);
      return null;
    } catch (err) {
      console.error('Failed to start job:', err);
      return null;
    }
  }, []);

  const getJobResult = useCallback((jobId: string) => {
    return jobs.find(j => j.id === jobId)?.result;
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

  const clearDone = useCallback(() => {
    setJobs(prev => prev.filter(j => j.status === 'pending' || j.status === 'running'));
  }, []);

  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');

  return (
    <BackgroundTaskContext.Provider value={{ jobs, activeJobs, startJob, getJobResult, cancelJob: cancelJobFn, dismissJob, clearDone }}>
      {children}
    </BackgroundTaskContext.Provider>
  );
}

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTaskContext);
  if (!ctx) throw new Error('useBackgroundTasks must be used within BackgroundTaskProvider');
  return ctx;
}
