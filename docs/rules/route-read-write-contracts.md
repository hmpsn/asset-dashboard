# Route Read/Write Contracts

Server route modules that are frequently edited must declare a file-level data contract:

```ts
/**
 * some-route routes
 *
 * @reads workspaces, page_keywords
 * @writes page_keywords, activities
 */
```

Use table names, store/module names, or external store labels that reviewers can grep. Keep the list comma-separated. Use `none` only when that side is intentionally empty.

The first enforced set is the ten highest-churn route files from git history:

- `server/routes/keyword-strategy.ts`
- `server/routes/jobs.ts`
- `server/routes/webflow-seo-audit.ts`
- `server/routes/webflow-seo-jobs.ts`
- `server/routes/webflow-schema.ts`
- `server/routes/workspaces.ts`
- `server/routes/public-portal.ts`
- `server/routes/content-requests.ts`
- `server/routes/public-analytics.ts`
- `server/routes/content-briefs.ts`
- `server/routes/webflow-alt-text.ts`

`scripts/pr-check.ts` validates that required files include both tags near the top of the file and rejects empty, `TODO`, or ambiguous values. Any `@reads`/`@writes` annotation in any route file is value-validated, even before that file is part of the required set. This first pass enforces the convention shape; future expansions can move from file-level presence to route-level or SQL-aware coverage without changing the annotation format.
