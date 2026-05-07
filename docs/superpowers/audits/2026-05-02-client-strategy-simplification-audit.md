# Client Strategy Simplification Audit

Date: 2026-05-02

## Scope

This audit covers the client-facing SEO Strategy route and the direct keyword-map child component only.

Touched implementation surfaces:

- `src/components/client/StrategyTab.tsx`
- `src/components/client/PageKeywordMapContent.tsx`

## Reused Platform Wiring

The simplification keeps the existing data and action model intact:

- Public keyword feedback stays wired through `/api/public/keyword-feedback/:workspaceId`.
- Priority-keyword add/remove continues to use `/api/public/tracked-keywords/:workspaceId`.
- Business-priority inputs continue to use `/api/public/business-priorities/:workspaceId`.
- Strategy requests continue to use `/api/public/content-request/:workspaceId`.
- Brief and full-post requests still flow through `PricingConfirmationModal` and the existing payment/request handling.
- Tier gating remains handled by `TierGate`.

## Reused UI Primitives

The route continues to use the platform primitives and styleguide tokens rather than adding ad-hoc styling systems:

- `Button` for primary/secondary actions where practical.
- Existing `Icon`/lucide icon pattern.
- Existing surface, border, text, radius, and accent tokens.
- `PageKeywordMapContent` remains the page-level keyword detail surface rather than duplicating a second map.

## Simplification Decisions

- Client-facing keyword language is collapsed to `Priority Keywords`; internal `siteKeywords`, `trackedKeywords`, and keyword feedback remain separate.
- The page now leads with `Strategy Snapshot` and `Recommended Next Steps`.
- Main strategy sections are framed as `Create Content`, `Improve Pages`, and `Keyword Map`.
- Noisy competitor terms are framed as `Review Keyword Ideas`, not automatic recommendations.
- Keyword Map is treated as advanced detail and starts collapsed by default.

## Non-Goals

- No server schema changes.
- No new public routes.
- No new backend keyword model.
- No changes to admin strategy generation.
- No changes to production publishing behavior.
