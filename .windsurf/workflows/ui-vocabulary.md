---
description: Canonical UI vocabulary for action labels, badges, and status text. Reference this before writing any user-facing strings.
---

# UI Vocabulary Guide

Use these exact labels when creating buttons, badges, tooltips, status text, and toast messages. Do NOT invent synonyms.

> **Color assignments below must match `BRAND_DESIGN_LANGUAGE.md` § 2 (Three Laws of Color).** When in doubt, check the Per-Component Color Map.

## Action Verbs

| Action | Label | Icon | Color | Context |
|--------|-------|------|-------|---------|
| Send item to client for review | **"Send to Client"** | `Send` | purple (admin-only AI feature) | Audit issues, schemas, briefs, SEO changes |
| Send batch for client approval | **"Send for Approval"** | `Send` | teal | SEO Editor, CMS Editor (batch approval flow) |
| Create internal team work item | **"Add to Tasks"** | `ClipboardList` | zinc | Audit → request manager |
| Batch create internal tasks | **"Add [X] to Tasks"** | `ClipboardList` | varies | e.g. "Add Errors to Tasks (5)" |
| Push fix directly to Webflow | **"Accept & Push"** | `CheckCircle` | emerald | AI suggestion → Webflow API |
| Navigate to fix tool | **"Fix"** | `Wrench` | teal | Audit → SEO Editor / Schema / etc. |
| Run/re-run an analysis | **"Re-scan"** / **"Run Audit"** | `RefreshCw` | zinc | Audit, Performance |
| Save + generate share link | **"Save & Share"** | `Share2` | teal | Audit report |
| Export data | **"Export"** | `FileText` | zinc | Audit, Analytics |

## Status Badges (past-tense of action)

| State | Badge Label | Icon | Color |
|-------|-------------|------|-------|
| Sent to client | **"Sent"** | `Send` | purple (admin-only) |
| Task created | **"Added"** | `CheckCircle` | green |
| Fix pushed to Webflow | **"Applied"** | `CheckCircle` | green |
| Approval sent | **"Sent!"** | `CheckCircle` | teal |
| Currently processing | **"Pushing..."** / **"Sending..."** / **"Adding..."** | `Loader2` | inherit |

## Nouns

| Concept | Canonical Term | DO NOT use |
|---------|---------------|------------|
| Client-submitted item | **"request"** | ticket, issue (in client context) |
| Internal team work item | **"task"** | ticket, to-do |
| Audit finding | **"issue"** | error (unless severity=error), problem, bug |
| AI-generated recommendation | **"AI suggestion"** | AI fix, AI recommendation, auto-fix |
| The place tasks live | **"Tasks"** (nav label) | Request Manager (internal name only) |
| Client-facing dashboard | **"Client Dashboard"** | portal, client view |
| Admin-facing dashboard | **"Command Center"** | admin panel, control panel |

## Overflow Menu Labels

When actions are behind a `⋮` (MoreVertical) overflow menu:

- **"Send to Client"** — always first, purple text
- **"Add to Tasks"** — always second, zinc text

## Toast / Confirmation Messages

| Event | Message |
|-------|---------|
| Sent to client | `"Sent to client"` |
| Task created | `"Added to tasks"` |
| Batch tasks created | `"{N} added to tasks"` |
| Fix applied | `"Applied to Webflow"` |
| Report saved | `"Report saved! Share this link with clients:"` |

## Rules

1. **Never mix "flag" and "send"** — always use "send" for client-facing actions.
2. **Never use "create" for tasks** — use "add" (tasks already exist as a concept; you're adding to the list).
3. **Past-tense badges match the verb** — Send → Sent, Add → Added, Apply → Applied.
4. **Tooltips expand the label** — e.g. button says "Fix", tooltip says "Open SEO Editor".
5. **Batch labels include the destination** — "Add Errors to Tasks", not just "Add Errors".
6. **Loading states use "...ing"** — "Pushing...", "Sending...", "Adding...".
7. **Color rules** — All action colors must follow the Three Laws in `BRAND_DESIGN_LANGUAGE.md`: teal for CTAs, blue for data, purple for admin AI only. Never use violet or indigo.
