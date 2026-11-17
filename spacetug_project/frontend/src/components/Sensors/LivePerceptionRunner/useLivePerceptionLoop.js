import { useEffect, useRef } from "react";

import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import { useMission } from "../../../context/MissionContext";
import { usePerception } from "../../../context/PerceptionContext";
import {
  grabSensorFrame,
  buildImagePoints,
  landmarksFromApi,
  TARGET_LANDMARKS_3D,
} from "../../../utils/poseGeometry";
import {
  getPoseLandmarksApi,
  perceptionStepApi,
  addFeatureReferenceApi,
  getFeatureLibraryApi,
} from "../../../services/api";

// ORB/SIFT reference library is built automatically from live frames (with their
// ground-truth pose) until it holds this many views, one view every few seconds.
const AUTO_LIBRARY_TARGET_VIEWS = 20;
const AUTO_LIBRARY_INTERVAL_MS = 3000;

/** 3D landmark definitions: single source of truth from the backend (fallback: local copy). */
export function useTargetLandmarks() {
  const ref = useRef(TARGET_LANDMARKS_3D);
  useEffect(() => {
    let cancelled = false;
    getPoseLandmarksApi()
      .then((d) => {
        const lm = landmarksFromApi(d);
        if (!cancelled && lm) ref.current = lm;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return ref;
}

/**
 * LIVE PERCEPTION LOOP (Phases 3-5), shared by the Sensors page and the background
 * runner, so perception keeps running whichever page is open.
 * Every 1/liveRate s: render the sensor view, send the image (YOLO + SORT tracking),
 * noisy 2D landmarks (solvePnP), ground truth and chaser attitude to the backend,
 * which returns tracks, pose, Kalman-filtered relative motion and collision risk.
 */
export function useLivePerceptionLoop(glContextRef, landmarks3DRef) {
  const { selectedSensor, bumpLibraryVersion } = useSensor();
  const { activeMission } = useMission();
  const { isRunning, simTimeRef } = useSimulation();
  const {
    liveActive,
    liveRate,
    liveNoise,
    safetyRadius,
    collisionHorizon,
    sessionId,
    pushStep,
    setLastError,
    setLibraryViews,
  } = usePerception();

  const inflightRef = useRef(false);
  const cfgRef = useRef({});
  useEffect(() => {
    cfgRef.current = {
      liveNoise,
      safetyRadius,
      collisionHorizon,
      sessionId,
      missionId: activeMission?.mission_id || null,
      sensor: selectedSensor,
      isRunning,
    };
  }, [liveNoise, safetyRadius, collisionHorizon, sessionId, activeMission?.mission_id, selectedSensor, isRunning]);

  // Auto-build of the ORB/SIFT library
  const libViewsRef = useRef(null);
  const lastLibAddRef = useRef(0);
  const libBusyRef = useRef(false);
  useEffect(() => {
    if (!liveActive) return;
    getFeatureLibraryApi()
      .then((d) => {
        libViewsRef.current = Number(d?.views || 0);
        setLibraryViews?.(libViewsRef.current);
      })
      .catch(() => {});
  }, [liveActive, setLibraryViews]);

  useEffect(() => {
    if (!liveActive) return undefined;
    const intervalMs = Math.max(250, Math.round(1000 / (Number(liveRate) || 2)));

    const id = setInterval(async () => {
      const cfg = cfgRef.current;
      // A paused simulation has no new time step: skip (motion needs time to advance)
      if (!cfg.isRunning || inflightRef.current) return;
      const frame = grabSensorFrame(glContextRef.current, {
        landmarks3D: landmarks3DRef.current,
        format: "image/jpeg",
        quality: 0.85,
      });
      if (!frame) return;

      const gt = frame.groundTruthPose;
      inflightRef.current = true;
      try {
        const imagePoints = buildImagePoints(
          { landmarks: frame.landmarkGeometry },
          { noiseSigmaPx: cfg.liveNoise, excludeOccluded: true }
        );
        const res = await perceptionStepApi({
          session_id: cfg.sessionId,
          timestamp: Number(simTimeRef?.current ?? performance.now() / 1000),
          image: frame.imageData,
          image_points: imagePoints,
          image_size: [frame.imgW, frame.imgH],
          camera_matrix: frame.cameraMatrix,
          ground_truth: gt ? { position: gt.position, rotation_matrix: gt.rotation_matrix } : null,
          camera_rotation_world: frame.cameraRotationWorld,
          safety_radius_m: cfg.safetyRadius,
          horizon_s: cfg.collisionHorizon || 60,
          mission_id: cfg.missionId,
          sensor_name: cfg.sensor,
        });
        pushStep(res, { imageSize: [frame.imgW, frame.imgH] });
      } catch (e) {
        setLastError(e?.message || "Perception step failed");
      } finally {
        inflightRef.current = false;
      }

      // Add this view to the ORB/SIFT library (only when the target was detected in it)
      const now = performance.now();
      const views = libViewsRef.current;
      if (
        gt &&
        views !== null &&
        views < AUTO_LIBRARY_TARGET_VIEWS &&
        !libBusyRef.current &&
        now - lastLibAddRef.current > AUTO_LIBRARY_INTERVAL_MS
      ) {
        lastLibAddRef.current = now;
        libBusyRef.current = true;
        addFeatureReferenceApi({
          image: frame.imageData,
          camera_matrix: frame.cameraMatrix,
          ground_truth: { position: gt.position, rotation_matrix: gt.rotation_matrix },
          view_id: `AUTO-${Date.now()}`,
          sensor_name: cfg.sensor,
        })
          .then((r) => {
            if (r?.views != null) libViewsRef.current = Number(r.views);
            else if (r?.success) libViewsRef.current = views + 1;
            setLibraryViews?.(libViewsRef.current);
            bumpLibraryVersion?.();
          })
          .catch(() => {})
          .finally(() => {
            libBusyRef.current = false;
          });
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [liveActive, liveRate, pushStep, setLastError, simTimeRef, glContextRef, landmarks3DRef, setLibraryViews, bumpLibraryVersion]);
}
