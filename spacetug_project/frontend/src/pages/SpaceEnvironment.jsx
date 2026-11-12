import Layout from "../components/Layout/Layout";
import Scene from "../components/Scene/Scene";
import { useSimulation } from "../context/SimulationContext";
import "./Dashboard.css";

function SpaceEnvironment() {
  const {
    selectedObject,
    trackingTarget,
    setTrackingTarget,
    isTracking,
    setIsTracking,
    missionTime,
    isRunning,
  } = useSimulation();

  return (
    <Layout showInspector={true} showFooter={true}>
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
        }}
      >
        <Scene />

        {/* Floating Simulation HUD Overlay */}
        <div
          className="dashboard-status-badge"
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            padding: "10px 16px",
            borderRadius: "8px",
            background: "rgba(17, 26, 44, 0.85)",
            backdropFilter: "blur(8px)",
            border: "1px solid #24324d",
            color: "white",
            fontSize: "13px",
            zIndex: 10,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: isRunning ? "#4ade80" : "#f59e0b",
              marginRight: "8px",
            }}
          />
          Space Environment: <strong>{isRunning ? "RUNNING" : "PAUSED"}</strong> (T+{Number(missionTime || 0).toFixed(1)}s)
        </div>

        {/* Tracking Control Panel */}
        <div
          className="dashboard-status-badge"
          style={{
            position: "absolute",
            top: "70px",
            left: "20px",
            padding: "16px",
            borderRadius: "8px",
            background: "rgba(17, 26, 44, 0.85)",
            backdropFilter: "blur(8px)",
            border: "1px solid #24324d",
            color: "white",
            fontSize: "13px",
            zIndex: 10,
            width: "220px",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "8px", letterSpacing: "1px", color: "#38bdf8" }}>
            TARGET DYNAMICS
          </div>
          <div style={{ borderBottom: "1px solid #24324d", margin: "0 -16px 8px -16px" }} />

          <div style={{ marginBottom: "6px" }}>
            <span style={{ color: "#94a3b8" }}>Target ID: </span>
            <strong style={{ color: "#f8fafc" }}>{selectedObject?.id || "SAT-001"}</strong>
          </div>

          <div style={{ marginBottom: "14px" }}>
            <span style={{ color: "#94a3b8" }}>Boresight: </span>
            <span
              style={{
                color: isTracking ? "#4ade80" : "#94a3b8",
                fontWeight: isTracking ? "bold" : "normal",
              }}
            >
              {isTracking ? "LOCKED (TRACKING)" : "FREE ROTATION"}
            </span>
          </div>

          {isTracking ? (
            <button
              onClick={() => {
                setTrackingTarget(null);
                setIsTracking(false);
              }}
              style={{
                width: "100%",
                padding: "8px",
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              DISENGAGE TRACKING
            </button>
          ) : (
            <button
              onClick={() => {
                setTrackingTarget({ id: "SAT-001", type: "Target Spacecraft" });
                setIsTracking(true);
              }}
              style={{
                width: "100%",
                padding: "8px",
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              TRACK TARGET
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}

export default SpaceEnvironment;
