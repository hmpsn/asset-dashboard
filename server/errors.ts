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
//
// ⚠ SyntaxError caveat: the built-in JSON parser also throws SyntaxError for
// malformed input, which is expected degradation (not a code bug). Do NOT call
// isProgrammingError() inside catch blocks that wrap JSON parsing — use the
// parseJsonSafe helper from server/db/json-validation.ts instead.
//
// ⚠ TypeError caveat: `new URL(invalidInput)` throws TypeError for malformed
// URLs. When the input comes from user data, scraped pages, or external APIs,
// this is expected validation — not a code bug. Do NOT call isProgrammingError()
// inside catch blocks that wrap `new URL()` on external/user-supplied strings.
//
// ⚠ TypeError caveat: Node.js `fetch()` throws TypeError for network failures
// (DNS resolution, connection refused, TLS errors). When fetching external URLs
// or third-party APIs, this is expected degradation — not a code bug. Do NOT call
// isProgrammingError() inside catch blocks that wrap `fetch()` on external URLs.

export function isProgrammingError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof RangeError
  );
}
