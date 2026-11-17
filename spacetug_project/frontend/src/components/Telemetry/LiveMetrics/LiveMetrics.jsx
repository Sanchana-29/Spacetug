import { useMemo } from "react";
import {
  FaRuler,
  FaTachometerAlt,
  FaCompass,
  FaSatellite,
  FaCheckCircle,
  FaClock,
} from "react-icons/fa";
import { useSimulation } from "../../../context/SimulationContext";
import "./LiveMetrics.css";

function LiveMetrics() {
  const {
    chaserPosition,
    targetPosition,
    angularVelocity,
    telemetrySamples,
    isRunning,
    missionTime,
    isTracking,
  } = useSimulation();

  // latest finite-difference relative speed from the shared telemetry samples
  const relativeVelocity = useMemo(() => {
    for (let i = (telemetrySamples?.length || 0) - 1; i >= 0; i -= 1) {
      const v = telemetrySamples[i]?.velocity;
      if (Number.isFinite(v)) return v;
    }
    return null;
  }, [telemetrySamples]);

  const metrics = useMemo(() => {
    const dx = targetPosition.x - chaserPosition.x;
    const dy = targetPosition.y - chaserPosition.y;
    const dz = targetPosition.z - chaserPosition.z;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const wx = angularVelocity?.x ?? 0;
    const wy = angularVelocity?.y ?? 0;
    const wz = angularVelocity?.z ?? 0;
    const angularRate =
      Math.sqrt(wx * wx + wy * wy + wz * wz);

    const relVelVal = Number.isFinite(relativeVelocity)
      ? `${relativeVelocity.toFixed(3)} m/s`
      : "-- m/s";

    return [
      {
        title: "Relative Distance",
        value: Number.isFinite(distance)
          ? `${distance.toFixed(2)} m`
          : "--",
        icon: <FaRuler />,
      },
      {
        title: "Relative Velocity",
        value: relVelVal,
        icon: <FaTachometerAlt />,
      },
      {
        title: "Angular Rate",
        value: `${((angularRate * 180) / Math.PI).toFixed(2)} °/s`,
        icon: <FaCompass />,
      },
      {
        title: "Tracking",
        value: isTracking ? "ACTIVE" : "INACTIVE",
        icon: <FaSatellite />,
      },
      {
        title: "Simulation",
        value: isRunning ? "RUNNING" : "PAUSED",
        icon: <FaCheckCircle />,
      },
      {
        title: "Mission Time",
        value: `${Math.floor(missionTime / 60)
          .toString()
          .padStart(2, "0")}:${Math.floor(missionTime % 60)
          .toString()
          .padStart(2, "0")}`,
        icon: <FaClock />,
      },
    ];
  }, [
    chaserPosition,
    targetPosition,
    angularVelocity,
    relativeVelocity,
    isRunning,
    missionTime,
    isTracking,
  ]);

  return (
    <div className="live-metrics">
      {metrics.map((item) => (
        <div className="metric-card" key={item.title}>
          <div className="metric-icon">{item.icon}</div>
          <div>
            <span>{item.title}</span>
            <h2>{item.value}</h2>
          </div>
        </div>
      ))}
    </div>
  );
}

export default LiveMetrics;
