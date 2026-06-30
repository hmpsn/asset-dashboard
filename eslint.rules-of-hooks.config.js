// Focused lint gate — ONLY `react-hooks/rules-of-hooks`.
//
// Why a dedicated config: the main eslint.config.js pulls in js/tseslint recommended +
// exhaustive-deps, which surface acknowledged pre-existing debt across the repo (see CLAUDE.md
// "react-hooks/exhaustive-deps suppressions"). Running the full config in the gate would be noisy
// and block on unrelated issues. This config enables ONLY rules-of-hooks — a hard correctness rule
// (a conditionally-called hook crashes the component with "Rendered more hooks than the previous
// render"). It is fast, noise-free, and safe to hard-fail in CI.
//
// Run via `npm run lint:hooks` (part of the quality gate). Added after a conditional useFeatureFlag
// in OverviewTab shipped to staging and crashed the client dashboard — eslint had the rule but it
// was never run in CI/the gate.
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    // Register react-hooks + typescript-eslint plugins so existing inline `// eslint-disable` comments
    // that reference their rules (e.g. react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any)
    // RESOLVE rather than erroring "rule definition not found". We still only ENABLE rules-of-hooks.
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    languageOptions: { parser: tseslint.parser },
    // Those inline directives are "unused" under this minimal config (their rules aren't enabled here);
    // do not report them — they are legitimate under the full eslint.config.js.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
])
