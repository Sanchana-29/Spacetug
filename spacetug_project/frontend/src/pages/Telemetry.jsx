import Layout from "../components/Layout/Layout";
import "./Telemetry.css";

import TelemetryControls from "../components/Telemetry/TelemetryControls/TelemetryControls";
import LiveMetrics from "../components/Telemetry/LiveMetrics/LiveMetrics";
import DistanceChart from "../components/Telemetry/DistanceChart/DistanceChart";
import VelocityChart from "../components/Telemetry/VelocityChart/VelocityChart";
import AttitudeChart from "../components/Telemetry/AttitudeChart/AttitudeChart";
import TumblingChart from "../components/Telemetry/TumblingChart/TumblingChart";
import TelemetryLogs from "../components/Telemetry/TelemetryLogs/TelemetryLogs";
import PerceptionCharts from "../components/Telemetry/PerceptionCharts/PerceptionCharts";

function Telemetry() {
  return (
    <Layout
      showInspector={false}
      showFooter={false}
    >
      <div className="telemetry-page">

        <TelemetryControls />

        <LiveMetrics />

        <PerceptionCharts />

        <DistanceChart />

        <VelocityChart />

        <AttitudeChart />

        <TumblingChart />

        <TelemetryLogs />

      </div>
    </Layout>
  );
}

export default Telemetry;