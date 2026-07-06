# Phase A — W0.5 Provider Payload Probes (2026-07-06)

Two live-API probes required by the plan before committing effort numbers on
sn-asset-manager-1 (SB-022) and sn-competitors-1 (SB-019). Raw responses excerpted
verbatim; probes ran against the live Webflow v2 API (via the Webflow MCP wrapper,
same `/sites/:id/assets` payload the server provider consumes) and live DataForSEO.

## Probe 1 — Webflow v2 list-assets: width/height? → **NO (effort commits to M)**

Site probed: `6642175cde42e6707d405b26` (petermayer, 234 assets). Asset object shape:

```json
{
  "id": "6a42a8b7386d1fe358fb8db1",
  "displayName": "chart-03-delivery-mobile.png",
  "contentType": "image/png",
  "size": 134070,
  "hostedUrl": "https://s3.amazonaws.com/webflow-prod-assets/.../chart-03-delivery-mobile.png",
  "variants": [
    { "hostedUrl": ".../chart-03-delivery-mobile-p-500.png", "format": "png",
      "width": 500, "height": null, "quality": 100 }
  ],
  "altText": null, "folderId": null
}
```

- The **original asset carries NO dimension fields** — only `size` (bytes) + `contentType`.
- `variants[]` carry a `width` (the responsive breakpoint, e.g. 500/800) but `height` is
  `null` even there, and variants describe the responsive derivatives, not the original.
- **Verdict:** original w×h must be DERIVED (fetch `hostedUrl` + parse image header, or
  `sharp` metadata) and persisted — an N+1 fetch path with caching, not a payload read.
- **Effort commit: SB-022 / sn-asset-manager-1 = M** (was S-if-payload-carries). Design
  note for the ticket: derive lazily/batched in a background job, store on the asset row,
  never block the list render on dimension fetches.

## Probe 2 — DataForSEO domain-rank + top-3: available? → **YES (effort holds at S/M)**

(a) `backlinks/bulk_ranks` (`rank_scale: one_hundred`) — one call, up to 1000 targets:

```json
{ "items": [ { "target": "webflow.com", "rank": 81 },
             { "target": "peteramayer.com", "rank": 34 } ] }
```

(b) `dataforseo_labs/google/domain_rank_overview` (per-domain call):

```json
{ "metrics": { "organic": {
    "pos_1": 1064, "pos_2_3": 1978, "pos_4_10": 11493,
    "etv": 418127.88, "count": 133773 } } }
```

- **Domain rank (DR-style 0–100):** `backlinks_bulk_ranks.rank` — bulk endpoint, so the
  whole competitor set costs ONE call.
- **Top-3 rankings count:** `pos_1 + pos_2_3` from the rank-overview metrics (one call per
  domain; a 4–6 domain competitor set is 4–6 calls, cacheable on the snapshot cadence).
- **Effort commit: SB-019 / sn-competitors-1 holds as scoped (S/M)** — both fields are
  direct payload reads, no scraping or N+1 keyword-level fan-out needed.

## Consequences for ticket-cuts

| Ticket | Change |
|---|---|
| asset-manager (W2) | SB-022 rides at **M** with the background-derivation design note above |
| competitors (W2) | SB-019 fields confirmed procurable; `backlinks_bulk_ranks` is the DR source of choice (bulk) |
