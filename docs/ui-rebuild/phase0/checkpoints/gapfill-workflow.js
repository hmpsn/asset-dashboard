export const meta = {
  name: 'ui-rebuild-phase0-gapfill',
  description: 'Resume Phase 0 audits (round 2): 7 missing auditors + 1 persona + all downstream stages',
  phases: [
    { title: 'Backfill', detail: '4 surfaces + 3 cross-cutting + 1 persona' },
    { title: 'Verify', detail: 'adversarial verification: 282 recovered + new at-risk claims' },
    { title: 'Strategy', detail: 'implementation approach, trade-offs, deferred tracking' },
    { title: 'Synthesize', detail: 'design-review validation + audit document' },
  ],
}

const REPO = '/Users/joshuahampson/CascadeProjects/asset-dashboard'
const KIT = REPO + '/hmpsn studio Design System'
const OUT = 'docs/ui-rebuild/phase0'
const DR = OUT + '/design-review'
const CKPT = OUT + '/checkpoints'
const DATE = args.date
const DISCOVERY = 'docs/superpowers/specs/2026-06-20-the-issue-client-discovery-spec.md'
const PRIOR_VERDICTS = 'docs/superpowers/audits/2026-06-20-the-issue-client-p0-persona-review.verdicts.json'

// ============ shared preambles (identical to the original runs) ============
const PRE = [
  'You are a READ-ONLY auditor for the hmpsn.studio UI rebuild, Phase 0 (additive-parity functionality audit), ' + DATE + '.',
  'Repo: ' + REPO + ' (branch ui-rebuild-phase-0 == post-Reconcile origin/staging HEAD). The UI Rebuild Kit lives at "' + KIT + '" — HTML docs; extract readable text with: textutil -convert txt -stdout "<file>" (quote paths, they contain spaces).',
  'MANDATE: the rebuild is ADDITIVE-ONLY. Every capability that exists at HEAD must survive unchanged or improved. Your job is to PROVE what exists, not to decide what to keep. Losing a function by omission is a hard stop.',
  'HARD RULES:',
  '1. NEVER run any git command (no status/add/commit/stash — nothing). Other sessions share this checkout.',
  '2. Write ONLY your single assigned output file. Everything else is strictly read-only.',
  '3. Every claim needs evidence: file:line. Never assert from memory — verify in code.',
  '4. Ambiguity or a capability with no clear home -> record it as a stopAndAsk question. NEVER decide unilaterally, never drop by omission, never invent a home.',
  '5. FEATURE_AUDIT.md is 8700 lines — grep for your surface terms, do not read it whole.',
  '6. Useful sources: src/routes.ts (Page/ClientTab unions), src/lib/navRegistry.tsx, src/components/, src/hooks/, server/routes/, shared/types/, "' + KIT + '/Platform Parity Ledger.html", "' + KIT + '/UI Rebuild Handoff Brief.html".',
].join('\n')

const DPRE = [
  'You are part of an ADVISORY design review of the proposed hmpsn.studio platform rebuild (' + DATE + '). No code changes ever — findings only.',
  'Repo: ' + REPO + '. The UI Rebuild Kit (the proposed new platform) lives at "' + KIT + '" — the hi-fi prototype is mockup/*.js view modules; HTML docs extract with: textutil -convert txt -stdout "<file>" (quote paths).',
  'The question under review: is this new platform design the RIGHT build for hmpsn.studio (a solo-founder SEO/web-analytics agency), and is its UI/UX sound for admins and clients?',
  'HARD RULES: (1) NEVER run any git command. (2) Write ONLY your single assigned output file if you have one; otherwise write nothing. (3) Ground every claim in something you actually read (file + section). (4) Honest signal over politeness — flattering reviews are worthless.',
].join('\n')

// ============ schemas (identical to original runs) ============
const SURFACE_SCHEMA = {
  type: 'object',
  required: ['surface', 'capabilityCount', 'statusCounts', 'atRisk', 'stopAndAsk', 'quickWinTradeoffs', 'ledgerFile'],
  properties: {
    surface: { type: 'string' },
    zone: { type: 'string' },
    currentRoutes: { type: 'array', items: { type: 'string' } },
    capabilityCount: { type: 'number' },
    statusCounts: { type: 'object', required: ['preserved', 'improved', 'new_proposed', 'at_risk'], properties: {
      preserved: { type: 'number' }, improved: { type: 'number' }, new_proposed: { type: 'number' }, at_risk: { type: 'number' } } },
    atRisk: { type: 'array', items: { type: 'object', required: ['capability', 'evidence', 'why'], properties: {
      capability: { type: 'string' }, evidence: { type: 'string' }, why: { type: 'string' }, proposedHome: { type: 'string' } } } },
    stopAndAsk: { type: 'array', items: { type: 'object', required: ['question'], properties: {
      question: { type: 'string' }, context: { type: 'string' }, options: { type: 'string' } } } },
    parityLedgerGaps: { type: 'array', items: { type: 'string' } },
    quickWinTradeoffs: { type: 'array', items: { type: 'object', required: ['item', 'quickWin', 'fullVersion'], properties: {
      item: { type: 'string' }, quickWin: { type: 'string' }, fullVersion: { type: 'string' }, risk: { type: 'string' } } } },
    prototypeViewRead: { type: 'string' },
    ledgerFile: { type: 'string' },
  },
}

const CROSS_SCHEMA = {
  type: 'object',
  required: ['topic', 'keyFindings', 'recommendations', 'stopAndAsk', 'ledgerFile'],
  properties: {
    topic: { type: 'string' },
    keyFindings: { type: 'array', items: { type: 'object', required: ['finding', 'evidence', 'severity'], properties: {
      finding: { type: 'string' }, evidence: { type: 'string' }, severity: { enum: ['critical', 'important', 'note'] } } } },
    recommendations: { type: 'array', items: { type: 'string' } },
    stopAndAsk: { type: 'array', items: { type: 'object', required: ['question'], properties: {
      question: { type: 'string' }, context: { type: 'string' }, options: { type: 'string' } } } },
    ledgerFile: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', required: ['verdicts'],
  properties: { verdicts: { type: 'array', items: { type: 'object', required: ['claim', 'verdict', 'evidence'], properties: {
    claim: { type: 'string' }, verdict: { enum: ['CONFIRMED', 'REFUTED', 'UNCERTAIN'] }, evidence: { type: 'string' }, note: { type: 'string' } } } } },
}

const PERSONA_SCHEMA = {
  type: 'object',
  required: ['persona', 'resolved', 'stillMissing', 'distrustTriggers', 'builtToMySpec', 'matters', 'verbatim'],
  properties: {
    persona: { type: 'string' },
    resolved: { type: 'array', items: { type: 'string' } },
    stillMissing: { type: 'array', items: { type: 'string' } },
    distrustTriggers: { type: 'array', items: { type: 'string' } },
    wouldImprove: { type: 'array', items: { type: 'string' } },
    builtToMySpec: { enum: ['fully', 'partially', 'no'] },
    matters: { enum: ['a lot', 'somewhat', 'blocker', 'not really'] },
    verbatim: { type: 'string' },
  },
}

const STRATEGY_SCHEMA = {
  type: 'object',
  required: ['buildSequence', 'topTradeoffs', 'deferredTrackingDesign', 'consistencyAuditorDesign', 'successRecommendations', 'risks', 'ledgerFile'],
  properties: {
    buildSequence: { type: 'array', items: { type: 'string' } },
    topTradeoffs: { type: 'array', items: { type: 'object', required: ['item', 'quickWin', 'fullVersion', 'recommendation'], properties: {
      item: { type: 'string' }, quickWin: { type: 'string' }, fullVersion: { type: 'string' }, recommendation: { type: 'string' }, upgradeTrigger: { type: 'string' } } } },
    deferredTrackingDesign: { type: 'string' },
    consistencyAuditorDesign: { type: 'string' },
    successRecommendations: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    ledgerFile: { type: 'string' },
  },
}

const SYNTH_SCHEMA = {
  type: 'object', required: ['headline', 'launchBlockers', 'perPersonaVerdicts', 'topRecommendations', 'fastFollows', 'auditDocPath'],
  properties: {
    headline: { type: 'string' },
    isRightBuild: { type: 'string' },
    launchBlockers: { type: 'array', items: { type: 'object', required: ['issue', 'raisedBy'], properties: {
      issue: { type: 'string' }, raisedBy: { type: 'array', items: { type: 'string' } }, validation: { type: 'string' } } } },
    perPersonaVerdicts: { type: 'array', items: { type: 'object', required: ['persona', 'builtToMySpec', 'matters'], properties: {
      persona: { type: 'string' }, builtToMySpec: { type: 'string' }, matters: { type: 'string' }, verbatim: { type: 'string' } } } },
    topRecommendations: { type: 'array', items: { type: 'string' } },
    fastFollows: { type: 'array', items: { type: 'string' } },
    auditDocPath: { type: 'string' },
  },
}

// ============ the 4 missing surfaces (defs identical to original run) ============
const SURFACES = [
  { id: 'brand-ai', name: 'Brand & AI', zone: 'Optimization', heads: "Page 'brand' (Copy & Brand Engine: brandscript, voice calibration, deliverables)", mockups: 'brand.js, brand-flows.js, brand-modal.js' },
  { id: 'recommendations', name: 'Recommendations', zone: 'Client-facing', heads: 'Strategy v3 recommendation lifecycle — admin curation + client delivery (docs/rules/strategy-recommendations.md)', mockups: 'recs.js' },
  { id: 'client-portal', name: 'Client portal', zone: 'Client-facing', heads: "ALL 14 ClientTabs in src/routes.ts ('overview'...'settings') + Inbox filters + The Issue feed. src/components/client/, src/hooks/client/", mockups: 'portal.js' },
  { id: 'global-ops', name: 'Global & Ops pages (NOT in the surface map — parity risk)', zone: 'UNMAPPED', heads: "Pages 'settings', 'workspace-settings', 'roadmap', 'prospect', 'revenue', 'features', 'ai-usage', 'outcomes', 'outcomes-overview', 'diagnostics', 'requests', 'brief' + onboarding flows. The prototype has settings.js/wsettings.js/roadmap.js/outcomes.js/business.js/onboard.js/requests.js/diagnostics.js views but the Handoff Brief's 18-surface map omits these entirely — every capability here is at risk of loss by omission. Flag surface-level homes as stopAndAsk.", mockups: 'settings.js, wsettings.js, roadmap.js, outcomes.js, business.js, onboard.js, requests.js, diagnostics.js' },
]

function surfacePrompt(s) {
  return [PRE, '',
    'YOUR SURFACE: ' + s.name + ' — zone: ' + s.zone,
    'Likely HEAD entry points: ' + s.heads,
    'Prototype view(s): "' + KIT + '/mockup/" -> ' + s.mockups + ' (JS view modules — read them raw; they render the hi-fi prototype)',
    '',
    'TASKS (in order):',
    '1. ENUMERATE every capability this surface supports at HEAD: user actions, CRUD, filters/sorts/lenses, data displayed, states (empty/loading/error/locked), tier gates, permissions, ?tab= deep links, WebSocket-driven updates, background jobs, AI operations, exports, settings. Evidence = file:line for each. Cross-check FEATURE_AUDIT.md (grep) and the Platform Parity Ledger rows for your surface.',
    '2. READ your prototype view(s). Note which capabilities the prototype demonstrates, which it omits, and any NEW functionality it proposes that HEAD lacks.',
    '3. MARK every capability: preserved (has an obvious home, same or better) / improved (prototype upgrades it) / new_proposed (prototype-only, needs sign-off) / at_risk (exists at HEAD, no visible home). Uncertain = at_risk, never preserved.',
    '4. RECONCILE the Parity Ledger: list any Gap/Partial rows for your surface and whether they now resolve.',
    '5. TRADE-OFFS: identify quick-win vs full implementations for this surface (what could ship simpler first, the upgrade path, the risk of the quick win).',
    '6. WRITE your full ledger to ' + OUT + '/surfaces/' + s.id + '.md (relative to repo root) — capability table (capability | evidence | status | home in new IA | notes), prototype coverage notes, parity reconciliation, trade-offs, open questions. This is the ONLY file you may write.',
    'Return the structured summary (keep atRisk/stopAndAsk complete — they drive verification and owner sign-off; keep everything else compact).',
  ].join('\n')
}

// ============ the 3 missing cross-cutting auditors (defs identical to original run) ============
const CROSS = [
  { id: 'design-system', label: 'cross:design-system', prompt: [PRE, '',
    'TOPIC: Design-system wiring readiness — can the kit components actually become the production UI?',
    '1. Inventory the kit: "' + KIT + '/components/", _ds_manifest.json, readme.md, styles.css, tokens/, templates/app-page/, _ds_bundle.js (how components mount — window.HmpsnStudioDesignSystem_09a9e3), _adherence.oxlintrc.json (what it enforces). Do components ship .d.ts prop contracts as the Handoff Brief claims? What framework are they (vanilla/web components/React)?',
    '2. INTEGRATION PATH: the repo is React 19 + Vite + Tailwind 4. Name the concrete options for getting 59 kit components into src/ (port to React components / wrap the bundle / regenerate from spec), with effort + risk each. This is the single biggest open technical question — be thorough.',
    '3. TOKEN DRIFT: diff the kit token vocabulary (--brand-mint? DIN Pro/Inter? spacing/type scales) against HEAD src/tokens.css + .t-* classes + BRAND_DESIGN_LANGUAGE.md ("teal for actions"). Name every drift explicitly — mint-vs-teal, typefaces, surface scales, z-index. Does .dashboard-light exist at HEAD or is light theme net-new?',
    '4. Map kit components onto existing src/components/ui/ primitives (SectionCard vs Card, StatCard vs MetricTile, DataList vs DataTable...) — which existing primitives survive, which are replaced, which kit components have no HEAD counterpart.',
    'Write full findings to ' + OUT + '/cross-design-system.md (your ONLY writable file).'].join('\n') },
  { id: 'platform', label: 'cross:platform', prompt: [PRE, '',
    'TOPIC: Cross-cutting platform readiness — shell, nav, URL state, theming, data layer.',
    '1. NAV: src/lib/navRegistry.tsx at HEAD vs the prototype two-zone rail ("' + KIT + '/mockup/nav.js", app.js). Map old nav ids to the new zones; list every consolidation (2-to-1, 3-to-1) and every HEAD nav entry with no home in the prototype rail.',
    '2. URL STATE: the ?tab= two-halves contract, deep links, adminPath/clientPath — what the rebuild must preserve (tests: tests/contract/tab-deep-link-wiring.test.ts).',
    '3. THEMING: does HEAD ship a light theme (.dashboard-light) anywhere? What would both-themes-from-first-commit require given src/tokens.css today?',
    '4. DATA LAYER: the React Query + useWorkspaceEvents invalidation pattern every surface must keep (broadcast -> invalidate contract, ws-events.ts), query key conventions, the intelligence-slice reads. What does a rebuilt surface have to wire to not regress live updates?',
    '5. FLAGS: active feature flags in shared/types/feature-flags.ts that gate UI surfaces — which does the rebuild have to respect/retire (client shell flags were deliberately kept for this rebuild).',
    'Write full findings to ' + OUT + '/cross-platform.md (your ONLY writable file).'].join('\n') },
  { id: 'consistency', label: 'cross:consistency', prompt: [PRE, '',
    'TOPIC: Build-consistency enforcement + deferred-work tracking — design the machinery that keeps an 18-surface parallel rebuild consistent.',
    '1. Study scripts/pr-check.ts (CHECKS array architecture, escape hatches, docs/rules/pr-check-rule-authoring.md) and existing CI gates (typecheck, vite build, vitest, lint:hooks, verify:feature-flags, coverage ratchet).',
    '2. Study the kit _adherence.oxlintrc.json — what it enforces, whether it can run in this repo CI as-is.',
    '3. DESIGN the consistency auditor: (a) mechanized layer — concrete new pr-check rules / lint configs for the rebuild (tokens-only styling, no raw hex, no reinvented primitives, both-themes, component-prop conformance), each named with its detection pattern; (b) agentic layer — a recurring multi-agent consistency review (cadence, scope, what it checks that lint cannot: visual drift, primitive divergence, prototype fidelity); (c) where the definition-of-done gates from "' + KIT + '/Build Conventions.html" plug into CI.',
    '4. DESIGN deferred/followup tracking: every quick-win trade-off and deferred upgrade needs a durable home — propose the ledger format (file, fields: item/decision/upgrade-trigger/owner/status), how it integrates with data/roadmap.json, and the review cadence so deferreds do not rot.',
    'Write the design to ' + OUT + '/cross-consistency.md (your ONLY writable file).'].join('\n') },
]

// ============ the 1 still-missing persona (dentist/saas/hvac + schema summary recovered in round 1) ============
const PERSONAS = [
  { key: 'multi-location', role: 'Multi-location/franchise operator (15-40 clinics, one P&L, one agency relationship). Ops-bred; buys triage and a decision, not SEO.', anxiety: 'Per-location spelunking; no portfolio triage; averages hiding outliers.' },
]

const digestRef = 'THE BUILD UNDER REVIEW: read ' + DR + '/digest.md (faithful digest of the whole proposed platform). For anything you need in more depth, the raw prototype views are in "' + KIT + '/mockup/" (portal.js is the client portal; Client Dashboard Mockup.html is its hi-fi version).'

function personaPrompt(p) {
  return [
    'Stay fully in character. Answer ONLY from this persona perspective and self-interest. Advisory review — no files written, no git.',
    'PERSONA: ' + p.role,
    'DISTRUST TRIGGERS: ' + p.anxiety,
    '',
    'YOUR OWN PRIOR SPEC: in June you and six other clients wrote what you actually want from this agency dashboard. Read ' + REPO + '/' + DISCOVERY + ' (Part 1: the client spec — the verdict-first spine, your segment layer, the trust guards, the anti-features) and find your own persona asks. Your prior verdicts are in ' + REPO + '/' + PRIOR_VERDICTS + ' if useful.',
    '',
    digestRef,
    '',
    'THE QUESTION: the agency is rebuilding the entire platform to this new design. Against YOUR OWN spec: what does the new design resolve? What is still missing? What in it would trigger your distrust? What would you concretely improve? Did they build to your spec (fully/partially/no) and does this redesign matter to you (a lot/somewhat/blocker/not really)? Focus on the client portal but glance at anything client-visible. End with one in-character sentence.',
  ].join('\n')
}

// ==================== Wave 1: backfill (8 agents) ====================
log('Backfill: 4 surfaces + 3 cross-cutting + 1 persona')
const wave1 = await parallel([
  ...SURFACES.map(s => () => agent(surfacePrompt(s), { label: 'parity:' + s.id, phase: 'Backfill', schema: SURFACE_SCHEMA })),
  ...CROSS.map(c => () => agent(c.prompt, { label: c.label, phase: 'Backfill', schema: CROSS_SCHEMA })),
  ...PERSONAS.map(p => () => agent(personaPrompt(p), { label: 'persona:' + p.key, phase: 'Backfill', schema: PERSONA_SCHEMA })),
])
const newSurfaces = wave1.slice(0, 4).filter(Boolean)
const newCross = wave1.slice(4, 7).filter(Boolean)
const newPersonas = wave1.slice(7, 8).filter(Boolean)
const dropped = 8 - newSurfaces.length - newCross.length - newPersonas.length
if (dropped > 0) log('WARNING: ' + dropped + ' backfill agent(s) returned null — will be named in synthesis')

const allNewParity = newSurfaces

// ==================== Wave 2: adversarial verification ====================
// Recovered claims live on disk: CKPT/gapfill-args-base.json (atRiskClaims: ~282 from the 16 recovered surfaces incl Schema).
// New claims from this run are passed inline. Split: verifier A = recovered claims first half; B = second half; new claims split between them.
const newClaims = []
allNewParity.forEach(r => (r.atRisk || []).forEach(a => newClaims.push({ surface: (r.surface || '').slice(0, 50), ...a })))
log('Verification: ~282 recovered claims (from disk) + ' + newClaims.length + ' new claims')

function verifyPrompt(part, inlineClaims, outFile) {
  return [PRE, '',
    'You are an ADVERSARIAL VERIFIER. Your claim set has two sources:',
    '(A) RECOVERED CLAIMS ON DISK: read ' + CKPT + '/gapfill-args-base.json — the atRiskClaims array. You take the ' + part + ' half when the array is split at Math.ceil(length/2) (use python3/jq to slice it precisely; state the exact index range you took).',
    '(B) INLINE CLAIMS below (verify all of them).',
    'For EACH claim, try to REFUTE it:',
    '(a) does the capability really exist at HEAD as described? Check the evidence file:line yourself.',
    '(b) is it really absent from the prototype/new IA? Check the relevant mockup view(s) in "' + KIT + '/mockup/" and the Handoff Brief surface map before agreeing.',
    'Verdicts: CONFIRMED (real capability, genuinely no home — belongs on the owner sign-off list), REFUTED (evidence wrong, or the prototype does cover it — say where), UNCERTAIN (could not establish either way — say what is missing).',
    'In each verdict, claim = "<surface>: <capability>" so results can be traced back.',
    'OUTAGE RESILIENCE: as you work, INCREMENTALLY append finished verdicts to ' + CKPT + '/' + outFile + ' (a JSON array — rewrite the file with the full array-so-far every ~20 verdicts). That file is your ONLY writable file. Finish by writing the complete array there AND returning the structured output.',
    'INLINE CLAIMS (JSON): ' + JSON.stringify(inlineClaims, null, 1),
  ].join('\n')
}
const half = Math.ceil(newClaims.length / 2)
const verifyResults = await parallel([
  () => agent(verifyPrompt('FIRST', newClaims.slice(0, half), 'verdicts-1.json'), { label: 'verify:1', phase: 'Verify', schema: VERDICT_SCHEMA }),
  () => agent(verifyPrompt('SECOND', newClaims.slice(half), 'verdicts-2.json'), { label: 'verify:2', phase: 'Verify', schema: VERDICT_SCHEMA }),
])
const verdicts = verifyResults.filter(Boolean).flatMap(v => v.verdicts || [])
log('Verdicts: ' + verdicts.length + ' (' + verdicts.filter(v => v.verdict === 'CONFIRMED').length + ' confirmed, ' + verdicts.filter(v => v.verdict === 'REFUTED').length + ' refuted)')

// ==================== Wave 3: strategy (needs everything) ====================
const compact = {
  note: 'Recovered pre-outage surface summaries are in ' + CKPT + '/gapfill-args-base.json (wf1Compact). New this run:',
  newSurfaces: allNewParity.map(r => ({ surface: r.surface, capabilityCount: r.capabilityCount, statusCounts: r.statusCounts, atRiskCount: (r.atRisk || []).length, stopAndAskCount: (r.stopAndAsk || []).length, quickWinTradeoffs: r.quickWinTradeoffs, ledgerFile: r.ledgerFile })),
  crossCutting: newCross.map(c => ({ topic: c.topic, criticalFindings: (c.keyFindings || []).filter(f => f.severity === 'critical'), recommendations: c.recommendations, ledgerFile: c.ledgerFile })),
  verifiedAtRisk: verdicts.filter(v => v.verdict === 'CONFIRMED').length,
  refutedAtRisk: verdicts.filter(v => v.verdict === 'REFUTED').length,
}
const strategy = await agent([PRE, '',
  'You are the IMPLEMENTATION STRATEGIST. All Phase 0 audit outputs are on disk under ' + OUT + '/ :',
  '- 20 per-surface ledgers in ' + OUT + '/surfaces/',
  '- cross-cutting docs at ' + OUT + '/cross-*.md (client-dashboard, design-system, platform, consistency)',
  '- recovered pre-outage summaries: ' + CKPT + '/gapfill-args-base.json (wf1Compact = per-surface counts + quick-win trade-offs)',
  '- an independent design review (craft + strategy + personas) in ' + DR + '/',
  'Compact summary of this run: ' + JSON.stringify(compact, null, 1),
  '',
  'Read the cross-cutting docs fully and skim the surface ledgers (prioritize ones with trade-offs and at-risk items). Also read "' + KIT + '/UI Rebuild Handoff Brief.html" (the build sequence: Phase 0 gate -> data-source ledgers -> pilot Keywords -> fan out -> gate every surface) and "' + KIT + '/Parallelization Map.html" if useful.',
  '',
  'DELIVER (write to ' + OUT + '/STRATEGY.md — your ONLY writable file — and return the structured summary):',
  '1. BUILD SEQUENCE: concrete recommended order of implementation phases, respecting the kit sequence, phase-per-PR + staging-first rules from CLAUDE.md, and dependencies you see in the evidence (e.g. design-system integration path must land before any surface; shell before surfaces; pilot before fan-out). Name lane groupings for parallel agents and what must be sequential.',
  '2. TRADE-OFFS: the top quick-win-now / upgrade-later decisions across all surfaces + cross-cutting findings. For each: quick win, full version, recommendation, and the explicit upgrade trigger (what event/date causes the upgrade to be scheduled). These feed a deferred ledger — be concrete.',
  '3. DEFERRED TRACKING: finalize the tracking design from ' + OUT + '/cross-consistency.md into one concrete mechanism.',
  '4. CONSISTENCY AUDITOR: finalize the consistency-enforcement design (mechanized + agentic layers) into a concrete recommendation.',
  '5. SUCCESS RECOMMENDATIONS: the 5-10 highest-leverage practices for this specific rebuild (grounded in the evidence, not generic advice).',
  '6. RISKS: ranked register of what is most likely to sink or degrade the rebuild, each with a mitigation.',
].join('\n'), { label: 'strategy', phase: 'Strategy', schema: STRATEGY_SCHEMA })

// ==================== Wave 4: design-review validation + synthesis ====================
// Recovered panel verdicts (6 personas) + craft summaries are in CKPT/wf2-design-review-recovered.json (structuredOutput fields).
const heavy = []
newPersonas.forEach(p => {
  if (p.matters === 'blocker' || p.builtToMySpec === 'no') {
    (p.stillMissing || []).slice(0, 4).forEach(m => heavy.push({ source: (p.persona || '').slice(0, 60), claim: m }))
  }
  ;(p.distrustTriggers || []).slice(0, 2).forEach(d => heavy.push({ source: (p.persona || '').slice(0, 60), claim: d }))
})

let validations = []
const validator = await agent([DPRE, '',
  'ROLE: Adversarial validator for the design-review panel.',
  'CLAIM SOURCES: (A) recovered panel + craft findings in ' + CKPT + '/wf2-design-review-recovered.json — for every entry whose structuredOutput has matters=blocker or builtToMySpec=no take up to 4 stillMissing items, plus take up to 2 distrustTriggers from EVERY persona entry, plus every craft keyFinding with severity=blocker. (B) INLINE new-persona claims below.',
  'For EACH claim: is it REAL and IN-SCOPE (the prototype/kit genuinely has this problem — check the digest at ' + DR + '/digest.md and the named mockup views yourself), or persona hyperbole / out of scope (e.g. complaining about placeholder copy the Handoff Brief already declares non-final, or about backend behavior no UI can fix)? CONFIRMED / REFUTED / UNCERTAIN with evidence. Prefix each claim with its source persona/topic.',
  'OUTAGE RESILIENCE: incrementally write verdicts-so-far to ' + CKPT + '/design-validations.json (JSON array, rewrite every ~15 verdicts) — your ONLY writable file. Finish with the complete array there AND the structured output.',
  'INLINE CLAIMS: ' + JSON.stringify(heavy, null, 1),
].join('\n'), { label: 'validate', phase: 'Synthesize', schema: VERDICT_SCHEMA })
validations = (validator && validator.verdicts) || []

const synthesis = await agent([DPRE, '',
  'ROLE: Synthesizer. Produce the ADVISORY design-review audit document.',
  'INPUTS:',
  '- RECOVERED panel (9 personas) + craft/strategy summaries: ' + CKPT + '/wf2-design-review-recovered.json (read it; use entries with structuredOutput).',
  '- NEW panel results (1 persona, inline): ' + JSON.stringify(newPersonas),
  '- VALIDATIONS (inline): ' + JSON.stringify(validations),
  '- Full craft/strategy detail on disk: ' + DR + '/craft-*.md, ' + DR + '/strategy-*.md, ' + DR + '/digest.md — read them.',
  'WRITE to docs/superpowers/audits/' + DATE + '-ui-rebuild-prototype-persona-audit.md (your ONLY writable file):',
  '1. HEADLINE — the 1-2 structural findings that matter most, and a direct answer to "is this the right build?"',
  '2. LAUNCH-BLOCKERS — issues independently raised by 3+ reviewers OR validated CONFIRMED, each with who flagged it + validation status.',
  '3. PER-PERSONA VERDICTS table — ALL 10 personas (9 recovered + 1 new): builtToMySpec + matters + verbatim. Call out trust-but-not-compelled if present.',
  '4. WHAT IS GOOD — validated strengths worth protecting through the rebuild.',
  '5. RECOMMENDATIONS — concrete, ranked, each tagged [pre-build] vs [during-build] vs [fast-follow].',
  '6. FAST-FOLLOWS — explicitly deferred items.',
  'Header must state: advisory only, no code changed, owner decides.',
].join('\n'), { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA })

return {
  backfill: { newSurfaces: allNewParity.length, newCross: newCross.length, newPersonas: newPersonas.length, dropped },
  parity: { newSurfaceResults: allNewParity, crossResults: newCross, newClaimCount: newClaims.length, verdicts, strategy },
  designReview: { newPersonas, validations, synthesis },
}
