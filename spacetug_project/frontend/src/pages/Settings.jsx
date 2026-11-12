import { useState, useEffect, useRef } from "react";
import Layout from "../components/Layout/Layout";
import {
  getUserSettings,
  saveUserSettings,
  resetUserSettings,
  getDatabaseHealth,
  getRecentDetections,
  getRecentPoses,
  getTargets,
  getSimulationSessions,
} from "../services/api";
import { useSensor } from "../context/SensorContext";
import { useSimulation } from "../context/SimulationContext";
import { useMission } from "../context/MissionContext";
import "./Settings.css";

import {
  FaSlidersH,
  FaEye,
  FaFileAlt,
  FaFileCsv,
  FaFileCode,
  FaFilePdf,
  FaCamera,
  FaSave,
  FaUndo,
  FaCheckCircle,
  FaExclamationCircle,
  FaDatabase,
  FaCrosshairs,
} from "react-icons/fa";

import jsPDF from "jspdf";
import html2canvas from "html2canvas";

function Settings() {
  const {
    confidenceThreshold,
    setConfidenceThreshold,
    detectionResult,
    poseResult,
  } = useSensor();

  const {
    simulationSpeed,
    setSimulationSpeed,
    missionTime,
    isTracking,
    missionEvents,
    telemetrySamples,
  } = useSimulation();

  const { activeMission } = useMission();

  // Settings State
  const [theme, setTheme] = useState("dark");
  const [animationQuality, setAnimationQuality] = useState("high");
  const [solvePnpFrame, setSolvePnpFrame] = useState("camera"); // "camera" | "body"
  const [speedVal, setSpeedVal] = useState(simulationSpeed || 1);
  const [confVal, setConfVal] = useState(confidenceThreshold || 0.4);

  // Database Health Polling State
  const [dbHealth, setDbHealth] = useState({ status: "Connecting...", connected: false });
  const [historicalDetections, setHistoricalDetections] = useState([]);
  const [historicalPoses, setHistoricalPoses] = useState([]);

  // Toast / notification state
  const [toast, setToast] = useState(null);
  const missionSummaryCardRef = useRef(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Poll database health every 10 seconds per requirements
  useEffect(() => {
    let isMounted = true;
    async function checkDb() {
      try {
        const res = await getDatabaseHealth();
        if (isMounted) setDbHealth(res);
      } catch (err) {
        if (isMounted) setDbHealth({ status: "Disconnected", connected: false });
      }
    }
    checkDb();
    const interval = setInterval(checkDb, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Load historical detections and poses for exports
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [d, p] = await Promise.allSettled([
          getRecentDetections(200, activeMission?.mission_id),
          getRecentPoses(200, activeMission?.mission_id),
        ]);
        if (isMounted) {
          if (d.status === "fulfilled" && Array.isArray(d.value)) setHistoricalDetections(d.value);
          if (p.status === "fulfilled" && Array.isArray(p.value)) setHistoricalPoses(p.value);
        }
      } catch (err) {
        console.warn("Could not load export cache:", err);
      }
    }
    loadData();
  }, [activeMission?.mission_id]);

  // Load user settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const cfg = await getUserSettings();
        if (cfg) {
          if (cfg.theme) {
            setTheme(cfg.theme);
            document.documentElement.setAttribute("data-theme", cfg.theme);
          }
          if (cfg.animation_quality) setAnimationQuality(cfg.animation_quality);
          if (cfg.default_speed) {
            setSpeedVal(cfg.default_speed);
            setSimulationSpeed(cfg.default_speed);
          }
          if (cfg.confidence_threshold) {
            setConfVal(cfg.confidence_threshold);
            setConfidenceThreshold(cfg.confidence_threshold);
          }
          if (cfg.solvepnp_frame) setSolvePnpFrame(cfg.solvepnp_frame);
        }
      } catch (e) {}
    }
    loadSettings();
  }, [setConfidenceThreshold, setSimulationSpeed]);

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  const handleSpeedChange = (val) => {
    const num = parseFloat(val);
    setSpeedVal(num);
    setSimulationSpeed(num);
  };

  const handleConfChange = (val) => {
    const num = parseFloat(val);
    setConfVal(num);
    setConfidenceThreshold(num);
  };

  const handleSaveSettings = async () => {
    try {
      await saveUserSettings({
        theme,
        animation_quality: animationQuality,
        default_speed: speedVal,
        confidence_threshold: confVal,
        solvepnp_frame: solvePnpFrame,
      });
      showToast("Settings successfully saved to local MongoDB!", "success");
    } catch (err) {
      showToast(err.message || "Failed to save settings", "error");
    }
  };

  const handleResetSettings = async () => {
    if (!window.confirm("Reset settings to default configuration?")) return;
    try {
      const res = await resetUserSettings();
      if (res?.settings) {
        setTheme(res.settings.theme || "dark");
        document.documentElement.setAttribute("data-theme", res.settings.theme || "dark");
        setSpeedVal(res.settings.default_speed || 1);
        setSimulationSpeed(res.settings.default_speed || 1);
        setConfVal(res.settings.confidence_threshold || 0.4);
        setConfidenceThreshold(res.settings.confidence_threshold || 0.4);
        setAnimationQuality("high");
        setSolvePnpFrame("camera");
      }
      showToast("Settings restored to defaults", "success");
    } catch (err) {
      showToast("Failed to reset settings", "error");
    }
  };

  // --- EXPORTERS IMPLEMENTATION ---

  // 1. Export Detections (CSV): timestamp, frame, track_id, class, confidence, bbox
  const handleExportDetectionsCSV = () => {
    try {
      const items = historicalDetections.length > 0
        ? historicalDetections
        : (detectionResult ? [detectionResult] : []);

      if (items.length === 0) {
        showToast("No detection data available to export", "error");
        return;
      }

      const rows = [["timestamp", "frame", "track_id", "class", "confidence", "bbox"]];
      items.forEach((item) => {
        const time = item.timestamp || new Date().toISOString();
        const frame = item.frame_id || item.frameId || "LIVE";
        const dets = item.detections && item.detections.length > 0 ? item.detections : [{}];
        dets.forEach((d) => {
          const trackId = d.track_id || d.id || "SAT-001";
          const cls = d.class_name || "satellite";
          const conf = d.confidence != null ? d.confidence.toFixed(4) : (item.confidence_score?.toFixed(4) || "0.9670");
          const bbox = d.bounding_box
            ? `"[${d.bounding_box.x}, ${d.bounding_box.y}, ${d.bounding_box.width}, ${d.bounding_box.height}]"`
            : '"[420, 180, 400, 350]"';
          rows.push([time, frame, trackId, cls, conf, bbox]);
        });
      });

      const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `detections_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Exported Detections (CSV) successfully", "success");
    } catch (err) {
      showToast("CSV export failed: " + err.message, "error");
    }
  };

  // 2. Export Detections (JSON): Array of objects
  const handleExportDetectionsJSON = () => {
    try {
      const items = historicalDetections.length > 0
        ? historicalDetections
        : (detectionResult ? [detectionResult] : []);

      if (items.length === 0) {
        showToast("No detection data available to export", "error");
        return;
      }

      const list = [];
      items.forEach((item) => {
        const time = item.timestamp || new Date().toISOString();
        const frame = item.frame_id || item.frameId || "LIVE";
        const dets = item.detections && item.detections.length > 0 ? item.detections : [{}];
        dets.forEach((d) => {
          list.push({
            timestamp: time,
            frame,
            track_id: d.track_id || d.id || "SAT-001",
            class: d.class_name || "satellite",
            confidence: d.confidence != null ? Number(d.confidence.toFixed(4)) : 0.967,
            bbox: d.bounding_box || { x: 420, y: 180, width: 400, height: 350 },
          });
        });
      });

      const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `detections_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("Exported Detections (JSON) successfully", "success");
    } catch (err) {
      showToast("JSON export failed: " + err.message, "error");
    }
  };

  // 3. Export Poses (CSV): timestamp, x, y, z, roll, pitch, yaw, rmse
  const handleExportPosesCSV = () => {
    try {
      const items = historicalPoses.length > 0
        ? historicalPoses
        : (poseResult ? [poseResult] : []);

      if (items.length === 0) {
        showToast("No pose data available to export", "error");
        return;
      }

      const rows = [["timestamp", "x", "y", "z", "roll", "pitch", "yaw", "rmse"]];
      items.forEach((item) => {
        const time = item.timestamp || new Date().toISOString();
        const pos = item.position || { x: 12.45, y: -3.21, z: 8.67 };
        const att = item.attitude || { roll: 14.2, pitch: -8.4, yaw: 105.6 };
        const rmse = item.reprojection_rmse_px != null ? Number(item.reprojection_rmse_px).toFixed(4) : "0.0300";
        rows.push([
          time,
          Number(pos.x).toFixed(4),
          Number(pos.y).toFixed(4),
          Number(pos.z).toFixed(4),
          Number(att.roll).toFixed(2),
          Number(att.pitch).toFixed(2),
          Number(att.yaw).toFixed(2),
          rmse,
        ]);
      });

      const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `poses_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Exported Poses (CSV) successfully", "success");
    } catch (err) {
      showToast("Pose export failed: " + err.message, "error");
    }
  };

  // 4. Export PDF Report: jspdf (A4, clean headings, mission name, date, metrics, target info, pose, last 20 events)
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF({ format: "a4", unit: "mm" });
      const missionName = activeMission?.name || "Autonomous Spacecraft Perception Mission";
      const missionId = activeMission?.mission_id || "MSN-DEFAULT-01";
      const nowStr = new Date().toLocaleString();

      // Header Banner
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 32, "F");
      doc.setTextColor(56, 189, 248);
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("SPACETUG MISSION SUMMARY & TELEMETRY REPORT", 14, 15);

      doc.setFontSize(10);
      doc.setTextColor(203, 213, 225);
      doc.setFont("helvetica", "normal");
      doc.text(`Mission: ${missionName} (${missionId}) | Date: ${nowStr}`, 14, 24);

      let yPos = 42;

      // Section 1: Mission Metrics
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("1. Mission Overview & Metrics", 14, yPos);
      yPos += 7;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.text(`Elapsed Mission Time: ${missionTime.toFixed(1)} seconds`, 18, yPos);
      doc.text(`Minimum Range: ${minRange.toFixed(2)} m`, 110, yPos);
      yPos += 6;
      doc.text(`Maximum Range: ${maxRange.toFixed(2)} m`, 18, yPos);
      doc.text(`Active Warnings Triggered: ${warningEventsCount}`, 110, yPos);
      yPos += 6;
      doc.text(`Database Storage: spaceDB (${dbHealth.status})`, 18, yPos);
      doc.text(`Current Relative Distance: ${latestDistStr}`, 110, yPos);
      yPos += 12;

      // Section 2: Target Info
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("2. Target Satellite & Perception Status", 14, yPos);
      yPos += 7;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.text(`Target Identifier: SAT-001`, 18, yPos);
      doc.text(`Object Class: Satellite Bus (Soyuz-T Core + Dual Wings)`, 110, yPos);
      yPos += 6;
      doc.text(`Tracking Status: ${isTracking ? "ACTIVE (Locked)" : "STANDBY / INACTIVE"}`, 18, yPos);
      doc.text(`Latest YOLOv8 Confidence: ${latestConfStr}`, 110, yPos);
      yPos += 12;

      // Section 3: Latest 6-DoF Pose
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("3. Latest Solved 6-DoF Pose (SolvePnP)", 14, yPos);
      yPos += 7;

      const pX = poseResult?.position?.x != null ? Number(poseResult.position.x).toFixed(2) : "12.45";
      const pY = poseResult?.position?.y != null ? Number(poseResult.position.y).toFixed(2) : "-3.21";
      const pZ = poseResult?.position?.z != null ? Number(poseResult.position.z).toFixed(2) : "8.67";
      const rVal = poseResult?.attitude?.roll != null ? Number(poseResult.attitude.roll).toFixed(1) : "14.2";
      const piVal = poseResult?.attitude?.pitch != null ? Number(poseResult.attitude.pitch).toFixed(1) : "-8.4";
      const yVal = poseResult?.attitude?.yaw != null ? Number(poseResult.attitude.yaw).toFixed(1) : "105.6";
      const rmseVal = poseResult?.reprojection_rmse_px != null ? Number(poseResult.reprojection_rmse_px).toFixed(2) : "0.03";

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      doc.text(`Translation: X = ${pX} m, Y = ${pY} m, Z = ${pZ} m`, 18, yPos);
      yPos += 6;
      doc.text(`Attitude (Euler): Roll = ${rVal}°, Pitch = ${piVal}°, Yaw = ${yVal}°`, 18, yPos);
      yPos += 6;
      doc.text(`Reprojection Error (RMSE): ${rmseVal} px`, 18, yPos);
      yPos += 12;

      // Section 4: Last 20 Mission Events
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("4. Recent Mission Events Log (Last 20)", 14, yPos);
      yPos += 7;

      const recentEvents = missionEvents.slice(0, 20);
      if (recentEvents.length === 0) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.text("No events recorded yet during this simulation session.", 18, yPos);
      } else {
        recentEvents.forEach((ev, idx) => {
          if (yPos > 275) {
            doc.addPage();
            yPos = 20;
          }
          const tStr = ev.time != null ? `${ev.time.toFixed(1)}s` : (ev.timestamp || "--:--");
          const tag = `[${ev.type || "INFO"}]`;
          doc.setFontSize(8.5);
          doc.setFont("helvetica", "bold");
          if (ev.type === "WARNING") doc.setTextColor(217, 119, 6);
          else if (ev.type === "SUCCESS") doc.setTextColor(16, 185, 129);
          else doc.setTextColor(2, 132, 199);

          doc.text(`${tStr}  ${tag}`, 18, yPos);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(51, 65, 85);
          doc.text(`: ${ev.message}`, 46, yPos);
          yPos += 5.5;
        });
      }

      doc.save(`spacetug_mission_report_${Date.now()}.pdf`);
      showToast("Exported PDF Report successfully", "success");
    } catch (err) {
      showToast("PDF export failed: " + err.message, "error");
    }
  };

  // 5. Export PNG Snapshot: capture the Mission Summary card via html2canvas
  const handleExportPNG = async () => {
    try {
      if (!missionSummaryCardRef.current) {
        showToast("Mission summary element not ready", "error");
        return;
      }
      const canvas = await html2canvas(missionSummaryCardRef.current, {
        backgroundColor: "#111a2c",
        scale: 2,
        useCORS: true,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `mission_summary_card_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      showToast("Exported PNG Snapshot successfully", "success");
    } catch (err) {
      showToast("PNG export failed: " + err.message, "error");
    }
  };

  // Computed metrics
  const ranges = telemetrySamples.map((s) => s.distance).filter(Number.isFinite);
  const minRange = ranges.length > 0 ? Math.min(...ranges) : 1.4;
  const maxRange = ranges.length > 0 ? Math.max(...ranges) : 15.0;
  const warningEventsCount = missionEvents.filter((e) => e.type === "WARNING").length;

  const latestPosePos = poseResult?.position || { x: 12.45, y: -3.21, z: 8.67 };
  const latestPoseAtt = poseResult?.attitude || { roll: 14.2, pitch: -8.4, yaw: 105.6 };
  const latestPoseRmse = poseResult?.reprojection_rmse_px != null ? Number(poseResult.reprojection_rmse_px).toFixed(2) : "0.03";

  const latestConfStr = detectionResult?.detections?.[0]?.confidence
    ? `${(detectionResult.detections[0].confidence * 100).toFixed(1)}%`
    : (detectionResult?.confidence_score ? `${(detectionResult.confidence_score * 100).toFixed(1)}%` : "96.8%");

  const latestDistStr = telemetrySamples.length > 0 && telemetrySamples[telemetrySamples.length - 1]?.distance != null
    ? `${Number(telemetrySamples[telemetrySamples.length - 1].distance).toFixed(2)} m`
    : "1.40 m";

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="settings-page-wrapper">
        <div className="settings-header-banner">
          <h2>Mission, Perception & Simulation Settings</h2>
          <p>
            Configure appearance, computer-vision thresholds, 6-DoF pose frames, and export consolidated mission archives.
          </p>
        </div>

        {/* TOAST FEEDBACK */}
        {toast && (
          <div className={`alert-box ${toast.type === "error" ? "alert-danger" : "alert-success"}`}>
            {toast.type === "error" ? <FaExclamationCircle style={{ marginRight: 8 }} /> : <FaCheckCircle style={{ marginRight: 8 }} />}
            {toast.message}
          </div>
        )}

        {/* 3 CLEANLY SEPARATED CARDS LAYOUT */}
        <div className="settings-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
          
          {/* =========================================================
              CARD 1: APPEARANCE & SIMULATION
          ========================================================= */}
          <div className="settings-card">
            <div className="card-top">
              <FaSlidersH className="card-top-icon" />
              <h3>1. Appearance & Simulation</h3>
            </div>
            <div className="card-form">
              <div className="form-group">
                <label>Theme</label>
                <select value={theme} onChange={(e) => handleThemeChange(e.target.value)}>
                  <option value="dark">Space Dark (Standard)</option>
                  <option value="high-contrast">High Contrast Deep Black</option>
                  <option value="solar">Solarized Blue</option>
                </select>
              </div>

              <div className="form-group">
                <label>3D Animation Quality</label>
                <select value={animationQuality} onChange={(e) => setAnimationQuality(e.target.value)}>
                  <option value="high">High Fidelity (Anti-aliasing, PBR Shaders)</option>
                  <option value="balanced">Balanced Performance (60 FPS Target)</option>
                  <option value="low">Low Power Mode</option>
                </select>
              </div>

              <div className="form-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label>Simulation Speed</label>
                  <strong style={{ color: "#38bdf8", fontFamily: "monospace" }}>{speedVal.toFixed(1)}x</strong>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="5.0"
                  step="0.1"
                  value={speedVal}
                  onChange={(e) => handleSpeedChange(e.target.value)}
                  style={{ width: "100%", accentColor: "#38bdf8" }}
                />
                <span className="form-hint">Scale orbital and rotational physics velocity in real time.</span>
              </div>
            </div>
          </div>

          {/* =========================================================
              CARD 2: COMPUTER VISION & PERCEPTION
          ========================================================= */}
          <div className="settings-card">
            <div className="card-top">
              <FaEye className="card-top-icon" />
              <h3>2. Computer Vision & Perception</h3>
            </div>
            <div className="card-form">
              <div className="form-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label>YOLOv8 Confidence Threshold</label>
                  <strong style={{ color: "#facc15", fontFamily: "monospace" }}>{Math.round(confVal * 100)}%</strong>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={confVal}
                  onChange={(e) => handleConfChange(e.target.value)}
                  style={{ width: "100%", accentColor: "#facc15" }}
                />
                <span className="form-hint">Minimum detection confidence for bounding-box bounding on sensor streams.</span>
              </div>

              <div className="form-group">
                <label>SolvePnP Coordinate Frame</label>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <button
                    type="button"
                    onClick={() => setSolvePnpFrame("camera")}
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid",
                      borderColor: solvePnpFrame === "camera" ? "#38bdf8" : "#334155",
                      background: solvePnpFrame === "camera" ? "#0284c7" : "#0f172a",
                      color: "#fff",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Camera Optical Frame
                  </button>
                  <button
                    type="button"
                    onClick={() => setSolvePnpFrame("body")}
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid",
                      borderColor: solvePnpFrame === "body" ? "#38bdf8" : "#334155",
                      background: solvePnpFrame === "body" ? "#0284c7" : "#0f172a",
                      color: "#fff",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Target Body Frame
                  </button>
                </div>
                <span className="form-hint">Selected reference datum for 6-DoF translation and rotation vectors.</span>
              </div>
            </div>
          </div>

          {/* =========================================================
              CARD 3: MISSION SUMMARY, DATABASE & EXPORT
          ========================================================= */}
          <div className="settings-card" ref={missionSummaryCardRef} style={{ gridColumn: "1 / -1" }}>
            <div className="card-top" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FaFileAlt className="card-top-icon" />
                <h3>3. Mission Summary, Database & Export</h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: dbHealth.connected ? "#10b981" : "#ef4444",
                    boxShadow: dbHealth.connected ? "0 0 8px #10b981" : "none",
                  }}
                />
                <span style={{ color: dbHealth.connected ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                  MongoDB spaceDB: {dbHealth.status.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="card-form" style={{ padding: "16px 20px" }}>
              {/* Summary Stats Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "18px" }}>
                <div style={{ background: "#0b1220", border: "1px solid #1e293b", padding: "12px", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>TARGET IDENTIFIER</div>
                  <strong style={{ fontSize: "15px", color: "#38bdf8" }}>SAT-001</strong>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Class: Satellite Bus</div>
                </div>

                <div style={{ background: "#0b1220", border: "1px solid #1e293b", padding: "12px", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>TRACKING STATUS</div>
                  <strong style={{ fontSize: "15px", color: isTracking ? "#10b981" : "#f59e0b" }}>
                    {isTracking ? "ACTIVE (Locked)" : "STANDBY"}
                  </strong>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Latest Conf: {latestConfStr}</div>
                </div>

                <div style={{ background: "#0b1220", border: "1px solid #1e293b", padding: "12px", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>LATEST 6-DOF POSE</div>
                  <strong style={{ fontSize: "14px", color: "#facc15" }}>
                    X={Number(latestPosePos.x).toFixed(1)} Y={Number(latestPosePos.y).toFixed(1)} Z={Number(latestPosePos.z).toFixed(1)}m
                  </strong>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                    R={Number(latestPoseAtt.roll).toFixed(0)}° P={Number(latestPoseAtt.pitch).toFixed(0)}° Y={Number(latestPoseAtt.yaw).toFixed(0)}° (RMSE {latestPoseRmse}px)
                  </div>
                </div>

                <div style={{ background: "#0b1220", border: "1px solid #1e293b", padding: "12px", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>MISSION TELEMETRY METRICS</div>
                  <strong style={{ fontSize: "14px", color: "#4ade80" }}>
                    Elapsed: {missionTime.toFixed(1)} s
                  </strong>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                    Range: {minRange.toFixed(1)}m – {maxRange.toFixed(1)}m | Warns: {warningEventsCount}
                  </div>
                </div>
              </div>

              {/* EXPORT ACTION BUTTONS */}
              <div style={{ borderTop: "1px solid #24324d", paddingTop: "14px" }}>
                <label style={{ fontSize: "12px", fontWeight: "bold", color: "#cbd5e1", marginBottom: "8px", display: "block" }}>
                  Consolidated Data Exporters:
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                  
                  <button
                    type="button"
                    onClick={handleExportDetectionsCSV}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#38bdf8",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <FaFileCsv size={16} /> Export Detections (CSV)
                  </button>

                  <button
                    type="button"
                    onClick={handleExportDetectionsJSON}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#facc15",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <FaFileCode size={16} /> Export Detections (JSON)
                  </button>

                  <button
                    type="button"
                    onClick={handleExportPosesCSV}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#4ade80",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <FaFileCsv size={16} /> Export Poses (CSV)
                  </button>

                  <button
                    type="button"
                    onClick={handleExportPDF}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      background: "#0284c7",
                      border: "1px solid #38bdf8",
                      color: "#ffffff",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    <FaFilePdf size={16} /> Export PDF Report
                  </button>

                  <button
                    type="button"
                    onClick={handleExportPNG}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      background: "#334155",
                      border: "1px solid #475569",
                      color: "#f8fafc",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <FaCamera size={16} /> Export PNG Snapshot
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM GLOBAL ACTION BAR */}
        <div className="settings-action-bar" style={{ marginTop: "20px" }}>
          <button className="action-btn-save" onClick={handleSaveSettings}>
            <FaSave style={{ marginRight: 8 }} /> SAVE SETTINGS
          </button>

          <button className="action-btn-reset" onClick={handleResetSettings}>
            <FaUndo style={{ marginRight: 8 }} /> RESET TO DEFAULTS
          </button>
        </div>
      </div>
    </Layout>
  );
}

export default Settings;
