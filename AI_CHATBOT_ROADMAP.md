# Client AI Chatbot Roadmap

Upgrade the client-facing AI assistant from a search-data-only Q&A tool into a full-spectrum site advisor and soft sales engine.

---

## Current State

### What it sees today

| Data Source | Passed to AI | Notes |
|------------|:---:|---|
| GSC overview (clicks, impressions, CTR, position) | Yes | Top 15 queries, top 10 pages |
| GA4 overview (users, sessions, pageviews, bounce, duration) | Yes | |
| GA4 top pages, sources, devices, countries | Yes | Sliced to top 8-15 |
| GA4 events & conversions | Yes | Top 15 events, top 10 conversions |
| **Site health audit** | **No** | Score, errors, warnings, page-level issues all available in state but not passed |
| **SEO strategy / keyword map** | **No** | Page keywords, content gaps, quick wins all loaded but not passed |
| **Rank tracking** | **No** | Historical positions, keyword changes available but not passed |
| **Content requests / briefs** | **No** | Status of content pipeline invisible to AI |
| **Approval batches** | **No** | Pending approvals not mentioned |
| **Activity log** | **No** | Recent team actions invisible |
| **Annotations** | **No** | Timeline events not correlated |
| **Period comparison (GSC)** | **No** | New endpoint exists but client dashboard doesn't fetch it yet |
| **Organic landing pages (GA4)** | **No** | New endpoint exists but not wired |

### What it does well
- Warm, data-driven tone (already tuned)
- Natural "talk to your web team" soft-sell nudges
- Quick question presets
- GPT-4o model
- Floating chat widget UX

### What it lacks
1. **Blindness to 60% of the dashboard** — can't answer questions about site health, SEO strategy, content, or approvals
2. **No memory** — every conversation starts from zero
3. **No workspace/business context** — doesn't know the client's industry, goals, or brand
4. **No proactive insights** — only answers questions, never surfaces opportunities
5. **No action triggers** — can't link to specific dashboard sections or trigger actions
6. **Single-turn context** — dumps raw JSON, no conversation history to the AI

---

## Implementation Phases

### Phase 1: Full Dashboard Context (Priority: HIGH)
**Estimated effort: 3-4 hours**

Feed every available data source into the AI context so it can answer questions about anything on the dashboard.

#### Frontend (ClientDashboard.tsx)
- [ ] Pass audit summary to context: `{ siteScore, errors, warnings, previousScore, scoreHistory }`
- [ ] Pass top audit issues (top 5 errors, top 3 warnings) as digestible summaries
- [ ] Pass keyword strategy summary: `{ siteKeywords, pageCount, contentGaps count, quickWins count }`
- [ ] Pass rank tracking: latest positions for tracked keywords with change deltas
- [ ] Pass content pipeline status: `{ pending: N, in_review: N, approved: N, delivered: N }`
- [ ] Pass approval status: `{ pendingBatches: N, totalItems: N }`
- [ ] Pass recent activity log (last 5 entries)
- [ ] Pass annotations (correlate with data)
- [ ] Fetch and pass GSC period comparison (new endpoint)
- [ ] Fetch and pass GA4 organic landing pages (new endpoint)

#### Backend (server/index.ts — `/api/public/search-chat`)
- [ ] Update system prompt to describe all new data sources
- [ ] Add section-specific guidance: "If asked about site health, reference the audit score and top issues"
- [ ] Increase maxTokens from 1500 → 2000 (more context = longer answers)

#### Smart context compression
- [ ] Don't dump full JSON — pre-summarize on the frontend:
  - Audit: "Site health score: 78/100 (up from 72). 3 critical errors, 12 warnings. Top issues: missing meta descriptions (5 pages), thin content (3 pages)."
  - Strategy: "28 pages mapped to keywords. 6 content gaps identified. 4 quick wins available."
  - Ranks: "Top movers: 'web design dallas' +4 positions, 'seo services' -2 positions."

**Why this is #1:** Dramatically increases the chatbot's usefulness with minimal backend work. All the data is already loaded in the client dashboard state — it just needs to be passed along.

---

### Phase 2: Global Knowledge Base (Priority: HIGH)
**Estimated effort: 4-5 hours**

Give the AI a "brain" of SEO, web design, and digital marketing knowledge that's independent of any single client's data. This makes it genuinely helpful even when data is sparse.

#### Knowledge base content
- [ ] Create `server/ai-knowledge-base.ts` with structured knowledge:
  - **SEO fundamentals**: What affects rankings, how Google works, E-E-A-T, Core Web Vitals thresholds
  - **Common client questions**: "Why did my traffic drop?", "How long does SEO take?", "What's a good bounce rate?"
  - **Industry benchmarks**: Average CTR by position, typical bounce rates by industry, conversion rate benchmarks
  - **Service explanations**: What a content brief is, what schema markup does, why site speed matters
  - **Objection handling**: "Is SEO worth it?", "Why can't I just do Google Ads?", "My competitor ranks higher"

#### System prompt enrichment
- [ ] Inject relevant knowledge base sections based on question classification
- [ ] Simple keyword matching to select which knowledge modules to include (not full RAG — overkill for this size)
- [ ] Keep knowledge base under 2000 tokens to avoid prompt bloat

#### Per-workspace customization
- [ ] Pull `brandVoice` from workspace settings into system prompt
- [ ] Pull `businessContext` from keyword strategy into prompt ("This is a Dallas-based web design agency targeting SMBs")
- [ ] Pull `competitorDomains` for competitive context

**Why this is #2:** Transforms the chatbot from a "data reader" into a knowledgeable advisor. Clients ask "why did my traffic drop?" and get a real answer — not just "I don't have that data."

---

### Phase 3: Sales Engine Behavior (Priority: HIGH)
**Estimated effort: 3-4 hours**

Make the chatbot a natural revenue driver without feeling pushy. It should identify opportunities and connect them to services the agency offers.

#### Opportunity detection rules
- [ ] **Content gaps → content brief upsell**: "Your strategy shows 6 untapped content opportunities. Your team can generate detailed briefs for these — want me to explain what that looks like?"
- [ ] **Low site score → audit-driven urgency**: "Your site health is at 64/100 — down from 71 last month. There are 3 critical issues your team should address soon."
- [ ] **High-impression low-click queries → SEO service hook**: "You're showing up 800 times/month for 'dallas web design' but only getting 12 clicks. Title and meta optimization could 3-4x that traffic."
- [ ] **Declining traffic → proactive alert**: "Your organic traffic dropped 18% vs last month. This could be seasonal, a competitor move, or a technical issue. Worth flagging with your team."
- [ ] **No strategy generated → strategy upsell**: "I don't have keyword strategy data for your site yet. A full keyword mapping would help us identify your biggest growth opportunities."
- [ ] **Pending approvals → action nudge**: "You have 8 SEO changes waiting for your review. Approving these could improve your search visibility."

#### Soft-sell prompt engineering
- [ ] Add `serviceOfferings` to system prompt based on what the agency actually provides
- [ ] Train on conversion patterns: identify → educate → suggest action → defer to team
- [ ] Never use words like "buy", "purchase", "upgrade" — use "explore", "discuss with your team", "great opportunity"
- [ ] Track which upsell paths the AI suggests (log to activity)

#### Action links
- [ ] AI responses can include deep links: "Check your [Site Health tab](/client/ws_123?tab=health) to see the details"
- [ ] "Request this topic" links embedded in content gap responses
- [ ] "Review your approvals" links when pending items exist

**Why this is #3:** This is where the chatbot pays for itself. Every conversation becomes a potential touchpoint for additional services.

---

### Phase 4: Conversation Memory (Priority: MEDIUM)
**Estimated effort: 3-4 hours**

#### Short-term memory (within session)
- [ ] Pass full conversation history to AI (not just latest question)
- [ ] Sliding window: last 10 messages to avoid token overflow
- [ ] AI can reference earlier questions: "As we discussed, your mobile traffic is growing..."

#### Long-term memory (across sessions)
- [ ] Store conversation summaries per workspace: `{ lastTopics, keyInsights, openQuestions }`
- [ ] On chat open, inject: "Last time we talked about mobile traffic growth and your content strategy."
- [ ] Store client preferences: "This client always asks about rankings" → prioritize rank data in context

#### Backend
- [ ] `/api/public/chat-history/:workspaceId` — store/retrieve conversation summaries
- [ ] Summarize conversations on close (quick AI call to extract key points)
- [ ] Prune history older than 90 days

**Why this is medium:** Valuable but not critical. The chatbot is useful without memory; memory makes it feel *personal*.

---

### Phase 5: Proactive Insights (Priority: MEDIUM)
**Estimated effort: 4-5 hours**

Instead of waiting for questions, the chatbot surfaces insights automatically.

#### Insight engine
- [ ] On dashboard load, generate 2-3 contextual insights based on current data:
  - "Your traffic is up 23% this month — great momentum!"
  - "3 pages have bounce rates over 80% — worth investigating"
  - "You have 2 content briefs ready for review"
- [ ] Display as cards above the chat or as the chat's "greeting"
- [ ] Each insight links to the relevant dashboard section

#### Trigger-based suggestions
- [ ] When client views Health tab with score < 70: chat bubble pulses with "I noticed some issues — want to talk about them?"
- [ ] When client views Strategy with content gaps: "I see some great content opportunities here"
- [ ] When approvals are pending > 3 days: gentle nudge in chat

#### Weekly digest (future)
- [ ] Auto-generate a weekly summary insight for each workspace
- [ ] Could be pushed via email notification system

**Why this is medium:** Proactive feels premium but requires careful UX to not be annoying. Best implemented after the foundation is solid.

---

### Phase 6: Multi-Modal Responses (Priority: LOW)
**Estimated effort: 3-4 hours**

#### Rich responses
- [ ] AI can suggest charts: "Here's your traffic trend" → render an inline mini-chart in the chat
- [ ] Data tables in responses: top 5 keywords as a formatted table instead of bullet list
- [ ] "Show me" commands: "Show me my top pages" → renders a compact data view inline

#### Export & share
- [ ] "Email this to me" — send the AI's response as a formatted email
- [ ] "Save as note" — save insight to the activity log
- [ ] Copy response to clipboard

**Why this is low:** Polish feature. The text-based chat is effective on its own.

---

## Technical Decisions

1. **Context size management**: With all data sources, the context could hit 4-5K tokens. Need smart compression — pre-summarize on the frontend, not raw JSON dumps.

2. **Knowledge base format**: Simple TypeScript module with exportable sections, not a vector database. The knowledge base is small enough (<50 articles) that keyword matching works fine.

3. **Conversation storage**: JSON files per workspace (consistent with existing data patterns) or append to the existing activity log.

4. **Rate limiting**: Current rate limiter allows 5 requests/minute. May need to adjust for active chat sessions.

5. **Model choice**: Stick with GPT-4o for quality. The sales-engine use case justifies the cost — one converted upsell pays for thousands of API calls.

---

## Estimated Total Effort

| Phase | Hours | Priority |
|-------|:-----:|:--------:|
| Phase 1: Full dashboard context | 3-4 | HIGH |
| Phase 2: Global knowledge base | 4-5 | HIGH |
| Phase 3: Sales engine behavior | 3-4 | HIGH |
| Phase 4: Conversation memory | 3-4 | MEDIUM |
| Phase 5: Proactive insights | 4-5 | MEDIUM |
| Phase 6: Multi-modal responses | 3-4 | LOW |
| **Total** | **20-26** | |

Critical path (Phases 1-3) = **10-13 hours**.

---

*Created: March 7, 2026*
*Status: Planning — not yet started*
