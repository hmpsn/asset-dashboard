# Authority Context Expansion

Authority-aware recommendation work must follow these rules:

1. Backlink enrichment is opt-in.
   - Use `buildWorkspaceIntelligence(..., { enrichWithBacklinks: true })` only for recommendation-style consumers that actually judge keyword or content ambition.
   - Never flip backlink enrichment on by default for shared builders.

2. Missing backlink data must degrade explicitly.
   - Recommendation outputs must say `authority unknown` when no backlink profile is available.
   - Do not silently treat missing authority data as "within reach."

3. Reuse one authority posture vocabulary.
   - `authority_unknown`
   - `within_current_authority_range`
   - `requires_authority_building`
   - Keep the human-readable copy aligned with these values across keyword recommendations and recommendation cards.

4. Keep authority guidance advisory, not blocking.
   - Authority posture can down-rank or reframe ambition-sensitive opportunities.
   - It must not hard-delete otherwise valid opportunities unless another rule already excludes them.

5. Prefer shared helpers over ad hoc thresholds.
   - KD-vs-authority framing and backlink-footprint posture should come from `server/authority-context.ts`.
   - Do not duplicate difficulty/authority thresholds inline across recommendation surfaces.
