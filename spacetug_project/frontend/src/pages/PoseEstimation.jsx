import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Layout from "../components/Layout/Layout";
import "./PoseEstimation.css";

import PoseControls from "../components/PoseEstimation/PoseControls/PoseControls";
import PosePipeline from "../components/PoseEstimation/PosePipeline/PosePipeline";
import PoseViewer from "../components/PoseEstimation/PoseViewer/PoseViewer";
import PoseResults from "../components/PoseEstimation/PoseResults/PoseResults";
import { useSensor } from "../context/SensorContext";
import { buildImagePoints } from "../utils/poseGeometry";

function PoseEstimation() {
  const { capturedFrame, runPoseEstimation } = useSensor();

  // Solver: ITERATIVE | EPNP | SQPNP (mapped to cv2.SOLVEPNP_* in the backend)
  const [algorithm, setAlgorithm] = useState("ITERATIVE");
  // Keypoint source. Phase 1: projected 3D landmarks (simulated detector).
  const [feature, setFeature] = useState("LANDMARKS");
  const [target, setTarget] = useState("SAT-001");
  const [noiseSigma, setNoiseSigma] = useState(0);
  const [excludeOccluded, setExcludeOccluded] = useState(true);
  const [autoEstimate, setAutoEstimate] = useState(true);
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);
  const [lastImagePoints, setLastImagePoints] = useState(null);

  const landmarkStats = useMemo(() => {
    const lm = capturedFrame?.landmarks;
    if (!lm?.points) return { total: 0, inImage: 0, visible: 0 };
    const ids = Object.keys(lm.points);
    const inImage = ids.filter((id) => lm.inImage?.[id]).length;
    const visible = ids.filter((id) => lm.inImage?.[id] && !lm.occluded?.[id]).length;
    return { total: ids.length, inImage, visible };
  }, [capturedFrame]);

  const handleEstimate = useCallback(async () => {
    if (!capturedFrame) return null;

    const imagePoints = buildImagePoints(capturedFrame, {
      noiseSigmaPx: noiseSigma,
      excludeOccluded,
    });
    setLastImagePoints(imagePoints);

    const gt = capturedFrame.ground_truth_pose;
    return runPoseEstimation({
      image_points: imagePoints,
      image_size: capturedFrame.image_size,
      camera_matrix: capturedFrame.camera_matrix,
      fov_degrees: Number(capturedFrame.fov) || 60,
      fov_mode: "vertical",
      method: algorithm,
      use_ransac: false,
      noise_sigma_px: Number(noiseSigma) || 0,
      keypoint_source: feature,
      sensor_name: capturedFrame.selectedSensor,
      ground_truth: gt ? { position: gt.position, rotation_matrix: gt.rotation_matrix } : null,
      target_id: target,
    });
  }, [capturedFrame, noiseSigma, excludeOccluded, algorithm, feature, target, runPoseEstimation]);

  // Auto-estimate once for every newly captured frame
  const lastAutoFrameRef = useRef(null);
  useEffect(() => {
    if (!autoEstimate || !capturedFrame?.id) return;
    if (lastAutoFrameRef.current === capturedFrame.id) return;
    lastAutoFrameRef.current = capturedFrame.id;
    handleEstimate();
  }, [autoEstimate, capturedFrame, handleEstimate]);

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
