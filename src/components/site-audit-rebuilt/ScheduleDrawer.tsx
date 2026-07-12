// @ds-rebuilt
import { useEffect, useState } from 'react';
import { Button, Drawer, FormSelect, Icon, MetricTile, Toggle } from '../ui';
import type { AuditSchedule } from '../../hooks/admin/useAdminSeo';
import { dateOrDash } from './siteAuditFormatters';

interface ScheduleDrawerProps {
  open: boolean;
  onClose: () => void;
  schedule: AuditSchedule | null | undefined;
  saving: boolean;
  onSave: (enabled: boolean, intervalDays: number, scoreDropThreshold: number) => Promise<AuditSchedule>;
  onSaved: (enabled: boolean) => void;
  onError: (error: unknown) => void;
}

export function ScheduleDrawer({
  open,
  onClose,
  schedule,
  saving,
  onSave,
  onSaved,
  onError,
}: ScheduleDrawerProps) {
  const [enabled, setEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState(7);
  const [scoreDropThreshold, setScoreDropThreshold] = useState(5);

  useEffect(() => {
    if (!schedule) return;
    setEnabled(schedule.enabled);
    setIntervalDays(schedule.intervalDays);
    setScoreDropThreshold(schedule.scoreDropThreshold);
  }, [schedule]);

  const handleSave = async () => {
    try {
      await onSave(enabled, intervalDays, scoreDropThreshold);
      onSaved(enabled);
      onClose();
    } catch (error) {
      onError(error);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Scheduled Audits"
      eyebrow="Site Audit"
      subtitle="Run a recurring audit and alert operators when health drops."
      width={420}
      footer={(
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving}>
            Save schedule
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <MetricTile
            label="Last run"
            value={dateOrDash(schedule?.lastRunAt)}
            sub={schedule?.enabled ? 'schedule active' : 'manual only'}
          />
          <MetricTile
            label="Last score"
            value={schedule?.lastScore ?? '—'}
            sub="saved snapshot"
          />
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            label="Enable scheduled audits"
          />
          <p className="t-body text-[var(--brand-text-muted)] mt-2">
            Enabled schedules run in the background and reuse the same snapshot history.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="t-label text-[var(--brand-text-muted)] block mb-1.5" htmlFor="site-audit-schedule-interval">
              Run every
            </label>
            <FormSelect
              id="site-audit-schedule-interval"
              value={String(intervalDays)}
              onChange={(value) => setIntervalDays(Number(value))}
              options={[
                { value: '1', label: 'Daily' },
                { value: '7', label: 'Weekly' },
                { value: '14', label: 'Every 2 weeks' },
                { value: '30', label: 'Monthly' },
              ]}
            />
          </div>
          <div>
            <label className="t-label text-[var(--brand-text-muted)] block mb-1.5" htmlFor="site-audit-schedule-threshold">
              Alert on score drop
            </label>
            <FormSelect
              id="site-audit-schedule-threshold"
              value={String(scoreDropThreshold)}
              onChange={(value) => setScoreDropThreshold(Number(value))}
              options={[
                { value: '3', label: '3 points' },
                { value: '5', label: '5 points' },
                { value: '10', label: '10 points' },
                { value: '15', label: '15 points' },
              ]}
            />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-3">
          <Icon name="info" size="md" className="mt-0.5 text-[var(--blue)]" />
          <p className="t-body text-[var(--brand-text-muted)]">
            Schedules are additive to manual runs. Operators can still run an on-demand audit at any time.
          </p>
        </div>
      </div>
    </Drawer>
  );
}
