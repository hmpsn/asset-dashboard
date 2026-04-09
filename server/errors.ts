// server/errors.ts
// Shared error classification utilities for assembler catch blocks.
//
// isProgrammingError — returns true for JS engine errors that indicate a code
// bug: wrong export name, renamed function, null dereference, syntax mistake.
// These should surface as log.warn so Sentry can alert on them, even though the
// assembler continues with a degraded fallback.
//
// Everything else (plain Error: no such table, ENOENT, network timeout, module
// unavailable on older DBs) is expected degradation — log at debug or skip silently.

export function isProgrammingError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof RangeError
  );
}
