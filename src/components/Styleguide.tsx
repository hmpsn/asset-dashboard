import { useState } from 'react';
import { STUDIO_NAME } from '../constants';
import {
  BarChart3, Globe, MousePointer, TrendingUp, Target, Zap,
  Shield, AlertTriangle, Info, Search, FileText,
  Activity, Sun, Moon, Gauge, Lock, Users,
  Loader2, X, CheckCircle, Send, ChevronDown, Image,
  Settings, Clipboard, Pencil, CornerDownRight, Share2, Code2,
} from 'lucide-react';
import { ChartPointDetail } from './ChartPointDetail';
import { ErrorBoundary } from './ErrorBoundary';
import {
  MetricRing, MetricRingSvg, StatCard, CompactStatBar,
  PageHeader, SectionCard, DateRangeSelector, DataList,
  Badge, EmptyState, TabBar,
  scoreColor, DATE_PRESETS_SHORT, DATE_PRESETS_FULL,
} from './ui';

const ACCENT_COLORS = [
  { name: 'Teal', dark: '#2dd4bf', light: '#0d9488', ratio: '4.5:1', tw: 'bg-teal-500' },
  { name: 'Blue', dark: '#60a5fa', light: '#2563eb', ratio: '4.6:1', tw: 'bg-blue-500' },
  { name: 'Emerald', dark: '#34d399', light: '#047857', ratio: '5.5:1', tw: 'bg-emerald-500' },
  { name: 'Green', dark: '#4ade80', light: '#15803d', ratio: '5.2:1', tw: 'bg-green-500' },
  { name: 'Amber', dark: '#fbbf24', light: '#b45309', ratio: '5.4:1', tw: 'bg-amber-500' },
  { name: 'Red', dark: '#f87171', light: '#dc2626', ratio: '4.6:1', tw: 'bg-red-500' },
  { name: 'Orange', dark: '#fb923c', light: '#c2410c', ratio: '5.2:1', tw: 'bg-orange-500' },
  { name: 'Cyan', dark: '#22d3ee', light: '#0e7490', ratio: '5.6:1', tw: 'bg-cyan-500' },
  { name: 'Sky', dark: '#38bdf8', light: '#0369a1', ratio: '7.0:1', tw: 'bg-sky-500' },
  { name: 'Yellow', dark: '#eab308', light: '#a16207', ratio: '5.2:1', tw: 'bg-yellow-500' },
  { name: 'Purple', dark: '#a78bfa', light: '#7c3aed', ratio: '4.6:1', tw: 'bg-purple-500' },
];

const NEUTRAL_SCALE = [
  { name: 'zinc-100', hex: '#f4f4f5', desc: 'Primary text, headings' },
  { name: 'zinc-200', hex: '#e4e4e7', desc: 'Key content' },
  { name: 'zinc-300', hex: '#d4d4d8', desc: 'Strong secondary' },
  { name: 'zinc-400', hex: '#a1a1aa', desc: 'Secondary text' },
  { name: 'zinc-500', hex: '#71717a', desc: 'Muted text, labels' },
  { name: 'zinc-600', hex: '#52525b', desc: 'Subtle' },
  { name: 'zinc-700', hex: '#3f3f46', desc: 'Borders, dividers' },
  { name: 'zinc-800', hex: '#27272a', desc: 'Elevated surfaces' },
  { name: 'zinc-900', hex: '#18181b', desc: 'Card backgrounds' },
];

const SAMPLE_TREND = Array.from({ length: 28 }, (_, i) => ({
  date: `2026-02-${String(i + 1).padStart(2, '0')}`,
  clicks: Math.round(200 + Math.sin(i / 4) * 80 + Math.random() * 40),
  impressions: Math.round(3000 + Math.cos(i / 3) * 800 + Math.random() * 300),
  ctr: +(((200 + Math.sin(i / 4) * 80) / (3000 + Math.cos(i / 3) * 800)) * 100).toFixed(1),
  position: +(8 - Math.sin(i / 5) * 3 + Math.random()).toFixed(1),
}));

const SAMPLE_TABLE = [
  { query: 'best seo tools 2026', clicks: 2340, impressions: 18200, ctr: '12.9%', position: 3.2 },
  { query: 'website audit checklist', clicks: 1890, impressions: 14500, ctr: '13.0%', position: 5.1 },
  { query: 'page speed optimization', clicks: 1456, impressions: 22100, ctr: '6.6%', position: 7.4 },
  { query: 'internal linking strategy', clicks: 987, impressions: 8900, ctr: '11.1%', position: 12.3 },
  { query: 'schema markup generator', clicks: 654, impressions: 5600, ctr: '11.7%', position: 4.8 },
];

const NAV_ITEMS = [
  { icon: BarChart3, label: 'Overview', id: 'overview' },
  { icon: Search, label: 'Search Console', id: 'search' },
  { icon: Activity, label: 'Analytics', id: 'analytics' },
  { icon: Shield, label: 'SEO Audit', id: 'seo' },
  { icon: Gauge, label: 'Performance', id: 'performance' },
  { icon: Image, label: 'Media', id: 'media' },
  { icon: Pencil, label: 'Content Briefs', id: 'briefs' },
  { icon: CornerDownRight, label: 'Redirects', id: 'redirects' },
  { icon: Share2, label: 'Internal Links', id: 'links' },
  { icon: Code2, label: 'Schema', id: 'schema' },
  { icon: Settings, label: 'Settings', id: 'settings' },
];

export function Styleguide() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [dateRange, setDateRange] = useState(28);
  const [activeTab, setActiveTab] = useState('overview');
  const [showModal, setShowModal] = useState(false);
  const [showToast, setShowToast] = useState<'success' | 'error' | 'info' | null>(null);
  const [chartSelected, setChartSelected] = useState<number | null>(null);
  const [dualSelected, setDualSelected] = useState<number | null>(null);
  const [activeNav, setActiveNav] = useState('overview');

  return (
    <ErrorBoundary label="Style Guide">
    <div className={theme === 'light' ? 'dashboard-light' : ''} style={{ minHeight: '100vh', background: theme === 'light' ? '#f8fafc' : '#0f1219' }}>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Component Styleguide</h1>
            <p className="text-sm text-zinc-500 mt-1">All UI primitives in one place · Dark & Light mode</p>
          </div>
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>

        {/* ═══════════ TYPOGRAPHY ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Typography</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">DIN Pro · Stat Hero (34px)</span><div className="text-3xl font-bold text-zinc-100 mt-1">1,234,567</div></div>
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">DIN Pro · Stat Default (28px)</span><div className="text-2xl font-bold text-zinc-100 mt-1">45,678</div></div>
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">DIN Pro · Stat Compact (24px)</span><div className="text-xl font-bold text-zinc-100 mt-1">3,456</div></div>
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">DIN Pro · Page Title (18px)</span><div className="text-lg font-semibold text-zinc-200 mt-1">Page Title Example</div></div>
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Inter · Section Header (14px)</span><div className="text-sm font-medium text-zinc-300 mt-1">Section Header Example</div></div>
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Inter · Body (14px)</span><div className="text-sm text-zinc-400 mt-1">Body text uses Inter at 14px. This is the default for descriptions, paragraphs, and supporting content across the application.</div></div>
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">DIN Pro · Label (12px, uppercase)</span><div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mt-1">Uppercase Label Example</div></div>
            <div><span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Inter · Caption (12px)</span><div className="text-xs text-zinc-500 mt-1">Caption text · timestamps · metadata</div></div>
          </div>
        </section>

        {/* ═══════════ COLOR PALETTE ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Color Palette</h2>

          {/* Neutral scale */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-300">Neutral Scale</h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {NEUTRAL_SCALE.map(c => (
                <div key={c.name} className="text-center">
                  <div className="w-full h-12 rounded-lg border border-zinc-700" style={{ backgroundColor: c.hex }} />
                  <div className="text-[11px] text-zinc-400 mt-1 font-medium">{c.name}</div>
                  <div className="text-[11px] text-zinc-500">{c.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Accent colors */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-300">Accent Colors (WCAG AA ≥4.5:1)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {ACCENT_COLORS.map(c => (
                <div key={c.name} className="bg-zinc-900 rounded-xl border border-zinc-800 p-3 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg" style={{ backgroundColor: c.dark }} />
                    <div className="w-8 h-8 rounded-lg border border-zinc-700" style={{ backgroundColor: c.light }} />
                  </div>
                  <div className="text-xs font-medium text-zinc-300">{c.name}</div>
                  <div className="text-[11px] text-zinc-500">{c.ratio} on white</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ METRIC RINGS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">MetricRing</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <div className="flex items-end justify-around flex-wrap gap-6">
              <div className="text-center">
                <MetricRing score={95} size={120} />
                <div className="text-[11px] text-zinc-500 mt-2">Excellent (≥80)</div>
              </div>
              <div className="text-center">
                <MetricRing score={72} size={100} />
                <div className="text-[11px] text-zinc-500 mt-2">Good (60-79)</div>
              </div>
              <div className="text-center">
                <MetricRing score={45} size={80} />
                <div className="text-[11px] text-zinc-500 mt-2">Poor (&lt;60)</div>
              </div>
              <div className="text-center">
                <MetricRing score={88} size={48} />
                <div className="text-[11px] text-zinc-500 mt-2">Small</div>
              </div>
              <div className="text-center space-y-1">
                <div className="text-[11px] text-zinc-500">SVG variant (for tables)</div>
                <div className="flex items-center gap-3">
                  <MetricRingSvg score={91} size={44} strokeWidth={3.5} />
                  <MetricRingSvg score={67} size={44} strokeWidth={3.5} />
                  <MetricRingSvg score={38} size={44} strokeWidth={3.5} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ STAT CARDS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">StatCard</h2>

          {/* Default variant */}
          <h3 className="text-sm font-medium text-zinc-300">Default Variant</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Sessions" value="12,345" icon={Globe} iconColor="#60a5fa" sub="last 30 days" />
            <StatCard label="Clicks" value="3,456" icon={MousePointer} iconColor="#2dd4bf" />
            <StatCard label="Site Health" value="87" icon={Shield} iconColor="#34d399" valueColor="text-emerald-400" />
            <StatCard label="Avg Position" value="#4.2" icon={Target} iconColor="#fbbf24" sub="12 pages ranking" />
          </div>

          {/* With delta */}
          <h3 className="text-sm font-medium text-zinc-300">With Delta</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Users" value="8,901" icon={Users} iconColor="#60a5fa" delta={12} deltaLabel="%" />
            <StatCard label="Bounce Rate" value="42%" icon={TrendingUp} iconColor="#34d399" delta={-3} deltaLabel="%" />
            <StatCard label="Errors" value="5" icon={AlertTriangle} iconColor="#f87171" valueColor="text-red-400/80" />
            <StatCard label="Warnings" value="12" icon={Info} iconColor="#fbbf24" valueColor="text-amber-400/80" onClick={() => {}} />
          </div>

          {/* Compact variant */}
          <h3 className="text-sm font-medium text-zinc-300">Compact Variant (CompactStatBar)</h3>
          <CompactStatBar items={[
            { label: 'Clicks', value: '1,234', valueColor: 'text-blue-400' },
            { label: 'Impressions', value: '45,678', valueColor: 'text-teal-400' },
            { label: 'CTR', value: '3.2%', valueColor: 'text-emerald-400' },
            { label: 'Avg Position', value: '8.4', valueColor: 'text-amber-400' },
          ]} />
        </section>

        {/* ═══════════ PAGE HEADER ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">PageHeader</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
            <PageHeader
              title="Search Console"
              subtitle="https://example.com · Last 28 days"
              actions={
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors">
                  <Search className="w-3 h-3" /> Reanalyze
                </button>
              }
            />
            <div className="border-t border-zinc-800 pt-4">
              <PageHeader
                title="SEO Audit"
                subtitle="Scanned Mar 6, 2026 · 119 pages checked"
                icon={<Shield className="w-5 h-5 text-teal-400" />}
              />
            </div>
          </div>
        </section>

        {/* ═══════════ SECTION CARD ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">SectionCard</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard
              title="Top Pages"
              titleIcon={<BarChart3 className="w-4 h-4 text-zinc-500" />}
              action={<button className="text-xs text-teal-400 hover:text-teal-300">View all</button>}
            >
              <DataList items={[
                { label: '/blog/seo-guide', value: '1,234' },
                { label: '/pricing', value: '987' },
                { label: '/about', value: '654' },
                { label: '/contact', value: '432' },
                { label: '/features/analytics', value: '321' },
              ]} />
            </SectionCard>

            <SectionCard title="Traffic Sources" titleIcon={<Globe className="w-4 h-4 text-zinc-500" />}>
              <DataList items={[
                { label: 'Organic Search', value: '45%', valueColor: 'text-emerald-400' },
                { label: 'Direct', value: '28%', valueColor: 'text-blue-400' },
                { label: 'Social', value: '15%', valueColor: 'text-amber-400' },
                { label: 'Referral', value: '12%', valueColor: 'text-teal-400' },
              ]} ranked={false} />
            </SectionCard>
          </div>
        </section>

        {/* ═══════════ DATE RANGE SELECTOR ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">DateRangeSelector</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Short Presets</div>
              <DateRangeSelector options={DATE_PRESETS_SHORT} selected={dateRange} onChange={setDateRange} />
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Full Presets</div>
              <DateRangeSelector options={DATE_PRESETS_FULL} selected={dateRange} onChange={setDateRange} />
            </div>
          </div>
        </section>

        {/* ═══════════ TAB BAR ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">TabBar</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            {/* tab-deeplink-ok — styleguide TabBar is for demonstration only, no deep-linking needed */}
            <TabBar
              tabs={[
                { id: 'overview', label: 'Overview', icon: BarChart3 },
                { id: 'search', label: 'Search', icon: Search },
                { id: 'health', label: 'Site Health', icon: Shield },
                { id: 'speed', label: 'Page Speed', icon: Gauge },
              ]}
              active={activeTab}
              onChange={setActiveTab}
            />
            <div className="mt-4 text-xs text-zinc-500">Active tab: <span className="text-teal-400 font-medium">{activeTab}</span></div>
          </div>
        </section>

        {/* ═══════════ BADGES ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Badge</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex flex-wrap gap-2">
              <Badge label="Teal" color="teal" />
              <Badge label="Blue" color="blue" />
              <Badge label="Emerald" color="emerald" />
              <Badge label="Green" color="green" />
              <Badge label="Amber" color="amber" />
              <Badge label="Red" color="red" />
              <Badge label="Orange" color="orange" />
              <Badge label="Purple" color="purple" />
              <Badge label="Zinc (muted)" color="zinc" />
            </div>
          </div>
        </section>

        {/* ═══════════ EMPTY STATE ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">EmptyState</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800">
              <EmptyState
                icon={Search}
                title="No search data available"
                description="Connect Google Search Console to see keyword rankings, clicks, and impressions."
              />
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800">
              <EmptyState
                icon={Lock}
                title="Feature not configured"
                description={`This module needs to be enabled by ${STUDIO_NAME}.`}
                action={<button className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-xs font-medium hover:from-teal-500 hover:to-emerald-500 transition-all">Request Access</button>}
              />
            </div>
          </div>
        </section>

        {/* ═══════════ BUTTONS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Buttons</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Primary</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium transition-all shadow-lg shadow-teal-900/20">Run Audit</button>
                <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium transition-all">
                  <Zap className="w-3.5 h-3.5" /> Generate Brief
                </button>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Secondary</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors">Rescan</button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors">
                  <FileText className="w-3 h-3" /> Export
                </button>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Ghost</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="px-2 py-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 text-xs font-medium transition-colors">Cancel</button>
                <button className="px-2 py-1 rounded-md text-teal-400 hover:bg-zinc-800 text-xs font-medium transition-colors">View all</button>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Action Pills</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors">Start</button>
                <button className="px-2 py-1 rounded bg-green-600/20 border border-green-500/30 text-[11px] text-green-300 hover:bg-green-600/30 transition-colors">Approve</button>
                <button className="px-2 py-1 rounded bg-cyan-600/20 border border-cyan-500/30 text-[11px] text-cyan-300 hover:bg-cyan-600/30 transition-colors">Send to Client</button>
                <button className="px-2 py-1 rounded bg-orange-600/20 border border-orange-500/30 text-[11px] text-orange-300 hover:bg-orange-600/30 transition-colors">Request Changes</button>
                <button className="px-2 py-1 rounded bg-zinc-800 text-[11px] text-zinc-500 hover:text-red-400 transition-colors">Decline</button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ DATA LIST ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">DataList</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Ranked List" titleIcon={<BarChart3 className="w-4 h-4 text-zinc-500" />}>
              <DataList items={[
                { label: 'best seo tools 2026', value: '2,340', sub: '#3.2' },
                { label: 'website audit checklist', value: '1,890', sub: '#5.1' },
                { label: 'page speed optimization', value: '1,456', sub: '#7.4' },
                { label: 'internal linking strategy', value: '987', sub: '#12.3' },
                { label: 'schema markup generator', value: '654', sub: '#4.8' },
              ]} />
            </SectionCard>
            <SectionCard title="Unranked List" titleIcon={<Activity className="w-4 h-4 text-zinc-500" />}>
              <DataList ranked={false} items={[
                { label: 'Organic Search', value: '45.2%', valueColor: 'text-emerald-400' },
                { label: 'Direct Traffic', value: '28.1%', valueColor: 'text-blue-400' },
                { label: 'Social Media', value: '15.3%', valueColor: 'text-amber-400' },
                { label: 'Referral', value: '8.7%', valueColor: 'text-teal-400' },
                { label: 'Email', value: '2.7%', valueColor: 'text-red-400' },
              ]} />
            </SectionCard>
          </div>
        </section>

        {/* ═══════════ SCORE COLOR FUNCTION ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">scoreColor() Utility</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center gap-4 flex-wrap">
              {[95, 85, 75, 65, 55, 45, 35, 25, 15].map(score => (
                <div key={score} className="text-center">
                  <div className="text-xl font-bold" style={{ color: scoreColor(score) }}>{score}</div>
                  <div className="text-[11px] text-zinc-500">{scoreColor(score)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ LINE / AREA CHARTS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Line / Area Charts</h2>

          {/* Single trend */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-300">Single Trend (TrendChart)</h3>
            <SectionCard title="Clicks Trend" titleIcon={<TrendingUp className="w-4 h-4 text-zinc-500" />}>
              {(() => {
                const data = SAMPLE_TREND;
                const values = data.map(d => d.clicks);
                const max = Math.max(...values), min = Math.min(...values), range = max - min || 1, w = 100;
                const coords = values.map((v, i) => ({ x: (i / (values.length - 1)) * w, y: 100 - ((v - min) / range) * 90 - 5 }));
                const points = coords.map(p => `${p.x},${p.y}`).join(' ');
                const bandW = w / data.length;
                return (
                  <div className="relative" onMouseLeave={() => setChartSelected(null)}>
                    <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 100 }} preserveAspectRatio="none">
                      <defs><linearGradient id="sg-cg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity="0.2" /><stop offset="100%" stopColor="#60a5fa" stopOpacity="0" /></linearGradient></defs>
                      <polygon fill="url(#sg-cg1)" points={`0,100 ${points} ${w},100`} />
                      <polyline fill="none" stroke="#60a5fa" strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                      {coords.map((p, i) => (
                        <rect key={i} x={p.x - bandW / 2} y={0} width={bandW} height={100} fill="transparent" className="cursor-pointer" onMouseEnter={() => setChartSelected(i)} />
                      ))}
                      {chartSelected !== null && coords[chartSelected] && (
                        <>
                          <line x1={coords[chartSelected].x} y1={0} x2={coords[chartSelected].x} y2={100} stroke="#60a5fa" strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
                          <circle cx={coords[chartSelected].x} cy={coords[chartSelected].y} r="3" fill="#60a5fa" stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                        </>
                      )}
                    </svg>
                    {chartSelected !== null && data[chartSelected] && (
                      <ChartPointDetail
                        date={data[chartSelected].date}
                        xPct={(chartSelected / (data.length - 1)) * 100}
                        onClose={() => setChartSelected(null)}
                        metrics={[
                          { label: 'Clicks', value: data[chartSelected].clicks, color: '#60a5fa' },
                          { label: 'Impressions', value: data[chartSelected].impressions, color: '#2dd4bf' },
                          { label: 'CTR', value: `${data[chartSelected].ctr}%`, color: '#34d399' },
                          { label: 'Position', value: data[chartSelected].position, color: '#fbbf24' },
                        ]}
                      />
                    )}
                  </div>
                );
              })()}
            </SectionCard>
          </div>

          {/* Dual trend */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-300">Dual Trend (DualTrendChart)</h3>
            <SectionCard title="Clicks & Impressions" titleIcon={<BarChart3 className="w-4 h-4 text-zinc-500" />}>
              {(() => {
                const data = SAMPLE_TREND;
                const clicks = data.map(d => d.clicks), imps = data.map(d => d.impressions);
                const cMax = Math.max(...clicks), cMin = Math.min(...clicks), cRange = cMax - cMin || 1;
                const iMax = Math.max(...imps), iMin = Math.min(...imps), iRange = iMax - iMin || 1;
                const w = 100;
                const cCoords = clicks.map((v, i) => ({ x: (i / (clicks.length - 1)) * w, y: 100 - ((v - cMin) / cRange) * 85 - 7 }));
                const iCoords = imps.map((v, i) => ({ x: (i / (imps.length - 1)) * w, y: 100 - ((v - iMin) / iRange) * 85 - 7 }));
                const cPoints = cCoords.map(p => `${p.x},${p.y}`).join(' ');
                const iPoints = iCoords.map(p => `${p.x},${p.y}`).join(' ');
                const bandW = w / data.length;
                return (
                  <div className="relative" onMouseLeave={() => setDualSelected(null)}>
                    <div className="flex items-center gap-4 mb-2">
                      <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-blue-400" /><span className="text-[11px] text-blue-400">Clicks</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-teal-400" /><span className="text-[11px] text-teal-400">Impressions</span></div>
                    </div>
                    <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="sg-cg-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity="0.15" /><stop offset="100%" stopColor="#60a5fa" stopOpacity="0" /></linearGradient>
                        <linearGradient id="sg-cg-i" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.1" /><stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" /></linearGradient>
                      </defs>
                      <polygon fill="url(#sg-cg-i)" points={`0,100 ${iPoints} ${w},100`} />
                      <polyline fill="none" stroke="#2dd4bf" strokeWidth="1.2" points={iPoints} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeOpacity="0.6" />
                      <polygon fill="url(#sg-cg-c)" points={`0,100 ${cPoints} ${w},100`} />
                      <polyline fill="none" stroke="#60a5fa" strokeWidth="1.5" points={cPoints} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                      {cCoords.map((p, i) => (
                        <rect key={i} x={p.x - bandW / 2} y={0} width={bandW} height={100} fill="transparent" className="cursor-pointer" onMouseEnter={() => setDualSelected(i)} />
                      ))}
                      {dualSelected !== null && cCoords[dualSelected] && (
                        <>
                          <line x1={cCoords[dualSelected].x} y1={2} x2={cCoords[dualSelected].x} y2={98} stroke="#a1a1aa" strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
                          <circle cx={cCoords[dualSelected].x} cy={cCoords[dualSelected].y} r="3" fill="#60a5fa" stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                          <circle cx={iCoords[dualSelected].x} cy={iCoords[dualSelected].y} r="3" fill="#2dd4bf" stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                        </>
                      )}
                    </svg>
                    {dualSelected !== null && data[dualSelected] && (
                      <ChartPointDetail
                        date={data[dualSelected].date}
                        xPct={(dualSelected / (data.length - 1)) * 100}
                        onClose={() => setDualSelected(null)}
                        metrics={[
                          { label: 'Clicks', value: data[dualSelected].clicks, color: '#60a5fa' },
                          { label: 'Impressions', value: data[dualSelected].impressions, color: '#2dd4bf' },
                          { label: 'CTR', value: `${data[dualSelected].ctr}%`, color: '#34d399' },
                          { label: 'Position', value: data[dualSelected].position, color: '#fbbf24' },
                        ]}
                      />
                    )}
                  </div>
                );
              })()}
            </SectionCard>
          </div>
        </section>

        {/* ═══════════ CHART POINT DETAIL ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">ChartPointDetail (Popover)</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <p className="text-xs text-zinc-400 mb-4">Click any point on the chart above to see the ChartPointDetail popover. Here is a static preview:</p>
            <div className="relative h-20">
              <ChartPointDetail
                date="Feb 15, 2026"
                xPct={30}
                onClose={() => {}}
                metrics={[
                  { label: 'Clicks', value: 1234, color: '#60a5fa' },
                  { label: 'Impressions', value: 45678, color: '#2dd4bf' },
                  { label: 'CTR', value: '2.7%', color: '#34d399' },
                  { label: 'Position', value: 6.2, color: '#fbbf24' },
                ]}
              />
            </div>
          </div>
        </section>

        {/* ═══════════ TABLES ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Tables</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-3 px-4 text-zinc-500 font-medium">Query</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">Clicks</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">Impressions</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">CTR</th>
                  <th className="text-right py-3 px-3 text-zinc-500 font-medium">Position</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_TABLE.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-2.5 px-4 text-zinc-300 font-medium">{row.query}</td>
                    <td className="py-2.5 px-3 text-right text-blue-400 tabular-nums">{row.clicks.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-zinc-400 tabular-nums">{row.impressions.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400 tabular-nums">{row.ctr}</td>
                    <td className="py-2.5 px-3 text-right text-amber-400 tabular-nums">{row.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ═══════════ MODALS / DIALOGS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Modal / Dialog</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <button onClick={() => setShowModal(true)} className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium transition-all">
              Open Modal
            </button>
          </div>
          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
              <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full mx-4 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="w-14 h-14 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-7 h-7 text-teal-400" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-100 mb-2">Premium Feature</h3>
                <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                  This is the standard modal pattern used for upgrade prompts, confirmations, and pricing flows throughout the application.
                </p>
                <div className="space-y-2 text-left mb-6">
                  {['Feature benefit one', 'Feature benefit two', 'Feature benefit three'].map(f => (
                    <div key={f} className="flex items-center gap-2 text-xs text-zinc-300">
                      <CheckCircle className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors">
                  Got It
                </button>
                <button onClick={() => setShowModal(false)} className="block mx-auto mt-3 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
                  Maybe later
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ═══════════ TOAST NOTIFICATIONS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Toast Notifications</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowToast('success')} className="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-xs text-emerald-300 font-medium">Success Toast</button>
              <button onClick={() => setShowToast('error')} className="px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-500/30 text-xs text-red-300 font-medium">Error Toast</button>
              <button onClick={() => setShowToast('info')} className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-xs text-blue-300 font-medium">Info Toast</button>
            </div>

            {/* Static previews */}
            <div className="space-y-2">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Static Previews</div>
              {([
                { type: 'success' as const, icon: <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />, border: 'border-emerald-500/20', msg: 'Audit completed successfully — 119 pages scanned.' },
                { type: 'error' as const, icon: <AlertTriangle className="w-4 h-4 text-red-400/80 shrink-0" />, border: 'border-red-500/20', msg: 'Failed to connect to Search Console. Please try again.' },
                { type: 'info' as const, icon: <Info className="w-4 h-4 text-blue-400 shrink-0" />, border: 'border-blue-500/20', msg: 'Schema changes pushed to 12 pages.' },
              ]).map(t => (
                <div key={t.type} className={`flex items-center gap-2.5 px-4 py-3 rounded-xl bg-zinc-900 border ${t.border} shadow-2xl shadow-black/40 text-sm text-zinc-200`}>
                  {t.icon}
                  <span className="text-xs">{t.msg}</span>
                  <button className="ml-auto text-zinc-500 hover:text-zinc-400 transition-colors"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>

            {/* Inline toast (ClientDashboard style) */}
            <div className="space-y-2">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Inline Toast (Client Dashboard)</div>
              <div className="px-5 py-3 rounded-xl border shadow-lg bg-emerald-500/15 border-emerald-500/30 text-emerald-300 flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-medium">Brief approved! {STUDIO_NAME} will begin content production.</span>
                <button className="ml-auto text-zinc-400 hover:text-zinc-200"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>

          {/* Live toast */}
          {showToast && (
            <div className="fixed bottom-4 right-4 z-[200] pointer-events-auto">
              <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl bg-zinc-900 border shadow-2xl shadow-black/40 text-sm text-zinc-200 ${showToast === 'success' ? 'border-emerald-500/20' : showToast === 'error' ? 'border-red-500/20' : 'border-blue-500/20'}`}>
                {showToast === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                {showToast === 'error' && <AlertTriangle className="w-4 h-4 text-red-400/80" />}
                {showToast === 'info' && <Info className="w-4 h-4 text-blue-400" />}
                <span className="text-xs">This is a {showToast} toast notification.</span>
                <button onClick={() => setShowToast(null)} className="ml-1 text-zinc-500 hover:text-zinc-400"><X className="w-3 h-3" /></button>
              </div>
            </div>
          )}
        </section>

        {/* ═══════════ FORM INPUTS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Form Inputs</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Text Input</div>
              <input type="text" placeholder="Enter a keyword to track..." className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Input with Icon + Button</div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input type="text" placeholder="Search pages..." className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
                </div>
                <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-colors">
                  <Search className="w-3 h-3" /> Search
                </button>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Textarea</div>
              <textarea placeholder="Add notes or context for this topic... (optional)" rows={3} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Select / Dropdown</div>
                <div className="relative">
                  <select className="w-full appearance-none px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 pr-8">
                    <option>All Pages</option>
                    <option>Top 10</option>
                    <option>Errors Only</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Segmented Toggle</div>
                <div className="flex items-center gap-0">
                  <button className="flex-1 px-3 py-2 rounded-l-lg border border-zinc-800 bg-teal-600/20 border-teal-500/40 text-xs font-medium text-teal-300">Brief</button>
                  <button className="flex-1 px-3 py-2 rounded-r-lg border border-zinc-800 bg-zinc-950 text-xs font-medium text-zinc-500 hover:border-zinc-700">Full Post</button>
                </div>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Submit Row</div>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-colors">
                  <Send className="w-3.5 h-3.5" /> Submit
                </button>
                <button className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ LOADING / SPINNERS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Loading States</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="text-center space-y-2">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Page Loading</div>
                <div className="flex flex-col items-center justify-center py-6 gap-3 text-zinc-500">
                  <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
                  <p className="text-xs">Loading data...</p>
                </div>
              </div>
              <div className="text-center space-y-2">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Inline Spinner</div>
                <div className="flex items-center justify-center gap-2 py-6">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                  <span className="text-xs text-zinc-400">Refreshing...</span>
                </div>
              </div>
              <div className="text-center space-y-2">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Button Loading</div>
                <div className="flex items-center justify-center py-6">
                  <button disabled className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 text-white text-xs font-medium opacity-50">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Submitting...
                  </button>
                </div>
              </div>
              <div className="text-center space-y-2">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Chat Typing</div>
                <div className="flex items-center justify-center py-6">
                  <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ PROGRESS BARS ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Progress Bars</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-5">
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Action Items Progress (segmented)</div>
              <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-zinc-800">
                <div className="bg-green-500 rounded-full" style={{ width: '45%' }} />
                <div className="bg-blue-500 rounded-full" style={{ width: '20%' }} />
              </div>
              <div className="flex items-center gap-4 mt-2">
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> <span className="text-zinc-400">Done (9)</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> <span className="text-zinc-400">In Progress (4)</span></span>
                <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full bg-zinc-700 inline-block" /> <span className="text-zinc-400">Planned (7)</span></span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Severity Breakdown</div>
              <div className="space-y-2">
                {[
                  { label: 'Errors', count: 5, total: 119, color: 'bg-red-500' },
                  { label: 'Warnings', count: 12, total: 119, color: 'bg-amber-500' },
                  { label: 'Passed', count: 102, total: 119, color: 'bg-emerald-500' },
                ].map(bar => (
                  <div key={bar.label} className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400 w-16">{bar.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${(bar.count / bar.total) * 100}%` }} />
                    </div>
                    <span className="text-xs text-zinc-500 tabular-nums w-8 text-right">{bar.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Bulk Operation</div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full bg-teal-500 transition-all duration-300" style={{ width: '65%' }} />
                </div>
                <span className="text-xs text-zinc-400 tabular-nums">13/20</span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ SIDEBAR NAVIGATION ═══════════ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Sidebar Navigation</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="w-56 py-2">
              {NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveNav(item.id)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-teal-500/10 text-teal-300 border-l-2 border-teal-400'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border-l-2 border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
              <div className="border-t border-zinc-800 mt-2 pt-2 px-4 py-2">
                <button className="flex items-center gap-2.5 text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors">
                  <Clipboard className="w-4 h-4" /> Task Panel
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center py-8 border-t border-zinc-800">
          <p className="text-xs text-zinc-500">{STUDIO_NAME} Design System · {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
