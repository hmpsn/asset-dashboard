# Google Business Profile Connection Audit

**Date:** 2026-07-16
**Status:** Verified pre-plan audit and banked execution order
**Scope:** Authenticated Google Business Profile connection, location mapping, review sync, reply drafting, client approval, publishing, E-E-A-T reuse, intelligence, recommendations, outcomes, health, and rollout posture

## Executive conclusion

The recently shipped GBP workflow has a strong operational spine: secure OAuth, workspace-to-location mapping, authenticated review reads, explicit approval, background publishing, activity logging, workspace broadcasts, client inbox integration, health reporting, and outcome-action recording are all present.

The largest risks are not missing buttons. They are source integrity and policy boundaries:

1. Full review text is stored, then intentionally reduced to a 260-character excerpt on nearly every read path. The client deliverable permanently snapshots that excerpt, so the approver cannot verify the source against the proposed reply.
2. The canonical source-fidelity rule (never introduce a fact the reviewer did not post) is absent from the repository, absent from the AI prompt, and not enforced before send, approval, or publish.
3. Google's current Business Profile API policy says API-provided content may be stored only temporarily, for no more than 30 calendar days, and restricts reuse outside the Business Profile project. The current table has no expiry or purge and stores full review text indefinitely. This requires immediate policy/retention remediation before any E-E-A-T reuse.
4. Review sync is manual-only and fetches only the newest 50 reviews. Although it stores Google's continuation token, subsequent syncs start from page one again, so the sync can remain permanently partial.
5. Authenticated GBP data is well wired into its own operating surface but not into the workspace intelligence layer. The existing intelligence and recommendations use the separate DataForSEO/public aggregate snapshot path instead.

The recommended product boundary is deliberately simple:

- **Authenticated GBP:** short-lived operational review context, approval, reply publishing, connection/mapping health, and current first-party aggregates.
- **DataForSEO/public snapshots:** durable trend history, competitor benchmarking, long-term outcomes, and recommendation calibration.
- **E-E-A-T assets:** only independently authorized, human-approved testimonial evidence; never automatic permanent copies of API review text.

## What is working well

### Connection and location authority

- OAuth tokens are encrypted and refresh/revocation behavior is covered by tests.
- Signed, single-use OAuth state protects connection callbacks.
- Google accounts and locations are normalized, then explicitly mapped to workspace `client_locations`.
- Connection and mapping health appear in Workspace Settings, Business Footprint, Local Presence, and the platform health endpoint.
- The location read model already captures title, place ID, website, phone, address, region, and primary category—enough to support a future confirm-before-overwrite NAP/category drift check.

### Review-response workflow

- Review drafts use the full stored source text internally.
- `gbp-review-response-draft` is a named AI operation with JSON response mode and Zod validation.
- Admins can generate, manually write, edit, send to the client, approve internally, and retry failures.
- Client approval is explicit and correctly communicates that approval publishes the reply to Google.
- Publishing runs through the background-job platform and records attempts, failures, state transitions, activity, and workspace broadcasts.
- A tracked `gbp_review_reply` action is recorded only after Google succeeds, with idempotency protection.

### Data-flow integration

- Server and frontend WebSocket event names match.
- Review and response mutations invalidate the correct admin and client React Query caches.
- GBP response deliverables use the canonical unified inbox adapter.
- The platform health read reports connection, mapping, authenticated review availability, expiry, and affected features.

## Verified findings

### GBP-1 — Critical: the approver receives a permanently truncated source

The database stores the full `comment`, but `rowToReview` and `rowToReviewContext` derive a 260-character excerpt. `listGbpReviewResponseWorkflow` explicitly sets `includeText: false`, so both the rebuilt and legacy admin workflow surfaces receive only excerpts. The rebuilt surface then adds `truncate` or `line-clamp-2`.

The larger defect is at the client boundary: `gbp-review-response.ts` builds the durable deliverable with `reviewText: response.review.commentExcerpt`. The client approval card renders its payload without CSS truncation, but the payload has already lost the source text. Existing sent deliverables therefore remain clipped even if an admin list view is later expanded.

**Implication:** a client or operator can approve a public reply without seeing the evidence required to verify it. This directly explains the reported false positive around the reviewer's own insurance disclosure.

**Required direction:** list rows may remain concise, but every draft/edit/approval detail view must display the complete, latest review. Do not solve this by permanently embedding full API text into the deliverable; resolve it just in time from a policy-compliant short-lived cache or Google and carry only source identity, update time, and a hash/version in durable workflow records.

### GBP-2 — Critical: Google API content retention/reuse posture is non-compliant or at minimum unverified

Migration 160 stores full review comments and reviewer identity with no expiry. There is no purge or retention job. Google currently states that Business Profile API content may be cached/stored only in limited amounts, temporarily for no more than 30 days, securely, and not for use outside the Business Profile project.

Relevant primary sources:

- [Business Profile APIs policies](https://developers.google.com/my-business/content/policies)
- [Work with review data](https://developers.google.com/my-business/content/review-data)

**Implication:** indefinite raw-review storage, permanent deliverable snapshots, long-lived E-E-A-T copies, and durable derived review-text analytics should be treated as blocked pending policy/legal confirmation.

**Required direction:** add a documented 30-day operational-content boundary, purge expired review text/reviewer content, retain only allowed workflow provenance, and fetch/refresh source text when needed. Audit existing production rows by age before expanding the feature.

### GBP-3 — High: the compliance rule exists outside the product contract

The repository contains no copy of the referenced GBP reply constraints, no “never introduce a fact the reviewer did not post” rule, and no New Vision-pattern/insurance rule. The AI prompt says not to mention private details or legal/medical claims, but does not require every customer-specific fact to be grounded in the review. Zod validates only shape, length, and plain-text formatting.

There is no compliance validator at draft, send-to-client, approval, or publish. Admin approval and client approval can therefore publish a reply after only a workflow-state check.

**Required direction:** version the source-fidelity policy in this repository; apply it to AI generation and the human approval UI; then add a pre-send/pre-publish gate that always evaluates the complete, current source. For high-risk terms (health conditions, insurance, treatments, outcomes, financial/legal details, minors, names), unsupported additions should block rather than merely warn.

### GBP-4 — High: review edits can invalidate an already-approved reply

Google notes that customers can edit a review after a reply and that the review update date changes. The platform stores `update_time`, but a response does not snapshot the source update time/hash used for drafting or approval. Before publishing, the job checks local `hasReply`, not whether the review text changed since draft/approval, and it does not refresh the individual review from Google.

**Implication:** a compliant reply can become stale or factually mismatched between draft, client approval, and publish.

**Required direction:** persist `sourceReviewUpdateTime` and a source hash on the response/deliverable; refresh the source before approval/publish; if it changed, invalidate approval and require re-review.

### GBP-5 — High: sync remains partial and stale by construction

The Google client uses `pageSize = 50` and `maxPages = 1`. It stores `nextPageToken`, but `syncWorkspaceGbpReviews` never supplies that token on a later run; every sync begins with the newest page. There is no scheduled authenticated-review sync. Upserts refresh returned rows, but absent/deleted reviews are not reconciled.

**Implications:**

- older unanswered reviews may never enter the workflow;
- edited/deleted/provider-removed reviews can remain stale locally;
- a newly connected account remains stale until an operator clicks Sync;
- aggregate labels such as unanswered/low-rating describe only stored rows, not the whole profile.

**Required direction:** schedule read-only sync, page only far enough to cover the permitted operational retention window, reconcile edits/deletions/replies, purge expired source content, and label windowed counts honestly (for example, “unanswered in the last 30 days”). Keep Google-provided `averageRating` and `totalReviewCount` as the profile-wide aggregates.

### GBP-6 — Medium: the two policy read models contradict each other

The authenticated review read says `aiUseAllowed: false` and “do not use raw review text in AI,” while the response workflow says raw text is used for response drafting and the AI draft path does so. The intended narrow exception is reasonable, but the contracts now disagree.

**Required direction:** replace the boolean with explicit allowed purposes, retention, audience, and prohibited-use fields. The narrow permitted purpose should be “draft and validate a response for this exact review,” never general intelligence or copy generation.

### GBP-7 — Medium: authenticated first-party aggregates are not in workspace intelligence

`LocalSeoSlice.reviewSummary` is assembled from `business_listing_snapshots`, the separate DataForSEO/public aggregate layer. Authenticated review tables are intentionally absent from intelligence. This prevents raw text leakage, which is good, but it also means Admin Chat/recommendations cannot see fresh connection status, mapped-location count, last sync, or Google-provided owned-profile aggregate rating/count from the authenticated connection.

**Required direction:** add a safe aggregates-only authenticated GBP projection to the local intelligence slice. It may include connection/mapping/freshness and Google-provided aggregates; it must not expose raw review text or reviewer identity. Long-term trends should continue to come from the public/DataForSEO snapshot layer.

### GBP-8 — Medium: rollout flags are stale and can create half-on behavior

`gbp-auth-connection`, `gbp-auth-reviews`, and `gbp-review-responses` remain default-off with `staging-validation` rollout targets and weekly review cadence last reviewed on 2026-06-29. The admin rebuilt surface uses global `useFeatureFlag`, while server routes use workspace-aware `isFeatureEnabled`.

**Implication:** a workspace override can enable server data while the global-reading UI remains off. The dependency stack also leaves three nested flags to retire after rollout.

**Required direction:** decide whether the rollout has passed staging validation. If yes, retire flags dependency-first with real flag-on smoke coverage. If not, document the pilot wiring so UI and server scope cannot diverge.

### GBP-9 — Medium: outcome recording exists, effectiveness measurement does not

Successful publishing records a `gbp_review_reply` tracked action, which is a good attribution seam. It carries no measurable metric baseline and the code still describes the outcome path as dark/stubbed. Response time, publish success rate, review-response coverage, and later aggregate rating/review-count changes are not connected.

**Required direction:** measure operational outcomes first (time-to-reply, approval time, publish success, response coverage). Use public aggregate snapshots—not long-lived raw authenticated reviews—for long-term reputation trends.

### GBP-10 — Low: current AI model is not the limiting factor

The reply operation uses OpenAI `gpt-5.4`, strict JSON mode, Zod parsing, a 45-second timeout, and two retries. The failure is missing source/policy contracts and evaluation, not an obviously stale or undersized model.

**Required direction:** keep the model stable while adding deterministic compliance fixtures, source-change cases, high-risk healthcare examples, and cost/latency baselines. Only then compare `gpt-5.4-mini`, `gpt-5.4`, and a newer canary. A model upgrade cannot compensate for a clipped approval source or a missing enforcement rule.

## E-E-A-T decision

### Should good five-star reviews automatically become E-E-A-T assets?

**No—not as permanent testimonial assets and not from the API text automatically.** A public review is useful evidence, but five stars alone do not establish permission, relevance, specificity, authenticity for reuse, or freedom from sensitive personal details. In healthcare, amplifying a reviewer's self-disclosed health/insurance information creates a materially different risk from replying underneath the review.

The safe, valuable pattern is a **testimonial candidate**, not an asset:

1. Deterministically nominate a recent five-star review with substantive text and no obvious high-risk content.
2. Store only the candidate's durable identity/status—not a permanent raw-text copy.
3. Require an operator to obtain or record independent reuse permission and, where appropriate, a direct public review link. Google itself documents how a business can share a direct review link: [Manage customer reviews](https://support.google.com/business/answer/3474050).
4. Let the operator select the exact approved quotation and attribution.
5. Only then create an `EeatAsset` of type `testimonial` with consent/source evidence, service/location tags, and approved page associations.

An approved testimonial may then flow through the existing E-E-A-T intelligence slice to briefs/content. It should not automatically create first-party `Review`/`AggregateRating` structured data for a `LocalBusiness`; Google excludes self-serving local-business/organization reviews from review rich results, including embedded third-party review widgets. See [Review snippet structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/review-snippet).

## Where the connection should wire next

### Do now

1. **Full-source approval context:** complete latest review on draft/edit/admin approval/client approval; compact lists may keep excerpts with Expand.
2. **Retention and purpose controls:** 30-day review-content purge, allowed-purpose contract, no permanent raw-text deliverable snapshot.
3. **Source-fidelity gate:** canonical policy, prompt contract, high-risk unsupported-fact blocker, and stale-source invalidation.
4. **Fresh read sync:** scheduled read-only sync and complete coverage of the retained time window.

### Do next

5. **Safe intelligence projection:** connection, mappings, freshness, Google-provided rating/count, and windowed response backlog—no review text/authors.
6. **Business Footprint drift:** compare GBP NAP/category/website against confirmed location data and ask the operator to accept changes; never silently overwrite authority.
7. **Operational reputation outcomes:** time-to-first-draft, time-to-approval, time-to-publish, publish success, and response coverage.
8. **Optional testimonial-candidate queue:** independent permission and human promotion into E-E-A-T.

### Deliberately not now

- automatic review replies or unattended publishing;
- bulk AI drafting;
- general sentiment/topic mining over raw authenticated review text;
- raw-review reuse in Admin Chat, content generation, or recommendation prompts;
- permanent review-text warehousing;
- automatic testimonial/schema publication;
- complex “review quality” AI scoring before deterministic nomination and consent are proven.

Google's API policy requires prior specific and express consent for automated review replies, so keeping auto-responder work deferred is the correct product and policy posture.

## Banked execution order

1. **Contain policy risk:** audit production row age, document allowed purposes, stop permanent propagation, add 30-day purge/retention.
2. **Repair the approval evidence chain:** full latest review in every consequential detail surface; no source clipping; version/hash the source.
3. **Enforce source fidelity:** canonical reply constraints, prompt update, deterministic fixtures, pre-send/pre-publish compliance gate.
4. **Repair freshness:** scheduled read sync, retained-window pagination, reply/edit/deletion reconciliation, honest window labels.
5. **Wire safe aggregates:** authenticated connection/mapping/freshness and provider aggregates into local intelligence; preserve public snapshots for durable trends.
6. **Add measured value:** NAP/category drift and operational reply outcomes.
7. **Pilot testimonial candidates:** independent permission and manual E-E-A-T promotion only.
8. **Close rollout debt:** flag-on smoke, scope-parity verification, then dependency-ordered flag retirement.

## Master-plan guidance

Treat steps 1–4 as one integrity program that must precede new GBP product expansion. The compliance policy, source-version contract, retention boundary, and acceptance fixtures should be pre-committed before parallel implementation. Steps 5–7 can then ship as separate, small PRs. Avoid combining the authenticated operational store with the durable public analytics store; that separation is the core simplifying design decision.

No production behavior was changed by this audit.
