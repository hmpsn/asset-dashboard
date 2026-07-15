// @ds-rebuilt
import { useId, type CSSProperties, type ReactElement } from 'react';
import { cn } from '../../lib/utils';

/**
 * Inline trend line (no axes) from a series of numbers — the app's `.spark`.
 * Hand-rolled SVG (no chart dependency). Blue by default (the data color);
 * `area` adds a soft gradient fill. Handles empty/single-point series safely.
 */
export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  area?: boolean;
  strokeWidth?: number;
  /** Accessible label; when omitted the SVG is aria-hidden (purely decorative). */
  label?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Sparkline({
  data,
  width = 74,
  height = 26,
  color = 'var(--blue)',
  area = false,
  strokeWidth = 1.5,
  label,
  className,
  id,
  style,
}: SparklineProps): ReactElement {
  const uid = useId().replace(/:/g, '');
  const a11yProps = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };

  if (data.length === 0) {
    return (
      <svg
        id={id}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        style={style}
        {...a11yProps}
      />
    );
  }

  const pad = strokeWidth;

  if (data.length === 1) {
    const y = height / 2;
    return (
      <svg
        id={id}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn('block overflow-visible', className)}
        style={style}
        {...a11yProps}
      >
        <line x1={pad} y1={y} x2={width - pad} y2={y} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const lineStr = points.map((p) => p.join(',')).join(' ');

  return (
    <svg
      id={id}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block overflow-visible', className)}
      style={style}
      {...a11yProps}
    >
      {area && (
        <>
          <defs>
            <linearGradient id={`spg-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`${pad},${height - pad} ${lineStr} ${width - pad},${height - pad}`}
            fill={`url(#spg-${uid})`}
          />
        </>
      )}
      <polyline
        points={lineStr}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
