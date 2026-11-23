import { useSimulation } from "../../../context/SimulationContext";
import StaticLineChart from "../StaticLineChart";

function TumblingChart() {
  const { telemetrySamples, tumblingRate } = useSimulation();

  const tumblingData = telemetrySamples.map((sample) => ({
    time: sample.time,
    tumblingRate: sample.tumblingRate ?? 0,
  }));

  const latestVal = tumblingRate != null
    ? `${Number(tumblingRate).toFixed(3)} rad/s`
    : (telemetrySamples.length > 0 && telemetrySamples[telemetrySamples.length - 1]?.tumblingRate != null
        ? `${Number(telemetrySamples[telemetrySamples.length - 1].tumblingRate).toFixed(3)} rad/s`
        : "-- rad/s");

  const isWarning = (tumblingRate ?? 0) >= 0.05;

  return (
    <div className="chart-card">
      <div className="chart-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 14px", flexShrink: 0 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "12px", fontFamily: "Orbitron, sans-serif" }}>Target Angular Velocity</h3>
          <span style={{ fontSize: "10px", color: isWarning ? "#f59e0b" : "#64748b" }}>
            {isWarning ? "⚠ Warning: Rate exceeds 0.05 rad/s" : "Nominal Stability Threshold: < 0.05 rad/s"}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span
            style={{
              fontSize: "16px",
              fontWeight: "bold",
              color: isWarning ? "#ef4444" : "#06b6d4",
              fontFamily: "monospace",
            }}
          >
            {latestVal}
          </span>
          <div style={{ fontSize: "9px", color: "#64748b" }}>ANGULAR RATE</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, width: "100%", padding: "4px 8px" }}>
        <StaticLineChart
          data={tumblingData}
          yKey="tumblingRate"
          yLabel="Angular Velocity"
          yUnits="rad/s"
          color="#06b6d4"
        />
      </div>
    </div>
  );
}

export default TumblingChart;

