
import { useSimulation } from "../../../context/SimulationContext";
import "./AttitudeChart.css";
import StaticLineChart from "../StaticLineChart";

function AttitudeChart() {
  const { telemetrySamples } = useSimulation();

  const attitudeData = telemetrySamples.map((sample) => ({
    time: sample.time,
    roll: sample.roll,
    pitch: sample.pitch,
    yaw: sample.yaw,
  }));

  const lastSample = telemetrySamples.length > 0 ? telemetrySamples[telemetrySamples.length - 1] : null;
  const rollStr = lastSample?.roll != null ? `${lastSample.roll.toFixed(1)}°` : "--°";
  const pitchStr = lastSample?.pitch != null ? `${lastSample.pitch.toFixed(1)}°` : "--°";
  const yawStr = lastSample?.yaw != null ? `${lastSample.yaw.toFixed(1)}°` : "--°";

  return (
    <div className="chart-card attitude-chart">
      <div className="chart-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3>Target Attitude (Roll, Pitch, Yaw)</h3>
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            <span style={{ color: "#f43f5e", fontWeight: "bold" }}>● Roll (X)</span>
            {"  "}
            <span style={{ color: "#10b981", fontWeight: "bold" }}>● Pitch (Y)</span>
            {"  "}
            <span style={{ color: "#8b5cf6", fontWeight: "bold" }}>● Yaw (Z)</span>
          </span>
        </div>
        <div style={{ textAlign: "right", display: "flex", gap: "10px" }}>
          <div>
            <span style={{ fontSize: "16px", fontWeight: "bold", color: "#f43f5e", fontFamily: "monospace" }}>{rollStr}</span>
            <div style={{ fontSize: "9px", color: "#64748b" }}>ROLL</div>
          </div>
          <div>
            <span style={{ fontSize: "16px", fontWeight: "bold", color: "#10b981", fontFamily: "monospace" }}>{pitchStr}</span>
            <div style={{ fontSize: "9px", color: "#64748b" }}>PITCH</div>
          </div>
          <div>
            <span style={{ fontSize: "16px", fontWeight: "bold", color: "#8b5cf6", fontFamily: "monospace" }}>{yawStr}</span>
            <div style={{ fontSize: "9px", color: "#64748b" }}>YAW</div>
          </div>
        </div>
      </div>

      <div style={{ height: "240px", width: "100%", padding: "10px" }}>
        <StaticLineChart
          data={attitudeData}
          yLabel="Attitude"
          yUnits="°"
          lines={[
            { key: "roll", color: "#f43f5e" },
            { key: "pitch", color: "#10b981" },
            { key: "yaw", color: "#8b5cf6" },
          ]}
        />
      </div>
    </div>
  );
}

export default AttitudeChart;
