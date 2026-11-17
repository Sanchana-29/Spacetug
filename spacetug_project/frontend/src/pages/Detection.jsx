import { useEffect } from "react";
import Layout from "../components/Layout/Layout";
import "./Detection.css";

import DetectionControls from "../components/Detection/DetectionControls/DetectionControls";
import CapturedGallery from "../components/Detection/CapturedGallery/CapturedGallery";
import DetectionViewer from "../components/Detection/DetectionViewer/DetectionViewer";
import DetectionDock from "../components/Detection/DetectionDock/DetectionDock";
import { useSensor } from "../context/SensorContext";

function Detection() {
  const { setDetectionResult } = useSensor();

  // Reset detection results on entering the Detection tab
  useEffect(() => {
    if (setDetectionResult) {
      setDetectionResult(null);
    }
  }, [setDetectionResult]);

  return (
    <Layout
      showInspector={false}
      showFooter={false}
    >
      <div className="detection-page">
        {/* TOP CONTROLS BAR: SPANNING FULL PAGE WIDTH */}
        <DetectionControls />

        {/* 3-COLUMN LAYOUT: GALLERY | DETECTION CANVAS | RESULTS DOCK */}
        <div className="detection-layout-grid">
          {/* LEFT-SIDE CAPTURED IMAGE GALLERY DRAWER */}
          <div className="detection-left-sidebar">
            <CapturedGallery />
          </div>

          {/* CENTER HIGH-RESOLUTION DETECTION CANVAS */}
          <div className="detection-center-viewport">
            <DetectionViewer />
          </div>

          {/* RIGHT-SIDE CONTROL & DETECTION RESULTS DOCK */}
          <div className="detection-right-dock">
            <DetectionDock />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default Detection;
