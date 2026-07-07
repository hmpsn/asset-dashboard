// @ds-rebuilt
import { Drawer } from '../ui';
import { ActivityFeed } from '../workspace-home';
import type { CockpitActivityEntry } from '../../hooks/admin/useCockpitRebuilt';

interface CockpitActivityDrawerProps {
  open: boolean;
  onClose: () => void;
  activity: CockpitActivityEntry[];
}

export function CockpitActivityDrawer({ open, onClose, activity }: CockpitActivityDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Recent activity"
      subtitle="Workspace changes, sends, audits, and resolved requests."
      eyebrow="Evidence"
      width={560}
    >
      <ActivityFeed activity={activity} />
    </Drawer>
  );
}
