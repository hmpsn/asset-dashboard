# Keyword Normalization And Route Reliability

Keyword equality in the operating loop must use the shared canonical comparison helper from `shared/keyword-normalization.ts`.

Use `keywordComparisonKey()` / `normalizeKeywordForComparison()` for:

- keyword dedupe and map/set keys
- strategy, rank-tracking, feedback, Command Center, Page Intelligence, and client Strategy joins
- declined/requested/approved feedback matching
- local-intent keyword matching in future local SEO work

Do not use the shared comparison key for:

- user-facing display strings
- provider request payloads where exact seed wording matters
- provider/cache keys that intentionally preserve raw keyword text
- URL/path normalization or non-keyword text fields

The helper is intentionally conservative: lowercase, punctuation to spaces, whitespace collapse, and trim. It does not stem, translate, remove city/service-area modifiers, or treat different local markets as equivalent.

High-value keyword-loop routes should fail through explicit Express error handling. Prefer existing route-local `try/catch next(err)` patterns over unhandled async route promises when touching Strategy, Rank Tracker, Command Center, client keyword feedback, or recommendation endpoints.
