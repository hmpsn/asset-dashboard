# Lexicon — the enforced vocabulary contract

> **Root vocabulary contract for the platform.** `GLOSSARY.md` is no longer a
> reference document you can drift from — it is enforced against a machine-readable
> registry (`shared/types/lexicon.ts`) by `npm run verify:lexicon`
> (`scripts/lexicon-registry.ts`), which runs in CI (pr-ci-blocking) and nightly
> (`pr-check --all`).

## What the lexicon is (and is not)

The lexicon **points at** the owning modules for every domain word; it never
**re-declares** a union or enum. `server/activity-log.ts` still owns `ActivityType`;
`server/ws-events.ts` still owns `WS_EVENTS`; `server/state-machines.ts` still owns the
transition maps. The registry adds two things on top:

1. **Word classes** — a governance tag on each term (see below).
2. **Duplicate-name governance** — an allowlist of exported type/interface names that
   legitimately collide across `shared/` + `server/`, each tagged with the ticket that
   will resolve it.

The label layer (`docs/workflows/ui-vocabulary.md`) sits **on top of** the lexicon: the
lexicon governs the internal/domain word; ui-vocabulary governs the user-facing button
and badge wording for that word. The lexicon references ui-vocabulary; it does not
absorb it. R12's client-vocabulary translation map is built on the ui-vocabulary layer.

## Word classes

| Class | Meaning | Rename policy |
|---|---|---|
| **canonical** | A core domain term the platform owns and defines. | Rename via a normal string-literal rename (grep whole repo, one commit). |
| **externally-mirrored** | Spelling/values dictated by a third party (Stripe, GBP, Webflow). | **Never rename** — renaming breaks the integration. Tagged with `externalSource`. |
| **historical** | Append-only / write-time-frozen (e.g. `ActivityType` members already in `activity_log` rows). | **Never rename a persisted value.** Renderers must tolerate retired/unknown words. New members are additive-only and need a registry entry. |
| **proposed** | Snapshotted from the untracked redesign mockup. | **No live identifier renamed, no type reserved.** Carries `resolvingTicket`; the redesign phase promotes it to canonical or drops it. |

The **historical** class aligns with the `deprecated → hidden → migrated → removed`
taxonomy in [`docs/rules/deprecation-lifecycle.md`](deprecation-lifecycle.md): a
historical value is *frozen-but-live*, distinct from a *removed* value.

## PROPOSED intake process

The redesign mockup (`hmpsn studio Design System/mockup/`) is **untracked** — it is not
in version control. When new vocabulary appears there (or in any design source that will
feed a build), intake it as **proposed**:

1. Snapshot the term + a one-line definition into `GLOSSARY.md` under `## proposed` and
   add a matching entry to `LEXICON` in `shared/types/lexicon.ts` with
   `wordClass: 'proposed'` and a `resolvingTicket`.
2. Do **not** rename any live identifier and do **not** reserve a TypeScript type. A
   proposed term is a governed placeholder, not a commitment.
3. When the redesign phase builds the term for real, flip it to `canonical` (and update
   its definition + `canonicalType`/`declarationSites`) or delete it if it was dropped.

This keeps the P2 rebuild from inheriting a conflicted lexicon (proposed mockup words
like "Insights Engine" / "strategy signal" overlap the canonical **Insight** /
recommendation concepts — recording them as proposed makes the overlap explicit).

## Duplicate-name allowlist + burn-down rule

`DUPLICATE_NAME_ALLOWLIST` in `shared/types/lexicon.ts` grandfathers the
duplicate-exported-name census (30 names verified 2026-07-01, each declared in exactly
two files across `shared/` + `server/`). The verifier's live scan fails on **any**
exported `type`/`interface` name declared in 2+ files that is **not** on the allowlist —
so a new accidental collision (e.g. a barrel importer silently resolving the wrong
`DeliverableStatus`) is caught.

**Every allowlist entry carries a `resolvingTicket`:**

- `R2` — the two brand-artifact `Deliverable*` names, resolved when R2 renames them to
  `BrandDeliverable*`.
- `permanent` — mirror/twin pairs duplicated by design (server data-fetcher shapes
  mirrored into `shared/types` for the client; server-internal near-duplicates).
  Consolidating them is a separate ticket with its own read-path risk.

**Burn-down rule:** when a ticket removes a duplicate (a rename or a genuine merge), it
**removes the allowlist entry in the same commit**. The allowlist only ever shrinks;
adding to it requires an explicit, justified `resolvingTicket` (never a bare grandfather).
The `permanent` entries are the floor — they document *why* the duplication is
intentional so a future reviewer doesn't "fix" a by-design mirror.

## The verifier (`npm run verify:lexicon`)

Three checks, all pure and deterministic:

1. **GLOSSARY ↔ registry parity, both directions** — every `LEXICON` term has a
   `GLOSSARY.md` entry and vice versa (terms are normalized: backticks stripped,
   whitespace collapsed).
2. **Live duplicate-name scan** — anchored `^export (type|interface) NAME` declarations
   across `shared/types/` + `server/`; a name in 2+ files not on the allowlist fails.
   Re-exports (`export type * from`, `export type { X }`) and indented (non-top-level)
   declarations are excluded by the anchor.
3. **Allowlist hygiene** — every entry has a non-empty `resolvingTicket`.

Registration surface (a new `verify:*` script needs all four): `package.json`,
`scripts/verify-platform.ts` (aggregate suite), `scripts/report-verification-governance.ts`
(classification — `pr-ci-blocking`), and `.github/workflows/ci.yml` (quality-job step).

## Relationship to the upcoming pr-check rules

A follow-up task adds two `pr-check` customChecks that read `LEXICON` /
`DUPLICATE_NAME_ALLOWLIST`:

1. **duplicate-exported-domain-type-name** — the diff-time analogue of check (2) above:
   a newly-added `export type|interface` whose name already exists elsewhere and isn't
   allowlisted fails.
2. **ActivityType minting guard** — a new member added to the `ActivityType` union in
   `server/activity-log.ts` without a matching lexicon registry entry fails.

`verify:lexicon` is the full-scan invariant (registry integrity); the pr-check rules are
the per-diff guards (catch a regression as it's introduced). Both read the same registry —
the registry is the single source of truth.

## Not to be confused with

`src/components/client/SeoGlossary.tsx` has its own `GLOSSARY` const — a client-facing
SEO-term glossary UI, unrelated to this developer domain lexicon. No coupling exists;
the name overlap is noted here to prevent confusion.
