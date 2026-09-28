import React, { useState } from 'react';
import { TimeSeriesBucket } from '../../types/analytics';
import { formatDurationMs, formatToLocalDateTime } from '../../services/analyticsService';
import { Clock } from 'lucide-react';

interface DurationTrendChartProps {
  buckets: TimeSeriesBucket[];
  isLoading?: boolean;
}

export const DurationTrendChart: React.FC<DurationTrendChartProps> = ({
  buckets,
  isLoading = false,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750 text-left space-y-4 animate-pulse">
        <div className="h-5 w-44 bg-warm-100 dark:bg-charcoal-800 rounded" />
        <div className="h-64 bg-warm-100 dark:bg-charcoal-800 rounded-xl" />
      </div>
    );
  }

  const hasData = buckets && buckets.length > 0 && buckets.some((b) => b.avg_duration_ms > 0 || b.p95_duration_ms > 0);

  if (!hasData) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750 text-left flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-12 h-12 rounded-2xl bg-warm-100 dark:bg-charcoal-800/60 border border-warm-300 dark:border-charcoal-700/50 flex items-center justify-center text-warm-400 dark:text-charcoal-500 mb-3">
          <Clock className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-warm-700 dark:text-charcoal-300">No Duration Trend Data</h4>
        <p className="text-xs text-warm-400 dark:text-charcoal-500 mt-1 max-w-sm text-center">
          No execution durations recorded in the selected period. Once workflows complete, latency percentiles will appear here.
        </p>
      </div>
    );
  }

  // Dimensions
  const height = 240;
  const paddingLeft = 55;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 35;
  const chartHeight = height - paddingTop - paddingBottom;
  const totalWidth = 600;
  const chartWidth = totalWidth - paddingLeft - paddingRight;

  // Max latency calculation for Y-scale
  const maxVal = Math.max(...buckets.map((b) => Math.max(b.p95_duration_ms, b.avg_duration_ms)), 100);
  const ySteps = [0, maxVal * 0.33, maxVal * 0.66, maxVal];

  // Point coordinates generator
  const getX = (i: number) => {
    if (buckets.length <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (i / (buckets.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    return paddingTop + chartHeight - (val / maxVal) * chartHeight;
  };

  // Build SVG polyline points
  const avgPoints = buckets.map((b, i) => `${getX(i)},${getY(b.avg_duration_ms)}`).join(' ');
  const p95Points = buckets.map((b, i) => `${getX(i)},${getY(b.p95_duration_ms)}`).join(' ');

  // Gradient area paths
  const p95Area = `${getX(0)},${paddingTop + chartHeight} ${p95Points} ${getX(buckets.length - 1)},${paddingTop + chartHeight}`;

  return (
    <div className="p-6 rounded-2xl bg-white dark:bg-charcoal-900/60 border border-warm-200 dark:border-charcoal-750 shadow-xl text-left relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-warm-900 dark:text-charcoal-100 tracking-tight flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Execution Latency Trend
          </h3>
          <p className="text-xs text-warm-500 dark:text-charcoal-400 mt-0.5">
            Average duration and P95 latency percentiles over time
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[11px] text-warm-500 dark:text-charcoal-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded bg-amber-500" />
            P95 Latency
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded bg-brand-600 dark:bg-brand-500" />
            Avg Latency
          </span>
        </div>
      </div>

      {/* SVG Container */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${totalWidth} ${height}`}
          className="w-full h-auto min-w-[500px] overflow-visible select-none"
        >
          <defs>
            <linearGradient id="p95Gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d97706" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#d97706" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Y Grid Lines & Labels */}
          {ySteps.map((val, idx) => {
            const y = getY(val);
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={totalWidth - paddingRight}
                  y2={y}
                  stroke="#DDD9D0"
                  strokeWidth="1"
                  strokeDasharray={val === 0 ? undefined : '3 3'}
                  opacity={val === 0 ? 0.8 : 0.4}
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="text-[10px] fill-slate-400 font-mono"
                >
                  {formatDurationMs(val)}
                </text>
              </g>
            );
          })}

          {/* Area under P95 */}
          <polygon points={p95Area} fill="url(#p95Gradient)" />

          {/* P95 Line */}
          <polyline
            fill="none"
            stroke="#d97706"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={p95Points}
          />

          {/* Avg Line */}
          <polyline
            fill="none"
            stroke="#176B4D"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={avgPoints}
          />

          {/* Interactive Data Points & Hover Targets */}
          {buckets.map((b, i) => {
            const x = getX(i);
            const isHovered = hoveredIdx === i;
            const showLabel = i % Math.max(Math.floor(buckets.length / 6), 1) === 0;

            return (
              <g
                key={i}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Vertical hover line indicator */}
                {isHovered && (
                  <line
                    x1={x}
                    y1={paddingTop}
                    x2={x}
                    y2={paddingTop + chartHeight}
                    stroke="#94a3b8"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity={0.7}
                  />
                )}

                {/* Point P95 */}
                <circle
                  cx={x}
                  cy={getY(b.p95_duration_ms)}
                  r={isHovered ? 5 : 3}
                  fill="#d97706"
                  stroke="#101513"
                  strokeWidth="2"
                />

                {/* Point Avg */}
                <circle
                  cx={x}
                  cy={getY(b.avg_duration_ms)}
                  r={isHovered ? 4.5 : 2.5}
                  fill="#176B4D"
                  stroke="#101513"
                  strokeWidth="2"
                />

                {/* Invisible large touch target */}
                <rect
                  x={x - 12}
                  y={paddingTop}
                  width={24}
                  height={chartHeight}
                  fill="transparent"
                />

                {/* X Axis Label */}
                {showLabel && (
                  <text
                    x={x}
                    y={height - 10}
                    textAnchor="middle"
                    className="text-[9px] fill-slate-400 font-mono"
                  >
                    {formatToLocalDateTime(b.timestamp)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {hoveredIdx !== null && buckets[hoveredIdx] && (
          <div
            className="absolute top-2 right-2 bg-warm-50 dark:bg-charcoal-950/95 border border-warm-300 dark:border-charcoal-700/80 rounded-xl p-3 shadow-2xl text-xs backdrop-blur-md pointer-events-none z-20 space-y-1"
          >
            <div className="font-semibold text-warm-900 dark:text-charcoal-100 border-b border-warm-200 dark:border-charcoal-750 pb-1">
              {formatToLocalDateTime(buckets[hoveredIdx].timestamp)}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <span className="text-amber-600 dark:text-amber-400">P95 Latency:</span>
              <span className="font-mono font-bold text-amber-700 dark:text-amber-300 text-right">
                {formatDurationMs(buckets[hoveredIdx].p95_duration_ms)}
              </span>

              <span className="text-brand-600 dark:text-brand-400">Avg Duration:</span>
              <span className="font-mono font-bold text-brand-700 dark:text-brand-300 text-right">
                {formatDurationMs(buckets[hoveredIdx].avg_duration_ms)}
              </span>

              <span className="text-warm-500 dark:text-charcoal-400">Runs Sampled:</span>
              <span className="font-mono text-warm-700 dark:text-charcoal-300 text-right">
                {buckets[hoveredIdx].total_count}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
