export type FeatureCategory =
  | 'seo' | 'content' | 'analytics' | 'ai'
  | 'client' | 'monetization' | 'auth' | 'platform' | 'infra';

export type PainPoint =
  | 'site-health' | 'technical-seo' | 'content-production'
  | 'keyword-strategy' | 'competitive-intel' | 'reporting'
  | 'client-transparency' | 'ai-seo' | 'schema'
  | 'payments' | 'onboarding' | 'scale';

export type FeatureTier = 'free' | 'growth' | 'premium' | 'admin';

export type FeatureImpact = 'high' | 'medium' | 'low';

export interface Feature {
  id: number;
  title: string;
  oneLiner: string;
  category: FeatureCategory;
  painPoints: PainPoint[];
  tier: FeatureTier;
  impact: FeatureImpact;
  clientFacing: boolean;
}

export interface FeaturesData {
  features: Feature[];
}

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  seo: 'SEO & Technical',
  content: 'Content & Strategy',
  analytics: 'Analytics & Tracking',
  ai: 'AI & Intelligence',
  client: 'Client Portal',
  monetization: 'Monetization',
  auth: 'Auth & Security',
  platform: 'Platform & UX',
  infra: 'Architecture & Infrastructure',
};

export const PAIN_POINT_LABELS: Record<PainPoint, string> = {
  'site-health': 'When they ask about site health',
  'technical-seo': 'When they need a technical audit',
  'content-production': 'When they need content / blog posts',
  'keyword-strategy': 'When they ask about keywords',
  'competitive-intel': 'When they ask about competitors',
  'reporting': 'When they want reports',
  'client-transparency': 'When they ask what you\'re doing for them',
  'ai-seo': 'When they ask about AI search / ChatGPT',
  'schema': 'When they need structured data / rich snippets',
  'payments': 'When they ask about billing',
  'onboarding': 'When they ask how to get started',
  'scale': 'When they have 100+ pages',
};
