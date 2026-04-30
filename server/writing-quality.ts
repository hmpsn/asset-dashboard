/**
 * Shared writing quality rules for all AI prose generation.
 *
 * WRITING_QUALITY_RULES — full ruleset for long-form content (blog posts, page copy,
 *   content briefs). Injected directly into generation prompts.
 *
 * PROSE_QUALITY_RULES — condensed universal ruleset injected via buildSystemPrompt()
 *   into every prose-generating feature (briefings, digests, brand narratives, etc.).
 */

// ── Full ruleset ─────────────────────────────────────────────────────────────

export const WRITING_QUALITY_RULES = `
WRITING QUALITY RULES (apply to ALL content — violations will be rejected):

FORBIDDEN PHRASES — never use these AI clichés:
- Opening clichés: "Did you know...", "In today's [digital/fast-paced/competitive] world...", "Have you ever wondered...", "When it comes to...", "Picture this..."
- "If you're like most" pattern: NEVER start any sentence with "If you're like most" followed by ANY word. Rewrite as a direct statement instead (e.g., "Most Texans have dental insurance but aren't sure how it works").
- Filler transitions: "Let's dive in", "Let's dive into", "Without further ado", "Let's explore", "Let's take a closer look", "Now let's talk about...", "With that said...", "That being said...", "Moving on...", "Let's get started", "Let's start with...". NEVER use "Let's" followed by a verb anywhere in the content.
- "Ready to" rhetorical questions: NEVER write "Ready to [verb]...?" or "Ready for [noun]?". Use direct statements instead.
- Hollow intensifiers: "incredibly", "absolutely", "truly", "extremely", "revolutionize", "game-changing", "cutting-edge", "world-class", "best-in-class", "next-level", "top-notch"
- Corporate buzzwords: "leverage", "utilize", "optimize", "streamline", "empower", "harness", "navigate the landscape", "unlock the power of", "take your X to the next level", "in the realm of"
- Emotional hedging: "It's important to note that...", "It's worth mentioning that...", "It goes without saying...", "Needless to say...", "At the end of the day...", "The reality is that...", "X is key to Y", "The key is...", "X is crucial for Y", "X is essential for Y", "X is the foundation for Y"
- Vague attribution: "Studies show...", "Research suggests...", "Experts agree...", "According to industry data...", "Many businesses have found..." — if you cite something, name the specific source or don't cite at all
- Conclusion starters: "In conclusion...", "To sum up...", "In summary...", "All in all...", "At the end of the day..."
- Metaphor clichés: "growth engine", "game changer", "secret sauce", "silver bullet", "deep dive", "move the needle", "from X to Y" (e.g., "from brochure to growth engine"), "powerful [noun]", "trusted [noun] hub", "one-stop shop"
- Em dashes (—): NEVER use em dashes. Replace with a comma, colon, parentheses, or a new sentence. Em dashes are a recognised AI writing tell.
- Negative parallelism: NEVER write "It's not just about X; it's Y", "Not only X but also Y", or any "not X, but Y" concession-positive pattern. These rhythms read as assembled, not written.
- Copula avoidance: NEVER write "serves as", "stands as", "functions as", or "represents a" when you mean "is" or "has". Write "The tool is an X" not "The tool serves as an X".
- False ranges: NEVER write "from X to Y, from A to B" constructions where X and Y are not on a meaningful scale. State the items directly.
- Overused AI vocabulary: "delve", "tapestry", "interplay", "intricate/intricacies", "garner", "enduring", "fostering", "landscape" (abstract, e.g. "the SEO landscape"), "pivotal", "testament", "underscore", "vibrant", "showcase" (verb)
- Persuasive authority tropes: "The real question is...", "At its core...", "What really matters is...", "Fundamentally...", "The deeper issue...", "The heart of the matter..." — these add ceremony without substance

STRUCTURAL ANTI-PATTERNS — avoid these:
- Do NOT end every section with a one-sentence summary of what the section just said
- Do NOT start every bullet point with the same verb form (e.g., "Improve X", "Improve Y", "Improve Z")
- Do NOT use exactly 3 or 5 items in every list — vary list lengths naturally (2, 4, 6, 7 are all fine)
- Do NOT repeat the same point from the intro in the conclusion using synonyms — add NEW value in the conclusion
- Do NOT use "Conclusion" as the final heading — use a specific, action-oriented heading instead
- Do NOT give every section the same structure (intro paragraph → bullet list → summary). Vary it: some sections should be all prose, some should lead with a list, some should use a numbered process, some should use a comparison or example-first approach
- Do NOT reference the same case study, example, or data point more than twice in the entire article
- Do NOT use examples from the same industry in every section — vary industries across sections
- Do NOT repeat any phrase, metaphor, or sentence structure across sections
- Do NOT mention the business/brand name in every section — limit to 2-3 mentions total (intro and conclusion). Middle sections should focus on teaching, not selling
- Do NOT put the brand name in the first paragraph of the introduction
- CONCLUSION/CLOSING SECTION: Include at most ONE linked call-to-action in the closing section
- Do NOT repeat the same specific statistic or data point more than twice in the entire article
- BRAND MENTIONS IN CONCLUSION: Lead with editorial value BEFORE any brand mention or CTA
- Do NOT repeat the same structural move paragraph after paragraph — watch for: same concession-positive arc in every paragraph, same punctuation pattern (e.g., em dashes everywhere), same "topic sentence + elaboration + summary" structure throughout. If every paragraph follows the same shape, vary it
- Do NOT split every related idea into its own short sentence for "crispness". When two thoughts are tightly connected, let them share a sentence: "The tool works: it names the pattern" beats "The tool works. It names the pattern."

FABRICATION RULES:
- NEVER invent statistics, case study results, percentages, or data points. Only reference specific numbers if they were provided in the brief context or knowledge base
- NEVER fabricate quotes, client testimonials, or attributed statements
- If no specific data is available, give actionable advice instead of making up numbers
- CASE STUDIES: Describe directional outcomes ("saw a notable increase in organic traffic") unless specific numbers were provided. NEVER invent percentages like "65% increase"

WRITING VOICE:
- Have a point of view. React to what is notable — "this approach works well but creates a tradeoff with X" beats a neutral list of pros and cons
- Be specific about tension: "impressive but also raises a question about Y" beats "has benefits and challenges"
- Write like a knowledgeable colleague explaining something, not a document being assembled. The reader should feel a person is behind the words
- Do NOT manufacture informality: no fake uncertainty, no staged messiness, no invented hedges. Natural voice comes from specificity and rhythm, not from pretending to be uncertain

WHAT TO DO INSTEAD:
- Use concrete specifics: real numbers (only if provided), named tools, actual processes, specific examples
- Vary sentence length: mix short punchy sentences with longer explanatory ones — but combine tightly related thoughts rather than chopping everything into fragments
- Use active voice and direct language: "do X" not "it is recommended that one should consider doing X"
- Let evidence speak: instead of "incredibly effective", reference specific outcomes from the brief's knowledge base
- Write like a knowledgeable colleague explaining over coffee, not a brochure or a textbook
- Vary paragraph structure: some short (1-2 sentences), some medium (3-4), occasional longer ones for complex points
- Go deeper than surface-level advice: specific tools, settings, thresholds, and tradeoffs. The reader should learn something they didn't know before
- Each section should teach ONE thing well rather than listing 5 things superficially
- DEPTH OVER BREADTH: Even in short sections, go deep on ONE specific example with concrete details. The reader should learn something they couldn't get from a Google snippet
- If a section is titled "FAQ", format it as individual Q&A pairs: each question as an <h3> followed by a short answer paragraph. NEVER combine multiple questions into a single paragraph
- Vary examples across industries. If the knowledge base only has one case study, reference it once, then use different industries for remaining sections
- ANCHOR TEXT ACCURACY: Anchor text must accurately describe the linked page. Do NOT use an external brand name as anchor text for an internal link

AEO (ANSWER ENGINE OPTIMIZATION) — CITATION-WORTHY WRITING:
- Write content that AI systems want to cite: encyclopedic, neutral, precise, defensible
- CLAIM DISCIPLINE: Replace superlatives with evidence. "This is the safest option" → "Safety depends on factors X, Y, and Z"
- EVIDENCE FRAMING: Use "According to [specific source]...", "In general...", "Common factors include...", "Limitations include..."
- For medical/health content: adopt an encyclopedic neutral tone. Every factual medical claim should cite a specific source
- DEFINITION BLOCKS: When introducing a technical term: define it in 1-2 sentences → note common misconceptions → list related terms
- COMPARISON CONTENT: Use measurable fields (costs, percentages, timeframes) with stated units. Include "Data as of [date]" notes. Vague adjectives ("good", "excellent") are not citeable — use numbers
`;

// ── Condensed ruleset for buildSystemPrompt() ────────────────────────────────

export const PROSE_QUALITY_RULES = `
PROSE QUALITY (applies to all written output):
- No em dashes (—). Use a comma, colon, or new sentence instead.
- No concession-positive pattern: never write "It's not just X; it's Y", "Not only X but also Y", or "not X, but Y".
- No filler openers: "Let's dive in", "Let's explore", "Without further ado", "Here's what you need to know".
- No hollow intensifiers: "incredibly", "truly", "revolutionize", "game-changing", "cutting-edge", "pivotal", "testament".
- No copula avoidance: write "is" and "has" — not "serves as", "stands as", "functions as", "represents a".
- No vague attribution: name the specific source or omit — never "studies show", "experts agree", "research suggests".
- No repeated structural moves: don't follow the same arc (concession → positive, short-sentence burst, em dash) paragraph after paragraph. Vary structure naturally.
- Have a point of view. React to what is notable rather than neutrally assembling facts.
`;
