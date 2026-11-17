import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { perceptionResetApi, getUserSettings } from "../services/api";
import { useSimulation } from "./SimulationContext";
import { useSensor } from "./SensorContext";
import { useMission } from "./MissionContext";

/**
 * Live perception state (Phases 3-5). The loop runs on the Sensors page, or in an
 * off-screen background runner on every other page, so it never stops when the user
 * navigates. It starts automatically when the mission simulation runs; every page can
 * read the latest result and the time history (Telemetry charts, Dashboard risk badge).
 */
const PerceptionContext = createContext(null);
const MAX_SAMPLES = 600;

// Live history survives a page refresh (same backend session -> Kalman state continues)
const PERCEPTION_STORAGE_KEY = "spacetug_perception";
function readSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(PERCEPTION_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

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
  const [liveActive, setLiveActiveState] = useState(false);
  const [libraryViews, setLibraryViews] = useState(null);
  // Once the user stops live perception by hand, it is not auto-started again
  const userStoppedRef = useRef(false);
  const setLiveActive = useCallback((v) => {
    const on = Boolean(v);
    userStoppedRef.current = !on;
    setLiveActiveState(on);
  }, []);
  const [liveRate, setLiveRate] = useState(2); // frames per second
  const [liveNoise, setLiveNoise] = useState(1); // landmark pixel noise sigma
  const [safetyRadius, setSafetyRadius] = useState(1.0);
  const [collisionHorizon, setCollisionHorizon] = useState(60);
  const [featureMinInliers, setFeatureMinInliers] = useState(15);
  const [featureMinRatio, setFeatureMinRatio] = useState(0.4);
  const { setSimulationSpeed, isRunning, setIrFloodlight } = useSimulation() || {};

  // Auto-start with the simulation (unless the user stopped it)
  useEffect(() => {
    if (isRunning && !userStoppedRef.current) setLiveActiveState(true);
  }, [isRunning]);

  // The chaser's IR illuminator is switched on while perception runs, so the target
  // stays visible to the camera during eclipse
  useEffect(() => {
    if (liveActive && setIrFloodlight) setIrFloodlight(true);
  }, [liveActive, setIrFloodlight]);
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
  const { activeMission } = useMission() || {};
  const missionIdRef = useRef(readSaved()?.missionId ?? null);
  const [sessionId, setSessionId] = useState(() => readSaved()?.sessionId || `LIVE-${Date.now()}`);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState(() => {
    const h = readSaved()?.history;
    return Array.isArray(h) ? h : [];
  });

  useEffect(() => {
    if (history.length % 5 !== 0) return; // save every 5 samples
    try {
      sessionStorage.setItem(
        PERCEPTION_STORAGE_KEY,
        JSON.stringify({ sessionId, history, missionId: missionIdRef.current })
      );
    } catch {
      /* storage full: history is only kept in memory */
    }
  }, [history, sessionId]);
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

  // A different mission starts a fresh perception session (new tracks, filters, charts)
  const currentMissionId = activeMission?.mission_id || null;
  useEffect(() => {
    if (!currentMissionId) return;
    const prev = missionIdRef.current;
    missionIdRef.current = currentMissionId;
    if (prev && prev !== currentMissionId) resetPerception();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMissionId]);

  const value = useMemo(
    () => ({
      liveActive,
      setLiveActive,
      libraryViews,
      setLibraryViews,
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
      setLiveActive,
      libraryViews,
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
