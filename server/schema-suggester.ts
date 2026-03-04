import { listPages, filterPublishedPages } from './webflow.js';

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(tokenOverride?: string): string | null {
  return tokenOverride || process.env.WEBFLOW_API_TOKEN || null;
}

export interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  suggestedSchemas: SchemaSuggestion[];
}

export interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  seo?: { title?: string; description?: string };
}

async function fetchPageMeta(pageId: string, tokenOverride?: string): Promise<PageMeta | null> {
  const token = getToken(tokenOverride);
  if (!token) return null;
  try {
    const res = await fetch(`${WEBFLOW_API}/pages/${pageId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json() as PageMeta;
  } catch { return null; }
}

async function fetchPublishedHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function getSiteSubdomain(siteId: string, tokenOverride?: string): Promise<string | null> {
  const token = getToken(tokenOverride);
  if (!token) return null;
  try {
    const res = await fetch(`${WEBFLOW_API}/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as { shortName?: string };
    return data.shortName || null;
  } catch { return null; }
}

// Detect existing JSON-LD schemas in HTML
function extractExistingSchemas(html: string): string[] {
  const schemas: string[] = [];
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      if (data['@type']) schemas.push(data['@type']);
      if (Array.isArray(data['@graph'])) {
        for (const item of data['@graph']) {
          if (item['@type']) schemas.push(item['@type']);
        }
      }
    } catch { /* malformed JSON-LD */ }
  }
  return schemas;
}

// Analyze page content and suggest appropriate schemas
function suggestSchemas(
  pageTitle: string,
  slug: string,
  seoTitle: string,
  seoDesc: string,
  html: string | null,
  existingSchemas: string[],
  isHomepage: boolean,
): SchemaSuggestion[] {
  const suggestions: SchemaSuggestion[] = [];
  const titleLower = (seoTitle || pageTitle || '').toLowerCase();
  const slugLower = (slug || '').toLowerCase();
  const bodyText = html ? html.replace(/<[^>]+>/g, ' ').toLowerCase() : '';

  const has = (type: string) => existingSchemas.some(s => s.toLowerCase() === type.toLowerCase());

  // Homepage → Organization or WebSite
  if (isHomepage) {
    if (!has('Organization') && !has('LocalBusiness')) {
      suggestions.push({
        type: 'Organization',
        reason: 'Homepage should have Organization schema to establish brand identity in search results.',
        priority: 'high',
        template: {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: '[Company Name]',
          url: '[Website URL]',
          logo: '[Logo URL]',
          description: seoDesc || '[Company description]',
          sameAs: ['[LinkedIn URL]', '[Twitter URL]'],
        },
      });
    }
    if (!has('WebSite')) {
      suggestions.push({
        type: 'WebSite',
        reason: 'WebSite schema helps search engines understand your site structure and can enable sitelinks search box.',
        priority: 'medium',
        template: {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: '[Site Name]',
          url: '[Website URL]',
          potentialAction: {
            '@type': 'SearchAction',
            target: '[Website URL]/search?q={search_term_string}',
            'query-input': 'required name=search_term_string',
          },
        },
      });
    }
  }

  // Blog/article pages
  const isBlogPost = slugLower.includes('blog/') || slugLower.includes('post/') || slugLower.includes('article/') ||
    titleLower.includes('blog') || bodyText.includes('published') || bodyText.includes('author');
  if (isBlogPost && !has('Article') && !has('BlogPosting') && !has('NewsArticle')) {
    suggestions.push({
      type: 'Article',
      reason: 'Blog/article pages benefit from Article schema for rich snippets in search results (author, date, image).',
      priority: 'high',
      template: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: seoTitle || pageTitle,
        description: seoDesc || '[Article description]',
        author: { '@type': 'Person', name: '[Author Name]' },
        datePublished: '[YYYY-MM-DD]',
        dateModified: '[YYYY-MM-DD]',
        image: '[Featured Image URL]',
        publisher: {
          '@type': 'Organization',
          name: '[Company Name]',
          logo: { '@type': 'ImageObject', url: '[Logo URL]' },
        },
      },
    });
  }

  // FAQ pages
  const isFaq = slugLower.includes('faq') || titleLower.includes('faq') ||
    titleLower.includes('frequently asked') || titleLower.includes('questions');
  const hasQAContent = html ? (html.match(/<(h[2-4]|summary)[^>]*>.*\?/gi) || []).length >= 2 : false;
  if ((isFaq || hasQAContent) && !has('FAQPage')) {
    suggestions.push({
      type: 'FAQPage',
      reason: 'FAQ content can display as rich results with expandable Q&A directly in search results, significantly increasing visibility.',
      priority: 'high',
      template: {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: '[Question 1]',
            acceptedAnswer: { '@type': 'Answer', text: '[Answer 1]' },
          },
          {
            '@type': 'Question',
            name: '[Question 2]',
            acceptedAnswer: { '@type': 'Answer', text: '[Answer 2]' },
          },
        ],
      },
    });
  }

  // Service pages
  const isService = slugLower.includes('service') || slugLower.includes('solution') ||
    titleLower.includes('service') || titleLower.includes('solution') || titleLower.includes('what we do');
  if (isService && !has('Service') && !has('Product')) {
    suggestions.push({
      type: 'Service',
      reason: 'Service pages should describe offerings with structured data so search engines can surface them in relevant queries.',
      priority: 'medium',
      template: {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: seoTitle || pageTitle,
        description: seoDesc || '[Service description]',
        provider: { '@type': 'Organization', name: '[Company Name]' },
        serviceType: '[Service Category]',
      },
    });
  }

  // About pages
  const isAbout = slugLower.includes('about') || titleLower.includes('about us') || titleLower.includes('our team') || titleLower.includes('our story');
  if (isAbout && !has('AboutPage') && !has('Organization')) {
    suggestions.push({
      type: 'Organization',
      reason: 'About pages should reinforce Organization schema with founders, team, and company details.',
      priority: 'medium',
      template: {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: '[Company Name]',
        url: '[Website URL]',
        description: seoDesc || '[About description]',
        foundingDate: '[YYYY]',
        founders: [{ '@type': 'Person', name: '[Founder Name]' }],
      },
    });
  }

  // Contact pages
  const isContact = slugLower.includes('contact') || titleLower.includes('contact') || titleLower.includes('get in touch');
  if (isContact && !has('ContactPage') && !has('LocalBusiness')) {
    suggestions.push({
      type: 'LocalBusiness',
      reason: 'Contact pages with address/phone information should include LocalBusiness schema for local SEO and Knowledge Panel.',
      priority: 'medium',
      template: {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: '[Company Name]',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '[Street]',
          addressLocality: '[City]',
          addressRegion: '[State]',
          postalCode: '[Zip]',
          addressCountry: '[Country]',
        },
        telephone: '[Phone]',
        email: '[Email]',
      },
    });
  }

  // Pricing pages
  const isPricing = slugLower.includes('pricing') || titleLower.includes('pricing') || titleLower.includes('plans');
  if (isPricing && !has('Product') && !has('Offer')) {
    suggestions.push({
      type: 'Product',
      reason: 'Pricing pages can use Product/Offer schema to display pricing directly in search results.',
      priority: 'medium',
      template: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: '[Product/Plan Name]',
        description: seoDesc || '[Plan description]',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '[Lowest Price]',
          highPrice: '[Highest Price]',
          priceCurrency: 'USD',
        },
      },
    });
  }

  // Case study / testimonial pages
  const isCaseStudy = slugLower.includes('case-stud') || slugLower.includes('testimonial') || slugLower.includes('review') ||
    titleLower.includes('case study') || titleLower.includes('testimonial') || titleLower.includes('success stor');
  if (isCaseStudy && !has('Review') && !has('AggregateRating')) {
    suggestions.push({
      type: 'Review',
      reason: 'Case studies and testimonials can use Review schema to show star ratings and endorsements in search results.',
      priority: 'low',
      template: {
        '@context': 'https://schema.org',
        '@type': 'Review',
        itemReviewed: { '@type': 'Organization', name: '[Your Company]' },
        author: { '@type': 'Person', name: '[Client Name]' },
        reviewBody: '[Testimonial text]',
        reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      },
    });
  }

  // Event pages
  const isEvent = slugLower.includes('event') || slugLower.includes('webinar') || slugLower.includes('conference') ||
    titleLower.includes('event') || titleLower.includes('webinar');
  if (isEvent && !has('Event')) {
    suggestions.push({
      type: 'Event',
      reason: 'Event pages can display date, location, and registration info directly in search results.',
      priority: 'medium',
      template: {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: seoTitle || pageTitle,
        description: seoDesc || '[Event description]',
        startDate: '[YYYY-MM-DDTHH:MM]',
        endDate: '[YYYY-MM-DDTHH:MM]',
        location: { '@type': 'Place', name: '[Venue]', address: '[Address]' },
        organizer: { '@type': 'Organization', name: '[Company Name]' },
      },
    });
  }

  // BreadcrumbList — almost every page should have this
  if (!has('BreadcrumbList') && !isHomepage && slug) {
    const parts = slug.split('/').filter(Boolean);
    if (parts.length >= 1) {
      suggestions.push({
        type: 'BreadcrumbList',
        reason: 'Breadcrumb schema helps search engines understand your site hierarchy and displays breadcrumb trails in results.',
        priority: 'low',
        template: {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: parts.map((part, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: part.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            item: `[Website URL]/${parts.slice(0, i + 1).join('/')}`,
          })),
        },
      });
    }
  }

  return suggestions;
}

// --- AI-Powered Schema Generation ---

async function aiGenerateSchema(
  pageTitle: string,
  slug: string,
  seoTitle: string,
  seoDesc: string,
  html: string | null,
  existingSchemas: string[],
  isHomepage: boolean,
  baseUrl: string,
): Promise<SchemaSuggestion[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return []; // Fall back to rule-based if no API key

  const safeSlug = slug || '';
  const safeSeoTitle = seoTitle || pageTitle || '';
  const safeSeoDesc = seoDesc || '';
  // Extract meaningful content from HTML (strip tags, limit length)
  let pageContent = '';
  if (html) {
    // Get body content only
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    // Remove scripts, styles, nav, footer
    pageContent = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000); // Limit to ~3k chars for token efficiency
  }

  // Extract any structured info from the page
  const emails = html ? (html.match(/[\w.-]+@[\w.-]+\.\w+/g) || []).slice(0, 3) : [];
  const phones = html ? (html.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []).slice(0, 2) : [];
  const images = html ? (html.match(/src=["']([^"']*(?:jpg|jpeg|png|webp|svg)[^"']*)["']/gi) || []).slice(0, 5).map(m => {
    const s = m.match(/src=["']([^"']+)["']/i);
    return s ? s[1] : '';
  }).filter(Boolean) : [];

  const prompt = `You are an expert SEO structured data consultant. Analyze this webpage and generate production-ready JSON-LD schema(s) that would maximize this page's rich snippet potential in Google Search.

PAGE INFO:
- URL: ${baseUrl}/${safeSlug}
- Title: ${safeSeoTitle}
- Meta Description: ${safeSeoDesc || '(none)'}
- Is Homepage: ${isHomepage}
- Existing Schemas: ${existingSchemas.length > 0 ? existingSchemas.join(', ') : 'None'}
- Emails found: ${emails.join(', ') || 'none'}
- Phone numbers found: ${phones.join(', ') || 'none'}
- Images found: ${images.slice(0, 3).join(', ') || 'none'}

PAGE CONTENT (excerpt):
${pageContent.slice(0, 2000)}

INSTRUCTIONS:
1. Generate 1-3 JSON-LD schemas that are MOST impactful for this specific page
2. Fill in ALL values using actual content from the page - NO placeholders
3. Each schema must be valid, complete, and ready to paste into the page's <head>
4. Prioritize schemas that enable rich snippets (FAQ, HowTo, Article, Organization, Product, BreadcrumbList, etc.)
5. Don't suggest schemas that already exist on the page
6. For Organization schema, use the site URL as the homepage, and extract company name from the page content
7. Be specific — use actual content, dates, descriptions from the page

Respond with a JSON array of objects, each with:
- "type": the @type value
- "reason": 1-2 sentence explanation of SEO impact
- "priority": "high" | "medium" | "low"
- "template": the complete JSON-LD object (with @context)

Return ONLY valid JSON array, no markdown or explanation.`;

  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return [];

    // Parse the response - handle both raw JSON and markdown-wrapped JSON
    let jsonStr = content;
    const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) jsonStr = mdMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: { type?: string; reason?: string; priority?: string; template?: Record<string, unknown> }) => ({
      type: item.type || 'Unknown',
      reason: item.reason || '',
      priority: (item.priority === 'high' || item.priority === 'medium' || item.priority === 'low') ? item.priority : 'medium',
      template: item.template || {},
    })).filter((s: { template: Record<string, unknown> }) => s.template['@type']) as SchemaSuggestion[];
  } catch (err) {
    console.error('AI schema generation error:', err);
    return [];
  }
}

export async function generateSchemaSuggestions(siteId: string, tokenOverride?: string, useAI: boolean = false): Promise<SchemaPageSuggestion[]> {
  const subdomain = await getSiteSubdomain(siteId, tokenOverride);
  const baseUrl = subdomain ? `https://${subdomain}.webflow.io` : '';
  console.log(`[schema] subdomain=${subdomain}, baseUrl=${baseUrl}`);
  if (!baseUrl) {
    console.error('[schema] No subdomain found for site', siteId);
    return [];
  }

  const allPages = await listPages(siteId, tokenOverride);
  console.log(`[schema] Total pages: ${allPages.length}`);
  const pages = filterPublishedPages(allPages).filter(
    (p: { title: string; slug: string }) => !(p.title || '').toLowerCase().includes('password') && !(p.slug || '').toLowerCase().includes('password')
  );
  console.log(`[schema] Published (non-password) pages: ${pages.length}`, pages.map(p => `${p.title} [${p.slug}]`));

  const results: SchemaPageSuggestion[] = [];
  // AI mode: smaller batches (API calls are slower), rule-based: larger batches
  const batch = useAI ? 2 : 5;

  for (let i = 0; i < pages.length; i += batch) {
    const chunk = pages.slice(i, i + batch);
    const chunkResults = await Promise.all(
      chunk.map(async (page) => {
        const url = (!page.slug || page.slug === 'index') ? baseUrl : `${baseUrl}/${page.slug}`;
        const isHomepage = !page.slug || page.slug === '' || page.slug === 'home' || page.slug === 'index';
        const [meta, html] = await Promise.all([
          fetchPageMeta(page.id, tokenOverride),
          fetchPublishedHtml(url),
        ]);

        const seoTitle = meta?.seo?.title || page.title || '';
        const seoDesc = meta?.seo?.description || '';
        const existingSchemas = html ? extractExistingSchemas(html) : [];
        console.log(`[schema] Page "${page.title}" [${page.slug}] → url=${url}, isHome=${isHomepage}, html=${html ? html.length + ' chars' : 'FAILED'}, existing=${existingSchemas.join(',') || 'none'}`);

        let suggestedSchemas: SchemaSuggestion[];

        if (useAI) {
          // AI-powered: generates pre-filled, production-ready schemas
          suggestedSchemas = await aiGenerateSchema(
            page.title, page.slug, seoTitle, seoDesc,
            html, existingSchemas, isHomepage, baseUrl,
          );
          // If AI fails or returns nothing, fall back to rule-based
          if (suggestedSchemas.length === 0) {
            suggestedSchemas = suggestSchemas(
              page.title, page.slug, seoTitle, seoDesc,
              html, existingSchemas, isHomepage,
            );
          }
        } else {
          suggestedSchemas = suggestSchemas(
            page.title, page.slug, seoTitle, seoDesc,
            html, existingSchemas, isHomepage,
          );
        }

        // Only include pages that have suggestions or existing schemas
        if (suggestedSchemas.length === 0 && existingSchemas.length === 0) return null;

        return {
          pageId: page.id,
          pageTitle: page.title,
          slug: page.slug,
          url,
          existingSchemas,
          suggestedSchemas,
        } as SchemaPageSuggestion;
      })
    );
    results.push(...chunkResults.filter(Boolean) as SchemaPageSuggestion[]);
  }

  // Sort: pages with high-priority suggestions first, then by number of suggestions
  results.sort((a, b) => {
    const aMax = Math.min(...a.suggestedSchemas.map(s => s.priority === 'high' ? 0 : s.priority === 'medium' ? 1 : 2), 3);
    const bMax = Math.min(...b.suggestedSchemas.map(s => s.priority === 'high' ? 0 : s.priority === 'medium' ? 1 : 2), 3);
    if (aMax !== bMax) return aMax - bMax;
    return b.suggestedSchemas.length - a.suggestedSchemas.length;
  });

  return results;
}
