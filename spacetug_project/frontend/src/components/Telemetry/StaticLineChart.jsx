
import React from "react";

// null / undefined / "" mean "no value" (Number(null) would plot as 0)
const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

export default function StaticLineChart({
  data = [],
  yKey,
  yLabel = "Value",
  yUnits = "",
  lines,
  color = "#3b82f6",
}) {
  const width = 600;
  const height = 250;
  const padding = { top: 20, right: 30, bottom: 40, left: 65 };

  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const validData = data.filter((item) => {
    if (!isNum(item.time)) return false;

    const keys = lines?.length
      ? lines.map((line) => line.key)
      : [yKey];

    return keys.some(
      (key) => key && isNum(item[key])
    );
  });

  const series = lines?.length
    ? lines
    : [{ key: yKey, color }];

  const values = validData.flatMap((item) =>
    series
      .filter((line) => isNum(item[line.key]))
      .map((line) => Number(item[line.key]))
  );

  if (validData.length === 0 || values.length === 0) {
    return (
      <div
        className="chart-placeholder"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p>No telemetry samples available</p>
      </div>
    );
  }

  const times = validData.map((item) => Number(item.time));

  let minX = Math.min(...times);
  let maxX = Math.max(...times);

  let minY = Math.min(...values);
  let maxY = Math.max(...values);

  // Avoid division by zero when all samples have the same value.
  if (minX === maxX) {
    minX -= 0.5;
    maxX += 0.5;
  }

  if (minY === maxY) {
    const paddingY = Math.max(Math.abs(minY) * 0.1, 0.1);
    minY -= paddingY;
    maxY += paddingY;
  } else {
    const paddingY = (maxY - minY) * 0.1;
    minY -= paddingY;
    maxY += paddingY;
  }

  const xScale = (time) =>
    padding.left + ((time - minX) / (maxX - minX)) * innerWidth;

  const yScale = (value) =>
    height -
    padding.bottom -
    ((value - minY) / (maxY - minY)) * innerHeight;

  const yTicks = 5;

  const renderLine = (line) => {
    const points = validData
      .filter((item) => isNum(item[line.key]))
      .map((item) => ({
        x: xScale(Number(item.time)),
        y: yScale(Number(item[line.key])),
      }));

    const pathData = points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
      )
      .join(" ");

    return (
      <g key={line.key}>
        {points.length > 1 && (
          <path
            d={pathData}
            fill="none"
            stroke={line.color}
            strokeWidth="2.5"
            strokeDasharray={line.dash || undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {points.map((point, index) => (
          <circle
            key={`${line.key}-${index}`}
            cx={point.x}
            cy={point.y}
            r={points.length === 1 ? 4 : 2}
            fill={line.color}
          />
        ))}
      </g>
    );
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${yLabel} over simulation time`}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      >
        {Array.from({ length: yTicks + 1 }, (_, index) => {
          const value =
            minY + ((maxY - minY) * index) / yTicks;
          const y = yScale(value);

          return (
            <g key={index}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#24324d"
                strokeDasharray="4 4"
              />
              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                fill="#94a3b8"
                fontSize="11"
              >
                {value.toFixed(2)}
              </text>
            </g>
          );
        })}

        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#475569"
        />

        <text
          x={padding.left}
          y={height - padding.bottom + 20}
          fill="#94a3b8"
          fontSize="11"
          textAnchor="middle"
        >
          {minX.toFixed(1)} s
        </text>

        <text
          x={width - padding.right}
          y={height - padding.bottom + 20}
          fill="#94a3b8"
          fontSize="11"
          textAnchor="middle"
        >
          {maxX.toFixed(1)} s
        </text>

        <text
          x={width / 2}
          y={height - 5}
          fill="#94a3b8"
          fontSize="12"
          textAnchor="middle"
        >
          Time (s)
        </text>

        <text
          x={15}
          y={height / 2}
          fill="#94a3b8"
          fontSize="12"
          textAnchor="middle"
          transform={`rotate(-90 15 ${height / 2})`}
        >
          {yUnits ? `${yLabel} (${yUnits})` : yLabel}
        </text>

        {series.map(renderLine)}
      {series.some((l) => l.label) && (
          <g>
            {series.map((l, i) => (
              <g key={`legend-${l.key}`} transform={`translate(${padding.left + 10 + i * 130}, ${padding.top - 6})`}>
                <line x1="0" y1="0" x2="16" y2="0" stroke={l.color} strokeWidth="3" strokeDasharray={l.dash || undefined} />
                <text x="21" y="4" fill="#cbd5e1" fontSize="11">{l.label}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
