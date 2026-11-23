
import { useSimulation } from "../../../context/SimulationContext";
import "./AttitudeChart.css";
import StaticLineChart from "../StaticLineChart";

function unwrapAngles(samples, key) {
  let prev = null;
  let offset = 0;
  return samples.map((sample) => {
    const raw = sample[key];
    if (raw == null || !Number.isFinite(Number(raw))) return null;
    const val = Number(raw);
    if (prev === null) {
      prev = val;
      return val;
    }
    let diff = val - prev;
    if (diff > 180) {
      offset -= 360;
    } else if (diff < -180) {
      offset += 360;
    }
    prev = val;
    return Number((val + offset).toFixed(2));
  });
}

function AttitudeChart() {
  const { telemetrySamples } = useSimulation();

  const unwrappedRoll = unwrapAngles(telemetrySamples, "roll");
  const unwrappedPitch = unwrapAngles(telemetrySamples, "pitch");
  const unwrappedYaw = unwrapAngles(telemetrySamples, "yaw");

  const attitudeData = telemetrySamples.map((sample, idx) => ({
    time: sample.time,
    roll: unwrappedRoll[idx],
    pitch: unwrappedPitch[idx],
    yaw: unwrappedYaw[idx],
  }));

  const lastSample = telemetrySamples.length > 0 ? telemetrySamples[telemetrySamples.length - 1] : null;
  const rollStr = lastSample?.roll != null ? `${lastSample.roll.toFixed(1)}°` : "--°";
  const pitchStr = lastSample?.pitch != null ? `${lastSample.pitch.toFixed(1)}°` : "--°";
  const yawStr = lastSample?.yaw != null ? `${lastSample.yaw.toFixed(1)}°` : "--°";

  return (
    <div className="chart-card attitude-chart">
      <div className="chart-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 14px", flexShrink: 0 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "12px", fontFamily: "Orbitron, sans-serif" }}>Target Attitude (Roll, Pitch, Yaw)</h3>
          <span style={{ fontSize: "10px", color: "#64748b" }}>
            <span style={{ color: "#f43f5e", fontWeight: "bold" }}>● Roll (X)</span>
            {"  "}
            <span style={{ color: "#10b981", fontWeight: "bold" }}>● Pitch (Y)</span>
            {"  "}
            <span style={{ color: "#8b5cf6", fontWeight: "bold" }}>● Yaw (Z)</span>
          </span>
        </div>
        <div style={{ textAlign: "right", display: "flex", gap: "8px" }}>
          <div>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "#f43f5e", fontFamily: "monospace" }}>{rollStr}</span>
            <div style={{ fontSize: "8px", color: "#64748b" }}>ROLL</div>
          </div>
          <div>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "#10b981", fontFamily: "monospace" }}>{pitchStr}</span>
            <div style={{ fontSize: "8px", color: "#64748b" }}>PITCH</div>
          </div>
          <div>
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "#8b5cf6", fontFamily: "monospace" }}>{yawStr}</span>
            <div style={{ fontSize: "8px", color: "#64748b" }}>YAW</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, width: "100%", padding: "4px 8px" }}>
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
