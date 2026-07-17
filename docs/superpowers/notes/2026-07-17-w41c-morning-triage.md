# W4.1c J1 morning-triage re-measure

Date: 2026-07-17  
Reference: `docs/superpowers/audits/2026-07-16-admin-ux-flow-audit.md` §6 and the J1 verdict in its companion `.verdicts.json`.

## Before W4.1

Landing at `/` put the operator inside one workspace. That was zero clicks to one local Cockpit, but it did not answer which workspace in the book needed attention most. Cross-book triage therefore had no fixed click bound: the operator had to inspect the current workspace, open the workspace switcher and choose each additional workspace (a linear workspace-by-workspace loop), then return to the most urgent one. Only after that discovery cost did the original J1 local path begin: one click on the top queue row, followed by the audit's 3–6+ total interactions when a bare destination forced re-finding.

## After W4.1a–c

- **0 clicks from landing** to identify the highest-attention workspace: `/` renders the server-ranked book and keeps rank 1 first.
- **1 click from landing** to enter that workspace's Cockpit through “Open [workspace] Cockpit.”
- **2 clicks from landing** to open the workspace Cockpit's top triage handoff: open the Cockpit, then open its first queue row.

This turns portfolio discovery from an unbounded, linear workspace-switch loop into a fixed two-click handoff. W1.2's section/lens routes remove the audit's bare-surface re-find tax where a receiver exists. Completing the action after the handoff remains receiver-specific; typed per-item identities for aggregate queue rows remain the separately tracked `cockpit-handoff-per-item-deeplink` item and are not claimed here.

## Scope confirmation

The measurement covers the `ui-rebuild-shell` flag-ON journey only. Flag-OFF `/` behavior is unchanged. No database migration or new query-parameter contract was introduced.
