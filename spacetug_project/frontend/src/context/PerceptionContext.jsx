import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { perceptionResetApi } from "../services/api";

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
      sessionId,
      latest,
      history,
      lastError,
      setLastError,
      pushStep,
      resetPerception,
    }),
    [liveActive, liveRate, liveNoise, safetyRadius, sessionId, latest, history, lastError, pushStep, resetPerception]
  );

  return <PerceptionContext.Provider value={value}>{children}</PerceptionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePerception() {
  return useContext(PerceptionContext);
}
