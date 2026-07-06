import { describe, expect, it } from 'vitest';
import { ADMIN_EVENTS, WS_EVENTS } from '../../server/ws-events.js';

function hasDuplicateValues(record: Record<string, string>): boolean {
  const values = Object.values(record);
  return new Set(values).size !== values.length;
}

describe('ws-events constants', () => {
  it('keeps workspace event names unique', () => {
    expect(hasDuplicateValues(WS_EVENTS)).toBe(false);
  });

  it('keeps admin event names unique', () => {
    expect(hasDuplicateValues(ADMIN_EVENTS)).toBe(false);
  });

  it('uses expected namespace format for representative events', () => {
    expect(WS_EVENTS.WORKSPACE_UPDATED).toBe('workspace:updated');
    expect(WS_EVENTS.BULK_OPERATION_FAILED).toBe('bulk-operation:failed');
    expect(ADMIN_EVENTS.QUEUE_UPDATE).toBe('queue:update');
  });
});
