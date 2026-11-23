import { useState, useMemo } from "react";
import Layout from "../components/Layout/Layout";
import "./Telemetry.css";

import { useSimulation } from "../context/SimulationContext";
import DistanceChart from "../components/Telemetry/DistanceChart/DistanceChart";
import VelocityChart from "../components/Telemetry/VelocityChart/VelocityChart";
import AttitudeChart from "../components/Telemetry/AttitudeChart/AttitudeChart";
import TumblingChart from "../components/Telemetry/TumblingChart/TumblingChart";
import TelemetryLogs from "../components/Telemetry/TelemetryLogs/TelemetryLogs";
import {
  FaClock,
  FaRuler,
  FaTachometerAlt,
  FaCompass,
  FaListAlt,
  FaDownload,
  FaTimes,
} from "react-icons/fa";

function Telemetry() {
  const {
    missionTime,
    isRunning,
    isRecording,
    setIsRecording,
    telemetryUpdateRate,
    setTelemetryUpdateRate,
    telemetrySamples,
    chaserPosition,
    targetPosition,
    angularVelocity,
    missionEvents,
  } = useSimulation();

  const [showLogsModal, setShowLogsModal] = useState(false);

  const formatTime = (seconds = 0) => {
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return [hours, minutes, secs]
      .map((v) => String(v).padStart(2, "0"))
      .join(":");
  };

  // Export recorded telemetry samples as CSV
  const handleExportCsv = () => {
    if (!telemetrySamples || telemetrySamples.length === 0) {
      alert("No telemetry samples recorded yet.");
      return;
    }
    const headers = ["time", "distance", "velocity", "roll", "pitch", "yaw", "tumblingRate"];
    const rows = telemetrySamples.map((s) => [
      s.time ?? 0,
      s.distance ?? 0,
      s.velocity ?? 0,
      s.roll ?? 0,
      s.pitch ?? 0,
      s.yaw ?? 0,
      s.tumblingRate ?? 0,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `telemetry_mission_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Quick live KPI values
  const kpis = useMemo(() => {
    const dx = (targetPosition?.x ?? 5.2) - (chaserPosition?.x ?? 0);
    const dy = (targetPosition?.y ?? 0) - (chaserPosition?.y ?? 0);
    const dz = (targetPosition?.z ?? 1.24) - (chaserPosition?.z ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    let lastVel = "--";
    for (let i = telemetrySamples.length - 1; i >= 0; i--) {
      if (Number.isFinite(telemetrySamples[i]?.velocity)) {
        lastVel = `${telemetrySamples[i].velocity.toFixed(3)} m/s`;
        break;
      }
    }

    const wx = angularVelocity?.x ?? 0;
    const wy = angularVelocity?.y ?? 0;
    const wz = angularVelocity?.z ?? 0;
    const rate = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const rateDeg = ((rate * 180) / Math.PI).toFixed(2);

    return {
      distance: `${dist.toFixed(2)} m`,
      velocity: lastVel,
      angularRate: `${rateDeg} °/s`,
    };
  }, [chaserPosition, targetPosition, angularVelocity, telemetrySamples]);

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="telemetry-viewport-container">
        {/* COMPACT UNIFIED COMMAND & KPI TOOLBAR */}
        <header className="telemetry-compact-toolbar">
          <div className="toolbar-left-group">
            <div className="telemetry-pill time-pill">
              <FaClock className="pill-icon" />
              <span>TIME:</span>
              <strong>{formatTime(missionTime)}</strong>
            </div>

            <div className="telemetry-pill rate-pill">
              <span>RATE:</span>
              <select
                value={String(telemetryUpdateRate)}
                onChange={(e) => setTelemetryUpdateRate(Number(e.target.value))}
                className="rate-select"
              >
                <option value="10">10 Hz</option>
                <option value="20">20 Hz</option>
                <option value="30">30 Hz</option>
              </select>
            </div>

            <button
              type="button"
              className={`telemetry-rec-btn ${isRecording ? "active" : ""}`}
              onClick={() => setIsRecording((prev) => !prev)}
              title="Toggle Telemetry Recording"
            >
              <span className="rec-dot" />
              {isRecording ? "REC ON" : "REC OFF"}
            </button>

            <span className={`telemetry-sim-status ${isRunning ? "running" : "paused"}`}>
              ● {isRunning ? "SIM RUNNING" : "SIM PAUSED"}
            </span>
          </div>

          {/* KPI CHIPS */}
          <div className="toolbar-mid-kpis">
            <div className="kpi-chip">
              <FaRuler className="kpi-icon cyan" />
              <span>DIST:</span>
              <strong>{kpis.distance}</strong>
            </div>
            <div className="kpi-chip">
              <FaTachometerAlt className="kpi-icon yellow" />
              <span>VEL:</span>
              <strong>{kpis.velocity}</strong>
            </div>
            <div className="kpi-chip">
              <FaCompass className="kpi-icon green" />
              <span>ROT:</span>
              <strong>{kpis.angularRate}</strong>
            </div>
          </div>

          {/* ACTION BUTTONS: EXPORT & LOGS */}
          <div className="toolbar-right-actions">
            <button
              type="button"
              className="action-btn export-btn"
              onClick={handleExportCsv}
              title="Export recorded telemetry data as CSV"
            >
              <FaDownload />
              <span>CSV</span>
            </button>

            <button
              type="button"
              className={`action-btn logs-btn ${showLogsModal ? "active" : ""}`}
              onClick={() => setShowLogsModal((prev) => !prev)}
              title="Toggle Mission Event Logs Drawer"
            >
              <FaListAlt />
              <span>LOGS ({missionEvents?.length || 0})</span>
            </button>
          </div>
        </header>

        {/* 2x2 CORE TELEMETRY GRAPHS (FILLS 100% OF REMAINING VERTICAL SPACE, NO SCROLL) */}
        <div className="telemetry-core-charts-grid">
          <DistanceChart />
          <VelocityChart />
          <AttitudeChart />
          <TumblingChart />
        </div>

        {/* OPTIONAL SLIDE-OUT / MODAL DRAWER FOR MISSION LOGS */}
        {showLogsModal && (
          <div className="telemetry-logs-drawer-backdrop" onClick={() => setShowLogsModal(false)}>
            <div className="telemetry-logs-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-header">
                <h4>MISSION TELEMETRY EVENT LOGS</h4>
                <button
                  type="button"
                  className="drawer-close-btn"
                  onClick={() => setShowLogsModal(false)}
                >
                  <FaTimes />
                </button>
              </div>
              <div className="drawer-body">
                <TelemetryLogs />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default Telemetry;
