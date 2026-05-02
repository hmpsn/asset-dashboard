// CLIENT-FACING
import { useNavigate } from 'react-router-dom';
import { SectionCard } from '../../ui/SectionCard';
import { Button } from '../../ui/Button';
import { clientPath } from '../../../routes';

interface FreeTierUpgradeCTAProps {
  workspaceId: string;
  betaMode: boolean;
}

/**
 * FreeTierUpgradeCTA — upgrade prompt shown to free-tier clients on the
 * Insights page in place of the AI-curated weekly briefing.
 *
 * Sits above the repurposed `<MonthlyDigestContent>` (which acts as a tease of
 * the editorial voice). Mirrors `<HeroStoryCard>`'s teal-accent wrapper so the
 * CTA reads as the lead "story" of the page for free-tier viewers.
 */
export function FreeTierUpgradeCTA({ workspaceId, betaMode }: FreeTierUpgradeCTAProps) {
  const navigate = useNavigate();

  const handleUpgrade = () => {
    navigate(clientPath(workspaceId, 'plans', betaMode));
  };

  return (
    <div className="border-l-2 border-teal-400 pl-3">
      <SectionCard>
        <div className="space-y-3">
          {/* Headline */}
          <h2 className="t-h2 font-bold text-[var(--brand-text-bright)]">
            Unlock your weekly briefing
          </h2>

          {/* Value prop */}
          <p className="t-body text-[var(--brand-text)] leading-relaxed">
            Your AI-curated weekly recap of wins, risks, and opportunities — tailored to your business, delivered every Monday. Skip the data dive; get the headline.
          </p>

          {/* CTA */}
          <div>
            <Button onClick={handleUpgrade} className="rounded-[var(--radius-lg)]">
              Upgrade to Growth
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
