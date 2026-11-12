import { useState, useEffect } from "react";
import Layout from "../components/Layout/Layout";
import {
  getTargets,
  getRecentDetections,
  getRecentPoses,
  getSimulationSessions,
  getExportUrl,
} from "../services/api";
import { useMission } from "../context/MissionContext";
import "./MissionSummary.css";

import {
  FaFileCsv,
  FaFileCode,
  FaFileAlt,
  FaDownload,
  FaFlag,
} from "react-icons/fa";

function MissionSummary() {
  const { activeMission, missions, setActiveMission } = useMission();
  const [targets, setTargets] = useState([]);
  const [detections, setDetections] = useState([]);
  const [poses, setPoses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSummary() {
      try {
        const [t, d, p, s] = await Promise.allSettled([
          getTargets(),
          getRecentDetections(100, activeMission?.mission_id),
          getRecentPoses(100, activeMission?.mission_id),
          getSimulationSessions(50, activeMission?.mission_id),
        ]);
        if (t.status === "fulfilled") setTargets(t.value);
        if (d.status === "fulfilled") setDetections(d.value);
        if (p.status === "fulfilled") setPoses(p.value);
        if (s.status === "fulfilled") setSessions(s.value);
      } catch (err) {
        console.error("Summary load error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSummary();
  }, [activeMission?.mission_id]);

  const totalDetections = detections.length;
  const positiveDetections = detections.filter((d) => d.detected).length;
  const totalPoses = poses.length;
  const avgRmse =
    totalPoses > 0
      ? (
          poses.reduce((acc, p) => acc + (p.reprojection_rmse_px || 0), 0) /
          totalPoses
        ).toFixed(2)
      : "N/A";

  const triggerDownload = (url) => {
    window.open(url, "_blank");
  };

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="mission-page-container">
        <div className="mission-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2>Mission Summary & Telemetry Export</h2>
            <p>
              Review automated computer-vision telemetry, historical pose data, and export
              processing archives directly from <code>spaceDB</code>.
            </p>
          </div>

          {/* MISSION SELECTOR DROPDOWN */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#111a2c", padding: "8px 14px", borderRadius: "8px", border: "1px solid #24324d" }}>
            <FaFlag style={{ color: "#38bdf8" }} />
            <label style={{ fontSize: "12px", color: "#94a3b8" }}>Selected Mission:</label>
            <select
              value={activeMission?.mission_id || ""}
              onChange={(e) => {
                const found = missions.find((m) => m.mission_id === e.target.value);
                if (found) setActiveMission(found);
              }}
              style={{ background: "#0b1020", color: "#f1f5f9", border: "1px solid #334155", padding: "6px 10px", borderRadius: "4px", fontSize: "12px", outline: "none" }}
            >
              {missions.map((m) => (
                <option key={m.mission_id} value={m.mission_id}>
                  {m.name} ({m.mission_id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* METRICS SUMMARY */}
        <div className="summary-metrics-row">
          <div className="metric-box">
            <span className="metric-title">TARGET SPACECRAFT</span>
            <strong className="metric-number">{activeMission?.target_id || targets[0]?.target_id || "SAT-001"}</strong>
            <span className="metric-sub">{targets[0]?.name || "Standard Satellite"}</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">PROCESSED FRAMES</span>
            <strong className="metric-number">{totalDetections}</strong>
            <span className="metric-sub">{positiveDetections} targets confirmed</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">SOLVED 6-DOF POSES</span>
            <strong className="metric-number">{totalPoses}</strong>
            <span className="metric-sub">Avg RMSE: {avgRmse} px</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">PERSISTENT DB</span>
            <strong className="metric-number text-green">spaceDB</strong>
            <span className="metric-sub">Local MongoDB Service</span>
          </div>
        </div>

        {/* EXPORT ACTIONS SUITE */}
        <div className="export-panel">
          <h3>
            <FaDownload style={{ marginRight: 8, color: "#38bdf8" }} />
            Data Export & Telemetry Reports
          </h3>
          <p className="panel-desc">
            Export processed perception data and pose estimations filtered by mission: <strong>{activeMission?.mission_id || "ALL"}</strong>
          </p>

          <div className="export-buttons-grid">
            <button
              className="export-btn csv"
              onClick={() => triggerDownload(getExportUrl("detections-csv", activeMission?.mission_id))}
            >
              <FaFileCsv size={20} />
              <div>
                <strong>Export Detections (CSV)</strong>
                <span>All timestamps, bounding boxes & confidence scores</span>
              </div>
            </button>

            <button
              className="export-btn json"
              onClick={() => triggerDownload(getExportUrl("detections-json", activeMission?.mission_id))}
            >
              <FaFileCode size={20} />
              <div>
                <strong>Export Detections (JSON)</strong>
                <span>Structured JSON array of processed inference frames</span>
              </div>
            </button>

            <button
              className="export-btn csv"
              onClick={() => triggerDownload(getExportUrl("poses-csv", activeMission?.mission_id))}
            >
              <FaFileCsv size={20} />
              <div>
                <strong>Export 6-DoF Poses (CSV)</strong>
                <span>Positions (X,Y,Z), attitude angles & reprojection errors</span>
              </div>
            </button>

            <button
              className="export-btn report"
              onClick={() => triggerDownload(getExportUrl("mission-report", activeMission?.mission_id))}
            >
              <FaFileAlt size={20} />
              <div>
                <strong>Full Mission Report (JSON)</strong>
                <span>Consolidated targets, detections, poses & activities</span>
              </div>
            </button>
          </div>
        </div>

        {/* HISTORICAL DETECTIONS TABLE */}
        <div className="data-table-section">
          <h3>Mission Sensor Detections ({activeMission?.mission_id || "Active"})</h3>
          <div className="table-responsive">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Frame ID</th>
                  <th>Sensor</th>
                  <th>Result</th>
                  <th>Confidence</th>
                  <th>Bounding Box (X, Y, W, H)</th>
                  <th>Image File</th>
                </tr>
              </thead>
              <tbody>
                {detections.length > 0 ? (
                  detections.slice(0, 15).map((d, i) => (
                    <tr key={d.id || i}>
                      <td>{d.timestamp ? new Date(d.timestamp).toLocaleString() : "--"}</td>
                      <td><code>{d.frame_id || "--"}</code></td>
                      <td>{d.sensor_name || "RGB-D"}</td>
                      <td>
                        <span className={`badge ${d.detected ? "badge-success" : "badge-danger"}`}>
                          {d.detected ? "DETECTED" : "ABSENT"}
                        </span>
                      </td>
                      <td>
                        {d.detections?.[0]?.confidence
                          ? `${(d.detections[0].confidence * 100).toFixed(1)}%`
                          : "--"}
                      </td>
                      <td>
                        {d.detections?.[0]?.bounding_box ? (
                          <span>
                            [{d.detections[0].bounding_box.x},{" "}
                            {d.detections[0].bounding_box.y},{" "}
                            {d.detections[0].bounding_box.width},{" "}
                            {d.detections[0].bounding_box.height}]
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td>
                        {d.annotated_image_filename ? (
                          <a
                            href={`http://127.0.0.1:8000/api/images/${d.annotated_image_filename}`}
                            target="_blank"
                            rel="noreferrer"
                            className="download-link"
                          >
                            Download PNG
                          </a>
                        ) : (
                          "--"
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="empty-cell">
                      No detection records found for this mission in spaceDB.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default MissionSummary;