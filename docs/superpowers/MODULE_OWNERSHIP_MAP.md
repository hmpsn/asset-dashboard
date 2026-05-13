# Historical Intelligence Module Ownership Map

> **Status:** Historical reference. Last full content refresh was April 1, 2026.

This document used to describe ownership by intelligence slice. It is no longer the source of truth for where new work belongs.

Use these current docs instead:

- `docs/rules/platform-organization.md` — canonical bounded-context ownership.
- `docs/rules/platform-integration-surfaces.md` — external APIs, DB/storage, AI calls, jobs, events, query keys, surfaces, endpoints, activity types, and docs by context.
- `docs/testing/platform-domain-smoke-matrix.md` — fast smoke signal for each bounded context.
- `docs/testing/critical-domain-coverage-baseline.md` — current test-coverage baseline and next test slices.
- `docs/workflows/feature-class-definition-of-done.md` — completion gates by feature class.

Do not add new ownership decisions here. If a future workflow still needs an intelligence-slice-specific inventory, create it as a read-only report that imports or references the canonical bounded-context map rather than reintroducing a competing ownership source.
