import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { listMatrices } from './content-matrices.js';
import { getTemplate } from './content-templates.js';
import { BRIEF_PAGE_TYPES } from '../shared/types/content.js';
import type { BriefPageType, BriefTemplateCrossrefMatch } from '../shared/types/content.js';

const BRIEF_PAGE_TYPE_SET = new Set<string>(BRIEF_PAGE_TYPES);

export function normalizeBriefKeyword(value: string): string {
  return keywordComparisonKey(value);
}

export function toBriefPageType(value: unknown): BriefPageType | null {
  return typeof value === 'string' && BRIEF_PAGE_TYPE_SET.has(value) ? value as BriefPageType : null;
}

export function resolveBriefTemplateCrossref(workspaceId: string, keyword: string): BriefTemplateCrossrefMatch | null {
  const normalizedKeyword = normalizeBriefKeyword(keyword);
  if (!normalizedKeyword) return null;

  const matrices = listMatrices(workspaceId);
  for (const matrix of matrices) {
    for (const cell of matrix.cells) {
      const customKeyword = typeof cell.customKeyword === 'string' ? cell.customKeyword.trim() : '';
      const targetKeyword = cell.targetKeyword.trim();
      const customMatch = customKeyword.length > 0 && normalizeBriefKeyword(customKeyword) === normalizedKeyword;
      const targetMatch = normalizeBriefKeyword(targetKeyword) === normalizedKeyword;
      if (!customMatch && !targetMatch) continue;

      const template = getTemplate(workspaceId, matrix.templateId);
      if (!template) continue;

      const sections = [...template.sections]
        .sort((a, b) => a.order - b.order)
        .map(section => ({
          id: section.id,
          name: section.name,
          headingTemplate: section.headingTemplate,
          guidance: section.guidance,
          wordCountTarget: section.wordCountTarget,
          order: section.order,
        }));

      return {
        keyword: keyword.trim(),
        matrixId: matrix.id,
        matrixName: matrix.name,
        cellId: cell.id,
        matchedKeyword: customMatch ? customKeyword : targetKeyword,
        matchedSource: customMatch ? 'custom' : 'target',
        templateId: template.id,
        templateName: template.name,
        pageType: toBriefPageType(template.pageType),
        sections,
        toneAndStyle: template.toneAndStyle,
        titlePattern: template.titlePattern,
        metaDescPattern: template.metaDescPattern,
      };
    }
  }

  return null;
}
