export interface CockpitActions {
  send: (recId: string, note?: string) => void;
  strike: (recId: string) => void;
  unstrike: (recId: string) => void;
  throttle: (recId: string, days: 7 | 30 | 90) => void;
  fix: (recId: string) => void;
  isPending: boolean;
}
