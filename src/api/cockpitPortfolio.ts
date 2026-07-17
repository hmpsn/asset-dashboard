import type { CockpitPortfolioRollup } from '../../shared/types/cockpit-portfolio';
import { get } from './client';

export function getCockpitPortfolio(signal?: AbortSignal): Promise<CockpitPortfolioRollup> {
  return get<CockpitPortfolioRollup>('/api/cockpit/portfolio', signal);
}
