/**
 * Surgical AI extractor for page descriptions.
 * Only calls AI when no meta description is present and the page has body content.
 * Single ~30-word call. Falls back to undefined on any error.
 */
import { callAI } from '../../ai.js';
import { createLogger } from '../../logger.js';
import type { WorkspaceSchemaInput } from '../data-sources.js';

const log = createLogger('schema/extractors/description');
const MAX_LENGTH = 200;

export interface DescriptionInput {
  existingDescription: string | undefined;
  title: string;
  pageBody: string;
  workspace: WorkspaceSchemaInput;
}

export async function extractDescription(input: DescriptionInput): Promise<string | undefined> {
  if (input.existingDescription && input.existingDescription.trim().length > 0) {
    return input.existingDescription.trim().slice(0, MAX_LENGTH);
  }
  if (!input.pageBody || input.pageBody.trim().length === 0) {
    return undefined;
  }

  const system = 'You write search-result meta descriptions: one sentence, under 160 characters, no keyword stuffing, no markdown, plain English.';
  const userPrompt = `Write one search-result meta description (under 160 chars) for this page.

Page title: ${input.title}
Workspace: ${input.workspace.name}
Page body (truncated):
${input.pageBody.slice(0, 2000)}

Output the description text only, no quotes, no explanation.`;

  try {
    const result = await callAI({
      system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 100,
      feature: 'schema-description',
    });
    const cleaned = result.text.trim().replace(/^["']|["']$/g, '');
    return cleaned.length > 0 ? cleaned.slice(0, MAX_LENGTH) : undefined;
  } catch (err) {
    log.debug({ err }, 'description extraction failed; degrading gracefully');
    return undefined;
  }
}
