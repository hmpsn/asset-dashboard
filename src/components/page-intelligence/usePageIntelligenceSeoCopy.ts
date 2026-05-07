import { useState } from 'react';
import { keywords } from '../../api/seo';
import type { UnifiedPage } from '../../../shared/types/page-join';
import type { SeoCopy } from './pageIntelligenceTypes';

interface UsePageIntelligenceSeoCopyOptions {
  workspaceId: string;
}

export function usePageIntelligenceSeoCopy({ workspaceId }: UsePageIntelligenceSeoCopyOptions) {
  const [generatingCopy, setGeneratingCopy] = useState<string | null>(null);
  const [seoCopyResults, setSeoCopyResults] = useState<Map<string, SeoCopy>>(new Map());
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const generateSeoCopy = async (page: UnifiedPage) => {
    if (!page.strategy) return;
    setGeneratingCopy(page.strategy.pagePath);
    try {
      const data = await keywords.seoCopy({
        pagePath: page.strategy.pagePath,
        pageTitle: page.strategy.pageTitle,
        workspaceId,
      }) as SeoCopy & { error?: string };
      if (!data.error) {
        setSeoCopyResults(prev => new Map(prev).set(page.strategy!.pagePath, data));
      }
    } catch (err) {
      console.error('SEO copy generation failed:', err);
    } finally {
      setGeneratingCopy(null);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return {
    generatingCopy,
    seoCopyResults,
    copiedField,
    generateSeoCopy,
    copyText,
  };
}
