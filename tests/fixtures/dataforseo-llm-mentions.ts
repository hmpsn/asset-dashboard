/**
 * Real (trimmed) DataForSEO AI-optimization response shapes captured live on 2026-06-24
 * (SEO Decision Engine P8 — AI-visibility / LLM citation). GROUND TRUTH for the parsers —
 * field names are validated, not guessed (the P6/P7 lesson: a paid integration built on guessed
 * field names is the #1 bug class in this repo).
 *
 * Two data models exist:
 *
 *  1. MENTIONS DATABASE — `ai_optimization/.../llm_mentions/aggregated_metrics` (and `.../search`).
 *     Query a target { domain } (or { keyword }) + platform ('chat_gpt' | 'google') → aggregated
 *     metrics from DataForSEO's database of LLM answers. The headline KPI ("are we cited by LLMs")
 *     is `total.platform[0].mentions` + `ai_search_volume`. `brand_entities_title` = the competitor
 *     brands co-mentioned alongside the target (share-of-voice). `sources_domain` = the content
 *     domains LLM answers cite WHEN they mention the target (the AEO targeting list — where to get
 *     cited). One DB query per domain; no live prompting. This is the better KPI source.
 *
 *  2. DIRECT PROMPT — `ai_optimization/chat_gpt/llm_responses/live` (llm_type claude|gemini|chat_gpt
 *     |perplexity, a user_prompt, optional web_search). Returns the answer text + `annotations`
 *     (structured citations, NULL when the model didn't web-search). Good for "did the LLM name us
 *     for THIS specific question" before/after AEO proof, but citation detection is FUZZY: scan the
 *     answer `text` for the client's brand name and/or read `annotations[].url`. ~$0.0008/call.
 *
 * Gotchas the parser depends on:
 *  - agg_metrics groups are arrays of `{ type:'group_element', key, mentions, ai_search_volume }`.
 *    A target with zero LLM presence returns empty group arrays — treat absent as 0 mentions.
 *  - llm_response `annotations` is often NULL even when web_search was requested (the model decides
 *    whether to search); citation-by-brand-name on the `text` is the reliable signal.
 */

/** MENTIONS DB: aggregated_metrics for { domain: 'squareup.com' }, platform chat_gpt, US/en. */
export const LLM_MENTIONS_AGG = {
  items: [
    {
      total: {
        location: [{ type: 'group_element', key: '2840', mentions: 2704, ai_search_volume: 58439 }],
        language: [{ type: 'group_element', key: 'en', mentions: 2704, ai_search_volume: 58439 }],
        // Headline KPI: how often the target is mentioned on this platform + the AI search volume behind it.
        platform: [{ type: 'group_element', key: 'chat_gpt', mentions: 2704, ai_search_volume: 58439 }],
        // Content domains LLM answers CITE when mentioning the target → the AEO "get cited here" list.
        sources_domain: [
          { type: 'group_element', key: 'squareup.com', mentions: 1031, ai_search_volume: 24033 },
          { type: 'group_element', key: 'www.reddit.com', mentions: 371, ai_search_volume: 6228 },
          { type: 'group_element', key: 'en.wikipedia.org', mentions: 253, ai_search_volume: 2812 },
          { type: 'group_element', key: 'www.nerdwallet.com', mentions: 142, ai_search_volume: 2279 },
          { type: 'group_element', key: 'www.forbes.com', mentions: 129, ai_search_volume: 3839 },
        ],
        search_results_domain: [
          { type: 'group_element', key: 'squareup.com', mentions: 2004, ai_search_volume: 42296 },
          { type: 'group_element', key: 'www.forbes.com', mentions: 255, ai_search_volume: 4369 },
        ],
        // Co-mentioned brands = the competitive set in LLM answers (share-of-voice).
        brand_entities_title: [
          { type: 'group_element', key: 'Square', mentions: 90, ai_search_volume: 1047 },
          { type: 'group_element', key: 'Apple Pay', mentions: 34, ai_search_volume: 251 },
          { type: 'group_element', key: 'Stripe', mentions: 14, ai_search_volume: 273 },
          { type: 'group_element', key: 'PayPal', mentions: 13, ai_search_volume: 175 },
          { type: 'group_element', key: 'Google Pay', mentions: 13, ai_search_volume: 86 },
        ],
        brand_entities_category: [
          { type: 'group_element', key: 'company', mentions: 184, ai_search_volume: 6101 },
          { type: 'group_element', key: 'software', mentions: 90, ai_search_volume: 1530 },
        ],
      },
    },
  ],
};

/** A target with NO LLM presence — empty group arrays (mentions = 0, never invented). */
export const LLM_MENTIONS_AGG_EMPTY = {
  items: [
    {
      total: {
        location: [],
        language: [],
        platform: [],
        sources_domain: [],
        search_results_domain: [],
        brand_entities_title: [],
        brand_entities_category: [],
      },
    },
  ],
};

/** DIRECT PROMPT: `ai_optimization/chat_gpt/llm_responses/live`, gpt-4o-mini, web_search requested. */
export const LLM_RESPONSE = {
  tasks: [
    {
      data: {
        user_prompt: 'What are the best mobile payment apps for small businesses in the US? List a few.',
        model_name: 'gpt-4o-mini',
        web_search: true,
      },
      result: [
        {
          model_name: 'gpt-4o-mini-2024-07-18',
          input_tokens: 330,
          output_tokens: 293,
          // NOTE: the model decided NOT to web-search despite the request → annotations come back null.
          web_search: false,
          money_spent: 0.0002253,
          datetime: '2026-06-25 03:08:08 +00:00',
          items: [
            {
              type: 'message',
              sections: [
                {
                  type: 'text',
                  // Brand-name presence in the answer is the reliable citation signal: 'Square', 'PayPal',
                  // 'Stripe', 'Shopify' all named here. (Owner brand ∈ text → "named by the LLM".)
                  text: 'Here are some of the best mobile payment apps...\n1. **Square**: ...\n2. **PayPal**: ...\n6. **Stripe**: ...',
                  // When the model web-searches, this is an array of { url, title, start_index, end_index };
                  // here it is null because web_search resolved false.
                  annotations: null,
                },
              ],
            },
          ],
          fan_out_queries: null,
        },
      ],
    },
  ],
};
