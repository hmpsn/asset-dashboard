export interface FixContext {
  /** Which admin route this fixContext is intended for (e.g. 'content-pipeline', 'seo-editor').
   *  REQUIRED — components check this before reacting. Without it, stale fixContext from one
   *  tab leaks into another. Making this required ensures TypeScript catches missing values
   *  at every navigation call site. */
  targetRoute: string;
  pageId?: string;
  pageSlug?: string;
  pageName?: string;
  issueCheck?: string;
  issueMessage?: string;
  // Brief generation context from Page Intelligence / Content Gaps
  primaryKeyword?: string;
  searchIntent?: string;
  optimizationScore?: number;
  optimizationIssues?: string[];
  recommendations?: string[];
  contentGaps?: string[];
  autoGenerate?: boolean;
  /** Suggested page type from content gaps (e.g. 'blog', 'service', 'landing'). */
  pageType?: string;
  // Strategy redesign P2 pre-commit (read by the P3 brief pre-seed receiver layers) -
  // content-gap evidence carried into the brief generator. All optional so existing
  // callers compile unchanged; the four receiver layers that READ these are P3, not here.
  rationale?: string;
  competitorProof?: string;
  volume?: number;
  intent?: string;
  questionKeywords?: string[];
  serpFeatures?: string[];
}
