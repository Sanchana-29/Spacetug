
import { useSimulation } from "../../../context/SimulationContext";
import "./VelocityChart.css";
import StaticLineChart from "../StaticLineChart";

function VelocityChart() {
  const { telemetrySamples } = useSimulation();

  const velocityData = telemetrySamples
    .filter((sample) => Number.isFinite(sample.velocity))
    .map((sample) => ({
      time: sample.time,
      velocity: sample.velocity,
    }));

  const latestVal = velocityData.length > 0 && velocityData[velocityData.length - 1]?.velocity != null
    ? `${Number(velocityData[velocityData.length - 1].velocity).toFixed(3)} m/s`
    : "-- m/s";

  return (
    <div className="chart-card velocity-chart">
      <div className="chart-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 14px", flexShrink: 0 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "12px", fontFamily: "Orbitron, sans-serif" }}>Relative Velocity</h3>
          <span style={{ fontSize: "10px", color: "#64748b" }}>|v_target − v_chaser| Magnitude</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: "16px", fontWeight: "bold", color: "#f59e0b", fontFamily: "monospace" }}>
            {latestVal}
          </span>
          <div style={{ fontSize: "9px", color: "#64748b" }}>CURRENT SPEED</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, width: "100%", padding: "4px 8px" }}>
        <StaticLineChart
          data={velocityData}
          yKey="velocity"
          yLabel="Relative Velocity"
          yUnits="m/s"
          color="#f59e0b"
        />
      </div>
    </div>
  );
}

export default VelocityChart;
