# Brand Engine — Contracts and Patterns

Reference for developers working with the Copy & Brand Engine (Phase 1: Brandscript + Voice Calibration + Brand Identity; Phase 3: Copy Pipeline).

Read this before touching: `server/prompt-assembly.ts`, `server/voice-calibration.ts`, `server/seo-context.ts`, `server/brand-identity.ts`, or any endpoint that injects voice context into an AI prompt.

---

## Overview

The brand engine has three phases:

- **Phase 1** — Discovery ingestion → Brandscript → Voice Calibration → Brand Identity
- **Phase 2** — Page Strategy Engine (blueprints and section plans)
- **Phase 3** — Copy Pipeline (section-level copy generation using brand context)

Data flow: raw source material (transcripts, docs) is ingested and extracted into voice patterns and story elements. Those feed a `VoiceProfile` (DNA + guardrails + samples) and a `Brandscript`. Brand Identity deliverables are generated from both. Approved deliverables and approved copy sections feed back as voice samples for the next calibration cycle.

All context builders live in `server/seo-context.ts`. Prompt layer injection lives in `server/prompt-assembly.ts`. State machine enforcement lives in `server/voice-calibration.ts`.

---

## Critical Rule: Prompt Layers Must Not Duplicate Content

This is the most consequential rule in the brand engine. Violating it sends contradictory or redundantly weighted voice instructions to the model, and the bug is invisible — the response just degrades.

### Three-Layer Architecture

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
```

`buildSystemPrompt(workspaceId, baseInstructions, customNotes?)` assembles all three layers into a single string joined by `\n\n`. Call it once per request, pass the result as the system prompt.

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
): string
```

Reads `voice_profiles` and `workspaces.custom_prompt_notes` from the DB on each call. If `customNotes` is provided as an argument, the DB query for custom notes is skipped (avoids a duplicate read when the caller has already fetched it for hashing).

Layer 2 is a no-op when no `voice_profiles` row exists or when `status !== 'calibrated'`. The function degrades gracefully when the `voice_profiles` table does not exist (test environments without migrations).

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

**Where it lives:** `isVoiceProfileAuthoritative()` in `server/seo-context.ts` (not exported — internal to that module)

**Rule:** the modern voice profile replaces the legacy `workspace.brandVoice` + brand-docs block only when one of two conditions is met:

1. `profile.status === 'calibrated'` — the profile is fully calibrated; `buildSystemPrompt` Layer 2 is active.
2. `profile.voiceDNA != null || profile.guardrails != null` AND the rendered `voiceProfileBlock` string is non-empty — the admin has explicitly committed DNA or guardrails while still in draft.

Voice samples alone do NOT trigger the authority override. A draft profile with only uploaded samples is in a "preparing to calibrate" state. The legacy brand voice remains active until the admin explicitly saves DNA or guardrails, or runs calibration to completion.

This decision is applied consistently in both branches of `buildSeoContext()` (with strategy and without strategy) using the shared helper. Do not hand-roll this check — copy it from the helper or call the helper.

**Effect:** `SeoContext.brandVoiceBlock` (returned by `buildSeoContext`) always reflects whichever source was actually injected into the prompt. When the voice profile is authoritative, `brandVoiceBlock` is the voice profile block, not the legacy field.

---

## Context Assembly Functions

All three builders live in `server/seo-context.ts`. These are the Phase 1 → Phase 2 contract surface; Phase 3 also calls them directly.

### buildBrandscriptContext()

```typescript
buildBrandscriptContext(workspaceId: string, emphasis?: ContextEmphasis): string
```

Returns a `BRAND NARRATIVE` block from the most recently created brandscript. Only includes sections with non-empty `content`. Returns `''` if no brandscript exists or all sections are empty. Wrapped in `safeBrandEngineRead` — degrades to `''` if the `brandscripts` table doesn't exist (test environments).

### buildVoiceProfileContext()

```typescript
buildVoiceProfileContext(
  workspaceId: string,
  emphasis?: ContextEmphasis,
  profileArg?: (VoiceProfile & { samples: VoiceSample[] }) | null,
): string
```

Returns a `BRAND VOICE PROFILE` block. Respects the calibration status contract: when calibrated, injects only voice samples (DNA + guardrails come from Layer 2). When not calibrated, injects DNA + samples + guardrails.

The `profileArg` parameter is a hot-path optimization. Pass the already-fetched profile to avoid a second DB read. Sentinel semantics: `undefined` means "fetch it"; `null` means "caller already checked, no profile — return empty." Do not pass `null` speculatively — only pass it when you know the profile does not exist.

### buildIdentityContext()

```typescript
buildIdentityContext(workspaceId: string, emphasis?: ContextEmphasis): string
```

Returns a `BRAND IDENTITY` block from approved (`status === 'approved'`) brand identity deliverables only. Draft deliverables are excluded. Returns `''` if no approved deliverables exist. Wrapped in `safeBrandEngineRead`.

### ContextEmphasis

```typescript
type ContextEmphasis = 'full' | 'summary' | 'minimal';
```

Controls how much context each builder emits. Defaults to `'full'`. Phase 3 uses `'summary'` or `'minimal'` for token-sensitive generation paths. See each function's implementation for what each level includes.

---

## VoiceProfile State Machine

**File:** `server/voice-calibration.ts`

Status values: `'draft'` → `'calibrating'` → `'calibrated'`

Legal transitions:

| From | Legal targets |
|------|--------------|
| `draft` | `draft`, `calibrating` |
| `calibrating` | `calibrating`, `draft`, `calibrated` |
| `calibrated` | `calibrated`, `draft`, `calibrating` |

`draft → calibrated` is illegal. The only path to `calibrated` is through `calibrating`, which runs the calibration pipeline that populates `voiceDNA` and `guardrails`. Skipping to `calibrated` without running the pipeline would let `buildSystemPrompt` Layer 2 inject `null` DNA and guardrails into every system prompt.

Illegal transitions throw `VoiceProfileStateTransitionError` (exported from `server/voice-calibration.ts`). Callers should catch this and return HTTP 400.

The transition guard is enforced in `updateVoiceProfile()`, which is the only write path. All callers — route handlers, internal flows, test harnesses — flow through it.

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

**File:** `server/seo-context.ts` (internal, not exported)

A narrow try/catch wrapper used around all brand-engine DB reads inside `buildSeoContext`. It catches only `no such table` and `no such column` SQLite errors (test environments without migrations) and returns the provided fallback. All other errors are re-thrown so programming bugs surface loudly rather than silently degrading in production.

Pattern used by: `buildBrandscriptContext`, `buildVoiceProfileContext`, `buildIdentityContext`, `buildCopyIntelligenceContext`, `buildBlueprintContext`, and the `getVoiceProfile` calls inside `buildSeoContext`.

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
