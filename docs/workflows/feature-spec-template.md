---
description: Required spec skeleton for new feature design docs before implementation planning begins
---

# Feature Spec Template (Required)

Use this skeleton for every net-new feature spec before implementation planning starts.

## 1. Ownership Snapshot

- Feature name: `[name]`
- Owning bounded context: `[exact context from docs/rules/platform-organization.md]`
- Secondary context integrations: `[none | list]`
- Behavior type: `[new behavior | behavior-preserving extraction | both]`

## 2. Route / API Surface

- Server route modules touched: `[server/routes/*.ts list]`
- Public endpoints (if any): `[GET/POST ...]`
- Frontend API wrappers: `[src/api/*.ts list]`
- Frontend hooks/consumers: `[src/hooks/* and component surfaces]`

## 3. Shared Contracts

- Shared types to add/update first: `[shared/types/*.ts]`
- Stored JSON column shapes (if any): `[typed interface + schema file]`
- Contract notes: `[authority chain / enum ownership / field semantics]`

## 4. Query Cache + Real-Time Contract

- Query keys (admin/client): `[queryKeys.* entries]`
- Invalidation triggers after writes: `[mutations → key invalidations]`
- WebSocket events (`WS_EVENTS.*`): `[event constants + payload shape]`
- Listener wiring: `[useWorkspaceEvents handlers and affected hooks]`

## 5. Test Ownership

- Integration test owners/files: `[tests/integration/*.test.ts]`
- Contract test owners/files: `[tests/contract/*.test.ts]`
- Unit/component test owners/files: `[tests/unit|component/*.test.ts[x]]`
- Critical failure modes to cover: `[list]`

## 6. Verification Commands

- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`
- Feature-specific checks: `[extra commands]`

## 7. Open Questions / Risks

- `[question/risk + owner + resolution trigger]`

