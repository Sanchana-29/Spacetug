import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Layout from "../components/Layout/Layout";
import "./PoseEstimation.css";

import PoseControls from "../components/PoseEstimation/PoseControls/PoseControls";
import PosePipeline from "../components/PoseEstimation/PosePipeline/PosePipeline";
import PoseViewer from "../components/PoseEstimation/PoseViewer/PoseViewer";
import PoseResults from "../components/PoseEstimation/PoseResults/PoseResults";
import { useSensor } from "../context/SensorContext";
import { usePerception } from "../context/PerceptionContext";
import { buildImagePoints } from "../utils/poseGeometry";
import {
  getFeatureLibraryApi,
  addFeatureReferenceApi,
  clearFeatureLibraryApi,
} from "../services/api";

function PoseEstimation() {
  const {
    capturedFrame,
    runPoseEstimation,
    detectionResult,
    autoAddToLibrary,
    setAutoAddToLibrary,
    libraryVersion,
  } = useSensor();
  const { featureMinInliers, featureMinRatio } = usePerception();

  // Solver: ITERATIVE | EPNP | SQPNP (mapped to cv2.SOLVEPNP_* in the backend)
  const [algorithm, setAlgorithm] = useState("ITERATIVE");
  // Keypoint source: LANDMARKS (projected 3D landmarks) | ORB | SIFT (real image features)
  const [feature, setFeature] = useState("LANDMARKS");
  const [target, setTarget] = useState("SAT-001");
  const [noiseSigma, setNoiseSigma] = useState(0);
  const [excludeOccluded, setExcludeOccluded] = useState(true);
  const [autoEstimate, setAutoEstimate] = useState(true);
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);
  const [lastImagePoints, setLastImagePoints] = useState(null);

  // ── ORB/SIFT reference library ─────────────────────────────────────────
  const [library, setLibrary] = useState(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryMsg, setLibraryMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    getFeatureLibraryApi()
      .then((d) => {
        if (!cancelled) setLibrary(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [libraryVersion]);

  const handleAddToLibrary = useCallback(async () => {
    const gt = capturedFrame?.ground_truth_pose;
    if (!capturedFrame?.imageData || !gt || !capturedFrame?.camera_matrix) {
      setLibraryMsg("Capture a frame (with ground-truth pose) first");
      return;
    }
    setLibraryBusy(true);
    try {
      const r = await addFeatureReferenceApi({
        image: capturedFrame.imageData,
        camera_matrix: capturedFrame.camera_matrix,
        ground_truth: { position: gt.position, rotation_matrix: gt.rotation_matrix },
        view_id: String(capturedFrame.id),
        sensor_name: capturedFrame.selectedSensor,
      });
      setLibrary(r);
      setLibraryMsg(
        r.success
          ? `Added: ${r.per_method?.ORB?.lifted ?? 0} ORB + ${r.per_method?.SIFT?.lifted ?? 0} SIFT points`
          : r.message
      );
    } catch (e) {
      setLibraryMsg(e.message);
    } finally {
      setLibraryBusy(false);
    }
  }, [capturedFrame]);

  const handleClearLibrary = useCallback(async () => {
    setLibraryBusy(true);
    try {
      setLibrary(await clearFeatureLibraryApi());
      setLibraryMsg("Library cleared");
    } catch (e) {
      setLibraryMsg(e.message);
    } finally {
      setLibraryBusy(false);
    }
  }, []);

  // YOLO bbox of the current frame (pixels of the captured image), if detection was run
  const detectionBBox = useMemo(() => {
    const det = detectionResult?.detections?.[0];
    const b = det?.bounding_box;
    if (!b || !capturedFrame?.image_size) return null;
    const sx = capturedFrame.image_size[0] / (detectionResult.image_width || capturedFrame.image_size[0]);
    const sy = capturedFrame.image_size[1] / (detectionResult.image_height || capturedFrame.image_size[1]);
    return [b.x * sx, b.y * sy, (b.x + b.width) * sx, (b.y + b.height) * sy];
  }, [detectionResult, capturedFrame]);

  const landmarkStats = useMemo(() => {
    const lm = capturedFrame?.landmarks;
    if (!lm?.points) return { total: 0, inImage: 0, visible: 0 };
    const ids = Object.keys(lm.points);
    const inImage = ids.filter((id) => lm.inImage?.[id]).length;
    const visible = ids.filter((id) => lm.inImage?.[id] && !lm.occluded?.[id]).length;
    return { total: ids.length, inImage, visible };
  }, [capturedFrame]);

  const latestLiveFrameRef = useRef(null);
  const handleLiveSampleUpdate = useCallback((frame) => {
    latestLiveFrameRef.current = frame;
  }, []);

  const handleEstimate = useCallback(
    async (overrides = {}) => {
      const activeAlgo = overrides.algorithm || algorithm;
      const activeFeature = overrides.feature || feature;
      const activeNoise = overrides.noiseSigma !== undefined ? overrides.noiseSigma : noiseSigma;
      const activeExclude = overrides.excludeOccluded !== undefined ? overrides.excludeOccluded : excludeOccluded;

      let targetFrame = overrides.frame || capturedFrame || latestLiveFrameRef.current;
      if (!targetFrame) return null;

      const gtPose = targetFrame.ground_truth_pose;

      if (activeFeature === "ORB" || activeFeature === "SIFT") {
        setLastImagePoints(null);
        return runPoseEstimation(
          {
            image: targetFrame.imageData,
            camera_matrix: targetFrame.camera_matrix,
            feature: activeFeature,
            method: activeAlgo,
            bbox: detectionBBox,
            exclude_view_id: String(targetFrame.id),
            ground_truth: gtPose
              ? { position: gtPose.position, rotation_matrix: gtPose.rotation_matrix }
              : null,
            sensor_name: targetFrame.selectedSensor,
            target_id: target,
            min_inliers: featureMinInliers,
            min_inlier_ratio: featureMinRatio,
          },
          "image"
        );
      }

      const imagePoints = buildImagePoints(targetFrame, {
        noiseSigmaPx: activeNoise,
        excludeOccluded: activeExclude,
      });
      setLastImagePoints(imagePoints);

      const gt = targetFrame.ground_truth_pose;
      return runPoseEstimation({
        image_points: imagePoints,
        image_size: targetFrame.image_size,
        camera_matrix: targetFrame.camera_matrix,
        fov_degrees: Number(targetFrame.fov) || 60,
        fov_mode: "vertical",
        method: activeAlgo,
        use_ransac: false,
        noise_sigma_px: Number(activeNoise) || 0,
        keypoint_source: activeFeature,
        sensor_name: targetFrame.selectedSensor,
        ground_truth: gt ? { position: gt.position, rotation_matrix: gt.rotation_matrix } : null,
        target_id: target,
      });
    },
    [
      algorithm,
      feature,
      noiseSigma,
      excludeOccluded,
      capturedFrame,
      target,
      runPoseEstimation,
      detectionBBox,
      featureMinInliers,
      featureMinRatio,
    ]
  );

  // Auto-estimate once for every newly captured frame
  const lastAutoFrameRef = useRef(null);
  useEffect(() => {
    if (!autoEstimate || !capturedFrame?.id) return;
    // nothing to solve for frames without geometry (gallery / old captures)
    if (feature === "LANDMARKS" && !capturedFrame.landmarks) return;
    if (lastAutoFrameRef.current === capturedFrame.id) return;
    lastAutoFrameRef.current = capturedFrame.id;
    handleEstimate();
  }, [autoEstimate, capturedFrame, handleEstimate, feature]);

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="pose-page">
        <PoseControls
          algorithm={algorithm}
          setAlgorithm={setAlgorithm}
          feature={feature}
          setFeature={setFeature}
          target={target}
          setTarget={setTarget}
          noiseSigma={noiseSigma}
          setNoiseSigma={setNoiseSigma}
          excludeOccluded={excludeOccluded}
          setExcludeOccluded={setExcludeOccluded}
          autoEstimate={autoEstimate}
          setAutoEstimate={setAutoEstimate}
          onEstimate={handleEstimate}
          landmarkStats={landmarkStats}
          library={library}
          libraryBusy={libraryBusy}
          libraryMsg={libraryMsg}
          onAddToLibrary={handleAddToLibrary}
          onClearLibrary={handleClearLibrary}
          autoAddToLibrary={autoAddToLibrary}
          setAutoAddToLibrary={setAutoAddToLibrary}
        />

        <div className="pose-middle">
          <div className="pose-left-col">
            <PosePipeline algorithm={algorithm} isLiveStreaming={isLiveStreaming} />
          </div>

          <div className="pose-center-col">
            <PoseViewer
              algorithm={algorithm}
              feature={feature}
              isLiveStreaming={isLiveStreaming}
              setIsLiveStreaming={setIsLiveStreaming}
              lastImagePoints={lastImagePoints}
              onEstimate={handleEstimate}
              onLiveSampleUpdate={handleLiveSampleUpdate}
            />
          </div>

          <div className="pose-right-col">
            <PoseResults isLiveStreaming={isLiveStreaming} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default PoseEstimation;
