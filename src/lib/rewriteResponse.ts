export const REWRITE_BEGIN = 'BEGIN_REWRITE';
export const REWRITE_END = 'END_REWRITE';
const rewriteBlockPattern = new RegExp(`${REWRITE_BEGIN}\\s*([\\s\\S]*?)\\s*${REWRITE_END}`, 'i');

export function stripRewritingPrefix(content: string): string {
  return content.replace(/^\s*\*{0,2}Rewriting:\s*[^*\n]+\*{0,2}\s*\n?/im, '');
}

export function parseRewriteSectionTarget(content: string): string | undefined {
  const sectionMatch = content.match(/^\s*\*{0,2}Rewriting:\s*([^*\n]+?)\*{0,2}\s*$/im);
  return sectionMatch ? sectionMatch[1].trim() : undefined;
}

/** Return only editor-safe rewrite prose, never surrounding rationale. */
export function extractRewriteOnly(content: string): string {
  const delimited = content.match(rewriteBlockPattern);
  if (delimited) {
    return delimited[1].trim();
  }

  const stripped = stripRewritingPrefix(content);
  const rationaleIdx = stripped.search(/\n\s*\*{0,2}(Rationale|Why this works|Why it works|Explanation):?\*{0,2}/i);
  return (rationaleIdx > 0 ? stripped.slice(0, rationaleIdx) : stripped).trim();
}
