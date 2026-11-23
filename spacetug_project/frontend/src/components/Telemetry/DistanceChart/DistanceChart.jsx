
import { useSimulation } from "../../../context/SimulationContext";
import "./DistanceChart.css";
import StaticLineChart from "../StaticLineChart";

function DistanceChart() {
  const { telemetrySamples } = useSimulation();

  const distanceData = telemetrySamples.map((sample) => ({
    time: sample.time,
    distance: sample.distance,
  }));

  const latestVal = telemetrySamples.length > 0 && telemetrySamples[telemetrySamples.length - 1]?.distance != null
    ? `${Number(telemetrySamples[telemetrySamples.length - 1].distance).toFixed(2)} m`
    : "-- m";

  return (
    <div className="chart-card">
      <div className="chart-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 14px", flexShrink: 0 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "12px", fontFamily: "Orbitron, sans-serif" }}>Relative Distance</h3>
          <span style={{ fontSize: "10px", color: "#64748b" }}>Target − Chaser | R = √(dx² + dy² + dz²)</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: "16px", fontWeight: "bold", color: "#38bdf8", fontFamily: "monospace" }}>
            {latestVal}
          </span>
          <div style={{ fontSize: "9px", color: "#64748b" }}>CURRENT RANGE</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, width: "100%", padding: "4px 8px" }}>
        <StaticLineChart
          data={distanceData}
          yKey="distance"
          yLabel="Relative Distance"
          yUnits="m"
          color="#38bdf8"
        />
      </div>
    </div>
  );
}

export default DistanceChart;
