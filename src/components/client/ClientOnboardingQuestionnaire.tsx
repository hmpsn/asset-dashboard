import { useState } from 'react';
import {
  ChevronRight, ChevronLeft, Check, Sparkles, Building2, Users, Palette,
  Target, Loader2,
} from 'lucide-react';
import { STUDIO_NAME } from '../../constants';

// ── Step types ──

interface BusinessInfo {
  businessName: string;
  industry: string;
  description: string;
  services: string;
  locations: string;
  differentiators: string;
  website: string;
}

interface AudienceInfo {
  primaryAudience: string;
  painPoints: string;
  goals: string;
  objections: string;
  buyingStage: string;
  secondaryAudience: string;
}

interface BrandInfo {
  tone: string;
  personality: string[];
  avoidWords: string;
  contentFormats: string[];
  existingExamples: string;
}

interface CompetitorInfo {
  competitors: string;
  whatTheyDoBetter: string;
  whatYouDoBetter: string;
  referenceUrls: string;
}

export interface OnboardingData {
  business: BusinessInfo;
  audience: AudienceInfo;
  brand: BrandInfo;
  competitors: CompetitorInfo;
}

interface Props {
  workspaceName: string;
  onComplete: (data: OnboardingData) => void;
  onSkip: () => void;
  saving?: boolean;
}

const STEPS = ['intro', 'business', 'audience', 'brand', 'competitors', 'review'] as const;
type Step = typeof STEPS[number];

const PERSONALITY_OPTIONS = [
  'Professional', 'Friendly', 'Authoritative', 'Conversational',
  'Technical', 'Casual', 'Empathetic', 'Bold',
  'Educational', 'Inspiring', 'Data-driven', 'Witty',
];

const CONTENT_FORMAT_OPTIONS = [
  'How-to guides', 'Case studies', 'Listicles', 'Comparison articles',
  'FAQ pages', 'Long-form pillar content', 'Short blog posts', 'Video scripts',
];

const BUYING_STAGE_OPTIONS = [
  { value: 'awareness', label: 'Awareness', desc: 'Just discovering they have a problem' },
  { value: 'consideration', label: 'Consideration', desc: 'Evaluating solutions and options' },
  { value: 'decision', label: 'Decision', desc: 'Ready to buy, choosing a provider' },
  { value: 'mixed', label: 'All stages', desc: 'We serve customers at every stage' },
];

export function ClientOnboardingQuestionnaire({ workspaceName, onComplete, onSkip, saving }: Props) {
  const [step, setStep] = useState<Step>('intro');
  const stepIdx = STEPS.indexOf(step);

  // Form state
  const [business, setBusiness] = useState<BusinessInfo>({
    businessName: workspaceName || '',
    industry: '',
    description: '',
    services: '',
    locations: '',
    differentiators: '',
    website: '',
  });
  const [audience, setAudience] = useState<AudienceInfo>({
    primaryAudience: '',
    painPoints: '',
    goals: '',
    objections: '',
    buyingStage: 'mixed',
    secondaryAudience: '',
  });
  const [brand, setBrand] = useState<BrandInfo>({
    tone: '',
    personality: [],
    avoidWords: '',
    contentFormats: [],
    existingExamples: '',
  });
  const [competitors, setCompetitors] = useState<CompetitorInfo>({
    competitors: '',
    whatTheyDoBetter: '',
    whatYouDoBetter: '',
    referenceUrls: '',
  });

  const next = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]); };
  const prev = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1]); };

  const togglePersonality = (p: string) => {
    setBrand(prev => ({
      ...prev,
      personality: prev.personality.includes(p)
        ? prev.personality.filter(x => x !== p)
        : [...prev.personality, p],
    }));
  };

  const toggleFormat = (f: string) => {
    setBrand(prev => ({
      ...prev,
      contentFormats: prev.contentFormats.includes(f)
        ? prev.contentFormats.filter(x => x !== f)
        : [...prev.contentFormats, f],
    }));
  };

  const handleSubmit = () => {
    onComplete({ business, audience, brand, competitors });
  };

  const inputCls = 'w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all';
  const textareaCls = `${inputCls} resize-none`;
  const labelCls = 'block text-xs font-medium text-zinc-300 mb-1.5';
  const hintCls = 'text-[11px] text-zinc-500 mt-1';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col">

        {/* Progress bar */}
        {step !== 'intro' && (
          <div className="px-6 pt-4 pb-0">
            <div className="flex items-center gap-1">
              {STEPS.filter(s => s !== 'intro').map((s) => (
                <div key={s} className={`flex-1 h-1 rounded-full transition-all ${
                  STEPS.indexOf(s) <= stepIdx ? 'bg-teal-500' : 'bg-zinc-800'
                }`} />
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-zinc-500">Step {stepIdx} of {STEPS.length - 1}</span>
              <button onClick={onSkip} className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* ── Intro ── */}
          {step === 'intro' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500/20 to-emerald-500/20 ring-1 ring-teal-500/20 flex items-center justify-center mx-auto mb-5">
                <Sparkles className="w-8 h-8 text-teal-400" />
              </div>
              <h2 className="text-xl font-bold text-zinc-100 mb-2">Help us create better content for you</h2>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-md mx-auto mb-6">
                Answer a few quick questions about your business, audience, and brand voice.
                This helps {STUDIO_NAME} generate content that sounds like <em>you</em> and resonates with <em>your</em> customers.
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto mb-8">
                {[
                  { icon: Building2, label: 'Your Business', desc: 'Services & differentiators' },
                  { icon: Users, label: 'Your Audience', desc: 'Who you serve & their needs' },
                  { icon: Palette, label: 'Brand Voice', desc: 'How you want to sound' },
                  { icon: Target, label: 'Competitors', desc: 'Who you compete with' },
                ].map((item, i) => (
                  <div key={i} className="px-3 py-3 bg-zinc-800/50 border border-zinc-800 text-left" style={{ borderRadius: '6px 12px 6px 12px' }}>
                    <item.icon className="w-4 h-4 text-teal-400 mb-1.5" />
                    <div className="text-[11px] font-semibold text-zinc-200">{item.label}</div>
                    <div className="text-[10px] text-zinc-500">{item.desc}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-600 mb-4">Takes about 5 minutes · You can skip and come back later</p>
            </div>
          )}

          {/* ── Business Info ── */}
          {step === 'business' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-teal-400" />
                <h3 className="text-base font-semibold text-zinc-100">About Your Business</h3>
              </div>
              <p className="text-[11px] text-zinc-500 -mt-2 mb-3">Tell us about what you do so our content reflects your expertise.</p>

              <div>
                <label className={labelCls}>Business Name</label>
                <input type="text" value={business.businessName} onChange={e => setBusiness({ ...business, businessName: e.target.value })}
                  className={inputCls} placeholder="e.g. Smith Family Dental" />
              </div>

              <div>
                <label className={labelCls}>Industry</label>
                <input type="text" value={business.industry} onChange={e => setBusiness({ ...business, industry: e.target.value })}
                  className={inputCls} placeholder="e.g. Dental, SaaS, Real Estate, E-commerce" />
              </div>

              <div>
                <label className={labelCls}>What does your business do?</label>
                <textarea rows={3} value={business.description} onChange={e => setBusiness({ ...business, description: e.target.value })}
                  className={textareaCls} placeholder="Describe your business in a few sentences — what problem do you solve and for whom?" />
              </div>

              <div>
                <label className={labelCls}>Key Services / Products</label>
                <textarea rows={2} value={business.services} onChange={e => setBusiness({ ...business, services: e.target.value })}
                  className={textareaCls} placeholder="List your main services or products, one per line" />
                <p className={hintCls}>These will be woven into content naturally.</p>
              </div>

              <div>
                <label className={labelCls}>Service Locations (if applicable)</label>
                <input type="text" value={business.locations} onChange={e => setBusiness({ ...business, locations: e.target.value })}
                  className={inputCls} placeholder="e.g. Austin TX, Denver CO, nationwide" />
              </div>

              <div>
                <label className={labelCls}>What makes you different from competitors?</label>
                <textarea rows={2} value={business.differentiators} onChange={e => setBusiness({ ...business, differentiators: e.target.value })}
                  className={textareaCls} placeholder="Unique selling points, specializations, awards, years in business, etc." />
              </div>

              <div>
                <label className={labelCls}>Website URL</label>
                <input type="text" value={business.website} onChange={e => setBusiness({ ...business, website: e.target.value })}
                  className={inputCls} placeholder="https://yourwebsite.com" />
              </div>
            </div>
          )}

          {/* ── Audience ── */}
          {step === 'audience' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-5 h-5 text-teal-400" />
                <h3 className="text-base font-semibold text-zinc-100">Your Target Audience</h3>
              </div>
              <p className="text-[11px] text-zinc-500 -mt-2 mb-3">Understanding your audience helps us write content that converts.</p>

              <div>
                <label className={labelCls}>Who is your primary customer?</label>
                <textarea rows={2} value={audience.primaryAudience} onChange={e => setAudience({ ...audience, primaryAudience: e.target.value })}
                  className={textareaCls} placeholder="e.g. Small business owners aged 30-55 looking for affordable accounting software" />
              </div>

              <div>
                <label className={labelCls}>What pain points do they have?</label>
                <textarea rows={3} value={audience.painPoints} onChange={e => setAudience({ ...audience, painPoints: e.target.value })}
                  className={textareaCls} placeholder="What problems, frustrations, or challenges bring them to you? One per line is great." />
                <p className={hintCls}>Content briefs will address these directly.</p>
              </div>

              <div>
                <label className={labelCls}>What goals are they trying to achieve?</label>
                <textarea rows={2} value={audience.goals} onChange={e => setAudience({ ...audience, goals: e.target.value })}
                  className={textareaCls} placeholder="What outcomes do they want? What does success look like for them?" />
              </div>

              <div>
                <label className={labelCls}>Common objections or hesitations</label>
                <textarea rows={2} value={audience.objections} onChange={e => setAudience({ ...audience, objections: e.target.value })}
                  className={textareaCls} placeholder="What holds them back from buying? Price, trust, complexity, time?" />
              </div>

              <div>
                <label className={labelCls}>Where are most customers in their buying journey?</label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  {BUYING_STAGE_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setAudience({ ...audience, buyingStage: opt.value })}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                        audience.buyingStage === opt.value
                          ? 'bg-teal-500/10 border-teal-500/30 ring-1 ring-teal-500/20'
                          : 'bg-zinc-800/40 border-zinc-800 hover:border-zinc-700'
                      }`}>
                      <div className={`text-[11px] font-semibold ${audience.buyingStage === opt.value ? 'text-teal-300' : 'text-zinc-300'}`}>{opt.label}</div>
                      <div className="text-[10px] text-zinc-500">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>Secondary audience (optional)</label>
                <textarea rows={2} value={audience.secondaryAudience} onChange={e => setAudience({ ...audience, secondaryAudience: e.target.value })}
                  className={textareaCls} placeholder="Any other audience segments you want to reach?" />
              </div>
            </div>
          )}

          {/* ── Brand Voice ── */}
          {step === 'brand' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Palette className="w-5 h-5 text-teal-400" />
                <h3 className="text-base font-semibold text-zinc-100">Brand Voice & Tone</h3>
              </div>
              <p className="text-[11px] text-zinc-500 -mt-2 mb-3">How should content sound? Pick traits that match your brand.</p>

              <div>
                <label className={labelCls}>Brand personality (select all that apply)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {PERSONALITY_OPTIONS.map(p => (
                    <button key={p} onClick={() => togglePersonality(p)}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                        brand.personality.includes(p)
                          ? 'bg-teal-500/15 border-teal-500/30 text-teal-300'
                          : 'bg-zinc-800/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                      }`}>
                      {brand.personality.includes(p) && <Check className="w-3 h-3 inline mr-1" />}{p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>Describe your ideal tone in your own words (optional)</label>
                <textarea rows={2} value={brand.tone} onChange={e => setBrand({ ...brand, tone: e.target.value })}
                  className={textareaCls} placeholder="e.g. Warm and approachable but still expert. We use simple language, never jargon." />
              </div>

              <div>
                <label className={labelCls}>Words or phrases to avoid</label>
                <input type="text" value={brand.avoidWords} onChange={e => setBrand({ ...brand, avoidWords: e.target.value })}
                  className={inputCls} placeholder="e.g. cheap, synergy, leverage, cutting-edge" />
                <p className={hintCls}>Comma-separated. The AI will never use these.</p>
              </div>

              <div>
                <label className={labelCls}>Preferred content formats (select all that apply)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {CONTENT_FORMAT_OPTIONS.map(f => (
                    <button key={f} onClick={() => toggleFormat(f)}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                        brand.contentFormats.includes(f)
                          ? 'bg-teal-500/15 border-teal-500/30 text-teal-300'
                          : 'bg-zinc-800/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                      }`}>
                      {brand.contentFormats.includes(f) && <Check className="w-3 h-3 inline mr-1" />}{f}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>Links to content you admire (optional)</label>
                <textarea rows={2} value={brand.existingExamples} onChange={e => setBrand({ ...brand, existingExamples: e.target.value })}
                  className={textareaCls} placeholder="URLs of blog posts or pages with a tone/style you'd like to emulate, one per line" />
              </div>
            </div>
          )}

          {/* ── Competitors ── */}
          {step === 'competitors' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-5 h-5 text-teal-400" />
                <h3 className="text-base font-semibold text-zinc-100">Competitor Landscape</h3>
              </div>
              <p className="text-[11px] text-zinc-500 -mt-2 mb-3">Knowing your competition helps us find content gaps and differentiate.</p>

              <div>
                <label className={labelCls}>Who are your main competitors?</label>
                <textarea rows={3} value={competitors.competitors} onChange={e => setCompetitors({ ...competitors, competitors: e.target.value })}
                  className={textareaCls} placeholder="List competitor names and/or their websites, one per line" />
              </div>

              <div>
                <label className={labelCls}>What do they do better than you (content-wise)?</label>
                <textarea rows={2} value={competitors.whatTheyDoBetter} onChange={e => setCompetitors({ ...competitors, whatTheyDoBetter: e.target.value })}
                  className={textareaCls} placeholder="e.g. They have better blog content, rank higher for key terms, have more case studies" />
              </div>

              <div>
                <label className={labelCls}>What do you do better?</label>
                <textarea rows={2} value={competitors.whatYouDoBetter} onChange={e => setCompetitors({ ...competitors, whatYouDoBetter: e.target.value })}
                  className={textareaCls} placeholder="e.g. Better customer service, more experience, niche specialization, better pricing" />
              </div>

              <div>
                <label className={labelCls}>Reference URLs (content you want to beat)</label>
                <textarea rows={2} value={competitors.referenceUrls} onChange={e => setCompetitors({ ...competitors, referenceUrls: e.target.value })}
                  className={textareaCls} placeholder="Specific competitor pages or articles you want to outrank, one per line" />
                <p className={hintCls}>We&apos;ll analyze these when generating briefs.</p>
              </div>
            </div>
          )}

          {/* ── Review ── */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="text-center mb-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-base font-semibold text-zinc-100">Ready to submit</h3>
                <p className="text-[11px] text-zinc-500 mt-1">Here&apos;s a summary. You can go back to edit any section.</p>
              </div>

              {/* Summary cards */}
              <div className="space-y-3">
                <SummaryCard icon={Building2} title="Business" filled={!!(business.description || business.services)} onClick={() => setStep('business')}>
                  {business.businessName && <div className="text-[11px] text-zinc-300 font-medium">{business.businessName}</div>}
                  {business.industry && <div className="text-[11px] text-zinc-500">{business.industry}</div>}
                  {business.description && <div className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{business.description}</div>}
                  {!business.description && !business.services && <div className="text-[11px] text-zinc-600 italic">Not filled in yet</div>}
                </SummaryCard>

                <SummaryCard icon={Users} title="Audience" filled={!!(audience.primaryAudience || audience.painPoints)} onClick={() => setStep('audience')}>
                  {audience.primaryAudience && <div className="text-[11px] text-zinc-400 line-clamp-2">{audience.primaryAudience}</div>}
                  {audience.painPoints && <div className="text-[11px] text-zinc-500 mt-1 line-clamp-1">Pain points: {audience.painPoints.split('\n')[0]}...</div>}
                  {!audience.primaryAudience && !audience.painPoints && <div className="text-[11px] text-zinc-600 italic">Not filled in yet</div>}
                </SummaryCard>

                <SummaryCard icon={Palette} title="Brand Voice" filled={brand.personality.length > 0 || !!brand.tone} onClick={() => setStep('brand')}>
                  {brand.personality.length > 0 && <div className="flex flex-wrap gap-1">{brand.personality.map(p => <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400">{p}</span>)}</div>}
                  {brand.tone && <div className="text-[11px] text-zinc-400 mt-1 line-clamp-1">{brand.tone}</div>}
                  {!brand.personality.length && !brand.tone && <div className="text-[11px] text-zinc-600 italic">Not filled in yet</div>}
                </SummaryCard>

                <SummaryCard icon={Target} title="Competitors" filled={!!competitors.competitors} onClick={() => setStep('competitors')}>
                  {competitors.competitors && <div className="text-[11px] text-zinc-400 line-clamp-2">{competitors.competitors}</div>}
                  {!competitors.competitors && <div className="text-[11px] text-zinc-600 italic">Not filled in yet</div>}
                </SummaryCard>
              </div>

              <div className="bg-teal-500/5 border border-teal-500/15 px-4 py-3 mt-4" style={{ borderRadius: '6px 12px 6px 12px' }}>
                <p className="text-[11px] text-teal-400/80 leading-relaxed">
                  <strong className="text-teal-300">What happens next:</strong> Your answers will be used to create audience personas, enrich your brand voice, and build a knowledge base — making every piece of content we generate more accurate and on-brand.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Navigation footer */}
        <div className="px-6 py-4 border-t border-zinc-800/50 flex items-center justify-between gap-3 flex-shrink-0">
          {step === 'intro' ? (
            <>
              <button onClick={onSkip} className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
                Skip for now
              </button>
              <button onClick={next} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-sm text-white font-semibold hover:from-teal-500 hover:to-emerald-500 transition-all">
                Get Started <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : step === 'review' ? (
            <>
              <button onClick={prev} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
              <button onClick={handleSubmit} disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-sm text-white font-semibold hover:from-teal-500 hover:to-emerald-500 transition-all disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {saving ? 'Saving...' : 'Submit & Continue'}
              </button>
            </>
          ) : (
            <>
              <button onClick={prev} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
              <button onClick={next} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-sm text-white font-semibold hover:from-teal-500 hover:to-emerald-500 transition-all">
                Continue <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Summary card sub-component ──

function SummaryCard({ icon: Icon, title, filled, onClick, children }: {
  icon: typeof Building2; title: string; filled: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="w-full text-left px-4 py-3 bg-zinc-800/40 border border-zinc-800 hover:border-zinc-700 transition-all group" style={{ borderRadius: '6px 12px 6px 12px' }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${filled ? 'text-teal-400' : 'text-zinc-600'}`} />
          <span className="text-xs font-medium text-zinc-200">{title}</span>
          {filled && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
        </div>
        <span className="text-[10px] text-zinc-600 group-hover:text-zinc-400 transition-colors">Edit →</span>
      </div>
      {children}
    </button>
  );
}
