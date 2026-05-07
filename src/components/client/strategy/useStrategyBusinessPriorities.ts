import { useCallback, useEffect, useState } from 'react';
import { post, businessPriorities as bizPrioritiesApi } from '../../../api';

export interface StrategyBusinessPriority {
  text: string;
  category: string;
}

interface UseStrategyBusinessPrioritiesOptions {
  workspaceId?: string;
  setToast?: (msg: string) => void;
}

export function useStrategyBusinessPriorities({ workspaceId, setToast }: UseStrategyBusinessPrioritiesOptions) {
  const [priorities, setPriorities] = useState<StrategyBusinessPriority[]>([]);
  const [prioritiesLoaded, setPrioritiesLoaded] = useState(false);
  const [newPriority, setNewPriority] = useState('');
  const [newPriorityCategory, setNewPriorityCategory] = useState('growth');
  const [savingPriorities, setSavingPriorities] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    bizPrioritiesApi.get(workspaceId)
      .then((data) => {
        setPriorities(data.priorities || []);
        setPrioritiesLoaded(true);
      })
      .catch(() => setPrioritiesLoaded(true));
  }, [workspaceId]);

  const savePriorities = useCallback(async (newList: StrategyBusinessPriority[]) => {
    if (!workspaceId) return;
    setSavingPriorities(true);
    try {
      await post(`/api/public/business-priorities/${workspaceId}`, { priorities: newList });
      setPriorities(newList);
      setToast?.('Business priorities saved - they will shape your next strategy');
    } catch {
      setToast?.('Failed to save priorities');
    } finally {
      setSavingPriorities(false);
    }
  }, [workspaceId, setToast]);

  return {
    priorities,
    prioritiesLoaded,
    newPriority,
    setNewPriority,
    newPriorityCategory,
    setNewPriorityCategory,
    savingPriorities,
    savePriorities,
  };
}
