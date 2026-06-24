/**
 * Real (trimmed) `serp/google/organic/live/advanced` response shapes captured from
 * the live DataForSEO API on 2026-06-24 (SEO Decision Engine P6). These are the
 * GROUND TRUTH for the national-SERP parser — field names are validated, not guessed.
 *
 * Key shape facts the parser depends on:
 *  - `ai_overview` is a top-level item with an aggregated `references[]` (each
 *    `{ source, domain, url, title, text }`) plus nested `items[]` (ai_overview_element,
 *    each with its own `references[]`). Citation match = client domain ∈ references[].domain.
 *  - `featured_snippet` carries its own `domain`/`url`/`rank_absolute`.
 *  - `rank_absolute` = true position across ALL SERP items; `rank_group` = position within type.
 *  - `organic` carries `domain`/`url`/`rank_group`/`rank_absolute`.
 */

/** A SERP that DOES contain an AI Overview (query: "what is dropshipping and how does it work"). */
export const SERP_WITH_AI_OVERVIEW = {
  items: [
    {
      type: 'ai_overview',
      rank_group: 1,
      rank_absolute: 1,
      items: [
        {
          type: 'ai_overview_element',
          text: "Dropshipping is an e-commerce retail model where a seller doesn't keep products in stock...",
          references: [
            { type: 'ai_overview_reference', source: 'Reddit', domain: 'www.reddit.com', url: 'https://www.reddit.com/r/explainlikeimfive/comments/1ft3q8b/', title: 'ELI5: What is dropshipping' },
            { type: 'ai_overview_reference', source: 'Square', domain: 'squareup.com', url: 'https://squareup.com/us/en/the-bottom-line/operating-your-business/what-is-drop-shipping', title: 'What Is Dropshipping - Square' },
          ],
        },
        { type: 'ai_overview_video_element', title: 'How to Actually Start Shopify Dropshipping', url: 'https://www.youtube.com/watch?v=YImqGsOPqU8', domain: 'www.youtube.com' },
      ],
      // Aggregated, deduped-ish references across all elements — the canonical citation list.
      references: [
        { type: 'ai_overview_reference', source: 'Reddit', domain: 'www.reddit.com', url: 'https://www.reddit.com/r/explainlikeimfive/comments/1ft3q8b/', title: 'ELI5: What is dropshipping' },
        { type: 'ai_overview_reference', source: 'Square', domain: 'squareup.com', url: 'https://squareup.com/us/en/the-bottom-line/operating-your-business/what-is-drop-shipping', title: 'What Is Dropshipping - Square' },
        { type: 'ai_overview_reference', source: 'Wix.com', domain: 'www.wix.com', url: 'https://www.wix.com/blog/what-is-dropshipping', title: 'What Is Dropshipping - Wix' },
        { type: 'ai_overview_reference', source: 'Printful', domain: 'www.printful.com', url: 'https://www.printful.com/blog/what-is-dropshipping', title: 'What is dropshipping - Printful' },
      ],
    },
    {
      type: 'people_also_ask',
      rank_group: 1,
      rank_absolute: 2,
      items: [
        { type: 'people_also_ask_element', title: 'How do you dropship for beginners?', expanded_element: [{ type: 'people_also_ask_ai_overview_expanded_element', asynchronous_ai_overview: true }] },
      ],
    },
    {
      type: 'organic',
      rank_group: 1,
      rank_absolute: 3,
      domain: 'www.reddit.com',
      title: 'ELI5: What is dropshipping and how is it lucrative?',
      url: 'https://www.reddit.com/r/explainlikeimfive/comments/1ft3q8b/',
    },
    {
      type: 'organic',
      rank_group: 2,
      rank_absolute: 5,
      domain: 'squareup.com',
      title: 'What Is Dropshipping and How Does It Work?',
      url: 'https://squareup.com/us/en/the-bottom-line/operating-your-business/what-is-drop-shipping',
    },
    {
      type: 'organic',
      rank_group: 3,
      rank_absolute: 7,
      domain: 'sell.amazon.com',
      title: 'What Is dropshipping? How does it work in 2026?',
      url: 'https://sell.amazon.com/learn/what-is-dropshipping',
    },
  ],
};

/** A SERP with a featured snippet + PAA but NO AI Overview (query: "how to make cold brew coffee"). */
export const SERP_WITHOUT_AI_OVERVIEW = {
  items: [
    {
      type: 'featured_snippet',
      rank_group: 1,
      rank_absolute: 1,
      domain: 'homebrewersassociation.org',
      title: 'How to Cold Brew Coffee',
      description: 'cold brew coffee is made by steeping coarse-ground, dark-roasted coffee beans in cold water for 12-24 hours...',
      url: 'https://homebrewersassociation.org/how-to-brew/cold-brew-coffee-adding-coffee-beer/',
    },
    {
      type: 'organic',
      rank_group: 1,
      rank_absolute: 2,
      domain: 'coffeegeek.com',
      title: 'A Preferred Way to Make Cold Brewed Coffee',
      url: 'https://coffeegeek.com/blog/techniques/a-preferred-way-to-make-cold-brewed-coffee/',
    },
    {
      type: 'people_also_ask',
      rank_group: 1,
      rank_absolute: 3,
      items: [
        { type: 'people_also_ask_element', title: 'How do you make cold brew coffee at home?', expanded_element: [{ type: 'people_also_ask_expanded_element', url: 'https://www.youtube.com/shorts/MWa-WNG3KAM', domain: 'www.youtube.com', title: 'How to make cold brew with a mason jar' }] },
      ],
    },
    {
      type: 'organic',
      rank_group: 2,
      rank_absolute: 4,
      domain: 'www.seriouseats.com',
      title: 'Cold Brew Iced Coffee Recipe',
      url: 'https://www.seriouseats.com/cold-brew-iced-coffee',
    },
  ],
};
