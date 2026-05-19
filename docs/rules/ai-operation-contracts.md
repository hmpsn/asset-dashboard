# AI Operation Contracts

Use this rule when an AI path returns structured data or when a caller needs stable provider/model/retry/research behavior that should be auditable from one place.

## Contracts

- Register high-value AI operations in `server/ai-operation-registry.ts` before wiring new callers.
- Prefer `callAI({ operation: '...' })` over hand-passing `feature`, `model`, `responseFormat`, `timeoutMs`, and retry posture when the call maps cleanly to a named operation.
- Structured-output callers must validate after boundary cleanup:
  - `parseAIJson()` is only boundary cleanup for fences/wrappers.
  - trust the payload only after Zod or equivalent schema validation.
- JSON-mode callers should rely on the operation contract for `responseFormat: { type: 'json_object' }` where the provider supports it.
- Keep graceful degradation explicit. If validation fails, either retry once on the surfaces that already support repair prompts or fail cleanly with logging and the caller’s existing fallback behavior.

## Use The Registry For

- user-visible structured outputs
- repeated model/feature/research settings
- calls whose timeout/retry behavior should stay consistent across refactors

## Do Not Use The Registry For

- one-off local experiments
- multimodal/vision calls that need payload shapes the registry cannot express yet
- deterministic parsing shortcuts that skip schema validation after JSON extraction
