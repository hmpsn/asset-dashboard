# Copy & Brand Engine — Future Phases (Notes)

**Date:** 2026-03-26
**Status:** Brainstormed, not yet spec'd
**Context:** These notes capture ideas discussed during the Phase 1 brainstorm. Each phase should go through its own brainstorm → spec → plan cycle when ready to build.

---

## Phase 2: Page Strategy Engine

**The problem it solves:** After you have a brandscript and calibrated voice, you still need to decide *what pages to build* and *what sections go on each page*. This is the "wireframing and page strategy" pain point — trying to think of the right things to include on a page while staying true to the brand.

**Key ideas discussed:**

- **Site blueprint generator** — Input industry type + brandscript, get recommended pages with section breakdowns. E.g., a dental practice needs: Homepage, About, Services (parent), individual service pages, Location pages, Blog, Contact, FAQ.

- **Section library** — Reusable section types mapped to StoryBrand narrative roles: Hero (Hook), Problem/Pain (Problem), Solution (Guide), Social Proof (Authority), Process/How-It-Works (Plan), FAQ (Objection Handling), CTA (Call to Action), About/Team (Guide - Authority), Testimonials (Success).

- **Per-section briefs** — Each section gets both a brand purpose ("This section should address the internal problem using empathetic tone") and an SEO purpose ("Target keyword for this page, include in H1 and first paragraph").

- **SEO + narrative harmonizer** — The core tension: SEO wants keywords and structure, brand wants story and voice. Each section gets both purposes, and the AI balances them during copy generation.

- **Iterative refinement** — Adjust the page strategy week by week during client sessions. Add/remove pages, reorder sections, change section purposes. The strategy is a living document throughout the engagement.

- **Scale consideration** — Must work for 5-page sites (hand-curated) and 50-page sites (template-driven). Connects to the existing Content Templates and Content Matrices systems for scaling.

**Downstream from Phase 1:** Messaging pillars → inform which sections are recommended. Customer journey → inform CTA strategy per page. Key differentiators → inform which proof points to include.

**Connects to existing features:** Content Templates (page structure), Content Matrices (scaling pages), Content Briefs (per-page briefs).

---

## Phase 3: Full Copy Pipeline

**The problem it solves:** With a brandscript, calibrated voice, and page strategy in place, the platform generates draft copy for every section of every page — ready to hand to design. The copywriter becomes a reviewer/editor rather than a first-draft writer.

**Key ideas discussed:**

- **Section-by-section copy generation** — Hero headlines, body copy, CTAs, microcopy. Each section generated with the full brand context (brandscript + voice profile + page strategy + SEO keywords).

- **Voice matching with calibration loop** — Generate → compare to voice samples → auto-refine. The calibration work from Phase 1 pays off here at scale.

- **SEO integration per section** — Keywords woven in naturally, not stuffed. The SEO + narrative harmonizer from Phase 2 feeds the copy generation prompts.

- **Copy review workflow** — Approve, revise, regenerate per section. Same conversational steering pattern from Phase 1.

- **Client-facing copy review (optional)** — Clients can flag sections that don't sound right. Extends the existing client portal pattern.

- **Export-ready output** — Structured copy decks ready for design handoff. Could export as structured data for Webflow CMS, Google Docs, or formatted documents.

- **Scale consideration** — Must work for 5-page sites (one page at a time) and 50-page sites (batch generation with template-driven copy). The template/matrix system from Phase 2 enables batch generation.

**Downstream from Phase 1:** Voice profile → every generated section matches the calibrated voice. Guardrails → automatic compliance checking. Brand identity deliverables → messaging pillars woven into copy, objections addressed in FAQ sections, brand story powers about page.

**Downstream from Phase 2:** Page strategy → defines what sections to generate. Section briefs → provide the AI with specific purpose and constraints per section. SEO harmony → keywords are pre-assigned to sections.

---

## Build Order

1. **Phase 1** (current) — Brandscript Engine + Voice Calibration → ~30-40 hours
2. **Phase 2** — Page Strategy Engine → ~50-70 hours (estimate from brainstorm)
3. **Phase 3** — Full Copy Pipeline → ~40-50 hours (much of the infrastructure is in place by this point)

Each phase is independently useful:
- Phase 1 alone: Better AI copy quality across all existing features
- Phase 1 + 2: Eliminates the "what goes on each page" problem
- Phase 1 + 2 + 3: Full brandscript-to-copy pipeline, copywriter becomes editor

---

## StoryBrand Framework Notes

The studio uses StoryBrand as a default framework but it doesn't always work for every client. The system must be flexible:

- StoryBrand sections map to page sections: Hook → Hero, Character → audience copy, Problem → pain point sections, Guide → about/trust, Plan → how-it-works, CTA → conversion sections, Failure → urgency/stakes, Success → transformation/testimonials
- Non-StoryBrand clients: The system should support custom narrative frameworks (Golden Circle, Problem/Solution/Proof, etc.) with the same section-to-page mapping capability
- Brand bibles from discovery typically follow the StoryBrand structure (as shown in the Rinse Dental example)

## Client Involvement Model

- Platform works as a powerful internal tool by default
- Selectively expose pieces to clients when they want to be involved
- Some clients are super hands-on, others trust the studio's judgment
- The system should support both modes without adding complexity to either
- Follows the existing content plan review pattern for client-facing views

## Workflow Cadence

- Weekly client review/pitching sessions
- Process takes weeks, not days
- Each week layers in more strategy, copy, and refinement
- The platform should be the through-line across sessions — visible progress each week
- Not a "go away and come back" model, but iterative and collaborative
