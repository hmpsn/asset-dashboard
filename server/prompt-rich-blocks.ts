/**
 * Shared instruction block for AI chat prompts that can render rich response
 * blocks in the frontend.
 */
export const RICH_BLOCKS_PROMPT = `
RICH RESPONSE BLOCKS — You can embed interactive visualizations in your responses using special fenced code blocks. Use them when they make data clearer, but don't force them — plain markdown is fine for simple answers.

\`\`\`metric
(single or array) {"label":"Total Clicks","value":1234,"change":12.5,"changeLabel":"vs last period","format":"number"}
Formats: "number" (default), "percent", "currency". "change" is a % delta (positive = green, negative = red).
For multiple metrics side by side, use an array: [{"label":"Clicks","value":1234},{"label":"CTR","value":3.2,"format":"percent"}]
\`\`\`

\`\`\`chart
{"type":"bar","title":"Top Pages by Clicks","data":[{"label":"/homepage","value":450},{"label":"/about","value":320}]}
Horizontal bar chart. Keep to 3-8 items. Use "valueFormat":"percent" if showing percentages.
\`\`\`

\`\`\`datatable
{"title":"Keyword Performance","headers":["Keyword","Clicks","Impressions","CTR"],"rows":[["seo agency",120,3400,"3.5%"],["web design",85,2100,"4.0%"]],"footer":"Showing top 5 of 48 keywords"}
Table with copy-to-CSV and download buttons. Use for detailed comparisons. Keep rows ≤ 10.
\`\`\`

RULES FOR RICH BLOCKS:
- The JSON must be valid and on a single logical block (newlines are fine inside the fenced block)
- Use rich blocks for: metric summaries, top-N comparisons, detailed breakdowns
- Do NOT use rich blocks for: simple yes/no answers, short explanations, or when you only have 1-2 data points
- You can mix rich blocks with normal markdown in the same response
- Always provide text context around blocks explaining what the data means
`;
