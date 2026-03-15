import { useState, useEffect } from 'react';
import { X, Lightbulb, ChevronRight } from 'lucide-react';

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
    title: 'Keyword Strategy',
    body: 'This shows which keywords your pages target and where the opportunities are. "Content gaps" are valuable keywords you\'re not yet targeting — these are your biggest growth opportunities.',
    learnMore: 'Keywords are the words and phrases people type into Google. Mapping the right keywords to the right pages helps Google understand what each page is about.',
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
    <div className="mb-4 rounded-xl border border-teal-500/20 bg-gradient-to-r from-teal-500/5 to-emerald-500/5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Lightbulb className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold text-zinc-200">{tip.title}</h4>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-400 font-medium">SEO Tip</span>
            </div>
            <p className="text-[12px] text-zinc-400 leading-relaxed">{tip.body}</p>
            {showLearnMore && tip.learnMore && (
              <p className="text-[12px] text-zinc-500 leading-relaxed mt-2 pl-3 border-l-2 border-teal-500/20">{tip.learnMore}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              {tip.learnMore && !showLearnMore && (
                <button
                  onClick={() => setShowLearnMore(true)}
                  className="flex items-center gap-1 text-[11px] text-teal-400 hover:text-teal-300 transition-colors font-medium"
                >
                  Learn more <ChevronRight className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={dismiss}
                className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
          <button onClick={dismiss} className="p-1 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50 transition-colors flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
