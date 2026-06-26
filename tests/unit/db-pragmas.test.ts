import { describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';

describe('SQLite connection PRAGMAs', () => {
  it('uses WAL with NORMAL sync and a larger cache', () => {
    const journal = db.pragma('journal_mode', { simple: true });
    const synchronous = db.pragma('synchronous', { simple: true });
    const cacheSize = db.pragma('cache_size', { simple: true });

    expect(String(journal).toLowerCase()).toBe('wal');
    expect(synchronous).toBe(1);
    expect(cacheSize).toBe(-20000);
  });
});
