export interface GoogleRichResultRule {
  required: string[];
  recommended: string[];
  feature: string;
}

export const GOOGLE_RICH_RESULT_RULES: Record<string, GoogleRichResultRule> = {
  Article: {
    required: ['headline', 'datePublished', 'author', 'image'],
    recommended: ['dateModified', 'publisher', 'description'],
    feature: 'Article rich result',
  },
  FAQPage: {
    required: ['mainEntity'],
    recommended: [],
    feature: 'FAQ accordion in search',
  },
  LocalBusiness: {
    required: ['name', 'address'],
    recommended: ['telephone', 'openingHours', 'geo', 'url', 'image'],
    feature: 'Local business panel',
  },
  Product: {
    required: ['name', 'offers'],
    recommended: ['image', 'description', 'brand', 'review', 'aggregateRating'],
    feature: 'Product rich result',
  },
  JobPosting: {
    required: ['title', 'datePosted', 'description', 'hiringOrganization', 'jobLocation'],
    recommended: ['validThrough', 'employmentType', 'jobLocation', 'baseSalary'],
    feature: 'Job listing in search',
  },
  Event: {
    required: ['name', 'startDate', 'location'],
    recommended: ['endDate', 'description', 'image', 'offers', 'organizer'],
    feature: 'Event listing',
  },
  Recipe: {
    required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
    recommended: ['cookTime', 'prepTime', 'totalTime', 'nutrition', 'author'],
    feature: 'Recipe rich result',
  },
  Course: {
    required: ['name', 'description', 'provider'],
    recommended: ['hasCourseInstance', 'offers'],
    feature: 'Course info in search',
  },
  Review: {
    required: ['itemReviewed', 'reviewRating', 'author'],
    recommended: ['datePublished', 'reviewBody'],
    feature: 'Review rich result',
  },
  HowTo: {
    required: ['name', 'step'],
    recommended: ['image', 'description', 'totalTime', 'estimatedCost', 'supply', 'tool'],
    feature: 'How-to steps in search',
  },
  VideoObject: {
    required: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    recommended: ['contentUrl', 'embedUrl', 'duration', 'author', 'publisher'],
    feature: 'Video carousel',
  },
  BlogPosting: {
    required: ['headline', 'datePublished', 'author', 'image'],
    recommended: ['dateModified', 'publisher', 'description', 'keywords'],
    feature: 'Article rich result',
  },
  NewsArticle: {
    required: ['headline', 'datePublished', 'author', 'image'],
    recommended: ['dateModified', 'publisher', 'description', 'articleSection'],
    feature: 'Article rich result',
  },
  BreadcrumbList: {
    required: ['itemListElement'],
    recommended: [],
    feature: 'Breadcrumb trail in search',
  },
  WebPage: {
    required: [],
    recommended: ['name', 'description', 'dateModified'],
    feature: 'Web page structured data',
  },
  Organization: {
    required: ['name'],
    recommended: ['url', 'logo', 'sameAs', 'address', 'telephone'],
    feature: 'Organization knowledge panel',
  },
  WebSite: {
    required: ['name', 'url'],
    recommended: [],
    feature: 'Website structured data',
  },
  Service: {
    required: ['name'],
    recommended: ['description', 'provider', 'areaServed', 'serviceType'],
    feature: 'Service structured data',
  },
  ProfilePage: {
    required: ['mainEntity'],
    recommended: ['name', 'description'],
    feature: 'Profile page in search',
  },
  MedicalOrganization: {
    required: ['name', 'address'],
    recommended: ['telephone', 'medicalSpecialty', 'availableService', 'openingHours', 'image'],
    feature: 'Medical business panel',
  },
  FinancialService: {
    required: ['name', 'address'],
    recommended: ['telephone', 'areaServed', 'serviceType', 'openingHours', 'image'],
    feature: 'Financial service panel',
  },
  Speakable: {
    required: ['cssSelector'],
    recommended: [],
    feature: 'Speakable for voice assistants',
  },
};

export const GOOGLE_RICH_RESULT_TYPES = new Set([
  'Article',
  'FAQPage',
  'LocalBusiness',
  'Product',
  'JobPosting',
  'Event',
  'Recipe',
  'Course',
  'Review',
  'BreadcrumbList',
  'Service',
  'ProfilePage',
  'MedicalOrganization',
  'FinancialService',
  'HowTo',
  'VideoObject',
  'BlogPosting',
  'NewsArticle',
  'Speakable',
]);
