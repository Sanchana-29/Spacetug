import { useState } from "react";
import { FaPlay, FaEye, FaShieldAlt, FaFingerprint, FaSave, FaUndo } from "react-icons/fa";
import { useSimulation } from "../../../context/SimulationContext";
import { useSensor } from "../../../context/SensorContext";
import { usePerception } from "../../../context/PerceptionContext";
import { saveUserSettings, resetUserSettings } from "../../../services/api";

const DEFAULTS = {
  default_speed: 1.0,
  confidence_threshold: 0.4,
  live_rate_fps: 2,
  live_noise_px: 1,
  safety_radius_m: 1.0,
  collision_horizon_s: 60,
  feature_min_inliers: 15,
  feature_min_inlier_ratio: 0.4,
};

function Slider({ label, value, min, max, step, unit = "", digits = 1, onChange, hint }) {
  return (
    <div className="st-field">
      <div className="st-field-head">
        <label>{label}</label>
        <strong>
          {Number(value).toFixed(digits)}
          {unit}
        </strong>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="st-hint">{hint}</span>}
    </div>
  );
}

/** Only settings that are actually used by the app. Saved to spaceDB and applied at start-up. */
function GeneralSettings({ notify }) {
  const { simulationSpeed, setSimulationSpeed } = useSimulation();
  const { confidenceThreshold, setConfidenceThreshold } = useSensor();
  const p = usePerception();
  const [busy, setBusy] = useState(false);

  const current = {
    default_speed: Number(simulationSpeed) || 1,
    confidence_threshold: Number(confidenceThreshold) || 0.4,
    live_rate_fps: p.liveRate,
    live_noise_px: p.liveNoise,
    safety_radius_m: p.safetyRadius,
    collision_horizon_s: p.collisionHorizon,
    feature_min_inliers: p.featureMinInliers,
    feature_min_inlier_ratio: p.featureMinRatio,
  };

  const apply = (cfg) => {
    setSimulationSpeed(cfg.default_speed);
    setConfidenceThreshold(cfg.confidence_threshold);
    p.setLiveRate(cfg.live_rate_fps);
    p.setLiveNoise(cfg.live_noise_px);
    p.setSafetyRadius(cfg.safety_radius_m);
    p.setCollisionHorizon(cfg.collision_horizon_s);
    p.setFeatureMinInliers(cfg.feature_min_inliers);
    p.setFeatureMinRatio(cfg.feature_min_inlier_ratio);
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveUserSettings(current);
      notify("Settings saved to spaceDB", "success");
    } catch (e) {
      notify(e.message || "Could not save settings (is MongoDB running?)", "error");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    apply(DEFAULTS);
    try {
      await resetUserSettings();
      await saveUserSettings(DEFAULTS);
      notify("Settings reset to defaults", "success");
    } catch {
      notify("Defaults applied (not saved: spaceDB unavailable)", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-general">
      <div className="st-grid">
        <section className="st-card">
          <h3>
            <FaPlay /> Simulation
          </h3>
          <Slider
            label="Simulation speed"
            value={current.default_speed}
            min={0.2}
            max={5}
            step={0.1}
            unit="×"
            onChange={setSimulationSpeed}
            hint="Speeds up orbital motion and target tumbling."
          />
        </section>

        <section className="st-card">
          <h3>
            <FaEye /> Detection
          </h3>
          <Slider
            label="YOLOv8n confidence threshold"
            value={current.confidence_threshold * 100}
            min={10}
            max={95}
            step={5}
            unit="%"
            digits={0}
            onChange={(v) => setConfidenceThreshold(v / 100)}
            hint="Detections below this confidence are ignored (Detection page and Live Perception)."
          />
        </section>

        <section className="st-card">
          <h3>
            <FaShieldAlt /> Live perception & collision
          </h3>
          <Slider label="Processing rate" value={current.live_rate_fps} min={1} max={4} step={1} unit=" FPS" digits={0} onChange={p.setLiveRate} />
          <Slider
            label="Landmark noise σ"
            value={current.live_noise_px}
            min={0}
            max={5}
            step={0.5}
            unit=" px"
            onChange={p.setLiveNoise}
            hint="Simulated keypoint detection error added before solvePnP."
          />
          <Slider label="Safety radius" value={current.safety_radius_m} min={0.5} max={10} step={0.1} unit=" m" onChange={p.setSafetyRadius} />
          <Slider
            label="Risk time horizon"
            value={current.collision_horizon_s}
            min={10}
            max={300}
            step={10}
            unit=" s"
            digits={0}
            onChange={p.setCollisionHorizon}
            hint="HIGH risk = predicted miss distance (CPA) inside the safety radius within this time."
          />
        </section>

        <section className="st-card">
          <h3>
            <FaFingerprint /> Target identification (ORB / SIFT)
          </h3>
          <Slider
            label="Minimum RANSAC inliers"
            value={current.feature_min_inliers}
            min={6}
            max={60}
            step={1}
            digits={0}
            onChange={p.setFeatureMinInliers}
          />
          <Slider
            label="Minimum inlier ratio"
            value={current.feature_min_inlier_ratio * 100}
            min={10}
            max={90}
            step={5}
            unit="%"
            digits={0}
            onChange={(v) => p.setFeatureMinRatio(v / 100)}
            hint="SAT-001 is 'identified' only if both thresholds are met."
          />
        </section>
      </div>

      <div className="st-actions">
        <button type="button" className="st-btn-primary" onClick={save} disabled={busy}>
          <FaSave /> Save settings
        </button>
        <button type="button" className="st-btn-ghost" onClick={reset} disabled={busy}>
          <FaUndo /> Reset to defaults
        </button>
        <span className="st-hint">Changes apply immediately; Save keeps them for the next session.</span>
      </div>
    </div>
  );
}

export default GeneralSettings;
