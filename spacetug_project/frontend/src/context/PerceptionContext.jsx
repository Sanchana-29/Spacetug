import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { perceptionResetApi, getUserSettings } from "../services/api";
import { useSimulation } from "./SimulationContext";
import { useSensor } from "./SensorContext";

/**
 * Live perception state (Phases 3-5): the Sensors page runs the loop, every page can
 * read the latest result and the time history (Telemetry charts, Dashboard risk badge).
 */
const PerceptionContext = createContext(null);
const MAX_SAMPLES = 600;

const num = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : null);

function toSample(res) {
  const mEst = res?.motion?.estimated || {};
  const mGt = res?.motion?.ground_truth || {};
  const pose = res?.pose || {};
  const cEst = res?.collision?.estimated || {};
  const cGt = res?.collision?.ground_truth || {};
  const track = res?.tracking?.tracks?.[0];
  return {
    time: num(res?.timestamp),
    rangeRaw: num(mEst.range_m ?? (pose.success ? pose.distance_m : null)),
    rangeFilt: num(mEst.range_filtered_m),
    rangeGT: num(mGt.range_m),
    speedRaw: num(mEst.speed_raw_mps),
    speedFilt: num(mEst.speed_filtered_mps),
    speedGT: num(mGt.speed_raw_mps),
    tumbleRaw: num(mEst.tumbling_rate_raw_dps),
    tumbleFilt: num(mEst.tumbling_rate_filtered_dps),
    tumbleGT: num(mGt.tumbling_rate_raw_dps),
    rotErr: num(pose.errors_vs_gt?.rotation_error_deg),
    transErr: num(pose.errors_vs_gt?.translation_error_m),
    risk: cEst.risk_level || cGt.risk_level || null,
    ttc: num(cEst.ttc_s),
    dcpa: num(cEst.d_cpa_m),
    dcpaGT: num(cGt.d_cpa_m),
    tcpa: num(cEst.t_cpa_s),
    trackId: track?.track_id || null,
  };
}

export function PerceptionProvider({ children }) {
  const [liveActive, setLiveActive] = useState(false);
  const [liveRate, setLiveRate] = useState(2); // frames per second
  const [liveNoise, setLiveNoise] = useState(1); // landmark pixel noise sigma
  const [safetyRadius, setSafetyRadius] = useState(2.0);
  const [collisionHorizon, setCollisionHorizon] = useState(60);
  const [featureMinInliers, setFeatureMinInliers] = useState(15);
  const [featureMinRatio, setFeatureMinRatio] = useState(0.4);
  const { setSimulationSpeed } = useSimulation() || {};
  const { setConfidenceThreshold } = useSensor() || {};

  // Apply the saved settings (spaceDB) once at app start, so they are used everywhere
  useEffect(() => {
    let cancelled = false;
    getUserSettings()
      .then((cfg) => {
        if (cancelled || !cfg) return;
        const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
        if (n(cfg.live_rate_fps) != null) setLiveRate(n(cfg.live_rate_fps));
        if (n(cfg.live_noise_px) != null) setLiveNoise(n(cfg.live_noise_px));
        if (n(cfg.safety_radius_m) != null) setSafetyRadius(n(cfg.safety_radius_m));
        if (n(cfg.collision_horizon_s) != null) setCollisionHorizon(n(cfg.collision_horizon_s));
        if (n(cfg.feature_min_inliers) != null) setFeatureMinInliers(n(cfg.feature_min_inliers));
        if (n(cfg.feature_min_inlier_ratio) != null) setFeatureMinRatio(n(cfg.feature_min_inlier_ratio));
        if (n(cfg.default_speed) != null && setSimulationSpeed) setSimulationSpeed(n(cfg.default_speed));
        if (n(cfg.confidence_threshold) != null && setConfidenceThreshold) setConfidenceThreshold(n(cfg.confidence_threshold));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sessionId, setSessionId] = useState(() => `LIVE-${Date.now()}`);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastError, setLastError] = useState(null);

  const pushStep = useCallback((res, meta = {}) => {
    setLastError(null);
    setLatest({ ...res, ...meta });
    setHistory((h) => [...h, toSample(res)].slice(-MAX_SAMPLES));
  }, []);

  const resetPerception = useCallback(async () => {
    try {
      await perceptionResetApi(sessionId);
    } catch {
      /* backend offline: local reset is still fine */
    }
    setSessionId(`LIVE-${Date.now()}`);
    setLatest(null);
    setHistory([]);
    setLastError(null);
  }, [sessionId]);

  const value = useMemo(
    () => ({
      liveActive,
      setLiveActive,
      liveRate,
      setLiveRate,
      liveNoise,
      setLiveNoise,
      safetyRadius,
      setSafetyRadius,
      collisionHorizon,
      setCollisionHorizon,
      featureMinInliers,
      setFeatureMinInliers,
      featureMinRatio,
      setFeatureMinRatio,
      sessionId,
      latest,
      history,
      lastError,
      setLastError,
      pushStep,
      resetPerception,
    }),
    [
      liveActive,
      liveRate,
      liveNoise,
      safetyRadius,
      collisionHorizon,
      featureMinInliers,
      featureMinRatio,
      sessionId,
      latest,
      history,
      lastError,
      pushStep,
      resetPerception,
    ]
  );

  return <PerceptionContext.Provider value={value}>{children}</PerceptionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePerception() {
  return useContext(PerceptionContext);
}
