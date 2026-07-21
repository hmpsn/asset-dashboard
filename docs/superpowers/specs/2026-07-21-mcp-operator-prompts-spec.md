# MCP Operator Desktop Workflows — Feature Spec

## 1. Ownership Snapshot

- Feature name: MCP operator desktop workflows
- Owning bounded context: `platform-foundation`
- Secondary context integrations: `workspace-command-center`, `client-portal`, `content-pipeline`, `brand-engine`
- Behavior type: new additive MCP prompt behavior; existing tools are unchanged

Personas are a solo studio operator working in Claude or ChatGPT Desktop and a
client whose data must be represented through the same scrubbed projection they
receive. The operator needs a short, safe starting point and must not have to
remember the matrix protocol. Trust fails if a workflow spends money without a
fresh confirmation, treats blockers as ready, exposes admin-only client data, or
continues through approval, send, or publication.

## 2. Route / API Surface

- Server route modules touched: none
- Public endpoints: additive MCP `prompts/list` and `prompts/get` on existing
  `POST /mcp/operator` only
- Frontend API wrappers, hooks, and components: none
- Existing tool discovery, tool invocation, auth, and response bodies remain
  unchanged. The full `/mcp` initialize capability set also remains unchanged.

## 3. Shared Contracts

- `shared/types/mcp-prompts.ts` owns the immutable three-name prompt vocabulary.
- Prompt definitions and rendering live in `server/mcp/prompts.ts`.
- Prompt arguments are strict: unknown, inherited, missing, blank, or malformed
  values fail without reflecting caller input.
- Prompt output is instructions only. It never reads data, calls a tool, starts a
  job, or persists state.

The three prompts are:

- `triage_studio_portfolio`
- `review_workspace_as_client`
- `run_content_matrix_generation_safely`

The generation workflow must stop on blockers, show the current selected cells,
fingerprints, accepted limits, and maximum estimate, then wait for a fresh human
confirmation before paid start. Same-authority retry requires a separate
exact-item/available-budget confirmation and stops when no bounded retry estimate
exists; changed authority returns to preview/start instead of retry. It stops at
human review and never approves, sends, or publishes.

## 4. Query Cache + Real-Time Contract

- Query keys: none
- Invalidations: none
- WebSocket events/listeners: none
- The prompts compose existing tools; those tools retain their own data-flow and
  mutation contracts.

## 5. Test Ownership

- Integration: `tests/integration/mcp-operator-prompts.test.ts`
- Unit/contract: `tests/unit/mcp-operator-prompts.test.ts`
- Critical failures: discovery drift, unknown prompt/arguments, malformed IDs,
  paid start before confirmation, stale confirmation reuse, automatic retry,
  client projection bypass, and accidental tool invocation during prompt fetch.

## 6. Verification Commands

- focused prompt unit and integration tests
- `npm run typecheck`
- `npx vite build`
- `npm run pr-check`
- `npm run lint:hooks`
- `npx vitest run`
- `npm run verify:platform:quick`
- staging MCP handshakes for `prompts/list` and `prompts/get`, using read-only
  requests only

## 7. Open Questions / Risks

- ChatGPT Desktop may not expose native MCP prompts. This does not change server
  semantics: the README ships equivalent copyable starters and the existing tool
  flow remains usable manually.
- P3–P6 are not dependencies for this phase. They add schemas, aliases,
  credentials, and telemetry; these prompts add none of those and use only the
  already shipped operator allowlist.
- No paid staging generation is authorized by this phase.
