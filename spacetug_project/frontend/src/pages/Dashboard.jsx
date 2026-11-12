import { useEffect, useState } from "react";
import Layout from "../components/Layout/Layout";
import Scene from "../components/Scene/Scene";
import { getSystemStatus } from "../services/api.js";
import { useSimulation } from "../context/SimulationContext";
import { useMission } from "../context/MissionContext";
import { FaEye, FaVideo, FaCrosshairs } from "react-icons/fa";

function Dashboard() {
  const [backendStatus, setBackendStatus] = useState("Connecting...");
  const [error, setError] = useState(false);
  const { activeMission } = useMission();
  const { loadMissionIntoSimulation, cameraMode, setCameraMode } = useSimulation();

  // Synchronize active mission with simulation parameters
  useEffect(() => {
    if (activeMission && loadMissionIntoSimulation) {
      loadMissionIntoSimulation(activeMission);
    }
  }, [activeMission?.mission_id, loadMissionIntoSimulation]);

  useEffect(() => {
    let isMounted = true;

    async function checkBackend() {
      try {
        const data = await getSystemStatus();
        if (!isMounted) return;

        if (data.backend === "online") {
          setBackendStatus("ONLINE");
          setError(false);
        } else {
          setBackendStatus(data.backend || "STANDBY");
          setError(false);
        }
      } catch (err) {
        if (!isMounted) return;
        setBackendStatus("OFFLINE");
        setError(true);
      }
    }

    checkBackend();
    const interval = setInterval(checkBackend, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <Layout>
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Scene />

        {/* Backend Status with Active Mission indicator */}
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "70px",
            padding: "10px 16px",
            borderRadius: "8px",
            background: "#111a2c",
            border: "1px solid #24324d",
            color: "white",
            fontSize: "13px",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: error ? "#ef4444" : "#4ade80",
                marginRight: "8px",
              }}
            />
            <span>
              Backend: <strong>{backendStatus}</strong>
            </span>
          </div>

          {activeMission && (
            <>
              <span style={{ color: "#475569" }}>|</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#94a3b8" }}>Mission:</span>
                <strong style={{ color: "#38bdf8" }}>{activeMission.name}</strong>
              </div>
            </>
          )}
        </div>

        {/* Camera Perspective Mode Switcher: CHASER VIEW, TARGET VIEW, FREE VIEW */}
        <div
          style={{
            position: "absolute",
            top: "20px",
            right: "70px",
            zIndex: 10,
            display: "flex",
            background: "#111a2c",
            border: "1px solid #24324d",
            borderRadius: "8px",
            padding: "4px",
            gap: "4px",
          }}
        >
          <button
            type="button"
            onClick={() => setCameraMode("CHASER")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: (cameraMode === "CHASER" || cameraMode === "CHASER_FOLLOW") ? "#0284c7" : "transparent",
              color: (cameraMode === "CHASER" || cameraMode === "CHASER_FOLLOW") ? "#ffffff" : "#94a3b8",
              border: "none",
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            title="Chaser View (Default): Camera mounted on Servicer looking forward at Target"
          >
            <FaVideo /> CHASER VIEW (DEFAULT)
          </button>

          <button
            type="button"
            onClick={() => setCameraMode("TARGET")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: cameraMode === "TARGET" ? "#0284c7" : "transparent",
              color: cameraMode === "TARGET" ? "#ffffff" : "#94a3b8",
              border: "none",
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            title="Target View: Centers and follows the target spacecraft"
          >
            <FaCrosshairs /> TARGET VIEW
          </button>

          <button
            type="button"
            onClick={() => setCameraMode("FREE")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: cameraMode === "FREE" ? "#2563eb" : "transparent",
              color: cameraMode === "FREE" ? "#ffffff" : "#94a3b8",
              border: "none",
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            title="Free Orbit Camera View: Release automatic tracking for full 360° OrbitControls"
          >
            <FaEye /> FREE VIEW
          </button>
        </div>
      </div>
    </Layout>
  );
}

export default Dashboard;
