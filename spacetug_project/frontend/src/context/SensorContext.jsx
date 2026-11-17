import { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
  dataURLtoBlob,
  runDetectionApi,
  runPoseEstimationApi,
  estimatePoseFromImageApi,
  addFeatureReferenceApi,
  getRecentDetections,
  getRecentPoses,
} from "../services/api";
import { useMission } from "./MissionContext";

const SensorContext = createContext(null);

function getMissionKey(missionId, suffix) {
  return missionId ? `spacecraft_mission_${missionId}_${suffix}` : `spacecraft_default_${suffix}`;
}

function readStorage(key, fallback = null) {
  try {
    const val = localStorage.getItem(key) || sessionStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch (e) {
    console.warn("Storage read error for " + key, e);
    return fallback;
  }
}

function writeStorage(key, val) {
  try {
    if (val === null || val === undefined) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } else {
      const json = JSON.stringify(val);
      localStorage.setItem(key, json);
      sessionStorage.setItem(key, json);
    }
  } catch (e) {
    console.warn("Storage write error for " + key, e);
  }
}

export function SensorProvider({ children }) {
  const { activeMission } = useMission();
  const missionId = activeMission?.mission_id || null;

  const [selectedSensor, setSelectedSensor] = useState("RGB-D Camera");
  const [capturedFrame, setCapturedFrameState] = useState(null);
  const [detectionResult, setDetectionResultState] = useState(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.4);
  const [poseResult, setPoseResultState] = useState(null);
  // Phase 2: automatically add every captured frame (with ground-truth pose) to the ORB/SIFT library
  const [autoAddToLibrary, setAutoAddToLibraryState] = useState(
    () => readStorage("spacetug_auto_add_library", false) === true
  );
  const [libraryVersion, setLibraryVersion] = useState(0);
  const setAutoAddToLibrary = useCallback((v) => {
    setAutoAddToLibraryState(Boolean(v));
    writeStorage("spacetug_auto_add_library", Boolean(v));
  }, []);
  const [missionGallery, setMissionGallery] = useState([]);

  // Detection Mode: "Dataset Image" | "Live Stream"
  const [detectionMode, setDetectionMode] = useState("Dataset Image");

  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState(null);
  const [isEstimatingPose, setIsEstimatingPose] = useState(false);
  const [poseError, setPoseError] = useState(null);
  const [sensorThumbnails, setSensorThumbnails] = useState({});

  // Live stream inference telemetry state for sync between center canvas and right dock
  const [liveInferenceData, setLiveInferenceData] = useState({
    fps: 30,
    latencyMs: 38,
    confScore: 96.8,
    primaryDetection: {
      class_name: "satellite",
      confidence: 0.968,
      bounding_box: { x: 420, y: 180, width: 400, height: 350 },
    },
    detections: [
      {
        class_name: "satellite",
        confidence: 0.968,
        bounding_box: { x: 420, y: 180, width: 400, height: 350 },
      },
    ],
    lastFrameUrl: null,
  });

  useEffect(() => {
    const frameKey = getMissionKey(missionId, "captured_frame");
    const detKey = getMissionKey(missionId, "detection_result");
    const poseKey = getMissionKey(missionId, "pose_result");
    const galleryKey = getMissionKey(missionId, "gallery");

    const savedFrame = readStorage(frameKey, null);
    const savedPose = readStorage(poseKey, null);
    const savedGallery = readStorage(galleryKey, []);

    setCapturedFrameState(savedFrame);
    // Explicitly reset detection result on mount / tab switch so no stale bounding boxes appear
    setDetectionResultState(null);
    setPoseResultState(savedPose);
    setMissionGallery(Array.isArray(savedGallery) ? savedGallery : []);
    setDetectionError(null);
    setPoseError(null);

    if (missionId) {
      (async () => {
        try {
          if (!savedPose) {
            const recentPoses = await getRecentPoses(5, missionId);
            if (Array.isArray(recentPoses) && recentPoses.length > 0) {
              const latestPose = recentPoses[0];
              setPoseResultState(latestPose);
              writeStorage(poseKey, latestPose);
            }
          }
        } catch (e) {
          console.warn("Could not sync mission data from backend:", e);
        }
      })();
    }
  }, [missionId]);

  const updateSensorThumbnail = useCallback((sensorName, imageData) => {
    if (!sensorName || !imageData) return;
    setSensorThumbnails((previous) => {
      if (previous[sensorName] === imageData) return previous;
      return { ...previous, [sensorName]: imageData };
    });
  }, []);

  const setCapturedFrame = useCallback(
    (frame) => {
      const taggedFrame = frame
        ? {
            ...frame,
            mission_id: frame.mission_id || missionId,
          }
        : null;

      setCapturedFrameState(taggedFrame);
      setDetectionResultState(null);
      setDetectionError(null);
      setPoseResultState(null);
      setPoseError(null);

      const frameKey = getMissionKey(missionId, "captured_frame");
      const detKey = getMissionKey(missionId, "detection_result");
      const poseKey = getMissionKey(missionId, "pose_result");
      const galleryKey = getMissionKey(missionId, "gallery");

      writeStorage(frameKey, taggedFrame);
      writeStorage(detKey, null);
      writeStorage(poseKey, null);

      if (taggedFrame) {
        setMissionGallery((prev) => {
          const filtered = prev.filter((item) => item.id !== taggedFrame.id);
          const updated = [taggedFrame, ...filtered].slice(0, 30);
          writeStorage(galleryKey, updated);
          return updated;
        });
      }

      const gt = taggedFrame?.ground_truth_pose;
      if (autoAddToLibrary && taggedFrame?.imageData && gt && taggedFrame?.camera_matrix) {
        addFeatureReferenceApi({
          image: taggedFrame.imageData,
          camera_matrix: taggedFrame.camera_matrix,
          ground_truth: { position: gt.position, rotation_matrix: gt.rotation_matrix },
          view_id: String(taggedFrame.id),
          sensor_name: taggedFrame.selectedSensor,
        })
          .then(() => setLibraryVersion((v) => v + 1))
          .catch((e) => console.warn("Auto-add to feature library failed:", e?.message));
      }
    },
    [missionId, autoAddToLibrary]
  );

  const setDetectionResult = useCallback(
    (result) => {
      setDetectionResultState(result);
      const detKey = getMissionKey(missionId, "detection_result");
      writeStorage(detKey, result ?? null);

      if (result && capturedFrame?.id) {
        const count = Array.isArray(result.detections) ? result.detections.length : 0;
        setMissionGallery((prev) => {
          const updated = prev.map((item) =>
            item.id === capturedFrame.id
              ? { ...item, detectionsCount: count, detections: result.detections || [] }
              : item
          );
          const galleryKey = getMissionKey(missionId, "gallery");
          writeStorage(galleryKey, updated);
          return updated;
        });
      }
    },
    [missionId, capturedFrame?.id]
  );

  const setPoseResult = useCallback(
    (result) => {
      setPoseResultState(result);
      const poseKey = getMissionKey(missionId, "pose_result");
      // the ORB/SIFT match visualisation is large: keep it in memory only
      const storable = result ? { ...result } : null;
      if (storable) delete storable.match_image;
      writeStorage(poseKey, storable);
    },
    [missionId]
  );

  const runDetection = useCallback(
    async (overrideThreshold, frameData = null) => {
      const targetFrame = frameData || capturedFrame;
      if (!targetFrame?.imageData) {
        setDetectionError("Capture a sensor frame before running detection.");
        return null;
      }

      setIsDetecting(true);
      setDetectionError(null);

      const thresholdToUse =
        typeof overrideThreshold === "number"
          ? overrideThreshold
          : confidenceThreshold;

      try {
        const blob = dataURLtoBlob(targetFrame.imageData);
        const sensorName = targetFrame.selectedSensor || targetFrame.sensorType || "RGB-D Camera";
        const frameId = targetFrame.id || `CAP-${Date.now()}`;
        const activeMsnId = targetFrame.mission_id || missionId || null;

        const result = await runDetectionApi(
          blob,
          thresholdToUse,
          sensorName,
          frameId,
          activeMsnId
        );

        const taggedResult = {
          ...result,
          frameId,
          mission_id: activeMsnId,
        };

        setDetectionResult(taggedResult);
        return taggedResult;
      } catch (error) {
        console.error("Detection error:", error);
        setDetectionError(
          error?.message || "Failed to connect to backend Detection API."
        );
        return null;
      } finally {
        setIsDetecting(false);
      }
    },
    [capturedFrame, confidenceThreshold, missionId, setDetectionResult]
  );

  // mode "landmarks" -> /api/pose/estimate (2D landmarks -> solvePnP)
  // mode "image"     -> /api/pose/estimate-from-image (ORB/SIFT matching -> PnP RANSAC)
  const runPoseEstimation = useCallback(
    async (payload, mode = "landmarks") => {
      if (!payload || typeof payload !== "object") {
        setPoseError("Pose estimation payload is missing or invalid.");
        return null;
      }

      if (!capturedFrame?.imageData) {
        setPoseError("Capture a sensor frame before estimating pose.");
        return null;
      }

      setIsEstimatingPose(true);
      setPoseError(null);
      setPoseResult(null);

      try {
        const finalPayload = {
          ...payload,
          frame_id: payload.frame_id || capturedFrame.id || `CAP-${Date.now()}`,
          mission_id: payload.mission_id || capturedFrame.mission_id || missionId || "MSN-DEFAULT-01",
        };

        const result =
          mode === "image"
            ? await estimatePoseFromImageApi(finalPayload)
            : await runPoseEstimationApi(finalPayload);
        const taggedResult = {
          ...result,
          mission_id: finalPayload.mission_id,
          frame_id: finalPayload.frame_id,
        };

        setPoseResult(taggedResult);

        if (result?.success === false) {
          setPoseError(
            result.message || "Pose estimation could not be completed."
          );
        } else if (!result || typeof result !== "object") {
          setPoseError("The pose API returned an invalid response.");
        }

        return taggedResult;
      } catch (error) {
        console.error("Pose estimation error:", error);
        setPoseError(
          error?.message || "Failed to connect to backend Pose API."
        );
        return null;
      } finally {
        setIsEstimatingPose(false);
      }
    },
    [capturedFrame, missionId, setPoseResult]
  );

  const value = {
    autoAddToLibrary,
    setAutoAddToLibrary,
    libraryVersion,
    selectedSensor,
    setSelectedSensor,
    sensorThumbnails,
    updateSensorThumbnail,
    capturedFrame,
    setCapturedFrame,
    detectionResult,
    setDetectionResult,
    confidenceThreshold,
    setConfidenceThreshold,
    detectionMode,
    setDetectionMode,
    isDetecting,
    detectionError,
    runDetection,
    poseResult,
    setPoseResult,
    isEstimatingPose,
    poseError,
    runPoseEstimation,
    missionGallery,
    liveInferenceData,
    setLiveInferenceData,
  };

  return (
    <SensorContext.Provider value={value}>
      {children}
    </SensorContext.Provider>
  );
}

export function useSensor() {
  const context = useContext(SensorContext);
  if (!context) {
    throw new Error("useSensor must be used within a SensorProvider.");
  }
  return context;
}
