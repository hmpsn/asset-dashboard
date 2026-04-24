export type PageEditStatus = 'clean' | 'issue-detected' | 'fix-proposed' | 'in-review' | 'approved' | 'rejected' | 'live';

interface StatusStyle {
  label: string;
  border: string;
  bg: string;
  text: string;
  dot: string;
}

export const statusConfig: Record<PageEditStatus, StatusStyle | null> = {
  clean: null,
  'issue-detected': { label: 'Issue Detected', border: 'border-amber-500/30', bg: 'bg-amber-500/8', text: 'text-amber-400/80', dot: 'bg-amber-400/80' },
  'fix-proposed':   { label: 'Fix Proposed',   border: 'border-blue-500/30',  bg: 'bg-blue-500/10',  text: 'text-blue-400',  dot: 'bg-blue-400' },
  'in-review':      { label: 'In Review',      border: 'border-blue-500/30',   bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
  approved:         { label: 'Approved',        border: 'border-emerald-500/30', bg: 'bg-emerald-500/8', text: 'text-emerald-400/80', dot: 'bg-emerald-400/80' },
  rejected:         { label: 'Rejected',        border: 'border-red-500/30',   bg: 'bg-red-500/8',   text: 'text-red-400/80',   dot: 'bg-red-400/80' },
  live:             { label: 'Live',            border: 'border-teal-500/30',  bg: 'bg-teal-500/10',  text: 'text-teal-400',  dot: 'bg-teal-400' },
};

export function statusBorderClass(status: PageEditStatus | undefined | null): string {
  if (!status || status === 'clean') return '';
  const c = statusConfig[status];
  return c ? `border-l-2 ${c.border.replace('/30', '/40')}` : '';
}

export function statusDotClass(status: PageEditStatus | undefined | null): string {
  if (!status || status === 'clean') return '';
  const c = statusConfig[status];
  return c?.dot || '';
}
