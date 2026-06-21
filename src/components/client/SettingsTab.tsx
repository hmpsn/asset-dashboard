// ── SettingsTab — the client account/settings home (Client IA v2, P2) ────────────
//
// A simple, slot-based arrangement surface. The parent (ClientDashboard) composes the
// data-heavy `BrandTab` (business profile / NAP) and `PlansTab` (billing) — both of which
// take many data props — and passes them here as ReactNode slots. SettingsTab owns NONE of
// that wiring; it only groups the two surfaces under labeled section headers and matches the
// section rhythm sibling client surfaces use (TheIssueClientPage): `space-y-6` layout,
// `t-label text-[var(--brand-text-muted)] uppercase tracking-wider` headers.
//
// `plansSlot` is omitted when billing is hidden (betaMode / external billing) — the entire
// "Plans & billing" section then disappears, header and all. Each slot is wrapped in an
// ErrorBoundary so a failure in one surface never blanks the other.
//
// Single surface: no `?tab=` reading (there is no internal tab bar).

import { ErrorBoundary } from '../ErrorBoundary';

export interface SettingsTabProps {
  /** BrandTab (business profile / NAP) — always rendered. */
  brandSlot: React.ReactNode;
  /** PlansTab (billing) — omitted when hidden (betaMode/external billing). */
  plansSlot?: React.ReactNode;
}

export function SettingsTab({ brandSlot, plansSlot }: SettingsTabProps) {
  return (
    <div className="space-y-6" data-testid="settings-tab">
      <section className="space-y-3" data-testid="settings-brand-section">
        <h2 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">Brand</h2>
        <ErrorBoundary label="Brand">{brandSlot}</ErrorBoundary>
      </section>

      {plansSlot != null && (
        <section className="space-y-3" data-testid="settings-plans-section">
          <h2 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">Plans &amp; billing</h2>
          <ErrorBoundary label="Plans &amp; billing">{plansSlot}</ErrorBoundary>
        </section>
      )}
    </div>
  );
}
