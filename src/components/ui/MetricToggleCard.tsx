interface MetricToggleCardProps {
  label: string;
  value: string;
  delta: string;
  deltaPositive: boolean;
  color: string;           // hex color, e.g. '#60a5fa'
  active: boolean;
  onClick: () => void;
  invertDelta?: boolean;   // for "lower is better" metrics
}

export function MetricToggleCard({
  label, value, delta, deltaPositive, color, active, onClick, invertDelta,
}: MetricToggleCardProps) {
  const isPositive = invertDelta ? !deltaPositive : deltaPositive;

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg p-2.5 transition-all border-2 cursor-pointer ${
        active
          ? 'border-current bg-current/8'
          : 'border-zinc-800 opacity-50 hover:opacity-70'
      }`}
      style={active ? { borderColor: color, backgroundColor: `${color}10` } : undefined}
    >
      <div className="text-[9px] font-medium uppercase tracking-wider" style={{ color }}>
        {label}
      </div>
      <div className="text-lg font-bold text-zinc-200 leading-tight mt-0.5">
        {value}
      </div>
      <div className={`text-[9px] mt-0.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {delta}
      </div>
    </button>
  );
}
