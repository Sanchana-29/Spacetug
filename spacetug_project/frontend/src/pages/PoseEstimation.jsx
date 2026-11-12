import { useState } from "react";
import Layout from "../components/Layout/Layout";
import "./PoseEstimation.css";

import PoseControls from "../components/PoseEstimation/PoseControls/PoseControls";
import PosePipeline from "../components/PoseEstimation/PosePipeline/PosePipeline";
import PoseViewer from "../components/PoseEstimation/PoseViewer/PoseViewer";
import PoseResults from "../components/PoseEstimation/PoseResults/PoseResults";

function PoseEstimation() {
  const [algorithm, setAlgorithm] = useState("SolvePnP");
  const [feature, setFeature] = useState("ORB");
  const [target, setTarget] = useState("SAT-001");
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);

  return (
    <Layout showInspector={false} showFooter={false}>
      <div className="pose-page">
        {/* TOP CONTROL HEADER BAR */}
        <PoseControls
          algorithm={algorithm}
          setAlgorithm={setAlgorithm}
          feature={feature}
          setFeature={setFeature}
          target={target}
          setTarget={setTarget}
        />

        {/* 3-COLUMN MISSION CONTROL GRID (1fr : 1.6fr : 1fr) */}
        <div className="pose-middle">
          {/* LEFT: POSE ESTIMATION ENGINE & LIVE MATRICES */}
          <div className="pose-left-col">
            <PosePipeline
              algorithm={algorithm}
              feature={feature}
              isLiveStreaming={isLiveStreaming}
            />
          </div>

          {/* CENTER: DUAL 3D BORESIGHT & 2D 7-POINT KEYPOINT VIEWPORTS */}
          <div className="pose-center-col">
            <PoseViewer
              algorithm={algorithm}
              feature={feature}
              isLiveStreaming={isLiveStreaming}
              setIsLiveStreaming={setIsLiveStreaming}
            />
          </div>

          {/* RIGHT: COORDINATE TRANSFORMATION, CIRCULAR GAUGES & ATTITUDE SPARKLINES */}
          <div className="pose-right-col">
            <PoseResults
              isLiveStreaming={isLiveStreaming}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default PoseEstimation;
