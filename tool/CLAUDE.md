# tool — Project Context

**Stack:** raw-http | none | javascript

0 routes | 0 models | 0 env vars | 0 import links


---

## Instructions for Claude Code

Before exploring the repo, read these files in order:
1. `.codesight/CODESIGHT.md` — full context map (routes, schema, components, deps)
2. Use the codesight MCP server for targeted queries:

   - `codesight_get_summary` — quick project overview
   - `codesight_get_routes --prefix /api/users` — filtered routes
   - `codesight_get_blast_radius --file src/lib/db.ts` — impact analysis before changes
   - `codesight_get_schema --model users` — specific model details

Only open specific files after consulting codesight context. This saves ~0 tokens per conversation.