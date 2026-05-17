import { useState, useEffect } from 'react';
import { X, Lightbulb, ChevronRight } from 'lucide-react';
import { Button, Icon, IconButton } from '../ui';

interface TabTip {
  title: string;
  body: string;
  learnMore?: string;
}

const TAB_TIPS: Record<string, TabTip> = {
  overview: {
    title: 'Your SEO Command Center',
    body: 'This tab shows AI-powered insights about your website\'s performance. The advisor analyzes your traffic, rankings, and site health to surface what matters most.',
    learnMore: 'SEO stands for Search Engine Optimization — the practice of improving your website so it ranks higher in Google and brings in more visitors.',
  },
  performance: {
    title: 'Understanding Search Performance',
    body: 'Here you\'ll see how people find your site through Google. "Clicks" are visits from search results, "Impressions" are how often you appeared, and "CTR" is the percentage of impressions that became clicks.',
    learnMore: 'A good CTR varies by position — #1 results average ~30% CTR, while position #10 averages ~2%. Improving your titles and descriptions can boost CTR at any position.',
  },
  health: {
    title: 'Site Health & Technical SEO',
    body: 'Your site health score reflects how well your website follows SEO best practices. Errors hurt your rankings, warnings are opportunities, and a score above 80 is considered healthy.',
    learnMore: 'Technical SEO covers things like page speed, mobile-friendliness, proper HTML structure, and secure connections (HTTPS). These are the foundation that content SEO builds on.',
  },
  strategy: {
    title: 'SEO Strategy',
    body: 'Start with the recommended next steps, then use strategy keywords to guide what we should watch, consider, or create around next.',
    learnMore: 'Adding a strategy keyword starts future rank tracking and helps shape later recommendations. Removing one stops future tracking, but historical ranking data is preserved.',
  },
  content: {
    title: 'Content That Ranks',
    body: 'AI-generated content briefs give writers a blueprint for articles that can rank in search. Each brief includes target keywords, suggested structure, and competitive analysis.',
    learnMore: 'Content is the #1 ranking factor. Pages with thorough, well-structured content that answers searcher intent tend to outrank thin or generic pages.',
  },
  roi: {
    title: 'Measuring SEO ROI',
    body: 'This dashboard estimates the dollar value of your organic traffic — what you\'d pay for the same clicks through Google Ads. As your rankings improve, this value grows.',
    learnMore: 'SEO is a compounding investment. Unlike paid ads that stop when you stop paying, organic rankings can deliver traffic for months or years after the initial work.',
  },
};

interface Props {
  tab: string;
  workspaceId: string;
}

export function SeoEducationTip({ tab, workspaceId }: Props) {
  const tip = TAB_TIPS[tab];
  const storageKey = `seo_tip_seen_${workspaceId}_${tab}`;
  const [visible, setVisible] = useState(false);
  const [showLearnMore, setShowLearnMore] = useState(false);

  // effect-layout-ok -- SEO tip intentionally appears after first paint to avoid competing with initial page load.
  useEffect(() => {
    if (!tip) return;
    const seen = localStorage.getItem(storageKey);
    if (!seen) {
      // Small delay so it doesn't flash immediately
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, [tab, storageKey, tip]);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(storageKey, 'true');
  };

  if (!visible || !tip) return null;

  return (
    <div className="mb-4 border border-teal-500/20 bg-gradient-to-r from-teal-500/5 to-emerald-500/5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300" style={{ borderRadius: 'var(--radius-signature)' }}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon as={Lightbulb} size="md" className="text-accent-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="t-page font-semibold text-[var(--brand-text-bright)]">{tip.title}</h4>
              <span className="t-micro px-1.5 py-0.5 rounded-[var(--radius-pill)] badge-span-ok bg-teal-500/10 text-accent-brand font-medium">SEO Tip</span>
            </div>
            <p className="t-body text-[var(--brand-text)] leading-relaxed">{tip.body}</p>
            {showLearnMore && tip.learnMore && (
              <p className="t-body text-[var(--brand-text-muted)] leading-relaxed mt-2 pl-3 border-l-2 border-teal-500/20">{tip.learnMore}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              {tip.learnMore && !showLearnMore && (
                <Button
                  onClick={() => setShowLearnMore(true)}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-0 p-0 rounded-[var(--radius-sm)] flex items-center gap-1 t-caption-sm text-accent-brand hover:text-accent-brand hover:bg-transparent hover:underline underline-offset-2 transition-colors font-medium"
                >
                  Learn more <ChevronRight className="w-3 h-3" />
                </Button>
              )}
              <Button
                onClick={dismiss}
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto min-h-0 p-0 rounded-[var(--radius-sm)] t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-transparent transition-colors"
              >
                Got it
              </Button>
            </div>
          </div>
          <IconButton
            onClick={dismiss}
            icon={X}
            label="Dismiss SEO tip"
            size="sm"
            className="flex-shrink-0 rounded-[var(--radius-sm)]"
          />
        </div>
      </div>
    </div>
  );
}
