import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  deleteReminder,
  getReminderSentAt,
  hasReminder,
  markReminderSent,
  pruneReminders,
  upsertReminder,
} from '../../server/sent-reminders-db.js';

const KEY_PREFIX = 'sent-reminder-test';

function key(name: string): string {
  return `${KEY_PREFIX}:${name}`;
}

function cleanup(): void {
  db.prepare(`DELETE FROM sent_reminders WHERE key LIKE ?`).run(`${KEY_PREFIX}:%`);
}

afterEach(cleanup);

describe('sent reminders db', () => {
  it('marks reminders as sent and reads UTC-normalized timestamps', () => {
    const reminderKey = key('mark');

    expect(hasReminder(reminderKey)).toBe(false);
    expect(getReminderSentAt(reminderKey)).toBeNull();

    markReminderSent(reminderKey);

    expect(hasReminder(reminderKey)).toBe(true);
    expect(getReminderSentAt(reminderKey)).toEqual(expect.stringMatching(/Z$/));
  });

  it('markReminderSent does not overwrite an existing timestamp', () => {
    const reminderKey = key('insert-ignore');
    markReminderSent(reminderKey);
    db.prepare(`UPDATE sent_reminders SET sent_at = ? WHERE key = ?`)
      .run('2026-01-01 00:00:00', reminderKey);

    markReminderSent(reminderKey);

    expect(getReminderSentAt(reminderKey)).toBe('2026-01-01 00:00:00Z');
  });

  it('upsertReminder refreshes an existing reminder timestamp', () => {
    const reminderKey = key('upsert');
    markReminderSent(reminderKey);
    db.prepare(`UPDATE sent_reminders SET sent_at = ? WHERE key = ?`)
      .run('2026-01-01 00:00:00', reminderKey);

    upsertReminder(reminderKey);

    expect(getReminderSentAt(reminderKey)).not.toBe('2026-01-01 00:00:00Z');
  });

  it('deletes a specific reminder key', () => {
    const first = key('delete-first');
    const second = key('delete-second');
    markReminderSent(first);
    markReminderSent(second);

    deleteReminder(first);

    expect(hasReminder(first)).toBe(false);
    expect(hasReminder(second)).toBe(true);
  });

  it('prunes only reminders older than the requested SQLite modifier', () => {
    const oldKey = key('old');
    const freshKey = key('fresh');
    markReminderSent(oldKey);
    markReminderSent(freshKey);
    db.prepare(`UPDATE sent_reminders SET sent_at = ? WHERE key = ?`)
      .run('2026-01-01 00:00:00', oldKey);

    pruneReminders('-30 days');

    expect(hasReminder(oldKey)).toBe(false);
    expect(hasReminder(freshKey)).toBe(true);
  });
});
