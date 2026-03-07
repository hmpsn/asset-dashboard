---
description: Run after shipping any feature or significant enhancement. Updates all documentation, roadmap, and knowledge bases.
---

# Feature Shipped — Documentation & Knowledge Update

Run this workflow after completing any feature, enhancement, or significant bug fix. This ensures all knowledge bases stay in sync.

## 1. Identify what shipped

// turbo
Run `git log --oneline -10` to see recent commits. Note all `feat:`, `fix:`, and `refactor:` commits since the last documentation update.

## 2. Update FEATURE_AUDIT.md

For each shipped item:

- **New feature**: Add a numbered entry (continue from current last number) with: What it does / Agency value / Client value / Mutual value.
- **Enhancement to existing feature**: Update the existing feature's "What it does" paragraph to include the new capability.
- **Future Additions section**: Mark any shipped items with `~~strikethrough~~: ✅ Shipped — [description]`.
- **Summary table**: Update category counts and total feature count if a new feature was added.
- **Bottom counter**: Update `Current feature count: **N**`.

## 3. Update data/roadmap.json

- **Existing items**: Change `"status": "pending"` → `"status": "done"` for any completed roadmap items. Update `"notes"` to include "Shipped —" prefix with a brief description.
- **New unplanned work**: If the shipped feature wasn't on the roadmap, add it as a new item in the appropriate sprint with `"status": "done"`. Use the next available ID number.
- **Cross-check all items**: Scan ALL sprints and backlog for items that may have been completed in previous sessions but never marked done. Compare item descriptions against the git log and actual codebase.

## 4. Update ACTION_PLAN.md

- Add a row to the **Decision Log** table with date, decision summary, and context.
- Update the `*Last updated:*` timestamp at the bottom.
- If a sprint is now fully complete, update its header to show `~~strikethrough~~ ✅ SHIPPED`.

## 5. Update AI_CHATBOT_ROADMAP.md (if applicable)

Only update if the shipped work affects the AI chatbot:
- Mark phases as shipped if completed.
- Update "What it still lacks" section.
- Update data source tables if new data is now passed to the AI.

## 6. Update feature-integration.md cross-link table (if applicable)

If the shipped feature adds new cross-links between tools, update the table in `.windsurf/workflows/feature-integration.md` section 1.

## 7. Build and verify

// turbo
Run `npx vite build` to ensure no build errors from documentation-adjacent code changes.

## 8. Commit and push

Commit all documentation changes in a single commit:
```
git add -A && git commit -m "docs: update FEATURE_AUDIT, roadmap, ACTION_PLAN — [brief summary]"
git push origin main
```

## Reminder checklist

Before committing, verify:
- [ ] FEATURE_AUDIT.md feature count matches actual numbered entries
- [ ] data/roadmap.json has no items marked "pending" that are actually shipped
- [ ] ACTION_PLAN.md decision log has entries for all significant decisions this session
- [ ] No roadmap items in ANY sprint were overlooked (scan all sprints, not just Sprint 1)
