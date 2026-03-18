# Content Planner — Feature Guide

> Quick reference for agency admins and clients on how to use the Content Planner system.

---

## For Admins

### Accessing the Content Planner

1. Open any workspace in the admin dashboard
2. Navigate to the **Content** tab
3. Click the **Planner** sub-tab (first item in the tab bar)

### Creating a Content Template

Templates define the structure for a type of page (blog, service, location, etc.).

1. From the Planner list view, click **New Template** (or **Create First Template** if none exist)
2. Fill in the template details:
   - **Name** — e.g. "City Service Pages"
   - **Page Type** — blog, landing, service, location, product, pillar, resource, etc.
   - **Variables** — dynamic placeholders like `{city}`, `{service}` that get swapped per page
   - **Sections** — define heading templates, word count targets, and guidance for each section
   - **URL Pattern** — e.g. `/services/{service}/{city}` — how generated page URLs are structured
   - **Keyword Pattern** — e.g. `{service} in {city}` — how target keywords are derived
3. Click **Save**

You can edit any existing template by clicking it in the list view.

### Building a Content Matrix

A matrix takes one template and multiplies it across variable values to plan dozens (or hundreds) of pages at once.

1. From the Planner list view, click **Build Matrix**
2. **Step 1 — Choose Template:** Select which template to base the matrix on
3. **Step 2 — Define Values:** Enter the values for each variable (e.g. cities: Austin, Dallas, Houston; services: Roofing, Plumbing)
4. **Step 3 — Review & Customize:** See every generated page combination. Adjust keywords, URLs, or remove unwanted combinations
5. **Step 4 — Confirm:** Name the matrix and create it

### Managing a Content Matrix (Grid View)

Click any matrix in the list view to open the **Grid View**, where you manage individual pages:

- **Filter & Sort** — filter by status, sort by volume/difficulty/alphabetical
- **Cell statuses** flow through: Planned → Keyword Validated → Brief Generated → Client Review → Approved → Draft → Published
- **Bulk actions** — select multiple cells and: optimize keywords, generate briefs, generate posts, send for client review, or export
- **Cell detail** — click any cell to see keyword candidates, validation metrics, and update status

### Sending Content Plans for Client Review

From the Grid View, you can send plans to clients in three tiers:

1. **Template Review** — sends the template structure for client approval (via the existing approval batch system)
2. **Sample Review** — select specific cells to send as preview samples
3. **Batch Approve** — after client feedback, approve all remaining cells at once

### Exporting Data

The **Export** dropdown in the Content Pipeline tab bar offers CSV and JSON downloads for:
- Content Briefs
- Content Requests
- Content Matrices
- Content Templates
- Keyword Strategy

---

## For Clients

### Accessing Your Content Plan

1. Log into your client dashboard
2. Click the **Content Plan** tab in the navigation bar

> Note: The Content Plan tab is available on Growth and Premium plans only.

### Viewing Your Content Plan

If your team has created one content matrix, it loads automatically. If there are multiple plans, you'll see a list — click any plan to view it.

The plan view shows:

- **Progress overview** — total pages planned, how many are in each stage, and overall completion percentage
- **Status breakdown** — visual indicators for each page's status:
  - 🔘 **Planned** — page is in the pipeline, not yet started
  - 🔵 **In Progress** — keywords being validated
  - 🟡 **Brief Ready** — content brief has been generated
  - 🔵 **Your Review** — waiting for your feedback
  - 🟢 **Approved** — you've approved this page
  - 🟠 **In Production** — content is being written
  - 🟢 **Published** — live on your site

### Previewing Pages

Click any page in the plan to see:
- Target keyword and URL
- Keyword metrics (search volume, difficulty, CPC)
- Current status with timestamp

### Flagging Concerns

If something doesn't look right on a planned page:

1. Click the page to open the preview
2. Click **Flag This**
3. Type your comment explaining the concern
4. Submit — your feedback goes directly to your strategist

### Downloading

Use the download button to export your content plan for offline review.

---

## Other New Features

### Site Architecture (Admin)

In the Content Pipeline, click the **Architecture** sub-tab to see:
- **URL tree** — collapsible hierarchy of every page on the site, sourced from Webflow pages, CMS sitemap, and keyword strategy
- **Source badges** — see where each URL comes from (Webflow, Sitemap, Strategy, CMS)
- **Search & filter** — find specific pages quickly
- **Gap analysis** — orphan pages, missing content opportunities, depth distribution chart

### LLMs.txt Generator (Admin)

In the Content Pipeline, click the **LLMs.txt** sub-tab to:
- **Generate** — one click to create an LLMs.txt file from your site's pages, keyword strategy, and planned content
- **Preview** — scrollable preview of the generated file
- **Copy** — copy the full content to clipboard
- **Download** — save as a `.txt` file

LLMs.txt helps AI systems understand your site's content structure — useful for AI search optimization (AEO).

---

*Last updated: March 2026*
