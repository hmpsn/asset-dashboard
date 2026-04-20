import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { put } from '../../api/client';
import { useAuditSchedule } from '../../hooks/admin';
import type { AuditSchedule } from '../../hooks/admin/useAdminSeo';
import { queryKeys } from '../../lib/queryKeys';

interface ScheduledAuditSettingsProps {
  workspaceId: string;
}

export function ScheduledAuditSettings({ workspaceId }: ScheduledAuditSettingsProps) {
  const queryClient = useQueryClient();
  const { data: schedule = null } = useAuditSchedule(workspaceId);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState(7);
  const [scheduleThreshold, setScheduleThreshold] = useState(5);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Sync schedule form fields when query data arrives
  useEffect(() => {
    if (schedule) {
      setScheduleInterval(schedule.intervalDays);
      setScheduleThreshold(schedule.scoreDropThreshold);
    }
  }, [schedule]);

  const saveSchedule = async (enabled: boolean) => {
    setScheduleSaving(true);
    try {
      const updated = await put<AuditSchedule>(`/api/audit-schedules/${workspaceId}`, {
        enabled,
        intervalDays: scheduleInterval,
        scoreDropThreshold: scheduleThreshold,
      });
      queryClient.setQueryData(queryKeys.admin.auditSchedule(workspaceId), updated);
    } catch (err) {
      console.error('Failed to save schedule:', err);
    } finally {
      setScheduleSaving(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 p-5" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-medium text-zinc-300">Scheduled Audits</span>
          {schedule?.enabled && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
          )}
          {schedule?.lastRunAt && (
            <span className="text-[11px] text-zinc-500">Last: {new Date(schedule.lastRunAt).toLocaleDateString()}</span>
          )}
        </div>
        <button onClick={() => setShowSchedule(!showSchedule)} className="text-[11px] text-teal-400 hover:text-teal-300">
          {showSchedule ? 'Hide' : 'Configure'}
        </button>
      </div>
      {showSchedule && (
        <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-zinc-500 block mb-1">Run Every</label>
              <select
                value={scheduleInterval}
                onChange={e => setScheduleInterval(Number(e.target.value))}
                className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-300"
              >
                <option value={1}>Daily</option>
                <option value={7}>Weekly</option>
                <option value={14}>Every 2 Weeks</option>
                <option value={30}>Monthly</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-zinc-500 block mb-1">Alert on Score Drop &gt;</label>
              <select
                value={scheduleThreshold}
                onChange={e => setScheduleThreshold(Number(e.target.value))}
                className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-300"
              >
                <option value={3}>3 points</option>
                <option value={5}>5 points</option>
                <option value={10}>10 points</option>
                <option value={15}>15 points</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!schedule?.enabled ? (
              <button
                onClick={() => saveSchedule(true)}
                disabled={scheduleSaving}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
              >
                {scheduleSaving ? 'Saving...' : 'Enable Schedule'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => saveSchedule(true)}
                  disabled={scheduleSaving}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
                >
                  {scheduleSaving ? 'Saving...' : 'Update'}
                </button>
                <button
                  onClick={() => saveSchedule(false)}
                  disabled={scheduleSaving}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-50 transition-colors"
                >
                  Disable
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
