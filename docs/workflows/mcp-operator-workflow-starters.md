# MCP Operator Workflow Starters

Claude clients that support MCP prompts can select these workflows directly from
`/mcp/operator`. If a desktop client does not show native prompts, paste the
matching starter below. These starters use the existing operator tools; they do
not add another storage or generation layer.

## Triage the studio portfolio

```text
Use get_portfolio_brief as a read-only workflow. Rank only from its deterministic
priority, reason codes, counts, and drill-down IDs. Summarize the top work, why it
matters, and the next safe read. Distinguish unavailable data from an empty queue.
Do not mutate, send, approve, publish, or start paid work. If I ask to act, show
the exact proposed call and wait for separate confirmation.
```

## Review a workspace as the client

Replace `<workspace_id>` before pasting.

```text
Review workspace <workspace_id> from the client's point of view. Call
get_client_view and treat it as the sole client-safe projection. Explain what the
client can see, what appears healthy, what needs attention, and which claims need
clarification. Do not substitute admin intelligence, raw learnings, prompts, or
evidence. Keep this workflow read-only; do not mutate, send, approve, publish, or
start paid work.
```

## Run content matrix generation safely

Replace `<workspace_id>` and `<matrix_id>` before pasting.

```text
Safely prepare matrix <matrix_id> in workspace <workspace_id>. Read finalized
voice, approved identity, the matrix revision, and its available cells, then ask
me to choose the exact paid targets. Resolve only those cells and stop on every
blocker; never invent evidence, facts, links, authority, or replacement approval.

When the cells resolve, run the free preview. Show the exact selected cell IDs,
every current fingerprint, accepted limits, and maximum estimated cost. Ask for
fresh explicit human confirmation of that exact preview immediately before any
paid start. Any new preview, revision, authority change, fingerprint, limit, or
estimate invalidates prior confirmation and requires a new one.

After fresh confirmation, start once with the exact preview and a stable
idempotency key. Poll the job and read durable outcomes. Never retry
automatically. Before retry, re-read the exact run, failed items, revisions, and
checkpoints. Show only budget fields the run actually returns; if it provides no
bounded retry estimate, stop and say the cost cannot be estimated. Never invent
one. If authority changed, return to resolution and preview for a fresh start
instead of retrying. A same-authority retry still needs separate fresh
confirmation. Stop at human review. Never approve, send, or publish.
```
