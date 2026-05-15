import type { ReactNode } from 'react';
import type { ClientTab } from '../types';

interface ClientDashboardTabContentProps {
  tab: ClientTab;
  panels: Partial<Record<ClientTab, ReactNode>>;
  chatWidget: ReactNode;
}

export function ClientDashboardTabContent({
  tab,
  panels,
  chatWidget,
}: ClientDashboardTabContentProps) {
  const chatFirstTabs = new Set<ClientTab>(['content-plan', 'plans', 'roi', 'brand']);
  const panel = panels[tab] ?? null;
  if (chatFirstTabs.has(tab)) {
    return (
      <>
        {chatWidget}
        {panel}
      </>
    );
  }

  return (
    <>
      {panel}
      {chatWidget}
    </>
  );
}
