# CI Coverage Thresholds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce test coverage thresholds so new code ships with meaningful test coverage and overall coverage never regresses.

**Architecture:** Install `@vitest/coverage-v8` (V8's built-in coverage, fastest provider), configure coverage thresholds in `vite.config.ts`, add a `test:coverage` npm script, and add a coverage step to the CI pipeline. Thresholds are set after establishing a baseline — slightly below current levels as a ratchet.

**Tech Stack:** @vitest/coverage-v8 (pinned to match vitest), vitest coverage config, GitHub Actions CI

**Not applicable (infrastructure change):** FEATURE_AUDIT.md, BRAND_DESIGN_LANGUAGE.md, data/features.json. Will add to data/roadmap.json if a roadmap item is created.

---

## Pre-requisites

- [ ] No spec needed (self-contained infrastructure)
- [ ] No pre-plan audit needed (modifies 4 config files, no codebase-wide changes)

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add `@vitest/coverage-v8` devDependency, `test:coverage` script |
| `vite.config.ts` | Modify | Add `coverage` block inside existing `test` config |
| `.github/workflows/ci.yml` | Modify | Replace `npm test` with `npm run test:coverage` |
| `.gitignore` | Modify | Add `coverage/` directory |

---

## Task Dependencies

```
Sequential:
  Task 1 (Install provider) → Task 2 (Establish baseline) → Task 3 (Set thresholds in config) → Task 4 (CI integration) → Task 5 (Code review + commit)
```

All tasks are single-agent, sequential. Model: **sonnet**.

**File ownership (single-agent, but documented for completeness):**
- **Owns:** `package.json` (scripts + devDependencies), `vite.config.ts` (test.coverage block only), `.github/workflows/ci.yml` (test step only), `.gitignore`
- **Must not touch:** any `server/`, `src/`, `shared/`, or `tests/` files

---

### Task 1: Install the coverage provider (Model: sonnet)

**Files:**
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Install @vitest/coverage-v8 pinned to the vitest range**

The project uses `vitest: ^4.0.18`. Pin the coverage provider to the same range to avoid peer dependency conflicts:

```bash
npm install --save-dev @vitest/coverage-v8@^4.0.18
```

**Why pin?** An unpinned `npm install --save-dev @vitest/coverage-v8` resolves to `latest` which may be ahead of the locked vitest version. A version mismatch produces peer dependency warnings and can cause runtime errors in the coverage provider.

- [ ] **Step 2: Add the coverage script to package.json**

Add to `"scripts"`:

```json
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: Add coverage/ to .gitignore**

Append to `.gitignore`:

```
# Coverage reports
coverage/
```

- [ ] **Step 4: Verify the install**

```bash
npx vitest run --coverage 2>&1 | tail -10
```

Expected: tests run and a coverage summary table prints at the end. No errors about missing coverage provider. If you see `Error: Failed to load url`, the version mismatch wasn't resolved — check `npm ls @vitest/coverage-v8` to verify peer dependency alignment.

---

### Task 2: Establish the baseline (Model: sonnet)

**Files:** None (measurement only)

- [ ] **Step 1: Run coverage and capture the summary**

```bash
npx vitest run --coverage 2>&1 | grep -E "^(All files|---|Stmts|Branch|Funcs|Lines)" | head -10
```

If the above grep misses the table (output format varies by vitest version), try:

```bash
npx vitest run --coverage 2>&1 | tail -30
```

Look for the `All files` row. Record the **Stmts (statements)**, **Branch**, **Funcs**, and **Lines** percentages.

- [ ] **Step 2: Calculate threshold values**

Subtract 5 points from each baseline percentage. For example:

| Metric | Baseline | Threshold (baseline - 5) |
|--------|----------|--------------------------|
| Lines | 62% | 57 |
| Branches | 48% | 43 |
| Functions | 55% | 50 |
| Statements | 61% | 56 |

The 5-point buffer prevents false failures from test-light utility additions while still catching "shipped a 500-line module with zero tests." Write down these four numbers for Task 3.

---

### Task 3: Configure coverage thresholds in vite.config.ts (Model: sonnet)

**Files:**
- Modify: `vite.config.ts` (the `test` block, currently at lines 56-61)

**Important:** `vite.config.ts` uses `defineConfig(async () => ({...}))`. The `test` property is inside the returned object literal. Add `coverage` as a new property inside the existing `test` block.

- [ ] **Step 1: Add the coverage configuration**

The existing `test` block is:

```ts
test: {
  environment: 'jsdom',
  globalSetup: ['tests/global-setup.ts'],
  setupFiles: ['tests/db-setup.ts', 'tests/component/setup.ts'],
  include: ['tests/**/*.test.{ts,tsx}', 'server/__tests__/**/*.test.ts'],
},
```

Add a `coverage` property after `include`:

```ts
test: {
  environment: 'jsdom',
  globalSetup: ['tests/global-setup.ts'],
  setupFiles: ['tests/db-setup.ts', 'tests/component/setup.ts'],
  include: ['tests/**/*.test.{ts,tsx}', 'server/__tests__/**/*.test.ts'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'text-summary', 'lcov'],
    reportsDirectory: './coverage',
    include: ['server/**/*.ts', 'src/**/*.{ts,tsx}', 'shared/**/*.ts'],
    exclude: [
      'server/index.ts',          // entry point, not unit-testable
      'server/db/migrations/**',   // SQL migrations
      'src/main.tsx',              // React entry point
      '**/*.d.ts',                 // type declarations
      'scripts/**',                // build/dev scripts
      '**/*.test.{ts,tsx}',        // test files themselves
    ],
    thresholds: {
      lines: 0,        // ← SET from Task 2 baseline minus 5
      branches: 0,     // ← SET from Task 2 baseline minus 5
      functions: 0,    // ← SET from Task 2 baseline minus 5
      statements: 0,   // ← SET from Task 2 baseline minus 5
    },
  },
},
```

- [ ] **Step 2: Set thresholds from Task 2 baseline**

Replace the four `0` placeholder values with the numbers calculated in Task 2 Step 2. These are intentionally placeholder zeros because the actual values depend on the baseline measurement — they MUST be set before committing.

- [ ] **Step 3: Verify thresholds pass**

```bash
npm run test:coverage
```

Expected: all 3,942+ tests pass AND coverage thresholds pass (exit code 0). If thresholds fail, the buffer was too tight — lower by another 2 points and re-run.

- [ ] **Step 4: Verify the ratchet works (thresholds actually block)**

Temporarily raise one threshold above the actual baseline to confirm enforcement:

```bash
# In vite.config.ts, temporarily set lines: 99
npm run test:coverage
# Expected: FAIL — "Coverage for lines (XX%) does not meet threshold (99%)"
# Revert the temporary change
```

---

### Task 4: Add coverage to CI (Model: sonnet)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the test step with coverage**

In `.github/workflows/ci.yml` (line 39-40), change:

```yaml
      - name: Run tests
        run: npm test
```

To:

```yaml
      - name: Run tests with coverage
        run: npm run test:coverage
```

This runs the same tests but also collects coverage and enforces thresholds. If coverage drops below the configured floor, CI fails. Locally, developers still use `npm test` (fast, no coverage overhead) for iterative development.

- [ ] **Step 2: Verify CI config is valid**

```bash
node -e "const y=require('js-yaml'); y.load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('Valid YAML')" 2>/dev/null || echo "Fallback: visually inspect the YAML edit is correct"
```

If `js-yaml` isn't available, manually verify the edit preserved proper YAML indentation (6 spaces for the `run:` line).

---

### Task 5: Code review + commit (Model: sonnet)

**Files:** All modified files from Tasks 1-4

- [ ] **Step 1: Run the full quality gate**

```bash
npm run typecheck && npm run test:coverage && npx vite build && npm run pr-check
```

All must pass. Note: `npm run test:coverage` replaces `npm test` here since it's a superset.

- [ ] **Step 2: Run code review**

Invoke `superpowers:requesting-code-review` (single-domain, <10 files). Fix any Critical or Important issues before proceeding. Per CLAUDE.md: "All bugs surfaced during review are fixed — never dismiss a fixable bug."

- [ ] **Step 3: Stage and commit**

```bash
git add package.json package-lock.json vite.config.ts .github/workflows/ci.yml .gitignore
git commit -m "chore(ci): add vitest coverage thresholds + CI enforcement"
```

---

## Systemic Improvements

- **Shared utilities:** None — uses vitest built-in coverage.
- **pr-check rules:** Not needed — coverage is enforced by vitest itself, not a custom rule.
- **New tests:** No new test files. The value is the threshold ratchet preventing coverage regression.
- **Future ratchet:** As coverage improves, periodically tighten thresholds. Run `npm run test:coverage`, note the new baseline, bump thresholds closer to the actual numbers (keep 3-5 point buffer).

## Verification Strategy

- [ ] `npm run test:coverage` passes locally with thresholds enforced
- [ ] Coverage summary table prints lines/branches/functions/statements
- [ ] Raising a threshold above actual coverage causes failure (ratchet works — Task 3 Step 4)
- [ ] `coverage/` directory is gitignored (not committed)
- [ ] CI YAML change is valid and the test step uses `test:coverage`
- [ ] `npm test` still works without coverage (fast local path preserved)
- [ ] Full quality gate passes: typecheck + test:coverage + build + pr-check

## Notes

- **Why v8 over istanbul?** V8 coverage uses the JS engine's built-in instrumentation — no source transforms, ~2x faster collection. The tradeoff is slightly less precise branch coverage on edge cases, but for threshold enforcement it's more than sufficient.
- **lcov reporter:** Generates `coverage/lcov.info` which Codecov/Coveralls can consume if wired up later.
- **Performance impact:** Coverage collection adds ~20-30% to test runtime (~45s instead of ~35s). Acceptable for CI; locally, `npm test` (no coverage) stays fast for iterative development.
- **Per-file thresholds:** Vitest supports `coverage.thresholds.perFile`. Not configured initially — start with global thresholds and add per-file only if specific modules need stricter enforcement.
- **Test file exclusion:** `**/*.test.{ts,tsx}` is added to the `exclude` list so test files themselves don't count toward coverage metrics (only production code is measured).
