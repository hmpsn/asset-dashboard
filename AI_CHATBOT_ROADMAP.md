# Client AI Chatbot Roadmap

Upgrade the client-facing AI assistant from a search-data-only Q&A tool into a full-spectrum site advisor and soft sales engine.

---

## Current State (Updated March 7, 2026)

### What the client chatbot sees

| Data Source | Passed to AI | Notes |
|------------|:---:|---|
| GSC overview (clicks, impressions, CTR, position) | ✅ Yes | Top 15 queries, top 10 pages |
| GSC search trend (period comparison) | ✅ Yes | First/last day comparison |
| GA4 overview (users, sessions, pageviews, bounce, duration) | ✅ Yes | |
| GA4 top pages, sources, devices, countries | ✅ Yes | Sliced to top 8-15 |
| GA4 events & conversions | ✅ Yes | Top 15 events, top 10 conversions |
| Site health audit (score, errors, warnings) | ✅ Yes | Score, previousScore, totalPages |
| Audit detail (site-wide issues, top problem pages) | ✅ Yes | Top 5 issue pages with specific issues |
| SEO strategy / keyword map | ✅ Yes | Page map, opportunities, content gaps, quick wins |
| Rank tracking | ✅ Yes | Latest positions with clicks, impressions, changes |
| Activity log | ✅ Yes | Last 10 entries |
| Annotations | ✅ Yes | Last 10 annotations |
| Pending approvals | ✅ Yes | Count of pending batches |
| Active requests | ✅ Yes | Top 5 open requests with title, category, status |
| Global knowledge base | ✅ Yes | Per-workspace business context + knowledge-docs/ files |

### What the admin chatbot sees

| Data Source | Passed to AI | Notes |
|------------|:---:|---|
| All of the above | ✅ Yes | Fetched on-demand when chat opens |
| GA4 period comparison | ✅ Yes | Current vs previous period deltas |
| GA4 organic overview | ✅ Yes | Organic users, engagement, share |
| GA4 new vs returning | ✅ Yes | Segment breakdown |
| GA4 landing pages | ✅ Yes | Sessions, bounce by entry page |
| GA4 conversions | ✅ Yes | Event counts, rates |
| Keyword strategy context | ✅ Yes | Server-side injection via buildSeoContext() |
| Keyword map context | ✅ Yes | Server-side injection via buildKeywordMapContext() |

### What it does well
- ✅ Branded as "Insights Engine by hmpsn studio" (client) / "Admin Insights" (admin)
- ✅ Revenue hooks: data signal → business impact → warm handoff
- ✅ Full dashboard data awareness (10+ data sources)
- ✅ Global knowledge base per workspace
- ✅ Admin-specific internal analyst persona (direct, technical)
- ✅ Quick question presets tailored to each persona
- ✅ GPT-4o model
- ✅ Floating chat widget UX (teal/emerald for client, indigo/violet for admin)

### What it still lacks
1. **No memory** — every conversation starts from zero
2. **No proactive insights** — only answers questions, never surfaces opportunities
3. **No action triggers** — can't link to specific dashboard sections or trigger actions
4. **Single-turn context** — no conversation history passed to the AI

---

## Implementation Phases

### ~~Phase 1: Full Dashboard Context~~ ✅ SHIPPED
**Shipped: March 7, 2026**

All available data sources now fed into both client and admin AI chatbot contexts. Client `askAi()` passes 10+ data sources including audit detail, SEO strategy, rank tracking, activity log, annotations, approvals, and requests. Admin chat auto-fetches GSC, GA4 (overview, comparison, organic, new-vs-returning, conversions, landing pages), and audit data on open.

---

### ~~Phase 2: Global Knowledge Base~~ ✅ SHIPPED
**Shipped: March 7, 2026**

Per-workspace `knowledgeBase` text field + `knowledge-docs/` folder for longer documents. `buildKnowledgeBase()` function in `seo-context.ts` reads both sources and injects into both chatbot system prompts. Editable from Workspace Settings → Features tab. Up to 6000 chars from knowledge-docs files.

---

### ~~Phase 3: Sales Engine Behavior~~ ✅ SHIPPED
**Shipped: March 7, 2026**

Client chatbot rebranded as "Insights Engine by hmpsn studio". System prompt includes 8 revenue hook patterns (low organic → keyword strategy, high bounce → page optimization, content gaps → briefs, technical issues → cleanup sprint, no tracking → analytics setup, ranking drops → recovery plan, pending approvals → action nudge, schema gaps → implementation). Three-step pattern: surface insight with numbers → explain business impact → warm handoff. Admin chatbot uses separate internal analyst persona with direct technical tone.

**Still TODO from Phase 3:**
- [ ] Action deep-links in AI responses (link to specific dashboard tabs)
- [ ] Track which revenue hooks the AI triggers (log to activity)

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
*Status: Phases 1-3 SHIPPED. Phases 4-6 pending.*
*Last updated: March 7, 2026*
