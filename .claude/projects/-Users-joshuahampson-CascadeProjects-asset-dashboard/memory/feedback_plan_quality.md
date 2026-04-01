---
name: Implementation plan quality standards
description: Plans must be exhaustively verified before writing — never assume coverage, always prove it with parallel agent grep scans. Every plan needs parallelization strategy, model assignments, systemic improvements, and prevention mechanisms.
type: feedback
---

Plans that assume scope from memory miss 70%+ of affected files. Proven on the light-mode audit (2026-03-29) where the first plan covered 9 files but exhaustive grep found 30+ files with 103 instances.

**Why:** The first light-mode plan relied on session memory and spot-checks. The user challenged "are we 100% sure?" and parallel agent scans revealed massive gaps — inline styles, SVG attributes, Recharts props, arbitrary Tailwind classes, and entire components the plan never mentioned.

**How to apply:**
- Before writing any implementation plan, run the `pre-plan-audit` skill to exhaustively grep the codebase and categorize every finding
- Every plan must include: parallelization strategy (which tasks can run concurrently), model assignments (Haiku/Sonnet/Opus per task), systemic improvements section (shared utilities, pr-check rules, test coverage), and verification strategy (preview screenshots, not "manual check")
- Never write a plan from memory — every file must appear in an audit with a grep match proving it needs changes
- Challenge completeness: "are we 100% sure we got every file?" is the final gate before writing tasks
