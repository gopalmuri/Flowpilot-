import React, { useState } from 'react';
import { TimeSeriesBucket } from '../../types/analytics';
import { formatToLocalDateTime } from '../../services/analyticsService';
import { BarChart3 } from 'lucide-react';

interface ExecutionVolumeChartProps {
  buckets: TimeSeriesBucket[];
  isLoading?: boolean;
}

export const ExecutionVolumeChart: React.FC<ExecutionVolumeChartProps> = ({
  buckets,
  isLoading = false,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-left space-y-4 animate-pulse">
        <div className="h-5 w-44 bg-slate-800 rounded" />
        <div className="h-64 bg-slate-800/40 rounded-xl" />
      </div>
    );
  }

  const hasData = buckets && buckets.length > 0 && buckets.some((b) => b.total_count > 0);

  if (!hasData) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-left flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center text-slate-500 mb-3">
          <BarChart3 className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-slate-300">No Execution Volume Data</h4>
        <p className="text-xs text-slate-500 mt-1 max-w-sm text-center">
          No workflow runs were recorded in the selected time window. Trigger a workflow execution to populate this chart.
        </p>
      </div>
    );
  }

  // Dimensions
  const height = 240;
  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 35;
  const chartHeight = height - paddingTop - paddingBottom;

  // Max value calculation for Y-scale
  const maxVal = Math.max(...buckets.map((b) => b.total_count), 5);
  // Y-grid intervals (4 levels)
  const ySteps = [0, Math.ceil(maxVal * 0.33), Math.ceil(maxVal * 0.66), maxVal];

  const totalWidth = 600;
  const chartWidth = totalWidth - paddingLeft - paddingRight;
  const barSlotWidth = chartWidth / buckets.length;
  const barWidth = Math.max(Math.min(barSlotWidth * 0.65, 24), 4);

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 shadow-xl text-left relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            Execution Volume Trend
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Total workflow executions broken down by completion status
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            Success
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
            Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
            Cancelled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
            In-Flight
          </span>
        </div>
      </div>

      {/* SVG Container */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${totalWidth} ${height}`}
          className="w-full h-auto min-w-[500px] overflow-visible select-none"
        >
          {/* Y Grid Lines & Labels */}
          {ySteps.map((val, idx) => {
            const y = paddingTop + chartHeight - (val / maxVal) * chartHeight;
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={totalWidth - paddingRight}
                  y2={y}
                  stroke="#334155"
                  strokeWidth="1"
                  strokeDasharray={val === 0 ? undefined : '3 3'}
                  opacity={val === 0 ? 0.8 : 0.4}
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="text-[10px] fill-slate-500 font-mono"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Stacked Bars */}
          {buckets.map((b, i) => {
            const x = paddingLeft + i * barSlotWidth + (barSlotWidth - barWidth) / 2;
            const isHovered = hoveredIdx === i;

            // Heights
            const successH = (b.success_count / maxVal) * chartHeight;
            const failedH = (b.failed_count / maxVal) * chartHeight;
            const cancelH = (b.cancelled_count / maxVal) * chartHeight;
            const inFlightH = (b.in_flight_count / maxVal) * chartHeight;

            let currentY = paddingTop + chartHeight;

            // Success (bottom)
            currentY -= successH;
            const successY = currentY;

            // Failed
            currentY -= failedH;
            const failedY = currentY;

            // Cancelled
            currentY -= cancelH;
            const cancelY = currentY;

            // In Flight (top)
            currentY -= inFlightH;
            const inFlightY = currentY;

            // X-axis label interval (show ~6 labels across chart)
            const showLabel = i % Math.max(Math.floor(buckets.length / 6), 1) === 0;

            return (
              <g
                key={i}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Background hover highlight strip */}
                {isHovered && (
                  <rect
                    x={paddingLeft + i * barSlotWidth}
                    y={paddingTop}
                    width={barSlotWidth}
                    height={chartHeight}
                    fill="#6366f1"
                    opacity={0.08}
                    rx={4}
                  />
                )}

                {/* Success Bar */}
                {successH > 0 && (
                  <rect
                    x={x}
                    y={successY}
                    width={barWidth}
                    height={successH}
                    fill="#10b981"
                    rx={1}
                  />
                )}

                {/* Failed Bar */}
                {failedH > 0 && (
                  <rect
                    x={x}
                    y={failedY}
                    width={barWidth}
                    height={failedH}
                    fill="#f43f5e"
                    rx={1}
                  />
                )}

                {/* Cancelled Bar */}
                {cancelH > 0 && (
                  <rect
                    x={x}
                    y={cancelY}
                    width={barWidth}
                    height={cancelH}
                    fill="#f59e0b"
                    rx={1}
                  />
                )}

                {/* In Flight Bar */}
                {inFlightH > 0 && (
                  <rect
                    x={x}
                    y={inFlightY}
                    width={barWidth}
                    height={inFlightH}
                    fill="#6366f1"
                    rx={1}
                  />
                )}

                {/* X Axis Date Label */}
                {showLabel && (
                  <text
                    x={x + barWidth / 2}
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

        {/* Hover Tooltip Popup */}
        {hoveredIdx !== null && buckets[hoveredIdx] && (
          <div
            className="absolute top-2 right-2 bg-slate-950/95 border border-slate-700/80 rounded-xl p-3 shadow-2xl text-xs backdrop-blur-md pointer-events-none z-20 space-y-1.5"
          >
            <div className="font-semibold text-white border-b border-slate-800 pb-1">
              {formatToLocalDateTime(buckets[hoveredIdx].timestamp)}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <span className="text-slate-400">Total Runs:</span>
              <span className="font-mono font-bold text-white text-right">
                {buckets[hoveredIdx].total_count}
              </span>

              <span className="text-emerald-400">Success:</span>
              <span className="font-mono text-emerald-300 text-right">
                {buckets[hoveredIdx].success_count}
              </span>

              <span className="text-rose-400">Failed:</span>
              <span className="font-mono text-rose-300 text-right">
                {buckets[hoveredIdx].failed_count}
              </span>

              <span className="text-amber-400">Cancelled:</span>
              <span className="font-mono text-amber-300 text-right">
                {buckets[hoveredIdx].cancelled_count}
              </span>

              <span className="text-indigo-400">In-Flight:</span>
              <span className="font-mono text-indigo-300 text-right">
                {buckets[hoveredIdx].in_flight_count}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
