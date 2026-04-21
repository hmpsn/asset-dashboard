# hmpsn studio — Platform Monetization Strategy

A comprehensive monetization plan for the asset dashboard platform, covering tiered access, product pricing, bundles, revenue flows, and implementation roadmap.

*Compiled: March 7, 2026*

---

## Platform Cost Analysis

### Zero Marginal Cost (keep free — builds habit)

| Feature | Why It's Free |
|---------|---------------|
| Search Console dashboards | GSC API is free; every login is an impression |
| Google Analytics dashboards | GA4 API is free; data access builds dependency |
| Site Health score (view only) | The hook — shows problems the client can't fix alone |
| Rank tracking (view only) | Creates awareness of keyword positions |
| Request system | You *want* clients asking for work |
| Activity log | Transparency = trust |
| Annotations | Context for data changes |
| Monthly report emails | Re-engagement trigger, costs nothing |

### Low Marginal Cost (agency time, minimal API spend)

| Feature | Cost |
|---------|------|
| SEO Editor (Webflow API) | Negligible API calls |
| Redirect scanner | Crawler compute time |
| Internal link analyzer | Crawler compute time |
| Dead link checker | Crawler compute time |
| Competitor SEO comparison | Crawler compute time |

### Meaningful Cost (OpenAI tokens + expertise)

| Feature | Est. Cost Per Use |
|---------|:-:|
| AI Insights Engine / Chatbot | ~$0.02–0.15/conversation |
| Proactive insights greeting | ~$0.03/open |
| Content briefs | ~$0.10–0.30/brief |
| Full blog posts | ~$0.50–2.00/post |
| Schema generation | ~$0.05–0.15/page |
| Keyword strategy generation | ~$0.50–1.50/run |
| SEMRush enrichment | API credit cost |

---

## Tier Structure

### 🟢 Free Tier — "Starter"

**$0/mo** — your site at a glance

| Feature | Purpose |
|---------|---------|
| AI-powered site insights | Overview tab with data-driven summaries |
| Search Console dashboard | Data access builds login habit |
| Google Analytics dashboard | Same — free data, frequent visits |
| Site Health audits (read-only) | Shows problems → creates upgrade pressure |
| AI chat advisor (3 convos/month) | Taste of the AI value → upgrade incentive |
| Monthly summary digest | Keeps agency top-of-mind |

**Strategy:** Free tier costs zero team effort. Clients see their data and the AI gives them a taste. Every insight naturally pushes toward Growth. No requests, no approvals, no content — zero labor.

---

### 🟡 Growth Tier — "AI-Powered SEO Engine"

**$249/mo** — AI does the work, you sell content

| Feature | Revenue Driver |
|---------|---------------|
| Everything in Starter | — |
| Unlimited AI chat advisor | The advisor that suggests services |
| Proactive insights greeting | Surfaces opportunities on every visit |
| SEO Strategy (lite: keywords, page map, content gaps, quick wins) | Shows gaps → upsell to briefs |
| Content purchasing (briefs & posts) | On-ramp to paid deliverables |
| ROI dashboard | Justifies the subscription every month |
| Custom date ranges | Power user feature |

**Strategy:** Growth is the scale play — pure SaaS margin with zero human touch. AI generates strategy, client self-serves, and you make money when they buy content. No requests, no approvals, no team hours. Competitor analysis held back for Premium.

---

### 🔴 Premium Tier — "Managed SEO Partnership"

**$999/mo** — we work for you (3 strategy & implementation hours included)

| Feature | Revenue Driver |
|---------|---------------|
| Everything in Growth | — |
| Competitor keyword analysis | Creates urgency, shows gaps |
| Advanced competitor intel | Ongoing competitive intelligence |
| SEO change approvals | Unlocks agency doing active SEO work |
| 3 strategy & implementation hrs/mo | Meta tags, schema, redirects, content publishing, audit fixes |
| Monthly strategy reviews | Dedicated strategist touch |
| Content calendar planning | Proactive content roadmap |
| Technical SEO implementation | Schema markup, structured data |
| Priority support | Faster turnaround |

**Strategy:** Premium is the managed partnership. The 3 included hours (at $150/hr floor rate = $450) plus $549 software margin makes the unit economics work. Clients feel like they have an SEO team. Additional hours available as add-on ($200/hr ad-hoc, $175/hr 5-hr block, $150/hr 10-hr block). Strategy & implementation hours are scoped to SEO execution only — not general development.

**What the 3 hours cover (no additional charge):**
- AI generation of schemas, metadata suggestions, strategy — always free (pennies in tokens)
- Publishing schemas to Webflow
- Updating meta titles, descriptions, OG tags
- Setting up and implementing redirects
- Publishing approved content to the site
- Fixing audit issues (alt text, heading structure, etc.)
- Any technical SEO execution within the platform

**What still costs extra on Premium:**
- Full content writing (blog posts, landing pages, etc.) — still purchased as deliverables
- Add-on implementation hours beyond the included 3

**Why:** Don't nickel-and-dime a $999/mo client with $29 metadata charges. The hour cap is the natural boundary — if they need more work, they buy an hour block. Clean, simple, trust-building.

---

## Product Pricing (One-Time Deliverables)

Transactional revenue items — purchased inside the platform, fulfilled through it.

### Content Briefs (By Page Type)

| Product | Price | Agency Cost | Margin | Notes |
|---------|:-----:|:-----------:|:------:|-------|
| **Blog Post Brief** | $75–150 | ~$0.30 tokens + 15min | ~95% | Keyword research, outline, meta, E-E-A-T |
| Blog Post Brief + SEMRush | $125–200 | ~$0.50 + SEMRush credits + 15min | ~90% | Real volume, KD, CPC, related keywords |
| **Landing Page Brief** | $150–250 | ~$0.40 tokens + 20min | ~90% | Conversion-focused: hero, benefits, social proof, CTA strategy |
| **Service Page Brief** | $125–200 | ~$0.35 tokens + 20min | ~90% | Service description, differentiators, FAQ, schema recommendations |
| **Location Page Brief** | $100–175 | ~$0.30 tokens + 15min | ~90% | Local SEO focus: NAP, service areas, local keywords, LocalBusiness schema |
| **Product Page Brief** | $125–200 | ~$0.35 tokens + 15min | ~90% | Features, benefits, comparison, Product schema, buyer intent keywords |
| **Pillar/Hub Page Brief** | $200–350 | ~$0.50 tokens + 30min | ~85% | Topic authority: comprehensive guide, internal linking map, cluster strategy |
| **Resource/Guide Brief** | $150–250 | ~$0.40 tokens + 20min | ~90% | Long-form educational: downloadable checklist, lead gen integration |

### Full Content (By Page Type)

| Product | Price | Agency Cost | Margin | Notes |
|---------|:-----:|:-----------:|:------:|-------|
| **Blog Post — AI Draft** | $250–400 | ~$1.50 tokens + 30-45min | ~85% | 1,500–2,000 words from brief |
| **Blog Post — Polished** | $500–800 | ~$2 tokens + 1.5-2hr editing | ~75% | AI draft + human editing + images |
| **Blog Post — Premium** | $1,000–1,500 | ~$2 tokens + 4-6hr work | ~60% | Original research, custom graphics, expert quotes |
| **Landing Page Copy** | $500–1,000 | ~$2 tokens + 2-3hr | ~70% | Full page copy: headline, subheads, benefits, proof, CTAs |
| **Service Page Copy** | $400–750 | ~$1.50 tokens + 1.5-2hr | ~75% | Service description, process, FAQ, testimonial placement |
| **Location Page Copy** | $300–500 | ~$1.50 tokens + 1-1.5hr | ~75% | Localized content, map embed, service area, reviews |
| **Pillar Page** | $1,500–2,500 | ~$3 tokens + 6-8hr | ~55% | 3,000-5,000 word authority piece with cluster linking |
| **Resource/Guide** | $800–1,500 | ~$2 tokens + 3-5hr | ~65% | Downloadable PDF + web version, lead gen form copy |

### Technical SEO Products (Growth Tier — Self-Service Cart)

Growth clients don't have implementation hours — they purchase technical SEO fixes à la carte. Products are split into two categories based on what the Webflow API can handle programmatically vs. what requires hands-on Designer access.

#### Product A: Automated Fixes (via Webflow API — Stripe Checkout)

AI generates fixes, published programmatically via Webflow API. Minimal human touchpoint. Sold in the self-service cart.

| Product | Price | API Method | Agency Cost | Margin | What's Delivered |
|---------|:-----:|-----------|:-----------:|:------:|------------------|
| **Metadata Optimization** | $20/page | Page PATCH | ~$0.05 tokens + 5min | ~90% | AI-optimized title, meta description, OG tags — published to Webflow |
| **Alt Text — Full Site** | $50 flat | Asset PATCH (bulk) | ~$0.50 tokens (GPT-4o-mini vision) | ~95% | AI-generated context-aware alt text for all site images, written back to Webflow |
| **Redirect Fix** | $19/redirect | CSV export | ~2min labor | ~90% | 301 redirect rule exported in Webflow-compatible CSV format |
| **Metadata Pack (10pg)** | $179 | Batch Page PATCH | ~$0.50 tokens + 30min | ~85% | Titles + descriptions optimized for 10 pages (save $21 vs individual) |
| **Schema — Per Page** | $39/page | Custom Code API | ~$0.10 tokens + 5min | ~95% | JSON-LD schema generated, validated, and published |
| **Schema Pack (10pg)** | $299 | Custom Code API | ~$1 tokens + 20min | ~90% | Schema for 10 pages, generated + published (save $91 vs individual) |

> **Why these are API-safe:** Meta titles, descriptions, and OG tags are editable via Webflow's Page PATCH endpoint. Alt text writes back via Asset PATCH API (already built — GPT-4o-mini vision + bulk generation + NDJSON streaming). Schema publishes via Custom Code API (already built). Redirects export as CSV for import in Webflow Settings → Hosting → 301 Redirects.

#### Product B: Manual Implementation (Webflow Designer Access — Custom Quote)

Fixes that require editing page body content, visual elements, or site structure. **Not a Stripe product** — surfaced as “Contact us for a quote” in the dashboard.

| Fix Type | Why It Needs Designer Access | Typical Scope |
|----------|----------------------------|---------------|
| Heading structure (H1/H2/H3) | Page body content structure | Per-page |
| Internal link additions | Rich text body edits | Per-page, varies by link count |
| Page speed fixes | Image compression, lazy loading, layout changes | Per-page or site-wide |
| Content edits | Thin content, duplicate content, cannibalization | Per-page, significant effort |
| Layout / UX fixes | Above-the-fold, mobile, CTA placement | Per-page or site-wide |

**Pricing model:** Quoted per-project after a scope call. Recommended minimums:
- **Small scope** (5-10 pages, simple fixes): $500-1,000
- **Medium scope** (10-25 pages, mixed fixes): $1,500-3,000
- **Large scope** (25+ pages or site-wide structural changes): $3,000-5,000+

**Client flow:**
1. Audit surfaces issues → platform shows “This fix requires Designer access”
2. Client clicks “Request a Quote” → creates a request with issue details pre-filled
3. Agency scopes the work, sends a custom quote
4. Client approves → grants Webflow Designer/Editor invite
5. Agency implements, QAs, publishes → re-runs audit to verify

#### How the Cart Works (UX Flow)

```
Client visits Site Health tab
    │
    ├─ Sees issues list: "14 pages missing meta descriptions"
    │   └─ Each issue row has: [ Fix This → $29/page ] button
    │   └─ Banner: [ Fix All 14 → $199 (save $207) ] ← smart bundle pricing
    │
    ├─ Selects individual fixes OR clicks a bundle
    │   └─ Items added to a cart sidebar / drawer
    │
    ├─ Cart shows:
    │   ┌─────────────────────────────────────┐
    │   │  Your SEO Fixes                     │
    │   │                                     │
    │   │  ☑ Meta optimization (8 pages) $199 │
    │   │  ☑ Schema (3 pages)          $117  │
    │   │  ☑ Redirect fixes (2)         $38  │
    │   │  ─────────────────────────────────  │
    │   │  Total                        $354  │
    │   │                                     │
    │   │  [ Checkout → Stripe ]              │
    │   └─────────────────────────────────────┘
    │
    ├─ Stripe Checkout (single session, all items)
    │
    └─ Fulfillment:
        ├─ Items appear as tasks in admin queue
        ├─ AI auto-generates fixes (meta, schema, alt text)
        ├─ Admin reviews + publishes to Webflow
        └─ Client notified: "3 fixes applied to your site"
```

#### Smart Bundle Pricing

When a client selects multiple automated fixes of the same type, auto-offer the 10-page pack:
- 1-9 pages: per-page rate ($20 meta, $39 schema)
- 10+ pages: suggest pack purchase — Metadata Pack ($179/10pg) or Schema Pack ($299/10pg)
- Alt text is always full-site ($50 flat) — runs bulk generation on all missing alt text
- Need more than 10 pages of meta/schema? Buy multiple packs or upgrade to Premium

For manual implementation (Product B), there is no self-service bundling — it’s always a custom quote.

#### Premium vs Growth: Technical SEO Pricing

| Action | Growth | Premium |
|--------|--------|---------|
| AI generates recommendations | Free | Free |
| View recommendations in dashboard | Free | Free |
| Metadata optimization | $20/page or $179/10pg (cart) | Included in 3 hrs |
| Schema generation + publishing | $39/page or $299/10pg (cart) | Included in 3 hrs |
| Redirect fixes | $19/redirect (cart) | Included in 3 hrs |
| Alt text optimization | $50 flat (full site) | Included in 3 hrs |
| Heading, link, layout fixes | Contact for quote (Designer access) | Included in 3 hrs* |
| Content briefs | $75-350 (purchase) | **10% off** — $68-315 |
| Full content posts | $250-2,500 (purchase) | **10% off** — $225-2,250 |

*\* Premium implementation hours can cover manual Designer fixes if the client grants Webflow access.*

#### Premium Content Discount (10%)

Premium clients receive a **10% discount on all content purchases** (briefs and full posts). This:
- Rewards commitment to the $999/mo tier
- Incentivizes content purchasing over DIY
- Creates a visible perk beyond implementation hours
- Still maintains strong margins (85%+ on briefs, 55%+ on premium posts)

**Implementation:** Apply discount at checkout time based on workspace `tier`. Display original price with strikethrough + discounted price in the content purchase flow. Example: ~~$125~~ **$113** for a blog brief.

### Schema Generation (Legacy — now part of Technical SEO Products)

| Product | Price | Agency Cost | Margin |
|---------|:-----:|:-----------:|:------:|
| Per-page schema (generate + publish) | $39/page | ~$0.10 tokens | ~95% |
| Schema Pack (10 pages) | $299 | ~$1 tokens | ~90% |

### Keyword Strategy

| Product | Price | Agency Cost | Margin |
|---------|:-----:|:-----------:|:------:|
| Full keyword strategy (page mapping, gaps, quick wins) | $300–500 | ~$1.50 tokens + SEMRush + 1hr review | ~80% |
| Strategy refresh (re-run with new data) | $150–250 | ~$1.50 tokens + 30min | ~85% |

### Page Type → Content Opportunity Mapping

The strategy engine's "Content Opportunities" section should recommend **specific page types** based on the gap analysis:

| Signal | Recommended Page Type | Why |
|--------|----------------------|-----|
| Informational keyword gap, no ranking content | **Blog Post** | Capture top-of-funnel search traffic |
| High-volume service keyword, no dedicated page | **Service Page** | Direct conversion page for core offering |
| "[service] near me" / "[service] in [city]" gaps | **Location Page** | Local SEO; one per service area |
| Broad topic with 5+ related keyword clusters | **Pillar/Hub Page** | Topic authority; anchors internal link cluster |
| Competitor has landing page for high-intent keyword | **Landing Page** | Conversion-focused response to competitor |
| "How to" / "guide" / "checklist" queries | **Resource/Guide** | Lead gen opportunity; downloadable asset |
| Product/feature comparison queries | **Product Page** | Bottom-of-funnel; buyer intent |
| FAQ / "what is" queries with no content | **Blog Post** or **FAQ Section** | Quick wins; potential featured snippet |

This mapping feeds into:
1. **Strategy tab** — Content Opportunities cards show recommended page type badge
2. **"Request This Topic" flow** — Pre-selects the page type, which determines brief template + pricing
3. **AI chatbot** — When discussing content gaps, recommends specific page types with rationale
4. **Content Pipeline** — Brief generation uses page-type-specific prompts and templates

---

## Bundles

### 🎯 Content Starter — $500/mo

- 4 AI briefs/month
- 1 keyword strategy refresh/quarter
- Growth tier dashboard access
- *Ideal for:* Clients who want direction but write their own content

### 🚀 Content Engine — $1,500–2,000/mo

- 4 polished blog posts/month
- Full keyword strategy
- Full-site schema package (one-time, then maintenance)
- Premium tier dashboard access
- *Ideal for:* Clients investing in organic growth

### 🏢 Full Service SEO — $3,000–5,000/mo

- Everything in Content Engine
- 8 posts/month
- Monthly competitor analysis
- Priority request queue
- Dedicated AI knowledge base tuning
- Quarterly strategy refresh
- *Ideal for:* Serious growth clients, multi-location businesses

---

## Revenue Flow — Where Money Enters

```
Client lands on dashboard (free)
    │
    ├─ Sees Site Health score → "72/100, 14 errors"
    │   ├─ Growth: [ Fix This → $29/page ] buttons on each issue
    │   │   └─ 💰 Adds to SEO Fix Cart → Stripe Checkout
    │   │       └─ 💰 Bundle: [ Fix All 14 → $199 ] smart pricing
    │   └─ Premium: covered by 3 implementation hrs/mo
    │
    ├─ AI chatbot opens with proactive insights
    │   └─ "Your clicks dropped 8% — here are 3 things to fix"
    │   └─ Revenue hook → "Want me to add a fix to your cart?"
    │       └─ 💰 Technical SEO fix ($19-39/page)
    │       └─ 💰 Content brief purchase ($75-350)
    │           └─ 💰 Upgrade to full post ($250-2,500)
    │
    ├─ Strategy tab shows content gaps + quick wins
    │   ├─ "Request This Topic" → 💰 Brief → Post pipeline
    │   └─ "Optimize This Page" → 💰 Meta/schema fix via cart
    │
    ├─ Schema tab shows "No structured data"
    │   └─ Growth: 💰 Per-page ($39) or full-site ($249) via cart
    │   └─ Premium: covered by implementation hours
    │
    └─ Monthly report email
        └─ "3 new issues found" or "traffic dropped 5%"
            └─ Client logs in → sees fix recommendations → cart → pays
```

### Key Monetization Moments (by frequency)

1. **Every dashboard visit** — health score issues surface with "Fix this → $X" buttons
2. **Every chat open** — proactive insights recommend fixes, AI offers to add to cart
3. **Every Strategy tab visit** — content gaps + quick wins with purchase CTAs
4. **Every audit completion** — new issues = new fix recommendations = new revenue
5. **Monthly report email** — "3 new issues found" re-engagement trigger
6. **Competitor comparison** — "they're ahead of you on X" drives action

---

## Implementation Roadmap

### Phase 1: Stripe Checkout for Deliverables
**Priority: Immediate | Est: 5-7 hours**

- Stripe Checkout or Payment Links for content briefs and full posts
- Webhook handler for payment confirmation → fulfillment status update
- Payment tracking per workspace
- Price display in Content Pipeline (brief request flow)
- Receipt/invoice generation

**Deliverables that get Stripe buttons first:**
1. Content briefs ($75–200)
2. Full blog posts ($250–1,500)
3. Keyword strategy ($300–500)
4. Schema packages ($200–500)

### Phase 2: Tier Gating
**Priority: After Stripe | Est: 4-6 hours**

- Feature flag system per workspace (tier: free/growth/premium)
- Soft-gate AI chatbot: free tier gets 3 conversations/month, then upgrade prompt
- Lock full strategy view behind Growth tier
- Lock schema generation behind Premium tier
- Upgrade prompts at gate points (not hard blocks — show value, then ask)

### Phase 3: Bundle Pricing Page
**Priority: After gating | Est: 3-4 hours**

- In-portal pricing page showing tier comparison
- Bundle cards with feature lists
- Stripe subscription integration for monthly tiers
- Upgrade/downgrade flow

### Phase 4: Usage Tracking
**Priority: After bundles | Est: 2-3 hours**

- Track AI conversations, briefs generated, strategies run per workspace per month
- "You've used 3 of 4 briefs this month" usage indicators
- Overage billing or upgrade prompts at limits
- Usage dashboard for admin (see which clients are heavy users)

---

## Revenue Projections (Conservative)

| Scenario | Clients | Avg Monthly/Client | Annual Revenue |
|----------|:-------:|:------------------:|:--------------:|
| Early stage: 3 Growth + 1 Premium + occasional briefs | 4 | $550 | $26,400 |
| Growing: 6 Growth + 3 Premium + content purchases | 9 | $700 | $75,600 |
| Established: 8 Growth + 5 Premium + content + hour add-ons | 13 | $900 | $140,400 |

These are **platform revenue only** — on top of content purchases, hour add-ons, and any separate development work.

---

## Strategic Notes

### What stays free and why
The free dashboard is the **best sales tool in the platform**. Every client login reinforces that the agency is doing real work. Keep it generous — the revenue comes from content deliverables and the services the AI naturally recommends. Never charge for viewing data the client already owns (GSC, GA4).

### The AI chatbot is the revenue engine
The chatbot is the highest-conversion feature — it literally tells clients what to buy, backed by their own data. Gate it behind Growth tier or give free-tier clients 3 conversations/month to taste the value, then upsell. Every proactive insight is a warm lead.

### Content pipeline is the cash register
The brief → post → publish pipeline is the most natural transaction point. Clients are already in the flow of reviewing content — adding a payment step feels natural, not forced. Stripe Checkout keeps it frictionless.

### Switching cost increases with tier
- **Free:** Low switching cost, but the data access creates login habit
- **Growth ($249):** AI chat history + strategy data + content pipeline = moderate switching cost. ROI dashboard proves value monthly.
- **Premium ($999):** Strategist relationship + implementation history + competitor intel + conversation history = very high switching cost. The 3 included hours create ongoing dependency.

---

## Trial Period Strategy

### 14-Day Growth Trial for All New Clients

Every new workspace starts with **14 days of Growth tier access** before dropping to Free.

| Day | Experience |
|-----|-----------|
| Day 1 | Welcome flow explains Growth features; AI chatbot introduces itself with proactive insights |
| Days 2–13 | Full Growth access: AI chat, strategy, content pipeline, custom date ranges, approvals |
| Day 10 | In-dashboard banner: "Your Growth trial ends in 4 days — keep access to AI insights and content tools" |
| Day 13 | Prominent upgrade prompt: "Trial ending tomorrow — upgrade now to keep your keyword strategy and AI advisor" |
| Day 14 | Downgrade to Free; soft-gated sections show blurred teaser with "You had access to this — upgrade to get it back" |

**Why this works:**
- Loss aversion is more powerful than gain framing — taking features away drives more upgrades than offering them
- 14 days is enough to experience 2-3 AI chatbot conversations, see strategy data, and request at least 1 brief
- The downgrade experience is designed: clients see their data still exists behind the blur, creating urgency

### Implementation
- `trialEndsAt: Date` field on Workspace (set to now + 14 days on creation)
- Tier resolution: `if (now < trialEndsAt) return 'growth'; else return ws.tier;`
- Countdown banner component: shows at day 10+
- Post-trial downgrade is automatic — no manual intervention needed

---

## Inline Price Visibility

### Show Prices Before Checkout

Clients should never be surprised by a price. Every purchasable action shows cost inline:

| Location | What They See |
|----------|--------------|
| Content Pipeline → "Request Brief" button | "Generate Brief — $125" (varies by page type) |
| Content Pipeline → "Upgrade to Full Post" | "Upgrade to Full Post — $500" with savings callout |
| Strategy tab → content gap cards | Page type badge + "Request Brief — $150" |
| AI chatbot → content recommendation | "I can generate a brief for this topic — $125" |
| Schema tab → generate button | "Generate Schema — $35/page" or "Full Site — $350" |
| Chat upgrade prompt | "Upgrade to Growth — $249/mo" |
| Soft gate overlay | Tier price + "Starting at $249/mo" |

### Bundle Savings Callouts
When a client is on a bundle, show the savings:
- "Generate Brief — ~~$125~~ **Included** (2 of 4 remaining this month)"
- "Upgrade to Full Post — ~~$500~~ **$400** (Content Engine discount)"

### Price Configuration
- Prices stored in workspace settings or global config (not hardcoded)
- Admin can override per-workspace for custom deals
- Stripe Price IDs mapped to product types in `server/stripe.ts`

---

## ROI Dashboard (Premium Feature)

### Show the Dollar Value of Organic Traffic

A dedicated section (Overview tab or standalone) that translates SEO metrics into dollar terms:

### Metrics

| Metric | Formula | Data Source |
|--------|---------|-------------|
| **Organic Traffic Value** | `organic clicks × avg CPC for those keywords` | GSC clicks + SEMRush CPC data |
| **Ad Spend Equivalent** | "You'd pay $X in Google Ads for this traffic" | SEMRush keyword CPCs |
| **Content ROI** | `traffic value of pages with published content ÷ content spend` | GSC per-page + payment records |
| **Estimated Lead Value** | `organic sessions × industry conversion rate × avg deal size` | GA4 conversions + knowledge base |
| **Growth Trend** | Month-over-month organic traffic value change | GSC period comparison |

### Display
```
┌─────────────────────────────────────────────────┐
│  Your Organic Traffic Value                      │
│                                                  │
│  💰 $4,200/mo                                   │
│  equivalent Google Ads spend                     │
│                                                  │
│  ↑ 18% vs last month                            │
│                                                  │
│  📈 Content ROI: 340%                           │
│  $1,200 spent on content → $4,200/mo in value   │
│                                                  │
│  🎯 Top Value Keywords:                         │
│  "emergency dentist" — $8.50/click × 340 clicks │
│  "dental implants cost" — $12/click × 180 clicks│
└─────────────────────────────────────────────────┘
```

**Why this is a Premium feature:** It's the single most powerful retention tool. A client who sees "your organic traffic is worth $4,200/mo and growing" never questions the retainer. It justifies the platform cost every single month.

### Implementation
- New endpoint: `GET /api/public/roi/:workspaceId`
- Cross-reference GSC click data with SEMRush CPC per keyword
- Cache aggressively (daily refresh is fine — SEMRush data doesn't change hourly)
- ROI card on Overview tab for Premium; blurred soft-gate for Growth/Free
- Est: 3-4 hours

---

## Churn Prevention Signals

### Automated Admin Alerts

The platform already has the data to predict disengagement. Surface these as admin-side alerts:

| Signal | Threshold | Action |
|--------|-----------|--------|
| **No client login** | 14+ days since last dashboard visit | Email: "We noticed you haven't checked your dashboard — here's what's new" |
| **Chat drop-off** | Conversations down 50%+ month-over-month | Admin flag: "Client X engagement declining" |
| **No requests** | 30+ days without a request submission | Admin alert: "Consider proactive outreach" |
| **Health score drop** | Score dropped 10+ points since last visit | Auto-email: "Your site health changed — log in to see details" |
| **Trial ending** | 3 days before trial expiration | In-dashboard banner + email |
| **Payment failed** | Stripe subscription payment fails | Admin alert + client email with retry link |

### Positive Signals (Case Study Triggers)
| Signal | Threshold | Action |
|--------|-----------|--------|
| Organic traffic up 20%+ | Quarter-over-quarter GSC comparison | Admin: "Client X is a strong case study candidate" |
| Health score improved 15+ points | Compare current to 90-day-ago snapshot | Prompt client: "Your site health improved significantly!" |
| AI chatbot high engagement | 10+ conversations in a month | Admin: "Client X is highly engaged — upsell opportunity" |

### Implementation
- Background job runs daily, checks all workspaces
- Alerts stored in admin notification queue (not email-only)
- Admin Command Center shows "Needs Attention" section (already exists — extend it)
- Est: 2-3 hours

---

## Credits System (Phase 3)

> **Not yet implemented.** This section is a spec for future work. No credits fields or credit-purchase flows exist in the codebase yet.

### Prepaid Credit Packs

An alternative to per-item checkout for higher-volume clients:

| Pack | Price | Credits | Savings | Per-Credit |
|------|:-----:|:-------:|:-------:|:----------:|
| Starter | $500 | 5 credits | — | $100 |
| Growth | $900 | 10 credits | 10% off | $90 |
| Pro | $1,600 | 20 credits | 20% off | $80 |

### Credit Costs by Product

| Product | Credits |
|---------|:-------:|
| Blog Post Brief | 1 |
| Landing/Service/Product Page Brief | 1.5 |
| Pillar/Hub Page Brief | 2 |
| Blog Post — AI Draft | 3 |
| Blog Post — Polished | 5 |
| Landing Page Copy | 5 |
| Service/Location Page Copy | 4 |
| Pillar Page | 15 |
| Schema (per page) | 0.5 |
| Strategy Refresh | 2 |

### Benefits
- **Cash flow positive** — clients prepay, you deliver over time
- **Increases lifetime value** — unused credits don't expire (or expire after 12 months)
- **Reduces checkout friction** — one payment upfront, then "spend" credits without re-entering card
- **Upsell path** — "You're running low on credits — upgrade to the next pack and save 10%"

### Implementation
- `credits: number` field on workspace
- Deduct on fulfillment (brief generated, post delivered), not on request
- Credit purchase via Stripe Checkout (one-time payment)
- Admin can manually grant credits (comps, bonuses)
- Est: 2-3 hours (after Stripe Phase 1 is built)

---

## White-Label Resale (Future)

> **Not yet implemented.** This section is a spec for future work. No white-label configuration, multi-tenant domain routing, or agency-tier billing exists in the codebase yet.

### Platform-as-a-Service for Other Agencies

The long-term 10x revenue multiplier. Other web/SEO agencies license the platform under their own brand.

| Tier | Price | Includes |
|------|:-----:|---------|
| Agency Starter | $299/mo | 5 client workspaces, their branding |
| Agency Growth | $599/mo | 15 workspaces, custom domain, priority support |
| Agency Enterprise | $999/mo | Unlimited workspaces, white-label everything, API access |

### What Needs to Be Configurable
- Logo, colors, favicon (already partially configurable per workspace)
- Domain (CNAME + reverse proxy)
- Email templates (sender name, branding)
- AI chatbot persona name
- "Powered by" footer (optional)

### Design Decisions for Now
Even before building white-label, make these choices to keep the door open:
- Keep branding in config, not hardcoded
- Keep the teal/zinc palette parameterizable (CSS variables)
- Keep email templates reading from workspace config for sender details
- API endpoints should work with any origin (CORS per-workspace)

---

## UX Soft-Gating Spec (Option A)

The dashboard shell, tabs, layout, and navigation stay **identical across all tiers**. What changes is depth of access within certain features. Gated content is shown as a **blurred teaser with an upgrade CTA overlay** — clients always see what they're missing.

### Unchanged Across All Tiers

| Tab / Feature | Experience |
|---------------|-----------|
| Overview (Welcome back, metric cards, InsightsDigest, MonthlySummary) | Identical |
| Search (full GSC data, charts, queries, pages) | Identical |
| Analytics (full GA4 data, charts, sources, devices) | Identical |
| Site Health (score ring, severity, page list) | Identical |
| Plans (tier comparison, upgrade CTA) | Identical |
| Onboarding Wizard (first-run) | Tier-aware feature grid |

### Gated Feature Matrix

| Feature | Free (Starter) | Growth ($249) | Premium ($999) |
|---------|----------------|---------------|----------------|
| AI Chatbot | 3 convos/month → upgrade prompt | Unlimited | Unlimited |
| Proactive Insights greeting | Disabled | Full greeting + follow-ups | Full |
| SEO Strategy tab | **Hidden** | Lite: keywords, page map, content gaps, quick wins | Full + competitor keyword gaps |
| Content tab | **Hidden** | Brief/post purchasing via Stripe | Same |
| ROI Dashboard tab | **Hidden** | Full organic traffic value view | Full |
| Approvals tab | **Hidden** | **Hidden** | Full approve / reject / edit |
| Requests tab | **Hidden** | **Hidden** | **Hidden** (returns with Strategy & Implementation Hours system) |
| Custom date ranges | Locked to 28d default | Full presets + custom calendar | Full |
| Competitor keyword analysis | Not available | Blurred with Premium upgrade CTA | Full |
| Strategy & implementation hours | Not available | Not available | 3 hrs/mo included |

### Soft Gate UX Pattern

Each gated section uses the same visual treatment:

```
┌──────────────────────────────────────┐
│  [Blurred/frosted content preview]   │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  🔒 Upgrade to Growth          │  │
│  │                                │  │
│  │  12 content opportunities      │  │
│  │  identified for your site.     │  │
│  │                                │  │
│  │  [ See Plans → ]               │  │
│  └────────────────────────────────┘  │
│                                      │
│  [Blurred/frosted content preview]   │
└──────────────────────────────────────┘
```

- Background: actual data rendered but with `blur-md` + `pointer-events-none`
- Overlay: centered card with lock icon, tier name, value proposition, and CTA button
- CTA links to in-portal pricing page or Stripe subscription checkout

### AI Chatbot Rate Limiting

Two separate systems exist. Understanding both is critical before modifying chat endpoints:

**`server/chat-memory.ts` — enforcement gate (currently free-tier only)**
`checkChatRateLimit(workspaceId, tier, sessionId)` is called at the top of the chat handler in `server/routes/public-analytics.ts:261`. For any tier other than `'free'` it unconditionally returns `{ allowed: true }` — Growth and Premium users have unlimited chats today.

**`server/usage-tracking.ts` — counting layer (all tiers)**
`incrementUsage(ws.id, 'ai_chats')` is called at `public-analytics.ts:491` after each successful response. This populates the `usage_tracking` table with accurate monthly counts, but counts are never checked before generating a response (no `checkUsageLimit` call in chat routes).

| Tier | `ai_chats` / month (defined) | Enforced? | `strategy_generations` / month | Enforced? |
|------|------------------------------|-----------|-------------------------------|-----------|
| Free | 3 | ✅ via `checkChatRateLimit` in `chat-memory.ts` | 0 | ✅ via `checkUsageLimit` in `usage-tracking.ts` |
| Growth | 50 | ❌ counted only — enforcement not wired | 3 | ✅ via `checkUsageLimit` in `keyword-strategy.ts` |
| Premium | Unlimited | n/a | Unlimited | n/a |

- A "conversation" = a chat session with at least 1 user message
- After the free-tier limit (3): chat input disabled, replaced with upgrade prompt
- Counter shown in chat header: "2 of 3 free conversations remaining"
- Proactive insights greeting disabled on free tier (saves tokens + creates upgrade incentive)
- **Growth-tier chat enforcement** — to wire up, replace the `checkChatRateLimit` call in `public-analytics.ts:261` with `checkUsageLimit(ws.id, tier, 'ai_chats')`, then remove the growth/premium bypass from `chat-memory.ts:193`. The count data is already there.

### Implementation Status

1. ✅ **`tier` on Workspace interface** — `tier: 'free' | 'growth' | 'premium'` in `server/workspaces.ts`
2. ✅ **`<TierGate>` component** — blur overlay with upgrade CTA, used across Strategy and Content sections
3. ✅ **Tab-level gating in NAV array** — `isPaid` / `isPremium` booleans control tab visibility
4. ✅ **Free-tier chat limit (3/month)** — enforced via `checkChatRateLimit` in `server/chat-memory.ts`
5. ✅ **Strategy generation limit (Growth: 3/month)** — enforced via `checkUsageLimit` in `server/routes/keyword-strategy.ts`
6. 🟡 **Growth-tier chat limit (50/month)** — counts tracked in `usage_tracking` table but enforcement not yet wired (see note above)
7. ✅ **Competitor gaps gated to Premium** — `TierGate required="premium"` on keyword gaps section
8. 🟡 **Strategy & Implementation Hours system** — roadmapped (item #76). Requests tab returns when active.
9. ✅ **Stripe subscription sync** — webhook updates `ws.tier` on subscription create/cancel/change
10. ✅ **Admin tier management** — Workspace Settings dropdown to manually set tier

---

## Stripe Integration Spec (Phase 1)

### Required Environment Variables
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BRIEF=price_...
STRIPE_PRICE_BRIEF_SEMRUSH=price_...
STRIPE_PRICE_POST_DRAFT=price_...
STRIPE_PRICE_POST_POLISHED=price_...
STRIPE_PRICE_POST_PREMIUM=price_...
STRIPE_PRICE_SCHEMA_PAGE=price_...
STRIPE_PRICE_SCHEMA_SITE=price_...
STRIPE_PRICE_STRATEGY=price_...
STRIPE_PRICE_STRATEGY_REFRESH=price_...
```

### New Server Endpoints
```
POST   /api/stripe/create-checkout    — Create Stripe Checkout session for a product
POST   /api/stripe/webhook            — Handle Stripe webhook events
GET    /api/stripe/payments/:wsId     — List payments for a workspace
GET    /api/public/stripe/status/:id  — Client checks payment status
```

### Implemented Files
```
server/stripe.ts                      — Stripe SDK setup, checkout helpers, webhook handler
server/payments.ts                    — Payment record persistence (SQLite)
```

### Webhook Events to Handle
```
checkout.session.completed    → Mark order as paid, update content request status
payment_intent.payment_failed → Flag order, notify admin
```

### Client-Side Integration Points
1. **Content Pipeline** — "Request Brief" button → Stripe Checkout → redirect back with success
2. **Strategy tab** — "Generate Strategy" → payment required for non-subscribers
3. **Schema tab** — "Generate Schemas" → payment for package
4. **Upgrade prompts** — At tier gate points, link to Stripe subscription checkout

---

*Last updated: April 21, 2026*
*Status: Phase 1 (Stripe) fully implemented. Phase 2 (tier gating + usage tracking) implemented. Phases 3–4 (bundle pricing page, credits system) pending.*
