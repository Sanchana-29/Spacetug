import { useEffect, useState } from "react";

import Layout from "../components/Layout/Layout";

import "./Sensors.css";

import SensorTabs from "../components/Sensors/SensorTabs/SensorTabs";
import SensorViewer from "../components/Sensors/SensorViewer/SensorViewer";

import { getSensorData } from "../services/api.js";


function Sensors() {

  const [sensorData, setSensorData] = useState(null);
  const [backendStatus, setBackendStatus] = useState("CONNECTING"); // CONNECTING, ONLINE, OFFLINE, DEGRADED
  const [errorMessage, setErrorMessage] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const loadSensorData = async () => {
    setIsRetrying(true);
    setErrorMessage(null);
    try {
      const data = await getSensorData();
      setSensorData(data);
      setBackendStatus("ONLINE");
      setLastCheck(new Date());
    } catch (error) {
      console.warn("Sensor API Error:", error);
      setSensorData(null);
      setBackendStatus("OFFLINE");
      setErrorMessage(error.message || "Failed to connect to backend sensor service");
      setLastCheck(new Date());
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    loadSensorData();
    const timer = setInterval(loadSensorData, 5000);
    return () => clearInterval(timer);
  }, []);


  // ==========================================
  // PAGE
  // ==========================================

  return (

    <Layout
      showInspector={false}
      showFooter={false}
    >

      <div className="sensors-page">

        {/* =====================================
            LEFT: SENSOR DOCK SIDEBAR
            ===================================== */}
        <div className="sensors-left-col">
          {/* Backend Status Bar */}
          <div
            className="sensor-backend-status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              width: "100%",
              padding: "8px 12px",
              borderRadius: "10px",
              background: "#111a2c",
              border: "1px solid #24324d",
              color: "white",
              fontSize: "12px",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                flexShrink: 0,
                background:
                  backendStatus === "ONLINE"
                    ? "#4ade80"
                    : backendStatus === "OFFLINE"
                    ? "#ef4444"
                    : "#f59e0b",
                boxShadow:
                  backendStatus === "ONLINE" ? "0 0 8px #4ade80" : "none",
              }}
            />

            <span style={{ color: "#94a3b8" }}>Backend:</span>

            <strong
              style={{
                color:
                  backendStatus === "ONLINE"
                    ? "#4ade80"
                    : backendStatus === "OFFLINE"
                    ? "#ef4444"
                    : "#f59e0b",
              }}
            >
              {backendStatus}
            </strong>

            {lastCheck && (
              <span style={{ fontSize: "10px", color: "#64748b", marginLeft: "auto" }}>
                {lastCheck.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}

            {backendStatus === "OFFLINE" && (
              <button
                type="button"
                onClick={loadSensorData}
                disabled={isRetrying}
                style={{
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "2px 6px",
                  fontSize: "10px",
                  cursor: "pointer",
                }}
              >
                {isRetrying ? "..." : "Retry"}
              </button>
            )}
          </div>

          {/* Vertical 4-Sensor Dock */}
          <SensorTabs sensorData={sensorData} />
        </div>


        {/* =====================================
            RIGHT: PRIMARY SENSOR VIEWPORT
            ===================================== */}
        <div className="sensors-right-col">
          <SensorViewer sensorData={sensorData} />
        </div>

      </div>

    </Layout>

  );
}


export default Sensors;
