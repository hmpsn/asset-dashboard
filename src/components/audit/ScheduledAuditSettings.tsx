import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { put } from '../../api/client';
import { useAuditSchedule } from '../../hooks/admin';
import type { AuditSchedule } from '../../hooks/admin/useAdminSeo';
import { queryKeys } from '../../lib/queryKeys';
import { Icon, SectionCard, Button } from '../ui';

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
    <SectionCard>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon as={Clock} size="md" className="text-[var(--brand-text)]" />
          <span className="t-caption font-medium text-[var(--brand-text-bright)]">Scheduled Audits</span>
          {schedule?.enabled && (
            <span className="t-caption-sm px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>
          )}
          {schedule?.lastRunAt && (
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Last: {new Date(schedule.lastRunAt).toLocaleDateString()}</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowSchedule(!showSchedule)}
          className="t-caption-sm text-teal-400 hover:text-teal-300 px-0 py-0 bg-transparent hover:bg-transparent"
        >
          {showSchedule ? 'Hide' : 'Configure'}
        </Button>
      </div>
      {showSchedule && (
        <div className="mt-3 pt-3 border-t border-[var(--brand-border)] space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-1">Run Every</label>
              <select
                value={scheduleInterval}
                onChange={e => setScheduleInterval(Number(e.target.value))}
                className="w-full px-2 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)]"
              >
                <option value={1}>Daily</option>
                <option value={7}>Weekly</option>
                <option value={14}>Every 2 Weeks</option>
                <option value={30}>Monthly</option>
              </select>
            </div>
            <div>
              <label className="t-caption-sm text-[var(--brand-text-muted)] block mb-1">Alert on Score Drop &gt;</label>
              <select
                value={scheduleThreshold}
                onChange={e => setScheduleThreshold(Number(e.target.value))}
                className="w-full px-2 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)]"
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
              <Button
                variant="primary"
                size="sm"
                loading={scheduleSaving}
                onClick={() => saveSchedule(true)}
              >
                {scheduleSaving ? 'Saving...' : 'Enable Schedule'}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  loading={scheduleSaving}
                  onClick={() => saveSchedule(true)}
                >
                  {scheduleSaving ? 'Saving...' : 'Update'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={scheduleSaving}
                  onClick={() => saveSchedule(false)}
                >
                  Disable
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
