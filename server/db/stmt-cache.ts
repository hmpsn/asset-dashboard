/**
 * Utility for lazily initializing and caching prepared statement sets.
 *
 * Usage:
 *   const stmts = createStmtCache(() => ({
 *     insert: db.prepare(`INSERT INTO ...`),
 *     select: db.prepare(`SELECT ...`),
 *   }));
 *
 * The build function runs once on first call, then the result is cached.
 * This ensures prepared statements are created after migrations have run.
 */
export function createStmtCache<T>(build: () => T): () => T {
  let cached: T | null = null;
  return () => {
    if (!cached) cached = build();
    return cached;
  };
}
