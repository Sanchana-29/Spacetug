import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Welcome from "../pages/Welcome";
import Dashboard from "../pages/Dashboard";
import Sensors from "../pages/Sensors";
import Detection from "../pages/Detection";
import PoseEstimation from "../pages/PoseEstimation";
import DatasetGenerator from "../pages/DatasetGenerator";
import ProcessingPipelinePage from "../pages/ProcessingPipelinePage";
import Telemetry from "../pages/Telemetry";
import MissionSummary from "../pages/MissionSummary";
import Settings from "../pages/Settings";
import BackgroundPerception from "../components/Sensors/LivePerceptionRunner/BackgroundPerception";

function AppRoutes() {
  return (
    <BrowserRouter>
      {/* Keeps live perception running while other pages are open */}
      <BackgroundPerception />
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/dashboard" element={<Dashboard />} />
        {/* Retain aliases redirecting to /dashboard */}
        <Route path="/simulation" element={<Navigate to="/dashboard" replace />} />
        <Route path="/space-environment" element={<Navigate to="/dashboard" replace />} />
        <Route path="/sensors" element={<Sensors />} />
        <Route path="/detection" element={<Detection />} />
        <Route path="/pose-estimation" element={<PoseEstimation />} />
        <Route path="/image-processing" element={<ProcessingPipelinePage />} />
        <Route path="/dataset-generator" element={<DatasetGenerator />} />
        <Route path="/telemetry" element={<Telemetry />} />
        <Route path="/mission-summary" element={<Navigate to="/settings" replace />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;
