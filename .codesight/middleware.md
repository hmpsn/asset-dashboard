# Middleware

## auth
- auth — `server/auth.ts`
- middleware — `server/middleware.ts`
- auth — `server/routes/auth.ts`
- debug-auth-guard.test — `tests/debug-auth-guard.test.ts`
- auth.test — `tests/integration/auth.test.ts`
- auth.test — `tests/unit/auth.test.ts`
- middleware.test — `tests/unit/middleware.test.ts`

## custom
- migrate-json — `server/db/migrate-json.ts`
- keyword-strategy — `server/routes/keyword-strategy.ts`
- KeywordStrategy — `src/components/KeywordStrategy.tsx`
- StrategyTab — `src/components/client/StrategyTab.tsx`
- StrategyDiff — `src/components/strategy/StrategyDiff.tsx`
- useKeywordStrategy — `src/hooks/admin/useKeywordStrategy.ts`
- client-chat-guardrails.test — `tests/client-chat-guardrails.test.ts`
- kd-framing-strategyTab.test — `tests/unit/kd-framing-strategyTab.test.ts`
- page-intelligence-strategy-blend.test — `tests/unit/page-intelligence-strategy-blend.test.ts`
- strategy-intelligence-enrichment.test — `tests/unit/strategy-intelligence-enrichment.test.ts`

## rate-limit
- fingerprint — `server/middleware/fingerprint.ts`
- client-signals-rate-limit.test — `tests/integration/client-signals-rate-limit.test.ts`

## logging
- request-logger — `server/middleware/request-logger.ts`

## validation
- turnstile — `server/middleware/turnstile.ts`
- validate — `server/middleware/validate.ts`

## cors
- cors — `server/app.ts`
