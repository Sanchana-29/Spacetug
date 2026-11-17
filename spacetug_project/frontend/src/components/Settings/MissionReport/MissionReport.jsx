import { useCallback, useEffect, useState } from "react";
import { FaFilePdf, FaFileCode, FaFileCsv, FaSyncAlt, FaDatabase } from "react-icons/fa";
import jsPDF from "jspdf";
import { useMission } from "../../../context/MissionContext";
import { useSimulation } from "../../../context/SimulationContext";
import { usePerception } from "../../../context/PerceptionContext";
import { getMissionSummaryApi, getExportUrl, getRecentPoses } from "../../../services/api";

const f = (v, d = 2, unit = "") =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "--" : `${Number(v).toFixed(d)}${unit}`;
const st = (s, d = 3, unit = "") => (s ? `${f(s.mean, d)}${unit} (median ${f(s.median, d)}, n=${s.count})` : "--");

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const counts = (obj) =>
  Object.entries(obj || {})
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ") || "none";

const csv = (rows) =>
  rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : `"${String(c).replace(/"/g, '""')}"`)).join(",")).join("\n");

/** Build the report sections once, used both on screen and in the PDF. */
function buildSections(s, missionTime) {
  if (!s) return [];
  const m = s.mission || {};
  const d = s.detection || {};
  const pe = s.pose_estimation?.by_keypoint_source || {};
  const live = s.live_perception || {};
  const mo = live.motion || {};
  const co = live.collision || {};
  const sections = [
    {
      title: "1. Mission",
      rows: [
        ["Name", m.name],
        ["Mission ID", m.mission_id],
        ["Status", m.status],
        ["Chaser", m.chaser_model],
        ["Target", m.target_model || "SAT-001"],
        ["Orbit", m.orbit_regime],
        ["Initial separation", m.separation_distance != null ? `${m.separation_distance} m` : null],
        ["Simulation time (this session)", `${f(missionTime, 1)} s`],
      ],
    },
    {
      title: "2. Detection (YOLOv8n)",
      rows: [
        ["Frames processed", d.frames_processed],
        ["Frames with target", `${d.frames_with_target ?? 0} (${f(d.detection_rate_pct, 1, "%")})`],
        ["Confidence", st(d.confidence, 3)],
        ["Frames by sensor", Object.entries(d.frames_by_sensor || {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "--"],
      ],
    },
  ];
  const poseRows = Object.entries(pe).map(([src, e]) => [
    src === "LANDMARKS" ? "Landmarks + solvePnP" : `${src} feature matching`,
    `solved ${e.solved}/${e.attempts}` +
      (e.identification_rate_pct != null ? `, identified ${f(e.identification_rate_pct, 1, "%")}` : "") +
      ` | rot err ${st(e.rotation_error_deg, 2, "°")} | trans err ${st(e.translation_error_m, 4, " m")}`,
  ]);
  sections.push({
    title: "3. 6-DoF pose estimation",
    rows: poseRows.length ? poseRows : [["Pose estimates", "none recorded"]],
  });
  sections.push({
    title: "4. Live perception: tracking, motion, collision",
    rows: [
      ["Steps processed", `${live.steps ?? 0} (sessions: ${live.sessions ?? 0})`],
      ["Frames with confirmed track", live.steps_with_track ?? 0],
      ["Track IDs seen", (live.track_ids_seen || []).join(", ") || "--"],
      ["Max ID switches", live.max_id_switches ?? 0],
      ["Pose rotation error", st(live.pose_rotation_error_deg, 2, "°")],
      ["Range RMSE", f(mo.range_rmse_m, 4, " m")],
      ["Speed RMSE raw / Kalman", `${f(mo.speed_rmse_raw_mps, 4)} / ${f(mo.speed_rmse_filtered_mps, 4)} m/s`],
      ["Tumble RMSE raw / Kalman", `${f(mo.tumble_rmse_raw_dps, 3)} / ${f(mo.tumble_rmse_filtered_dps, 3)} °/s`],
      ["Collision assessments", `${co.assessments ?? 0} (${counts(co.risk_counts)})`],
      ["Closest predicted approach", `${f(co.min_cpa_distance_m, 3, " m")} | min TTC ${f(co.min_ttc_s, 1, " s")}`],
    ],
  });
  sections.push({
    title: "5. Mission events",
    rows: [
      ["Total events", `${s.events?.total ?? 0} (${counts(s.events?.by_level)})`],
      ...(s.events?.recent || []).slice(-8).map((e) => [e.level || "INFO", `${e.event || ""} ${e.message || ""}`.trim()]),
    ],
  });
  return sections;
}

function MissionReport({ notify }) {
  const { activeMission } = useMission() || {};
  const { missionTime } = useSimulation();
  const { history } = usePerception();
  const missionId = activeMission?.mission_id || null;
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await getMissionSummaryApi(missionId));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    let cancelled = false;
    getMissionSummaryApi(missionId)
      .then((d) => {
        if (!cancelled) {
          setSummary(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  const sections = buildSections(summary, missionTime);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const tag = missionId || "all";

  const exportPDF = () => {
    if (!summary) return notify("Load the summary first", "error");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    let y = 18;
    const line = (txt, size = 10, bold = false, color = [30, 41, 59]) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.splitTextToSize(String(txt), 180).forEach((l) => {
        if (y > 282) {
          doc.addPage();
          y = 18;
        }
        doc.text(l, 15, y);
        y += size * 0.45 + 1.2;
      });
    };
    line("Spacecraft Perception & Pose Estimation", 16, true, [15, 23, 42]);
    line("Mission Summary Report", 12, true, [2, 132, 199]);
    line(`Generated ${new Date().toLocaleString()}  |  Source: spaceDB (MongoDB)`, 9, false, [100, 116, 139]);
    y += 3;
    sections.forEach((sec) => {
      y += 2;
      line(sec.title, 12, true, [15, 23, 42]);
      sec.rows.forEach(([k, v]) => line(`${k}: ${v ?? "--"}`, 9.5));
    });
    y += 4;
    line("All values are computed from records stored during the mission. Errors are measured against the simulation ground truth.", 8, false, [100, 116, 139]);
    doc.save(`mission_report_${tag}_${stamp}.pdf`);
    notify("PDF report downloaded", "success");
  };

  const exportJSON = () => {
    if (!summary) return notify("Load the summary first", "error");
    download(`mission_summary_${tag}_${stamp}.json`, JSON.stringify({ summary, live_perception_samples: history }, null, 2), "application/json");
    notify("JSON summary downloaded", "success");
  };

  const exportPoses = async () => {
    try {
      const poses = await getRecentPoses(100, missionId);
      if (!poses.length) return notify("No pose estimates stored for this mission", "error");
      const rows = [["timestamp", "keypoint_source", "method", "x_m", "y_m", "z_m", "range_m", "roll_deg", "pitch_deg", "yaw_deg", "rmse_px", "rot_err_deg", "trans_err_m", "identified", "inliers"]];
      poses.forEach((p) =>
        rows.push([
          p.timestamp, p.keypoint_source || "LANDMARKS", p.method, p.position?.x, p.position?.y, p.position?.z, p.distance_m,
          p.attitude?.roll, p.attitude?.pitch, p.attitude?.yaw, p.reprojection_rmse_px,
          p.errors_vs_gt?.rotation_error_deg, p.errors_vs_gt?.translation_error_m, p.identified, p.inliers,
        ])
      );
      download(`poses_${tag}_${stamp}.csv`, csv(rows), "text/csv");
      notify("Pose CSV downloaded", "success");
    } catch (e) {
      notify(e.message, "error");
    }
  };

  const exportPerception = () => {
    if (!history.length) return notify("No live perception samples in this session", "error");
    const keys = Object.keys(history[0]);
    download(`live_perception_${tag}_${stamp}.csv`, csv([keys, ...history.map((h) => keys.map((k) => h[k]))]), "text/csv");
    notify("Live perception CSV downloaded", "success");
  };

  return (
    <div className="mr-wrap">
      <div className="mr-toolbar">
        <div>
          <strong>{summary?.mission?.name || activeMission?.name || "Mission"}</strong>
          <span className="st-hint"> · {missionId || "all missions"}</span>
        </div>
        <button type="button" className="st-btn-ghost" onClick={load} disabled={loading}>
          <FaSyncAlt /> {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mr-error">
          <FaDatabase /> Could not load the mission summary: {error}. The report is built from spaceDB, so MongoDB must be running.
        </div>
      )}

      <div className="mr-sections">
        {sections.map((sec) => (
          <section key={sec.title} className="st-card mr-card">
            <h3>{sec.title}</h3>
            <table>
              <tbody>
                {sec.rows.map(([k, v], i) => (
                  <tr key={`${k}-${i}`}>
                    <td>{k}</td>
                    <td>{v ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <section className="st-card">
        <h3>Downloads</h3>
        <div className="mr-downloads">
          <button type="button" className="st-btn-primary" onClick={exportPDF} disabled={!summary}>
            <FaFilePdf /> Mission report (PDF)
          </button>
          <button type="button" className="st-btn-ghost" onClick={exportJSON} disabled={!summary}>
            <FaFileCode /> Summary + live samples (JSON)
          </button>
          <a className="st-btn-ghost" href={getExportUrl("mission-report", missionId)}>
            <FaFileCode /> Full database archive (JSON)
          </a>
          <a className="st-btn-ghost" href={getExportUrl("detections-csv", missionId)}>
            <FaFileCsv /> Detections (CSV)
          </a>
          <button type="button" className="st-btn-ghost" onClick={exportPoses}>
            <FaFileCsv /> Pose estimates (CSV)
          </button>
          <button type="button" className="st-btn-ghost" onClick={exportPerception}>
            <FaFileCsv /> Live perception (CSV)
          </button>
        </div>
      </section>
    </div>
  );
}

export default MissionReport;
