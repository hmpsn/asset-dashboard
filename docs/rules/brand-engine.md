# Brand Engine — Contracts and Patterns

Reference for developers working with the Copy & Brand Engine (Phase 1: Brandscript + Voice Calibration + Brand Identity; Phase 3: Copy Pipeline).

Read this before touching: `server/prompt-assembly.ts`, `server/voice-calibration.ts`, `server/intelligence/seo-context-source.ts`, `server/intelligence/seo-context-slice.ts`, `server/brand-identity.ts`, or any endpoint that injects voice context into an AI prompt.

---

## Overview

The brand engine has three phases:

- **Phase 1** — Discovery ingestion → Brandscript → Voice Calibration → Brand Identity
- **Phase 2** — Page Strategy Engine (blueprints and section plans)
- **Phase 3** — Copy Pipeline (section-level copy generation using brand context)

Data flow: raw source material (transcripts, docs) is ingested and extracted into voice patterns and story elements. Those feed a `VoiceProfile` (DNA + guardrails + samples) and a `Brandscript`. Brand Identity deliverables are generated from both. Approved deliverables and approved copy sections feed back as voice samples for the next calibration cycle.

Workspace intelligence assembles the SEO context in `server/intelligence/seo-context-slice.ts`. Raw brand/knowledge reads and voice-profile authority live in `server/intelligence/seo-context-source.ts`. Prompt layer injection lives in `server/prompt-assembly.ts`. Mutable-profile state enforcement lives in `server/voice-calibration.ts`; durable generation readiness and finalization history live in `server/domains/brand/voice-finalization.ts`.

---

## Critical Rule: Prompt Layers Must Not Duplicate Content

This is the most consequential rule in the brand engine. Violating it sends contradictory or redundantly weighted voice instructions to the model, and the bug is invisible — the response just degrades.

### Four-Layer Architecture

```
Layer 1 — Base task instructions
  Caller supplies: feature-specific system prompt string
  Example: "You are a copywriter matching a specific brand voice."

Layer 2 — Voice DNA + guardrails (injected by buildSystemPrompt)
  Activates when: voice_profiles.status === 'calibrated'
  What it injects: voiceDNAToPromptInstructions(dna) + guardrailsToPromptInstructions(guardrails)
  Function: buildSystemPrompt() in server/prompt-assembly.ts
  Format: "Voice profile for this client: ... Voice guardrails: ..."

Layer 3 — Per-workspace custom notes
  Activates when: workspaces.custom_prompt_notes is non-empty
  What it injects: "Additional context for this client:\n{notes}"
  Function: buildSystemPrompt() in server/prompt-assembly.ts

Layer 4 — Universal prose quality rules
  Activates by default for every buildSystemPrompt() call
  What it injects: anti-generic-writing rules from server/writing-quality.ts
  Skip hatch: buildSystemPrompt(workspaceId, base, notes, { skipProseRules: true })
```

`buildSystemPrompt(workspaceId, baseInstructions, customNotes?, opts?)` assembles all layers into a single string joined by `\n\n`. Call it once per request, pass the result as the system prompt.

### The No-Duplicate Contract

When `profile.status === 'calibrated'`, Layer 2 already injects DNA and guardrails into the system prompt. Any user-prompt or context builder that also inlines those fields creates a duplicate injection.

**Never** inline voice DNA or guardrails manually in a user prompt. **Always** use `buildVoiceCalibrationContext(profile)` from `server/voice-calibration.ts` — it returns empty strings for `dnaText` and `guardrailsText` when the profile is calibrated, making it safe to call at any status without checking first.

```
Wrong:
  const userPrompt = `... VOICE DNA: ${renderVoiceDNA(profile.voiceDNA)} ...`;

Right:
  const { samplesText, dnaText, guardrailsText } = buildVoiceCalibrationContext(profile);
  const userPrompt = `...${samplesText}${dnaText}${guardrailsText}`;
```

---

## buildSystemPrompt()

**File:** `server/prompt-assembly.ts`

**Signature:**
```typescript
buildSystemPrompt(
  workspaceId: string,
  baseInstructions: string,
  customNotes?: string | null,
  opts?: { skipProseRules?: boolean },
): string
```

Reads `voice_profiles` and `workspaces.custom_prompt_notes` from the DB on each call. If `customNotes` is provided as an argument, the DB query for custom notes is skipped (avoids a duplicate read when the caller has already fetched it for hashing).

Layer 2 is a no-op when no `voice_profiles` row exists or when `status !== 'calibrated'`. The function degrades gracefully when the `voice_profiles` table does not exist (test environments without migrations).

Layer 4 appends the universal prose quality rules by default. Use `{ skipProseRules: true }` only when the caller already includes the same rules or intentionally supplies a complete style system, such as copy generation paths that own richer writing-quality instructions. Do not skip Layer 4 just to save tokens.

## Writing Rule Selection

**File:** `server/writing-quality.ts`

Use the smallest ruleset that protects the output contract:

- `PROSE_QUALITY_RULES` — default Layer 4 guardrails for general prose callers through `buildSystemPrompt()`.
- `CREATIVE_WRITING_RULES` — lean creative-copy contract for content posts and copy pipeline generation. It keeps factual safety and output discipline strict while avoiding a long wall of phrase bans.
- `WRITING_QUALITY_RULES` — full legacy ruleset for paths that deliberately need exhaustive writing constraints.

Callers that inject either `CREATIVE_WRITING_RULES` or `WRITING_QUALITY_RULES` into their own task prompt must call `buildSystemPrompt(..., { skipProseRules: true })`. This avoids double-weighting anti-generic-writing instructions and preserves room for brand voice, page-type guidance, and approved samples to shape the final copy.

## Page-Type and Brand Context Priority

**File:** `server/page-type-copy-contract.ts`

Creative generation callers that receive rich brand inputs must include the shared page-type copy contract. The contract keeps calibrated voice, business knowledge, personas, approved identity deliverables, and copy patterns from overpowering page architecture.

Priority order for content posts and copy pipeline generation:

1. Factual safety and output format.
2. Page type, conversion goal, and word budget.
3. Brand voice and tone.
4. Brand identity, business knowledge, personas, and approved deliverables as selective support.

Brand context should choose vocabulary, proof, positioning, and rhythm. It must not add extra sections, repeated CTAs, duplicated proof blocks, or longer copy simply because more brand context is present. Service, location, landing, homepage, and product pages are density-reviewed during unification; blogs, pillars, and resources retain permission for deeper educational structure.

Content brief and outline generation must apply the same priority before prose generation starts. Fresh briefs and outline regeneration should create right-sized skeletons for the page type: conversion pages get compact section counts, capped subheading density, one closing CTA path, and deterministic trimming of duplicate close/contact sections. Brand identity and voice can shape the outline's proof and positioning, but page architecture and word budget outrank any temptation to expand because richer brand context is available.

## Content Generation Style Selector

Content briefs and generated posts may carry a `generationStyle` value: `standard`, `concise`, or `hybrid`. The style selector is an admin-facing density and rhythm control, not a replacement for page type or brand voice.

Priority order when a style is present:

1. Factual safety and output format remain mandatory.
2. Page type, conversion goal, and word budget still outrank the selected style.
3. `generationStyle` shapes density, rhythm, and how much supporting detail to include.
4. Brand voice/context chooses wording, proof, and positioning inside that density.

`standard` keeps balanced SEO depth and brand voice. `concise` asks for the shortest complete version that still feels useful and trustworthy. `hybrid` keeps a compact skeleton but allows sharper POV, proof, and positioning where it earns its place. None of the styles may add duplicate CTAs, extra sections, or longer copy simply because richer brand context is available.

## Voice Quality Contract Harness

**File:** `tests/unit/voice-quality-contract-harness.test.ts`

This harness is the regression gate for the current voice-authority states:

- calibrated profile
- draft profile with samples only
- draft profile with DNA/guardrails
- legacy brand voice only
- no voice data

The test renders both `buildSystemPrompt()` and `buildEffectiveBrandVoiceBlock()` for each state. It verifies that calibrated DNA/guardrails live in Layer 2 without duplication, draft samples alone do not override legacy authority, draft DNA/guardrails remain prompt-visible before calibration, legacy voice still works, and no-voice workspaces still receive base instructions plus prose quality rules.

It also verifies strict output-format instructions remain first in the final system prompt. Keep subjective live-model scoring out of CI; add offline/manual eval tooling only when it cannot block the deterministic test suite.

---

## buildVoiceCalibrationContext()

**File:** `server/voice-calibration.ts`

**Signature:**
```typescript
buildVoiceCalibrationContext(profile: VoiceProfile & { samples: VoiceSample[] }): {
  samplesText: string;   // voice samples block, safe at any status
  dnaText: string;       // empty string when profile.status === 'calibrated'
  guardrailsText: string; // empty string when profile.status === 'calibrated'
}
```

**Contract:** When `profile.status === 'calibrated'`, `dnaText` and `guardrailsText` are always empty strings. This is intentional — Layer 2 of `buildSystemPrompt` already injected them. Callers append all three fields unconditionally; the empties are a no-op.

`samplesText` is always populated from `profile.samples` regardless of status. Voice samples are safe to inject at any point in the calibration lifecycle.

This helper is the only correct way to build voice context for user prompts. Phases 2 and 3 import it from `server/voice-calibration.ts` — do not write inline equivalents.

---

## Voice Profile Authority Rule

**Where it lives:** `isVoiceProfileAuthoritative()` in `server/intelligence/seo-context-source.ts` (internal profile/block predicate) plus exported `isWorkspaceVoiceProfileAuthoritative(workspaceId)` for compatibility writers that need the same resolved decision.

**Rule:** the modern voice profile replaces the legacy `workspace.brandVoice` + brand-docs block only when one of two conditions is met:

1. `profile.status === 'calibrated'` — the profile is fully calibrated; `buildSystemPrompt` Layer 2 is active.
2. `profile.voiceDNA != null || profile.guardrails != null` AND the rendered `voiceProfileBlock` string is non-empty — the admin has explicitly committed DNA or guardrails while still in draft.

Voice samples alone do NOT trigger the authority override. A draft profile with only uploaded samples is in a "preparing to calibrate" state. The legacy brand voice remains active until the admin explicitly saves DNA or guardrails, or runs calibration to completion.

This decision is applied inside `buildEffectiveBrandVoiceBlock()` and consumed by `assembleSeoContext()`. Do not hand-roll this check — keep authority decisions in the source helper.

**Effect:** `SeoContextSlice.effectiveBrandVoiceBlock` always reflects whichever source was actually injected into the prompt. When the voice profile is authoritative, the effective block is the voice profile block, not the legacy workspace/doc field.

---

## SEO Context Voice Source

`assembleSeoContext()` owns the prompt-facing SEO context. It calls `buildEffectiveBrandVoiceBlock()` from `server/intelligence/seo-context-source.ts`, which chooses between the legacy workspace/docs brand voice and the modern voice profile using the authority rule above.

### buildVoiceProfileContext()

```typescript
buildVoiceProfileContext(
  workspaceId: string,
  emphasis?: ContextEmphasis,
  profileArg?: (VoiceProfile & { samples: VoiceSample[] }) | null,
): string
```

Internal helper in `server/intelligence/seo-context-source.ts`. Returns a `BRAND VOICE PROFILE` block. Respects the calibration status contract: when calibrated, injects only voice samples (DNA + guardrails come from Layer 2). When not calibrated, injects DNA + samples + guardrails.

The `profileArg` parameter is a hot-path optimization. Pass the already-fetched profile to avoid a second DB read. Sentinel semantics: `undefined` means "fetch it"; `null` means "caller already checked, no profile — return empty." Do not pass `null` speculatively — only pass it when you know the profile does not exist.

### ContextEmphasis

```typescript
type ContextEmphasis = 'full' | 'summary' | 'minimal';
```

Controls how much voice profile context is emitted. Defaults to `'full'`. Token-sensitive generation paths can request `'summary'` or `'minimal'`. See the source helper for what each level includes.

---

## VoiceProfile State Machine

**Files:** `server/voice-calibration.ts`, `server/domains/brand/voice-finalization.ts`

Status values: `'draft'` → `'calibrating'` → `'calibrated'`

Legal transitions:

| From | Legal targets |
|------|--------------|
| `draft` | `draft`, `calibrating` |
| `calibrating` | `calibrating`, `draft`, `calibrated` |
| `calibrated` | `calibrated`, `draft`, `calibrating` |

`draft → calibrated` remains an illegal direct edge. The finalization service may
validate and commit the legal `draft → calibrating → calibrated` path inside one
transaction, but only after validating non-empty DNA, substantive guardrails,
and at least one durable authentic anchor. Generic profile PATCH may never set
`calibrated`.

Illegal transitions throw `VoiceProfileStateTransitionError` (exported from `server/voice-calibration.ts`). Callers should catch this and return HTTP 400.

Every mutable profile has a monotonic `revision`. DNA, guardrail, modifier, and
sample mutations use optimistic concurrency and increment it. Editing a
calibrated profile reopens it to `calibrating`; the prior immutable snapshot
remains readable but readiness becomes `stale` until an operator finalizes the
new revision.

## Durable Voice Finalization Authority

**Files:** `shared/types/voice-finalization.ts`,
`server/domains/brand/voice-finalization.ts`, migration 186.

A `status === 'calibrated'` profile remains prompt-compatible for historical
workspaces, but status alone is not generation authority. B2/M1 generation must
consume `getBrandVoiceReadiness()` and require a `finalized` immutable snapshot.
Legacy calibrated rows have no fabricated operator or anchor history and return
`missing` readiness until truthfully finalized.

Each immutable voice version freezes:

- exact profile revision, DNA, guardrails, and context modifiers;
- selected authentic anchor content plus durable source identity;
- calibration ratings/selections;
- finalizing operator, separate execution actor, timestamp, and SHA-256
  fingerprint.

Only `manual` and `transcript_extraction` voice samples may anchor a final voice.
An exact immutable `BrandIntakeAuthenticSample` may also anchor it. Generated
calibration-loop, identity-approved, and copy-approved samples can inform a
draft but cannot establish authenticity.

An authenticated HTTP operator may finalize directly. MCP keys are execution
identities, not people: `finalize_brand_voice` must consume a short-lived,
one-time bearer authorization created at the operator boundary and bound to the
complete command and expected revision. Persist only the token digest; never
accept a caller-authored operator identity or reinterpret a key as a human.
Exact idempotent replay returns the existing version without activity/event
duplication. Only a newly committed finalization may record `voice_calibrated`.

Approved `voice_guidelines` and `tone_examples` are legacy draft/evidence inputs.
When a calibrated profile already owns the voice layer, copy generation excludes
those deliverables from the identity block so they cannot compete with Layer 2.

---

## guardrailsToPromptInstructions()

**File:** `server/prompt-assembly.ts`

```typescript
guardrailsToPromptInstructions(guardrails: VoiceGuardrails): string
```

Converts a `VoiceGuardrails` object into a `Voice guardrails:` block for prompt injection. Renders four fields: `forbiddenWords`, `requiredTerminology`, `toneBoundaries`, `antiPatterns`. Omits any field whose array is empty.

Used by both Layer 2 in `buildSystemPrompt` and by `buildVoiceCalibrationContext` (for the non-calibrated path). The shared function ensures both paths produce identical formatting.

---

## Voice DNA Rendering

**File:** `server/voice-dna-render.ts`

Two functions for rendering a `VoiceDNA` object:

- `renderVoiceDNAForPrompt(dna)` — multi-line block with all fields (used for `full` and `summary` emphasis in `buildVoiceProfileContext`, and in `buildVoiceCalibrationContext`)
- `renderVoiceDNASummary(dna)` — single-line summary (used for `minimal` emphasis)

Both functions include an exhaustive-field compile check against `Record<keyof VoiceDNA, true>`. Adding a new field to `VoiceDNA` in `shared/types/brand-engine.ts` will fail the build here until the new field is handled. This prevents silent field omissions like the `vocabularyLevel` bug that went undetected for months.

`prompt-assembly.ts` (`voiceDNAToPromptInstructions`) renders DNA differently — it translates numeric `toneSpectrum` values into natural-language directives. That function also has the same exhaustive-field guard. Both renderers must cover every `VoiceDNA` field.

---

## PROMPT_TYPE_TO_SECTION_TYPE Mapping

**File:** `shared/types/brand-engine.ts`

```typescript
export const PROMPT_TYPE_TO_SECTION_TYPE: Record<string, string> = {
  'hero_headline': 'hero',
  'about_intro': 'about-team',
  'service_body': 'features-benefits',
  'cta_copy': 'cta',
  'faq_answer': 'faq',
  'testimonial_copy': 'testimonials',
  'blog_intro': 'content-body',
  'meta_description': 'seo-meta',
};
```

Maps Phase 1 calibration `promptType` values (the keys used in `CalibrationSession.promptType`) to Phase 2 section types (the values used in `BlueprintEntry` section plans). Phase 3 uses this mapping to find the best-rated calibration variation for a given section type when seeding copy generation.

---

## Copy-Approved → Voice Samples Feedback Loop

When a brand identity deliverable transitions from `draft` to `approved`, `brand-identity.ts` automatically calls `addVoiceSample()` for certain deliverable types:

| Deliverable type | Context tag | Source |
|-----------------|-------------|--------|
| `tagline` | `headline` | `identity_approved` |
| `elevator_pitch` | `body` | `identity_approved` |
| `tone_examples` | `body` | `identity_approved` |

This is the Phase 1 arm of the feedback loop. Phase 3 adds a second arm via `VoiceSampleSource = 'copy_approved'` — approved copy sections from the pipeline feed back as voice samples with the appropriate context tag.

Auto-sampling runs inside the same `db.transaction()` as the status update to prevent duplicate samples from concurrent approval requests. The sample is capped at 500 characters of content. Failure to insert the auto-sample does NOT roll back the approval — the deliverable is approved regardless.

Reverting a deliverable to `draft` does not delete the auto-created sample.

---

## safeBrandEngineRead()

**File:** `server/intelligence/seo-context-source.ts` (internal, not exported)

A narrow try/catch wrapper used around brand-engine DB reads inside the SEO context source. It catches only `no such table` and `no such column` SQLite errors (test environments without migrations) and returns the provided fallback. All other errors are re-thrown so programming bugs surface loudly rather than silently degrading in production.

Pattern used by: `buildVoiceProfileContext()` fallback reads and the `getVoiceProfile()` call inside `buildEffectiveBrandVoiceBlock()`.

---

## VoiceSampleSource Values

```typescript
type VoiceSampleSource =
  | 'manual'              // admin-entered directly
  | 'transcript_extraction' // extracted from a discovery source
  | 'calibration_loop'   // selected from a calibration session
  | 'identity_approved'  // auto-created when a brand identity deliverable is approved
  | 'copy_approved';     // Phase 3: approved copy sections become training samples
```

The `copy_approved` value is forward-declared in Phase 1's shared types so Phase 3 can use it without a type-breaking change.

---

## Workspace Scoping on Brand Engine Tables

Every `UPDATE`, `DELETE`, and non-PK `SELECT` on a brand-engine table must include `AND workspace_id = ?`. Tables without a direct `workspace_id` column (e.g. `voice_samples` which scopes through `voice_profile_id`) must JOIN through to the workspace or derive the profile ID from a workspace-scoped read.

Brand-engine tables: `brandscripts`, `brandscript_sections`, `discovery_sources`, `discovery_extractions`, `voice_profiles`, `voice_samples`, `voice_calibration_sessions`, `brand_identity_deliverables`, `brand_identity_versions`, `site_blueprints`, `blueprint_entries`, `copy_sections`.
