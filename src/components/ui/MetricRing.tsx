import { scoreColor } from './constants';

interface MetricRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Disable charge-up animation (for compact/inline usage) */
  noAnimation?: boolean;
}

export function MetricRing({ score, size = 120, strokeWidth, className, noAnimation }: MetricRingProps) {
  const sw = strokeWidth ?? (size >= 100 ? 8 : size >= 48 ? 6 : 4);
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = scoreColor(score);
  const showGlow = !noAnimation && size >= 80;

  return (
    <div className={`relative ${className ?? ''}`} style={{ width: size, height: size }}>
      {/* Glow layer — outward-only via box-shadow behind the ring */}
      {showGlow && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow: `0 0 20px 8px rgba(52, 211, 153, 0.15), 0 0 40px 16px rgba(45, 212, 191, 0.1)`,
            animation: 'ringGlowIn 0.8s ease-out 2s both',
          }}
        />
      )}
      {/* Edge ring — subtle 1px border */}
      {showGlow && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: '1px solid rgba(45, 212, 191, 0.15)',
            animation: 'ringGlowIn 0.8s ease-out 2s both',
          }}
        />
      )}
      <svg width={size} height={size} className="transform -rotate-90 relative z-10">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#303036" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <span
          className="font-bold"
          style={{
            color,
            fontSize: size >= 100 ? 40 : size * 0.38,
            fontFamily: "'DIN Pro', 'Inter', sans-serif",
            fontWeight: 700,
            letterSpacing: '-0.03em',
            animation: showGlow ? 'numberFadeIn 0.4s ease-out 0.8s both' : undefined,
          }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

/** Small SVG-only ring for use inside tight spaces (workspace overview, list items) */
export function MetricRingSvg({ score, size = 48, strokeWidth }: Omit<MetricRingProps, 'noAnimation'>) {
  const sw = strokeWidth ?? (size >= 48 ? 4 : 3);
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = scoreColor(score);

  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#303036" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-700"
      />
      <text
        x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize={size * 0.38} fontWeight="700" fill={color}
        fontFamily="'DIN Pro', 'Inter', sans-serif" letterSpacing="-0.03em"
      >
        {score}
      </text>
    </svg>
  );
}
