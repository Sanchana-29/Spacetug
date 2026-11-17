import { useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";

import { usePerception } from "../../../context/PerceptionContext";
import { SensorCanvas } from "../SensorViewer/SensorTargetView";
import { useLivePerceptionLoop, useTargetLandmarks } from "./useLivePerceptionLoop";

/** Off-screen chaser camera + live perception loop, used while the Sensors page is not open. */
function BackgroundPerceptionRunner() {
  const glContextRef = useRef(null);
  const landmarks3DRef = useTargetLandmarks();
  useLivePerceptionLoop(glContextRef, landmarks3DRef);
  const onGlReady = useCallback((ctx) => {
    glContextRef.current = ctx;
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: "960px",
        height: "540px",
        zIndex: -1,
        opacity: 0.01,
        pointerEvents: "none",
      }}
    >
      <SensorCanvas sensor="RGB-D Camera" canvasId="bg-perception-canvas" onGlReady={onGlReady} isMini viewMode="CHASER" />
    </div>
  );
}

// Pages that have no simulation running behind them
const NO_RUNNER_PATHS = new Set(["/", "/welcome", "/sensors"]);

export default function BackgroundPerception() {
  const { pathname } = useLocation();
  const { liveActive } = usePerception() || {};
  if (!liveActive || NO_RUNNER_PATHS.has(pathname)) return null;
  return <BackgroundPerceptionRunner />;
}
