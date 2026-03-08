---
description: Ensure every backend feature has a matching frontend
---

# Full-Stack Feature Rule

When implementing any new backend feature (API endpoint, webhook handler, background job, data model change), **always** build or update the corresponding frontend:

1. **API endpoints** → Add the fetch call + UI in the relevant component (admin or client dashboard).
2. **New data fields** → Display them in the appropriate view (table column, card detail, badge, etc.).
3. **New email types** → Verify they render correctly by checking the template output.
4. **Background jobs** → Surface their status or results in the dashboard (e.g., job progress indicator, result display).
5. **Webhook handlers** → If they change state (e.g., tier upgrade, payment status), ensure the UI reflects the new state without a hard refresh.

## Checklist before marking a feature "done"

- [ ] Backend endpoint exists and is tested
- [ ] Frontend calls the endpoint and displays the result
- [ ] Error states are handled in the UI (toast, inline error, etc.)
- [ ] Loading states are shown during async operations
- [ ] The feature is accessible from the appropriate navigation (tab, button, modal)
- [ ] TypeScript types are in sync between server and client
