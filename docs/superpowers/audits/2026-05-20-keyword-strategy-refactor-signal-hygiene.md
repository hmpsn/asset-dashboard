# Keyword Strategy Refactor + Signal Hygiene Guardrail

Date: `2026-05-20`
Owner: `analytics-intelligence`
Secondary integrations: `seo-health`, `content-pipeline`, `client-portal`, `outcomes-roi`

## Purpose

This PR is the cleanup/refactor bridge between PR12 shared keyword intelligence and the PR13 strategy UX pass. It should not add a new product surface. It makes sure the current backend primitives are safe enough for UX to explain: selected strategy keywords, tracked keyword lifecycle state, and insight-derived Strategy Signals should all respect the same keyword-quality rules.

## Repo Truth

- Keyword strategy orchestration is already split across page discovery, search-data collection, provider source collection, AI synthesis, enrichment, persistence, and post-persistence follow-ons.
- PR12 added `server/keyword-intelligence/` with shared deterministic keyword judgment, including declined-keyword suppression and observed noisy fixtures such as `paper tiger` and `typing tiger`.
- PR11 added tracked-keyword lifecycle fields and reconciliation. Strategy-owned keywords can be retired with `deprecated`/`replaced` while preserving manual, pinned, client-requested, content-gap, and recommendation-owned keywords.
- Strategy Signals are generated from persisted `analytics_insights` rows through `buildStrategySignals()`. Before this PR, that boundary did not apply shared keyword-intelligence suppression, so stale/noisy competitor-gap insights could still appear in Strategy even when generation output was clean.

## Contracts For This PR

- Final strategy outputs must pass a deterministic sanitizer before persistence and rank-tracking reconciliation.
- Sanitization is a boundary cleanup step, not a replacement for provider/source collection or AI synthesis.
- Sanitizer fallback order for page primaries is: current primary if valid, valid secondary keyword, URL-level provider keyword, GSC keyword, page title/path identity. If none is valid, drop the page mapping rather than persisting a blank or known-noisy primary.
- Strategy-owned stale/noisy rank-tracking keywords are retired through the existing reconciliation lifecycle. Do not hard-delete rank history.
- Strategy Signals should be filtered at the signal boundary and in strategy prompt inclusion when keyword context is available. Do not hard-delete or auto-resolve raw analytics insights in this PR.
- No route changes, no client payload break, no DB migration, no auto-publishing.

## Verification Focus

- Blank, declined, and known noisy generated keywords are removed before persistence.
- Legitimate business-name matches are preserved even when they look like a known noisy phrase.
- Removed strategy-owned tracked keywords disappear from active rank views but remain in inactive history with lifecycle metadata.
- Strategy Signals suppress noisy keyword-derived competitor gaps while preserving useful business-fit gaps.
- Existing broadcasts and cache invalidation remain owned by strategy persistence and rank-tracking follow-ons.
