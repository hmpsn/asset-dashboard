import { useState } from 'react';
import {
  Search, BarChart3, Target, TrendingUp, Zap,
  CheckCircle2, ChevronDown, ArrowRight, Sparkles,
  MessageSquare, Clock,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   hmpsn.studio Landing Page
   GTM-driven lead gen page for Webflow SEO platform
   ═══════════════════════════════════════════════════════════ */

const SIGNUP_URL = '#signup'; // Replace with actual signup/trial URL

// ── Shared Components ──

function NavBar() {
  return (
    <nav className="fixed top-0 w-full z-50 border-b border-zinc-800/60 bg-[#0f1219]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <img src="/hmpsn-studio-logo-wordmark-white.svg" alt="hmpsn studio" className="h-6 opacity-90" />
        <div className="flex items-center gap-4">
          <a href="#pricing" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors hidden sm:block">Pricing</a>
          <a href={SIGNUP_URL} className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all">
            Start Free
          </a>
        </div>
      </div>
    </nav>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300 text-xs font-semibold tracking-wide uppercase mb-4">
      {children}
    </div>
  );
}

// ── Hero Section ──

function Hero() {
  return (
    <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-gradient-to-b from-teal-500/8 to-transparent blur-3xl pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800/80 border border-zinc-700 text-zinc-300 text-xs font-medium mb-8">
          <Zap className="w-3.5 h-3.5 text-teal-400" />
          AI-powered SEO for Webflow sites
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-zinc-100 leading-[1.1] tracking-tight mb-6">
          Your website should be your
          <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent"> best salesperson</span>
        </h1>

        <p className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          See what&apos;s working, get an AI-built SEO strategy, and grow your organic traffic — without hiring an agency or learning complex tools.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a href={SIGNUP_URL} className="group px-8 py-3.5 rounded-xl text-base font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all flex items-center gap-2 shadow-lg shadow-teal-500/20">
            Start Free — 14 Day Trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
          <span className="text-sm text-zinc-500">No credit card required</span>
        </div>

        {/* Product preview placeholder */}
        <div className="mt-16 relative">
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f1219] via-transparent to-transparent z-10 pointer-events-none" />
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden shadow-2xl shadow-black/40">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
              <div className="w-3 h-3 rounded-full bg-zinc-700" />
              <div className="w-3 h-3 rounded-full bg-zinc-700" />
              <div className="w-3 h-3 rounded-full bg-zinc-700" />
              <div className="flex-1 mx-4 h-5 rounded bg-zinc-800" />
            </div>
            <div className="p-6 sm:p-10 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Organic Traffic', value: '12,847', delta: '+23%', color: 'text-emerald-400' },
                  { label: 'Keywords Ranking', value: '342', delta: '+18', color: 'text-teal-400' },
                  { label: 'Traffic Value', value: '$4,210', delta: '+$890', color: 'text-teal-300' },
                ].map(m => (
                  <div key={m.label} className="rounded-xl bg-zinc-800/50 border border-zinc-700/50 p-4">
                    <div className="text-[11px] text-zinc-500 mb-1">{m.label}</div>
                    <div className="text-xl sm:text-2xl font-bold text-zinc-100">{m.value}</div>
                    <div className={`text-xs font-medium ${m.color} mt-1`}>{m.delta}</div>
                  </div>
                ))}
              </div>
              <div className="h-32 rounded-xl bg-zinc-800/30 border border-zinc-700/30 flex items-end px-4 pb-4 gap-1">
                {[35,42,38,55,48,62,58,72,68,80,75,90,85,95].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-teal-600/60 to-teal-400/40" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Problem Section ──

function Problem() {
  const problems = [
    {
      icon: Search,
      title: "You know SEO matters, but you don't know where to start",
      desc: "You've heard you need keywords, content, and technical fixes — but Semrush dashboards make your eyes glaze over.",
    },
    {
      icon: Clock,
      title: "You don't have time to become an SEO expert",
      desc: "You're running a business. You need results, not another tool to learn and another dashboard to check.",
    },
    {
      icon: MessageSquare,
      title: "Agencies charge $3K+/mo and you still can't see what they're doing",
      desc: "Monthly PDF reports don't build trust. You want transparency and control without the enterprise price tag.",
    },
  ];

  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-14">
          <SectionLabel>The Problem</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-100 mb-4">
            SEO shouldn&apos;t require a six-figure budget
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto">
            Most businesses know organic search matters. They just don&apos;t have the tools, time, or budget to do it right.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {problems.map((p, i) => (
            <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
                <p.icon className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-200 mb-2">{p.title}</h3>
              <p className="text-[13px] text-zinc-500 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Solution Pillars ──

function Solution() {
  const pillars = [
    {
      icon: BarChart3,
      label: 'See',
      title: 'Understand your performance',
      desc: 'Google Analytics, Search Console, and site health audits — unified in one dashboard with AI-powered plain-English summaries.',
      features: ['Site health score', 'Traffic analytics', 'Search keyword data', 'Monthly performance digest'],
      gradient: 'from-blue-500/10 to-blue-500/5',
      border: 'border-blue-500/20',
      iconBg: 'bg-blue-500/15',
      iconColor: 'text-blue-400',
    },
    {
      icon: Target,
      label: 'Strategize',
      title: 'Get an AI-built game plan',
      desc: 'Your own AI SEO strategist that maps keywords to pages, finds content gaps, and tells you exactly what to do next.',
      features: ['Keyword strategy', 'Content gap analysis', 'Quick win recommendations', '24/7 AI advisor'],
      gradient: 'from-teal-500/10 to-teal-500/5',
      border: 'border-teal-500/20',
      iconBg: 'bg-teal-500/15',
      iconColor: 'text-teal-400',
    },
    {
      icon: TrendingUp,
      label: 'Grow',
      title: 'Execute and track ROI',
      desc: 'AI-generated content briefs and blog posts, organic traffic value tracking, and proof that your investment is paying off.',
      features: ['Content briefs & posts', 'ROI dashboard', 'Traffic value tracking', 'Performance reports'],
      gradient: 'from-emerald-500/10 to-emerald-500/5',
      border: 'border-emerald-500/20',
      iconBg: 'bg-emerald-500/15',
      iconColor: 'text-emerald-400',
    },
  ];

  return (
    <section className="py-20 sm:py-28 border-t border-zinc-800/50">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-14">
          <SectionLabel>The Solution</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-100 mb-4">
            AI-powered SEO in three steps
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto">
            No jargon. No guesswork. Connect your site and the AI does the rest.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pillars.map((p, i) => (
            <div key={i} className={`rounded-xl border ${p.border} bg-gradient-to-br ${p.gradient} to-zinc-900/50 p-6 relative overflow-hidden`}>
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-gradient-to-br from-white/[0.02] to-transparent -translate-y-1/2 translate-x-1/2" />
              <div className="relative">
                <div className={`w-10 h-10 rounded-xl ${p.iconBg} flex items-center justify-center mb-4`}>
                  <p.icon className={`w-5 h-5 ${p.iconColor}`} />
                </div>
                <div className={`text-[11px] font-bold uppercase tracking-widest ${p.iconColor} mb-1`}>{p.label}</div>
                <h3 className="text-lg font-bold text-zinc-100 mb-2">{p.title}</h3>
                <p className="text-[13px] text-zinc-400 leading-relaxed mb-5">{p.desc}</p>
                <div className="space-y-2.5">
                  {p.features.map((f, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${p.iconColor}`} />
                      <span className="text-xs text-zinc-300">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── How It Works ──

function HowItWorks() {
  const steps = [
    { num: '01', title: 'Connect your site', desc: 'Link your Webflow site, Google Analytics, and Search Console in minutes. We handle the rest.' },
    { num: '02', title: 'AI builds your strategy', desc: 'Our AI analyzes your site, keywords, and competitors to build a custom SEO roadmap — automatically.' },
    { num: '03', title: 'Grow your traffic', desc: 'Execute with AI-generated content, track ROI in real-time, and watch your organic traffic climb.' },
  ];

  return (
    <section className="py-20 sm:py-28 border-t border-zinc-800/50">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-14">
          <SectionLabel>How It Works</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-100 mb-4">
            Up and running in under 5 minutes
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((s, i) => (
            <div key={i} className="text-center">
              <div className="w-12 h-12 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-sm font-bold text-teal-400">{s.num}</span>
              </div>
              <h3 className="text-base font-bold text-zinc-100 mb-2">{s.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-12">
          <a href={SIGNUP_URL} className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all shadow-lg shadow-teal-500/15">
            Start Your Free Trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Pricing Section ──

function Pricing() {
  const plans = [
    {
      id: 'free',
      name: 'Starter',
      price: 'Free',
      period: '',
      tagline: 'Your site at a glance',
      cta: 'Start Free',
      ctaStyle: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700',
      features: [
        'AI-powered site insights',
        'Site health audits',
        'Google Analytics overview',
        'Search Console data',
        'AI chat advisor (3/mo)',
        'Monthly summary digest',
      ],
      highlighted: false,
    },
    {
      id: 'growth',
      name: 'Growth',
      price: '$249',
      period: '/mo',
      tagline: 'AI-powered SEO engine',
      cta: 'Start 14-Day Free Trial',
      ctaStyle: 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white shadow-lg shadow-teal-500/20',
      features: [
        'Everything in Starter',
        'SEO keyword strategy',
        'Content gaps & quick wins',
        'Access to custom briefs & copy',
        'ROI dashboard',
        'Unlimited AI chat advisor',
        'Custom date ranges',
        'Page keyword mapping',
      ],
      highlighted: true,
    },
    {
      id: 'premium',
      name: 'Premium',
      price: '$999',
      period: '/mo',
      tagline: 'Managed SEO partnership',
      cta: 'Contact Us',
      ctaStyle: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700',
      features: [
        'Everything in Growth',
        'Competitor keyword analysis',
        'Advanced competitor intel',
        '3 strategy & implementation hrs/mo',
        'Dedicated strategist',
        'Monthly strategy reviews',
        'SEO change approvals',
        'Content calendar planning',
        'Technical SEO implementation',
        'Priority support',
      ],
      highlighted: false,
    },
  ];

  return (
    <section id="pricing" className="py-20 sm:py-28 border-t border-zinc-800/50">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-14">
          <SectionLabel>Pricing</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-100 mb-4">
            Less than the cost of one freelance blog post
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto">
            Start free. Upgrade when the AI proves its value. Cancel anytime.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map(plan => (
            <div key={plan.id} className={`relative rounded-2xl border p-6 transition-all ${plan.highlighted ? 'bg-teal-500/[0.03] border-teal-500/30 ring-1 ring-teal-500/20' : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'}`}>
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-teal-500/20 border border-teal-500/30 text-teal-300">
                  Most Popular
                </div>
              )}
              <div className="pt-1">
                <h3 className={`text-lg font-bold ${plan.highlighted ? 'text-teal-300' : 'text-zinc-200'}`}>{plan.name}</h3>
                <div className="flex items-baseline gap-1 mt-2 mb-1">
                  <span className={`text-3xl font-bold ${plan.highlighted ? 'text-teal-300' : 'text-zinc-100'}`}>{plan.price}</span>
                  {plan.period && <span className="text-sm text-zinc-500">{plan.period}</span>}
                </div>
                <p className="text-[11px] text-zinc-500 mb-6">{plan.tagline}</p>
                <a href={SIGNUP_URL} className={`block w-full py-2.5 rounded-lg text-sm font-semibold text-center transition-all ${plan.ctaStyle}`}>
                  {plan.cta}
                </a>
                <div className="mt-6 space-y-3">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${plan.highlighted ? 'text-teal-400' : 'text-zinc-600'}`} />
                      <span className={`text-xs ${plan.highlighted ? 'text-zinc-300' : 'text-zinc-400'}`}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-zinc-600 mt-6">
          Content briefs and blog posts available as separate purchases on all paid plans.
        </p>
      </div>
    </section>
  );
}

// ── Social Proof / Trust Signals ──

function Trust() {
  const stats = [
    { value: '50+', label: 'SEO audits delivered' },
    { value: '10K+', label: 'Keywords tracked' },
    { value: '24/7', label: 'AI advisor availability' },
    { value: '<5min', label: 'Setup time' },
  ];

  return (
    <section className="py-16 border-t border-zinc-800/50">
      <div className="max-w-4xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-2xl sm:text-3xl font-bold text-zinc-100">{s.value}</div>
              <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── FAQ Section ──

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-800/50">
      <button onClick={() => setOpen(!open)} className="w-full py-5 flex items-center justify-between text-left group">
        <span className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100 pr-4">{q}</span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pb-5 -mt-1">
          <p className="text-sm text-zinc-400 leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "I don't have time for SEO. Will this actually help?",
      a: "That's exactly why we built this. The AI generates your strategy, identifies opportunities, and creates content — you just review and approve. Most clients spend less than 30 minutes a month in their dashboard.",
    },
    {
      q: "How is this different from Semrush or Ahrefs?",
      a: "Those are raw data tools built for SEO professionals. We're a strategy platform built for business owners. Instead of drowning you in data, we tell you exactly what to do, in plain English, and help you execute it.",
    },
    {
      q: "Do I need to be on Webflow?",
      a: "Our platform is optimized for Webflow sites, but the SEO insights, strategy, and content engine work with any website that has Google Analytics and Search Console connected.",
    },
    {
      q: "What are 'strategy & implementation hours' on Premium?",
      a: "Premium includes 3 hours per month of hands-on SEO work by our team — things like updating meta tags, implementing schema markup, setting up redirects, and publishing content. It's scoped to SEO execution, not general web development.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. No contracts, no commitments. Cancel from your dashboard and you'll keep access through the end of your billing period, then drop to the free Starter plan.",
    },
    {
      q: "What happens after my 14-day trial?",
      a: "If you love it, upgrade to Growth ($249/mo) or Premium ($999/mo). If not, you automatically drop to the free Starter plan — you keep your dashboard, analytics, and site health data. No credit card required to start.",
    },
  ];

  return (
    <section className="py-20 sm:py-28 border-t border-zinc-800/50">
      <div className="max-w-2xl mx-auto px-6">
        <div className="text-center mb-12">
          <SectionLabel>FAQ</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-100">
            Questions? Answers.
          </h2>
        </div>
        <div>
          {faqs.map((f, i) => (
            <FAQItem key={i} q={f.q} a={f.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Final CTA ──

function FinalCTA() {
  return (
    <section className="py-20 sm:py-28 border-t border-zinc-800/50 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-teal-500/[0.04] to-transparent pointer-events-none" />
      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <Sparkles className="w-10 h-10 text-teal-400 mx-auto mb-6" />
        <h2 className="text-3xl sm:text-4xl font-bold text-zinc-100 mb-4">
          Your competitors are investing in SEO.
          <br />
          <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">Are you?</span>
        </h2>
        <p className="text-zinc-400 max-w-lg mx-auto mb-8">
          Start with a free dashboard. See your site health, traffic data, and AI insights in under 5 minutes. No credit card. No commitment.
        </p>
        <a href={SIGNUP_URL} className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-base font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all shadow-lg shadow-teal-500/20">
          Start Free — 14 Day Trial
          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </a>
      </div>
    </section>
  );
}

// ── Footer ──

function Footer() {
  return (
    <footer className="border-t border-zinc-800/50 py-10">
      <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <img src="/hmpsn-studio-logo-wordmark-white.svg" alt="hmpsn studio" className="h-5 opacity-60" />
        <p className="text-xs text-zinc-600">&copy; {new Date().getFullYear()} hmpsn.studio. All rights reserved.</p>
      </div>
    </footer>
  );
}

// ── Exported Landing Page ──

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0f1219] text-zinc-200 antialiased">
      <NavBar />
      <Hero />
      <Trust />
      <Problem />
      <Solution />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
