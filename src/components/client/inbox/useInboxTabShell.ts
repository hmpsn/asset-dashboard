import { useEffect, useState } from 'react';
import type { ClientAction } from '../../../../shared/types/client-actions';
import type { NormalizedDecision } from '../../../../shared/types/decision';
import type { InboxFilter } from './inbox-filter';
import { resolveInboxFilter } from './inbox-filter';

export type InboxMode = 'active' | 'completed';

interface UseInboxTabShellOptions {
  currentTabParam: string | null;
  betaMode: boolean;
  initialFilter?: InboxFilter;
  hasPendingSeoChanges: boolean;
}

export function useInboxTabShell({
  currentTabParam,
  betaMode,
  initialFilter,
  hasPendingSeoChanges,
}: UseInboxTabShellOptions) {
  const [filter, setFilter] = useState<InboxFilter>(() =>
    resolveInboxFilter(currentTabParam, betaMode, initialFilter),
  );
  const [mode, setMode] = useState<InboxMode>('active');
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [detailAction, setDetailAction] = useState<ClientAction | null>(null);
  const [detailActionSubmitting, setDetailActionSubmitting] = useState(false);
  const [flaggingCell, setFlaggingCell] = useState<string | null>(null);
  const [flagComment, setFlagComment] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [changeRequestAction, setChangeRequestAction] = useState<string | null>(null);
  const [changeRequestNote, setChangeRequestNote] = useState('');
  const [seoSectionExpanded, setSeoSectionExpanded] = useState(false);
  const [openDecision, setOpenDecision] = useState<NormalizedDecision | null>(null);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  useEffect(() => {
    if (hasPendingSeoChanges) setSeoSectionExpanded(true);
  }, [hasPendingSeoChanges]);

  useEffect(() => {
    setFilter(resolveInboxFilter(currentTabParam, betaMode, initialFilter));
  }, [currentTabParam, betaMode, initialFilter]);

  return {
    filter,
    setFilter,
    mode,
    setMode,
    schemaModalOpen,
    setSchemaModalOpen,
    detailAction,
    setDetailAction,
    detailActionSubmitting,
    setDetailActionSubmitting,
    flaggingCell,
    setFlaggingCell,
    flagComment,
    setFlagComment,
    flagSubmitting,
    setFlagSubmitting,
    changeRequestAction,
    setChangeRequestAction,
    changeRequestNote,
    setChangeRequestNote,
    seoSectionExpanded,
    setSeoSectionExpanded,
    openDecision,
    setOpenDecision,
    decisionSubmitting,
    setDecisionSubmitting,
  };
}
