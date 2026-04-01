# Multi-Agent Coordination Rules

> Mandatory rules for any work involving parallel subagents or multi-phase feature implementation.
> These rules supersede the informal guidance in memory feedback files and codify lessons from Phase 2 Connected Intelligence Engine (9 bugs from parallel agent coordination).

---

## Rule 1: Pre-Commit Shared Contracts Before Dispatch

Before dispatching any parallel subagents, commit all shared artifacts they will depend on:

- **Shared types** — interfaces, enums, type unions in `shared/types/`
- **Function signatures** — exported function signatures for cross-module calls
- **Barrel exports** — index files that agents will import from
- **Migration files** — DB schema that multiple services read from
- **Constants** — shared enums, config maps, mapping tables

Agents must read from committed code, never from uncommitted working state. If two agents need the same type definition, it must be committed before either agent starts.

**Anti-pattern:** Agent A creates a type. Agent B guesses the type shape. They diverge silently.

---

## Rule 2: Exclusive File Ownership Per Agent

Every file touched during parallel work must have exactly one owner. No file may be modified by two agents concurrently.

**Ownership assignment template:**

```
Agent 1 (Brandscript Service):
  OWNS (can create/modify):
    - server/brandscript.ts
    - server/routes/brandscript.ts
    - src/components/brand/BrandscriptTab.tsx
  READS (must not modify):
    - shared/types/brand-engine.ts
    - server/db/migrations/026-brandscript-engine.sql

Agent 2 (Discovery Ingestion Service):
  OWNS:
    - server/discovery-ingestion.ts
    - server/routes/discovery-ingestion.ts
    - src/components/brand/DiscoveryTab.tsx
  READS:
    - shared/types/brand-engine.ts
    - server/db/migrations/026-brandscript-engine.sql
```

**Shared files** (touched by 2+ agents) must be handled sequentially:
- `server/app.ts` — route registration (one agent at a time)
- `src/api/brand-engine.ts` — API client additions (one agent at a time)
- `server/seo-context.ts` — context builder additions (one agent at a time)
- `src/components/BrandHub.tsx` — tab additions (one agent at a time)

**When dispatching an implementer subagent, include in the prompt:**

```
## File Ownership

Files you OWN (create or modify freely):
- [list]

Files you may READ but must NOT modify:
- [list]

If you need to change a file not on your ownership list, STOP and report
back with status NEEDS_CONTEXT. Do not modify files outside your ownership.
```

---

## Rule 3: Diff Review Checkpoint After Each Parallel Batch

After all agents in a parallel batch complete:

1. `git diff` — review all modified files, especially any touched by multiple agents
2. `grep` for duplicate imports in files touched by multiple agents
3. Check for conflicting edits (two agents adding the same function, different implementations)
4. Run `npx tsc --noEmit --skipLibCheck` — type errors catch contract mismatches
5. Run full test suite — not just new tests

Only after all checks pass should the next batch be dispatched.

**Anti-pattern:** "All agents completed + tsc clean" is NOT sufficient. A duplicate import won't cause a type error but will cause a runtime error or lint failure.

---

## Rule 4: Task Dependency Graphs Must Be Explicit

Every implementation plan must include a task dependency section. Implicit ordering ("obviously Task 2 comes after Task 1") is not acceptable — subagent dispatchers don't infer dependencies.

**Required format:**

```
## Task Dependencies

Sequential (must run in order):
  Task 1 (Migration) → Task 2 (Types) → Task 3+ (Services)

Parallel after Task 2:
  Task 3 (Brandscript Service) ∥ Task 4 (Discovery Service) ∥ Task 5 (Voice Service)

Sequential shared-file tasks (after parallel batch):
  Task 7 (SEO Context builders) — touches server/seo-context.ts
  Task 8 (App.ts route registration) — touches server/app.ts

Parallel after Task 8:
  Task 9 (Frontend Tab A) ∥ Task 10 (Frontend Tab B)
```

**Rules for the dependency graph:**
- Any task that creates a file another task imports from is a dependency
- Any task that modifies a shared file is sequential with other shared-file tasks
- Frontend tasks that modify different components can run in parallel
- Backend service tasks that own different files can run in parallel

---

## Rule 5: Spec Amendment → Plan Sync (Same Commit)

When a spec is amended (addendum added, requirement changed, forward-compatibility item added), every plan that references that spec must be updated in the same commit.

**Why:** Spec addendums written after plans create invisible gaps. The plan says "implement X" but the spec now says "implement X + Y." A subagent executing the plan will implement X and miss Y.

**Checklist for spec amendments:**
- [ ] New requirement maps to an explicit task in the plan
- [ ] New types/interfaces added to the plan's shared types task
- [ ] New function signatures added to the plan's service tasks
- [ ] New DB columns added to the plan's migration task
- [ ] Forward-compatibility requirements added as explicit steps (not just comments)

**Anti-pattern:** Appending a "Forward-Compatibility Requirements" addendum to the spec without updating the plan. The spec reviewer will check the spec; the implementer will read the plan. They'll never see the addendum.

---

## Rule 6: Cross-Phase Contract Documentation

Multi-phase features must include a contracts document listing what each phase exports for downstream consumption. This document lives alongside the plans.

**Required sections:**

```markdown
## Phase 1 → Phase 2 Contracts

### Database Tables (Phase 2 reads from)
- brandscripts, brandscript_sections
- voice_profiles, voice_samples
- brand_identity_deliverables

### Exported Functions (Phase 2 calls)
- buildBrandscriptContext(workspaceId, emphasis?) → string
- buildVoiceProfileContext(workspaceId, emphasis?) → string
- getBrandscript(workspaceId, id) → Brandscript | null

### Shared Types (Phase 2 imports)
- Brandscript, VoiceProfile, BrandDeliverable from shared/types/brand-engine.ts
- VoiceSampleSource (must include 'identity_approved' for Phase 1 itself)

### UI Components (Phase 2 reuses)
- SteeringChat — conversational refinement (must include auto-summarization)

## Phase 2 → Phase 3 Contracts
[same structure]
```

**Why:** A subagent implementing Phase 3 shouldn't have to read all of Phase 1's code to discover what's available. The contract doc tells them exactly what exists and what its API looks like.

---

## Rule 7: Implementer Dispatch Protocol

When dispatching an implementer subagent (via `subagent-driven-development`), the prompt must include:

1. **Full task text** (already required by the skill)
2. **File ownership list** (Rule 2 — what they can and cannot touch)
3. **Relevant contracts** (what functions/types from other phases they should import, not recreate)
4. **Codebase conventions** (point to CLAUDE.md sections relevant to the task — e.g., "Use `createStmtCache` pattern for prepared statements, see server/approvals.ts for reference")
5. **Known gotchas** (e.g., "Express routes: literal paths before param routes", "Use parseJsonSafe for DB JSON columns")
6. **Model selection** — use the least capable model that can handle the task:

| Task type | Model | Signal |
|-----------|-------|--------|
| Migration SQL, shared types from spec, route boilerplate, API client wrappers | `haiku` | Pure transcription from plan — no judgment calls |
| Service/CRUD layers, React components, tasks with edge-case awareness | `sonnet` | Pattern-following with local judgment |
| Prompt engineering, brand context logic, complex shared components, auto-summarization | `opus` | Creative judgment or high reuse surface |
| Spec compliance reviewer | `opus` | Review quality scales with model capability |
| Code quality reviewer | `opus` | Same — never downgrade reviewers |

**Template addition for multi-phase work:**

```
## Cross-Phase Dependencies

This task depends on these Phase [N] artifacts:
- Import `SomeType` from 'shared/types/some-file.ts' (committed)
- Call `someFunction()` from 'server/some-module.ts' (committed)
- Read from `some_table` (migration committed)

Do NOT recreate these. Import them.
```

---

## Applying These Rules

### For plan authors (writing-plans skill):
- Include a Task Dependencies section (Rule 4)
- Include a File Ownership section in the File Structure area (Rule 2)
- When amending specs, update plans in the same commit (Rule 5)

### For plan executors (subagent-driven-development skill):
- Pre-commit shared contracts before dispatching (Rule 1)
- Include file ownership in every implementer prompt (Rule 2)
- Run diff review checkpoint after each parallel batch (Rule 3)
- Include cross-phase contracts in implementer prompts (Rule 7)

### For multi-phase features:
- Create a guardrails companion doc with cross-phase contracts (Rule 6)
- Reference it from each plan's header
- Update it as phases complete and APIs stabilize
